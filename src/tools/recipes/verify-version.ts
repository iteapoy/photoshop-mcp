import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import type { PhotoshopConnection } from '../../platform/connection.js';
import { getPhotoshopExportsWorkingDir } from '../../lib/export-paths.js';
import {
  compareVersionImages,
  decodeVersionPng,
  encodeVersionPng,
  versionContactSheet,
  versionThumbnail,
  MAX_VERSION_PIXELS,
} from '../../lib/version-images.js';
import { VERSION_DOCUMENT_INFO_SCRIPT, versionCaptureScript } from '../../api/version-capture.js';
import { atomicFailure, parseSnippetResult, runSnippet } from '../atomic-shared.js';
import { classifyError } from '../../errors/envelope.js';

const TOOL_NAME = 'photoshop_recipe_verify_version';
const unsavedSeries = new Map<number, string>();
interface DocumentInfo {
  id: number;
  name: string;
  path: string | null;
  saved: boolean;
  width: number;
  height: number;
}
interface VersionManifest {
  version_id: string;
  label: string | null;
  document: DocumentInfo;
  render: Record<string, unknown>;
  artifacts: Record<string, string>;
}

export function bindVerifyVersion(connection: PhotoshopConnection): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'Save a version and verify its visible pixels against the previous successful version in the same series. Writes a layered PSD copy, full-resolution lossless PNG, preview, labeled comparison sheet, pixel difference and JSON report. First call establishes a baseline; changed dimensions are reported without resampling the pixel comparison.\nPreconditions: 8/16-bit RGB document, at most 32 million pixels. Side effects: writes version files; source document, path, dirty state and history are unchanged. Pixel statistics compare canonical sRGB 8-bit renders, not PSD structure or original 16-bit values. Returns one image plus paths, comparison statistics and stage timings.',
      inputSchema: {
        type: 'object',
        properties: {
          series: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,64}$',
            description:
              'Stable comparison series. Omit for a series derived from the saved source path or this unsaved document. Supply explicitly to compare duplicated documents.',
          },
          label: {
            type: 'string',
            maxLength: 120,
            description: 'Optional human-readable version label.',
          },
          save_psd: {
            type: 'boolean',
            default: true,
            description: 'Include a layered PSD copy; source is never rebound or marked saved.',
          },
          max_dimension_px: {
            type: 'integer',
            minimum: 128,
            maximum: 2048,
            default: 1024,
            description:
              'Preview long edge only. Pixel comparison always uses the full-resolution render.',
          },
          pixel_threshold: {
            type: 'integer',
            minimum: 0,
            maximum: 255,
            default: 0,
            description:
              'A pixel changes when any premultiplied RGBA channel delta exceeds this threshold.',
          },
        },
        additionalProperties: false,
      },
    },
    handler: (args) => verifyVersion(connection, args),
  };
}
function validate(args: Record<string, unknown>): void {
  if (
    Object.keys(args).some(
      (k) =>
        ![
          'series',
          'label',
          'save_psd',
          'max_dimension_px',
          'pixel_threshold',
          'document_id',
        ].includes(k)
    ) ||
    (args.series !== undefined &&
      (typeof args.series !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(args.series))) ||
    (args.label !== undefined && (typeof args.label !== 'string' || args.label.length > 120)) ||
    (args.save_psd !== undefined && typeof args.save_psd !== 'boolean') ||
    (args.max_dimension_px !== undefined &&
      (typeof args.max_dimension_px !== 'number' ||
        !Number.isInteger(args.max_dimension_px) ||
        args.max_dimension_px < 128 ||
        args.max_dimension_px > 2048)) ||
    (args.pixel_threshold !== undefined &&
      (typeof args.pixel_threshold !== 'number' ||
        !Number.isInteger(args.pixel_threshold) ||
        args.pixel_threshold < 0 ||
        args.pixel_threshold > 255))
  )
    throw new Error('Invalid parameter: version verification arguments');
}
async function latestManifest(path: string): Promise<VersionManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const manifest = JSON.parse(raw) as VersionManifest;
  if (
    !manifest ||
    typeof manifest.version_id !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(manifest.version_id)
  )
    throw new Error('Document state: invalid version baseline manifest; choose a new series');
  return manifest;
}
export async function verifyVersion(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    validate(args);
  } catch (error) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: (error as Error).message,
    });
  }
  let stage = 'document_info',
    versionDir: string | undefined,
    lockPath: string | undefined,
    lock: Awaited<ReturnType<typeof open>> | undefined,
    pending: string | undefined;
  const timings: Record<string, number> = {},
    started = Date.now();
  try {
    const info = parseSnippetResult(
      await runSnippet(connection, VERSION_DOCUMENT_INFO_SCRIPT)
    ) as unknown as DocumentInfo;
    if (
      !info ||
      !Number.isSafeInteger(info.id) ||
      info.id <= 0 ||
      !Number.isInteger(info.width) ||
      !Number.isInteger(info.height) ||
      info.width <= 0 ||
      info.height <= 0 ||
      info.width * info.height > MAX_VERSION_PIXELS
    )
      throw new Error('Invalid parameter: invalid document or more than 32 million pixels');
    timings.document_info_ms = Date.now() - started;
    let series = args.series as string | undefined;
    if (!series) {
      if (info.path)
        series = 'file-' + createHash('sha256').update(info.path).digest('hex').slice(0, 20);
      else {
        series = unsavedSeries.get(info.id);
        if (!series) {
          series = 'unsaved-' + randomUUID();
          unsavedSeries.set(info.id, series);
        }
      }
    }
    const seriesDir = join(getPhotoshopExportsWorkingDir(), 'versions', series);
    await mkdir(seriesDir, { recursive: true });
    lockPath = join(seriesDir, '.lock');
    stage = 'series_lock';
    try {
      lock = await open(lockPath, 'wx');
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          'Document state: version series is busy; retry after the current verification finishes. Lock: ' +
            lockPath
        );
      throw error;
    }
    stage = 'baseline';
    const latest = join(seriesDir, 'latest.json'),
      previousManifest = await latestManifest(latest);
    const previous = previousManifest
      ? decodeVersionPng(
          await readFile(join(seriesDir, previousManifest.version_id, 'current.png'))
        )
      : undefined;
    const versionId =
      new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    versionDir = join(seriesDir, versionId);
    await mkdir(versionDir);
    const artifacts: Record<string, string> = {
      current: join(versionDir, 'current.png'),
      preview: join(versionDir, 'preview.png'),
      comparison: join(versionDir, 'comparison.png'),
      report: join(versionDir, 'report.json'),
    };
    if (args.save_psd !== false) artifacts.psd = join(versionDir, 'document.psd');
    stage = 'capture';
    const captureStarted = Date.now();
    const capture = parseSnippetResult(
      await runSnippet(
        connection,
        versionCaptureScript(info.id, artifacts.current, artifacts.psd),
        180000
      )
    );
    if (!capture || capture.ok === false || !capture.document || !capture.render)
      throw new Error('Version capture did not return a complete result');
    if (artifacts.psd) await stat(artifacts.psd);
    timings.capture_ms = Date.now() - captureStarted;
    stage = 'image_comparison';
    const comparisonStarted = Date.now();
    const current = decodeVersionPng(await readFile(artifacts.current));
    const { metrics, difference } = compareVersionImages(
      current,
      previous,
      (args.pixel_threshold as number | undefined) ?? 0
    );
    const preview = encodeVersionPng(
      versionThumbnail(current, (args.max_dimension_px as number | undefined) ?? 1024)
    );
    const sheet = encodeVersionPng(versionContactSheet(current, previous, difference));
    await writeFile(artifacts.preview, preview);
    await writeFile(artifacts.comparison, sheet);
    if (difference) {
      artifacts.difference = join(versionDir, 'difference.png');
      await writeFile(artifacts.difference, encodeVersionPng(difference));
    }
    timings.comparison_ms = Date.now() - comparisonStarted;
    timings.total_ms = Date.now() - started;
    const manifest: VersionManifest = {
      version_id: versionId,
      label: (args.label as string | undefined) ?? null,
      document: capture.document as unknown as DocumentInfo,
      render: capture.render as Record<string, unknown>,
      artifacts,
    };
    const report = {
      ...manifest,
      series,
      previous_version_id: previousManifest?.version_id ?? null,
      comparison: metrics,
      previous_dimensions: previous ? { width: previous.width, height: previous.height } : null,
      current_dimensions: { width: current.width, height: current.height },
      comparison_semantics:
        'Full-resolution sRGB 8-bit visible render; premultiplied RGB plus alpha. Fully transparent RGB is ignored. Bounds use exclusive right/bottom. Difference image amplifies changed pixels for viewing.',
      timings_ms: timings,
    };
    stage = 'publish';
    await writeFile(artifacts.report, JSON.stringify(report, null, 2) + '\n');
    // Publish last, so a partial capture never replaces the previous baseline.
    pending = join(seriesDir, '.pending-' + randomUUID() + '.json');
    await writeFile(pending, JSON.stringify(manifest, null, 2) + '\n');
    await rename(pending, latest);
    pending = undefined;
    const body = {
      ok: true,
      summary:
        metrics.status === 'first_version'
          ? 'Version saved; comparison baseline established'
          : metrics.status === 'dimensions_changed'
            ? 'Version saved; dimensions changed, pixel comparison skipped'
            : `Version saved; ${metrics.changed_pixels} changed pixels`,
      series,
      version_id: versionId,
      previous_version_id: report.previous_version_id,
      comparison: metrics,
      artifacts,
      timings_ms: timings,
      undo_history_states_consumed: 0,
    };
    return {
      content: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: (previous ? sheet : preview).toString('base64'),
        },
        { type: 'text', text: JSON.stringify(body, null, 2) },
      ],
    };
  } catch (error) {
    if (versionDir) await rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const envelope = classifyError(message);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ...envelope, verification_stage: stage, timings_ms: timings },
            null,
            2
          ),
        },
      ],
    };
  } finally {
    if (pending) await unlink(pending).catch(() => undefined);
    if (lock) {
      await lock.close().catch(() => undefined);
      if (lockPath) await unlink(lockPath).catch(() => undefined);
    }
  }
}
