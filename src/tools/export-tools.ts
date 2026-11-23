import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';
import { layerName } from './layer-target.js';

const EXPORT_FORMATS = ['PNG', 'JPEG', 'WEBP', 'AVIF'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const LAYER_FORMATS = ['PNG', 'JPEG', 'WEBP'] as const;
type LayerFormat = (typeof LAYER_FORMATS)[number];

/** Default folder for tools that write files without an explicit path. */
const DEFAULT_EXPORT_DIR = join(homedir(), '.photoshop-mcp', 'exports');

export function createExportTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_export_as',
        description:
          'Export a copy of the active document as PNG, JPEG, WebP or AVIF without changing the open document. WebP/AVIF require Photoshop 23.2+/recent builds and return a clear error when unsupported.\n\n' +
          'Users often say: export for web, save as webp, quick export png.\n\n' +
          'Use when: web-ready delivery formats are needed (WebP/AVIF/modern pipelines), or one artboard from a multi-screen file.\n' +
          'Do NOT use when: saving the working document itself — use photoshop_save_document. For every artboard at once use photoshop_export_artboards.\n\n' +
          'Returns: JSON { ok, summary, details: { path, format, method, artboard_id? } }.\n' +
          'Preconditions: active document. Side effects: writes one file to path. Optional artboard_id exports only that board (duplicate + crop).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute output file path (extension should match format)' },
            format: { type: 'string', enum: EXPORT_FORMATS, description: 'Export format', default: 'PNG' },
            quality: { type: 'number', description: 'Quality 0-100 (JPEG/WebP/AVIF)', minimum: 0, maximum: 100, default: 80 },
            artboard_id: {
              type: 'number',
              description:
                'Optional artboard layer id from photoshop_list_artboards — export that board only instead of the full canvas',
            },
          },
          required: ['path'],
        },
      },
      handler: async (args) => exportAs(connection, args),
    },
    {
      tool: {
        name: 'photoshop_export_layer',
        description:
          "Export one layer or group as PNG/JPEG/WebP; trim transparent margins by default. Omit path to auto-name under ~/.photoshop-mcp/exports; missing folders are created.\n" +
          "Group exports preserve internal visibility. Use layer_id for duplicate names; omit target for the active layer. Use photoshop_export_as for the whole canvas.\n" +
          "Returns: path, format, layer, width, height, trimmed, method.\n" +
          "Preconditions: active document and target with visible pixels; WebP requires Photoshop 23.2+. Side effects: writes a file using a temporary duplicate; source document is unchanged.",
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Absolute output file path. Omit to auto-name inside ~/.photoshop-mcp/exports. The parent folder is created when missing.',
            },
            format: {
              type: 'string',
              enum: LAYER_FORMATS,
              description: 'Export format (WebP needs Photoshop 23.2+)',
              default: 'PNG',
            },
            quality: {
              type: 'number',
              description: 'Quality 0-100 for JPEG/WebP',
              minimum: 0,
              maximum: 100,
              default: 90,
            },
            trim: {
              type: 'boolean',
              description: 'Trim transparent margins so the file is the layer content (default true)',
              default: true,
            },
            layer_name: {
              type: 'string',
              description:
                'Target layer by name (searches nested groups). Omit to export the active layer.',
            },
          },
        },
      },
      handler: async (args) => exportLayer(connection, args),
    },
  ];
}

async function exportLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const format: LayerFormat = LAYER_FORMATS.includes(args.format as LayerFormat)
    ? (args.format as LayerFormat)
    : 'PNG';
  const quality =
    typeof args.quality === 'number' && Number.isFinite(args.quality)
      ? Math.max(0, Math.min(100, Math.round(args.quality)))
      : 90;
  const trim = args.trim !== false;
  const requestedPath = typeof args.path === 'string' ? args.path.trim() : '';

  try {
    await mkdir(requestedPath ? dirname(requestedPath) : DEFAULT_EXPORT_DIR, { recursive: true });
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.exportLayer(
        requestedPath,
        DEFAULT_EXPORT_DIR,
        format,
        quality,
        layerName(args),
        trim
      )
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable layer export result: ${String(raw)}`));
    }
    if (parsed.ok === false) {
      return atomicFailureFromError(new Error(String(parsed.message || 'Layer export failed')), {
        code: parsed.code === 'version_unsupported' ? 'version_unsupported' : 'unknown',
        suggested_next_tool: 'photoshop_export_as',
      });
    }
    const outputPath = typeof parsed.path === 'string' ? parsed.path : requestedPath;
    const width = typeof parsed.width === 'number' ? Math.round(parsed.width) : null;
    const height = typeof parsed.height === 'number' ? Math.round(parsed.height) : null;
    const size = width !== null && height !== null ? `${width}×${height}` : 'unknown size';
    return atomicSuccess(`Exported layer "${String(parsed.layer ?? '')}" (${size}) to ${outputPath}`, {
      path: outputPath,
      format,
      layer: parsed.layer,
      width,
      height,
      trimmed: parsed.trimmed === true,
      method: parsed.method,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function exportAs(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = typeof args.path === 'string' ? args.path.trim() : '';
  if (!filePath) {
    return atomicFailureFromError(new Error('path parameter is required'));
  }
  const format: ExportFormat = EXPORT_FORMATS.includes(args.format as ExportFormat)
    ? (args.format as ExportFormat)
    : 'PNG';
  const quality =
    typeof args.quality === 'number' && Number.isFinite(args.quality)
      ? Math.max(0, Math.min(100, Math.round(args.quality)))
      : 80;
  const artboardId =
    typeof args.artboard_id === 'number' && Number.isFinite(args.artboard_id)
      ? Math.trunc(args.artboard_id)
      : undefined;

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.exportAs(filePath, format, quality, artboardId)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable export result: ${String(raw)}`));
    }
    if (parsed.ok === false) {
      return atomicFailureFromError(new Error(String(parsed.message || 'Export failed')), {
        code:
          parsed.code === 'artboard_not_found'
            ? 'artboard_not_found'
            : 'version_unsupported',
        suggested_next_tool:
          parsed.code === 'artboard_not_found' ? 'photoshop_list_artboards' : 'photoshop_save_document',
      });
    }
    return atomicSuccess(`Exported ${format} to ${filePath}`, {
      path: filePath,
      format,
      method: parsed.method,
      ...(artboardId !== undefined ? { artboard_id: artboardId } : {}),
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
