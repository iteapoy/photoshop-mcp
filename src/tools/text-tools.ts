import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';
import { installUserFont } from '../platform/install-font.js';
import { layerName } from './layer-target.js';
import {
  emitTextRangesLiteral,
  emitTextStyleLiteral,
  parseTextRangesArg,
  parseTextStyleArgs,
} from './text-style-options.js';

export function createTextTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_list_fonts',
        description:
          'List installed fonts available to Photoshop.\n\n' +
          'Use when: choosing a font for photoshop_create_text_layer or photoshop_set_text_style.\n' +
          'TextItem.font requires the PostScript name — use postScriptName from results, or pass display name to set/create tools (they resolve automatically).\n\n' +
          'Returns: fonts array ({ name, postScriptName, family, style }), total count, truncated flag.\n' +
          'First call may be slow (app.fonts.length can exceed 1000). Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional substring filter (matches name, postScriptName, or family)',
            },
            limit: {
              type: 'number',
              description: 'Maximum fonts to return (default: 200)',
              default: 200,
              minimum: 1,
              maximum: 1000,
            },
          },
        },
      },
      handler: async (args) => listFonts(connection, args),
    },
    {
      tool: {
        name: 'photoshop_install_font',
        description:
          "Install a font file for the current user and reload Photoshop's font list without quitting.\n\n" +
          'Use when: photoshop_list_fonts does not include a font the user wants, and they already have the font file.\n' +
          'Does not download fonts. file_path is an absolute path to a .ttf, .otf, .ttc, or .otc.\n' +
          'macOS copies it to ~/Library/Fonts (Font Book, Current User). Windows installs it for the current user only, not for all users.\n' +
          'If Photoshop is open, this calls app.refreshFonts() so the new PostScript names are listed immediately. Do not quit Photoshop.\n\n' +
          'Fredoka Bold is the Bold named instance inside the variable font Fredoka[wdth,wght].ttf (SIL Open Font License, Google Fonts). Its PostScript name is Fredoka-Bold. There is no separate Fredoka Bold file in that release.\n\n' +
          "Returns: installed_path, post_script_names, fonts_refreshed. Side effects: writes the current-user font folder and reloads the open app's font list.",
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to a .ttf, .otf, .ttc, or .otc file',
            },
          },
          required: ['file_path'],
        },
      },
      handler: async (args) => installFont(connection, args),
    },
    {
      tool: {
        name: 'photoshop_update_text_content',
        description:
          'Replace the string contents of the active text layer. Font, color, and alignment stay as they are.\n\n' +
          'Use when: the wording of an existing text layer should change.\n' +
          'Do NOT use when: no text layer exists yet — use photoshop_create_text_layer.\n' +
          'Do NOT use when: only style should change — use photoshop_set_text_style.\n\n' +
          'Returns: confirmation with the new text.\n' +
          'Preconditions: active document and an active text layer. Side effects: replaces the characters. The same string is idempotent. Reversible with photoshop_undo.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'New text content',
            },
          },
          required: ['text'],
        },
      },
      handler: async (args) => updateTextContent(connection, args),
    },
    {
      tool: {
        name: 'photoshop_get_text',
        description:
          "Read text content, typography, and pixel bounds. all=true scans every text layer; otherwise read layer_name/layer_id or the active layer.\n" +
          "Returns: scope=layer with layer, or scope=document with count and layers[]. Each entry includes id/name/parent, contents, font, size/leading (pt), tracking, kind, paragraph box size, alignment, RGB, bounds.\n" +
          "Preconditions: active document; a single target must be text. Side effects: none. Use photoshop_get_layers for the layer tree.",
        inputSchema: {
          type: 'object',
          properties: {
            all: {
              type: 'boolean',
              description: 'Return every text layer in the document instead of a single layer',
              default: false,
            },
            layer_name: {
              type: 'string',
              description:
                'Target text layer by name (searches nested groups). Omit to read the active layer.',
            },
          },
        },
      },
      handler: async (args) => getText(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_style',
        description:
          "Set whole-layer typography: font, size, color, alignment, kerning, tracking, leading, or paragraph box. Display font names resolve to PostScript names; discover fonts with photoshop_list_fonts.\n" +
          "Use photoshop_create_text_layer for new text, photoshop_update_text_content for wording, or photoshop_set_text_ranges for mixed styles.\n" +
          "Returns: updated style. Preconditions: active text layer. Side effects: updates TextItem attributes.",
        inputSchema: {
          type: 'object',
          properties: {
            kerning_mode: {
              type: 'string',
              enum: ['manual', 'metrics', 'optical'],
              description:
                'Kerning mode. New text defaults to manual with zero pair adjustment; tracking is a separate spacing setting.',
            },
            tracking: {
              type: 'number',
              description: 'Character spacing in 1/1000 em (−1000 to 10000)',
            },
            leading: {
              type: 'number',
              description: 'Line height in points. Sets auto_leading false.',
              minimum: 0.1,
            },
            auto_leading: {
              type: 'boolean',
              description: 'Use Photoshop auto leading',
            },
            kind: {
              type: 'string',
              enum: ['point', 'paragraph'],
              description: 'point or paragraph (wrapped) text',
            },
            box_width: {
              type: 'number',
              description: 'Paragraph box width in pixels (implies kind=paragraph)',
              minimum: 1,
            },
            box_height: {
              type: 'number',
              description: 'Paragraph box height in pixels (implies kind=paragraph)',
              minimum: 1,
            },
            alignment: {
              type: 'string',
              enum: [
                'LEFT',
                'CENTER',
                'RIGHT',
                'LEFTJUSTIFIED',
                'CENTERJUSTIFIED',
                'RIGHTJUSTIFIED',
                'FULLYJUSTIFIED',
              ],
              description: 'Text justification for the whole layer',
            },
            fontName: {
              type: 'string',
              description: 'Font display or PostScript name',
            },
            fontSize: {
              type: 'number',
              description: 'Size in points',
              minimum: 1,
            },
            red: { type: 'number', description: 'Red 0–255', minimum: 0, maximum: 255 },
            green: { type: 'number', description: 'Green 0–255', minimum: 0, maximum: 255 },
            blue: { type: 'number', description: 'Blue 0–255', minimum: 0, maximum: 255 },
          },
        },
      },
      handler: async (args) => setTextStyle(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_ranges',
        description:
          'Apply mixed fonts, sizes, and colors inside a single text layer (Action Manager textStyleRange).\n\n' +
          'Users often say: mixed type, two fonts in one line, multicolor text, 混排, 同一文字层.\n\n' +
          'Use when: one layer must contain more than one font or color. from is inclusive, to is exclusive (JavaScript slice / ExtendScript string indexes).\n' +
          'Do NOT use when: the whole layer shares one style — use photoshop_set_text_style.\n' +
          'Do NOT split into extra layers for mixed type unless this tool errors.\n\n' +
          'Returns: JSON { ok, summary, details: { style, ranges } }.\n' +
          'Preconditions: active text layer. Unspecified gaps keep the layer default style. Side effects: rewrites character styles; restores tracking/leading/box afterward.',
        inputSchema: {
          type: 'object',
          properties: {
            ranges: {
              type: 'array',
              description: 'Non-overlapping character spans (from inclusive, to exclusive)',
              minItems: 1,
              maxItems: 64,
              items: {
                type: 'object',
                properties: {
                  from: { type: 'number', description: 'Start index (inclusive)', minimum: 0 },
                  to: { type: 'number', description: 'End index (exclusive)' },
                  fontName: {
                    type: 'string',
                    description: 'Font display or PostScript name for this span',
                  },
                  fontSize: { type: 'number', description: 'Size in points', minimum: 1 },
                  red: { type: 'number', minimum: 0, maximum: 255 },
                  green: { type: 'number', minimum: 0, maximum: 255 },
                  blue: { type: 'number', minimum: 0, maximum: 255 },
                },
                required: ['from', 'to'],
              },
            },
          },
          required: ['ranges'],
        },
      },
      handler: async (args) => setTextRanges(connection, args),
    },
  ];
}

async function installFont(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.file_path;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'file_path is required.',
    });
  }
  try {
    const installed = await installUserFont(filePath);
    const refresh = await refreshPhotoshopFontList(connection, installed.postScriptNames);
    const names = installed.postScriptNames.length
      ? installed.postScriptNames.join(', ')
      : 'the name returned by photoshop_list_fonts';
    const summary = installFontSummary(installed.alreadyInstalled, names, refresh);
    return atomicSuccess(
      summary,
      {
        installed_path: installed.installedPath,
        post_script_names: installed.postScriptNames,
        family: installed.family,
        already_installed: installed.alreadyInstalled,
        fonts_refreshed: refresh.refreshed,
        visible_post_script_names: refresh.visible,
        needs_photoshop_restart: refresh.photoshopRunning && !refresh.refreshed,
      },
      'photoshop_list_fonts'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

interface FontRefreshResult {
  refreshed: boolean;
  visible: string[];
  photoshopRunning: boolean;
}

/**
 * Application.refreshFonts() forces the font list to refresh.
 * Adobe documents it on Application in the Photoshop JavaScript Reference,
 * and Photoshop 2026's CC Libraries panel calls app.refreshFonts() before
 * looking a font up. Copying a file into the user font folder does not
 * update an already-open session by itself.
 */
async function refreshPhotoshopFontList(
  connection: PhotoshopConnection,
  postScriptNames: string[]
): Promise<FontRefreshResult> {
  try {
    const api = await new PhotoshopAPIFactory(connection).createAPI();
    const result = await api.executeScript(
      ExtendScriptSnippets.refreshFonts(postScriptNames),
      undefined,
      { launch: false }
    );
    const visible = readVisiblePostScriptNames(result);
    const refreshed = postScriptNames.length === 0 || visible.length > 0;
    return { refreshed, visible, photoshopRunning: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      refreshed: false,
      visible: [],
      photoshopRunning: !/not running/i.test(message),
    };
  }
}

function readVisiblePostScriptNames(result: unknown): string[] {
  if (!result || typeof result !== 'object' || !('visible' in result)) return [];
  const visible = (result as { visible?: unknown }).visible;
  if (!Array.isArray(visible)) return [];
  return visible.filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function installFontSummary(
  alreadyInstalled: boolean,
  names: string,
  refresh: FontRefreshResult
): string {
  if (refresh.refreshed) {
    return alreadyInstalled
      ? `Font is already installed. Photoshop reloaded its font list. Use postScriptName: ${names}.`
      : `Installed the font and reloaded Photoshop's font list. Use postScriptName: ${names}.`;
  }
  if (!refresh.photoshopRunning) {
    return `Installed the font for the current user. Photoshop is not open, so the names will be listed when it starts. Use postScriptName: ${names}.`;
  }
  return `Installed the font, but it was still missing after app.refreshFonts(). Quit Photoshop and open it again, then use postScriptName: ${names}.`;
}

async function listFonts(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = args.query as string | undefined;
  const limit = (args.limit as number | undefined) ?? 200;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.listFonts(query, limit);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Fonts listed${query ? ` (query: "${query}")` : ''}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing fonts: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function updateTextContent(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.updateTextContent(text);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text content updated to: "${text}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating text content: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getText(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const all = args.all === true;
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.getText(layerName(args), all));
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable text result: ${String(raw)}`));
    }
    if (details.scope === 'document') {
      const layers = Array.isArray(details.layers) ? details.layers : [];
      const names = layers
        .slice(0, 8)
        .map((entry) =>
          entry && typeof entry === 'object'
            ? String((entry as Record<string, unknown>).name ?? '')
            : ''
        )
        .filter((value) => value.length > 0);
      const suffix = layers.length > names.length ? ', …' : '';
      return atomicSuccess(
        `Found ${layers.length} text layer(s)${names.length ? `: ${names.join(', ')}${suffix}` : ''}`,
        details
      );
    }
    const layer =
      details.layer && typeof details.layer === 'object'
        ? (details.layer as Record<string, unknown>)
        : {};
    const contents = typeof layer.contents === 'string' ? layer.contents : '';
    const font = typeof layer.font === 'string' ? layer.font : 'font unknown';
    const size =
      typeof layer.size === 'number' ? `${Math.round(layer.size * 100) / 100}pt` : 'size unknown';
    const alignment = typeof layer.alignment === 'string' ? `, ${layer.alignment}` : '';
    return atomicSuccess(`"${contents}" — ${font} ${size}${alignment}`, details);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function setTextStyle(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = parseTextStyleArgs(args, { requireSome: true });
  if (parsed.error) return atomicFailure(parsed.error);

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.setTextStyle(emitTextStyleLiteral(parsed.style))
    );
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable text style result: ${String(raw)}`));
    }
    const style =
      details.style && typeof details.style === 'object'
        ? (details.style as Record<string, unknown>)
        : details;
    const tracking = typeof style.tracking === 'number' ? ` tracking=${style.tracking}` : '';
    const kind = typeof style.kind === 'string' ? ` ${style.kind}` : '';
    return atomicSuccess(`Text style updated${kind}${tracking}`, details);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function setTextRanges(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const parsed = parseTextRangesArg(args);
  if (parsed.error) return atomicFailure(parsed.error);

  try {
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.setTextRanges(emitTextRangesLiteral(parsed.ranges))
    );
    const details = parseSnippetResult(raw);
    if (!details) {
      return atomicFailureFromError(new Error(`Unparseable text ranges result: ${String(raw)}`));
    }
    return atomicSuccess(`Applied ${parsed.ranges.length} text range(s)`, details);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
