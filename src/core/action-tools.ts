import { Ajv } from 'ajv';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { envelopeToToolResult } from '../errors/envelope.js';
import { TOOL_ANNOTATIONS } from './tool-annotations.js';
import type { ToolRegistry, ToolResult } from './tool-registry.js';

const groups = {
  photoshop_document: {
    description:
      'Create, open, inspect, list, switch, save, or close Photoshop documents. ' +
      'open loads a file as its own document. resize_image scales the image; crop cuts the document to a rectangle. ' +
      'flatten turns the document into one Background layer and discards hidden layers. ' +
      'Use photoshop_merge_visible_layers to keep hidden layers. ' +
      'stack_images opens two or more aligned image files and combines them in the first image document ' +
      'using a statistical blend ' +
      '(median removes transient objects, mean reduces noise).',
    actions: {
      create: ['photoshop_create_document'],
      open: ['photoshop_open_image'],
      get_info: ['photoshop_get_document_info'],
      list: ['photoshop_list_documents'],
      set_active: ['photoshop_set_active_document'],
      save: ['photoshop_save_document'],
      close: ['photoshop_close_document'],
      resize_image: ['photoshop_resize_image'],
      crop: ['photoshop_crop_document'],
      flatten: ['photoshop_flatten_image'],
      stack_images: ['photoshop_image_stack'],
    },
  },
  photoshop_layer: {
    description:
      'Create, list, edit, duplicate, delete, or transform a layer. ' +
      'Use select with an exact name or layer_id to activate a layer in the Layers panel. ' +
      'Use translate with deltaX and deltaY to shift a layer by pixels on the canvas. ' +
      'Use reorder for stacking order. Use photoshop_group with move_layers_into_group for group membership. ' +
      'For update, provide one property: name, opacity, blendMode, visible, or locked. ' +
      'rasterize converts one layer to pixels. merge_visible combines all visible layers in the document and keeps hidden layers. ' +
      'Use photoshop_flatten_image for a single Background layer. ' +
      'place_image inserts a file as a layer. fit_to_document scales a layer to fit the canvas. ' +
      'fill paints a solid color; fill_gradient paints a gradient. apply_style sets one layer effect ' +
      'such as a shadow, glow, stroke, or bevel and can replace existing effects. ' +
      'content_aware_fill fills the current pixel selection from surrounding content, then deselects it. ' +
      'create_shape adds an editable vector shape layer with optional fill and stroke.',
    actions: {
      create: ['photoshop_create_layer'],
      list: ['photoshop_get_layers'],
      select: ['photoshop_select_layer_by_name'],
      update: [
        'photoshop_rename_layer',
        'photoshop_set_layer_opacity',
        'photoshop_set_layer_blend_mode',
        'photoshop_set_layer_visibility',
        'photoshop_set_layer_locked',
      ],
      duplicate: ['photoshop_duplicate_layer'],
      delete: ['photoshop_delete_layer'],
      translate: ['photoshop_move_layer'],
      scale: ['photoshop_scale_layer'],
      rotate: ['photoshop_rotate_layer'],
      reorder: ['photoshop_reorder_layer'],
      rasterize: ['photoshop_rasterize_layer'],
      merge_visible: ['photoshop_merge_visible_layers'],
      place_image: ['photoshop_place_image'],
      fit_to_document: ['photoshop_fit_layer_to_document'],
      fill: ['photoshop_fill_layer'],
      fill_gradient: ['photoshop_fill_gradient'],
      apply_style: ['photoshop_apply_layer_style'],
      content_aware_fill: ['photoshop_content_aware_fill'],
      create_shape: ['photoshop_create_shape_layer'],
    },
  },
  photoshop_text: {
    description: 'Create a text layer, read its type properties, edit its content, or format it.',
    actions: {
      create: ['photoshop_create_text_layer'],
      get: ['photoshop_get_text'],
      update_content: ['photoshop_update_text_content'],
      set_style: ['photoshop_set_text_style'],
      set_ranges: ['photoshop_set_text_ranges'],
    },
  },
  photoshop_history: {
    description: 'List document history, undo, redo, save a snapshot, or restore a state.',
    actions: {
      list: ['photoshop_get_history'],
      undo: ['photoshop_undo'],
      redo: ['photoshop_redo'],
      save_snapshot: ['photoshop_save_snapshot'],
      revert_to_state: ['photoshop_revert_to_state'],
    },
  },
  photoshop_group: {
    description:
      'Create a group, move layers into a group, or ungroup. ' +
      'Use move_layers_into_group with layer_ids and the destination group_id to change layer hierarchy. ' +
      'Use photoshop_layer with translate for pixel offsets on the canvas.',
    actions: {
      create: ['photoshop_create_group'],
      move_layers_into_group: ['photoshop_move_layers_to_group'],
      ungroup: ['photoshop_ungroup'],
    },
  },
  photoshop_artboard: {
    description:
      'List or create artboards, activate one by ID or name, or export all artboards as separate files.',
    actions: {
      list: ['photoshop_list_artboards'],
      create: ['photoshop_create_artboard'],
      set_active: ['photoshop_set_active_artboard'],
      export: ['photoshop_export_artboards'],
    },
  },
  photoshop_selection: {
    description:
      'Create, inspect, modify, or save the active pixel selection. ' +
      'Use subject for Select Subject. Use photoshop_mask with create_from_selection to turn a selection into a layer mask.',
    actions: {
      get_bounds: ['photoshop_get_selection_bounds'],
      rectangle: ['photoshop_select_rectangle'],
      ellipse: ['photoshop_select_ellipse'],
      subject: ['photoshop_select_subject'],
      select_all: ['photoshop_select_all'],
      deselect: ['photoshop_deselect'],
      invert: ['photoshop_invert_selection'],
      expand: ['photoshop_expand_selection'],
      contract: ['photoshop_contract_selection'],
      feather: ['photoshop_feather_selection'],
      save: ['photoshop_save_selection'],
    },
  },
  photoshop_mask: {
    description:
      'Work with layer masks and clipping masks. create_from_selection adds an editable layer mask. ' +
      'delete discards the layer mask and keeps the pixels. bake_into_layer permanently removes masked-out pixels. ' +
      'apply_gradient paints on the layer mask. create_clipping and release_clipping control clipping to the layer below.',
    actions: {
      create_from_selection: ['photoshop_create_layer_mask'],
      delete: ['photoshop_delete_layer_mask'],
      bake_into_layer: ['photoshop_apply_layer_mask'],
      apply_gradient: ['photoshop_apply_gradient_mask'],
      create_clipping: ['photoshop_create_clipping_mask'],
      release_clipping: ['photoshop_release_clipping_mask'],
    },
  },
  photoshop_smart_object: {
    description:
      'Convert a layer to an embedded Smart Object, replace its contents from a file, open the embedded document for editing, ' +
      'or create an independent duplicate with its own embedded data.',
    actions: {
      convert: ['photoshop_convert_to_smart_object'],
      replace_contents: ['photoshop_replace_smart_object_contents'],
      edit_contents: ['photoshop_edit_smart_object_contents'],
      duplicate_independent: ['photoshop_create_smart_object_via_copy'],
    },
  },
  photoshop_filter: {
    description:
      'Apply a pixel filter to a layer. sharpen runs Unsharp Mask. ' +
      'sharpen, noise, and motion_blur can rasterize text or Smart Objects. ' +
      'For web-export sharpening, use photoshop_recipe_prepare_for_web.',
    actions: {
      gaussian_blur: ['photoshop_apply_gaussian_blur'],
      sharpen: ['photoshop_apply_sharpen'],
      noise: ['photoshop_apply_noise'],
      motion_blur: ['photoshop_apply_motion_blur'],
      high_pass: ['photoshop_apply_high_pass'],
      smart_blur: ['photoshop_apply_smart_blur'],
    },
  },
  photoshop_path: {
    description:
      'Create or delete editable vector paths in the Paths panel, or paint a path onto a pixel layer. ' +
      'create replaces an existing path with the same name. stroke paints the outline and fill paints the interior of a closed path.',
    actions: {
      create: ['photoshop_create_path'],
      stroke: ['photoshop_stroke_path'],
      fill: ['photoshop_fill_path'],
      delete: ['photoshop_delete_path'],
    },
  },
  photoshop_layout: {
    description:
      'Arrange layers on the canvas. align lines up layers against the canvas or a reference layer. ' +
      'distribute equalizes spacing across at least three layers. duplicate_array makes linear or radial copies, with count including the source.',
    actions: {
      align: ['photoshop_align_layers'],
      distribute: ['photoshop_distribute_layers'],
      duplicate_array: ['photoshop_duplicate_array'],
    },
  },
  photoshop_color: {
    description:
      'Adjust color and tone. brightness_contrast, hue_saturation, auto_levels, auto_contrast, ' +
      'desaturate, and invert change the target layer pixels and may rasterize text or Smart Objects. ' +
      'create_adjustment_layer adds a new editable adjustment layer. Choose its type and pass the matching params.',
    actions: {
      brightness_contrast: ['photoshop_adjust_brightness_contrast'],
      hue_saturation: ['photoshop_adjust_hue_saturation'],
      auto_levels: ['photoshop_auto_levels'],
      auto_contrast: ['photoshop_auto_contrast'],
      desaturate: ['photoshop_desaturate'],
      invert: ['photoshop_invert'],
      create_adjustment_layer: ['photoshop_create_adjustment_layer'],
    },
  },
  photoshop_dataset: {
    description:
      'Work with Photoshop Variables and Data Sets in a document. list shows the existing data sets. ' +
      'import loads data sets from an XML file into the document. generate renders named or all ' +
      'existing data sets to files in an output directory.',
    actions: {
      list: ['photoshop_list_datasets'],
      import: ['photoshop_import_datasets'],
      generate: ['photoshop_generate_from_datasets'],
    },
  },
  photoshop_export: {
    description:
      'Export one document, artboard, or layer to a file. document_or_artboard exports the entire ' +
      'document by default or one artboard when artboard_id is set. layer exports a single layer ' +
      'and can trim transparent margins. Use photoshop_artboard with action export to export all artboards.',
    actions: {
      document_or_artboard: ['photoshop_export_as'],
      layer: ['photoshop_export_layer'],
    },
  },
  photoshop_ai: {
    description:
      'Use Photoshop generative AI, native Sky Replacement, or Neural Filters. Check ' +
      'photoshop_get_capabilities first. fill adds or replaces content inside a selection using a prompt; ' +
      'remove erases selected content; expand extends the canvas; upscale increases resolution. ' +
      'generate_image creates an image from a text prompt. replace_sky uses native Sky Replacement; ' +
      'neural_filter runs a named Neural Filter through the UXP bridge. Firefly actions can consume ' +
      'Adobe generative credits. Use photoshop_recipe_remove_distraction if AI removal is unavailable ' +
      'or photoshop_recipe_sky_blend for a manual sky composite.',
    actions: {
      fill: ['photoshop_generative_fill'],
      remove: ['photoshop_generative_remove'],
      expand: ['photoshop_generative_expand'],
      upscale: ['photoshop_generative_upscale'],
      replace_sky: ['photoshop_sky_replacement'],
      generate_image: ['photoshop_generate_image'],
      neural_filter: ['photoshop_neural_filter'],
    },
  },
  photoshop_font: {
    description:
      'Manage fonts available to Photoshop. list searches installed fonts and returns their PostScript ' +
      'names. install takes an existing local .ttf, .otf, .ttc, or .otc file, installs it for the current ' +
      'user, and refreshes the Photoshop font list.',
    actions: {
      list: ['photoshop_list_fonts'],
      install: ['photoshop_install_font'],
    },
  },
  photoshop_recipe_edit: {
    description:
      'Run a multi-step editing workflow. enhance_portrait retouches a portrait; frequency_separation ' +
      'and dodge_burn set up layers for manual retouching. remove_distraction removes selected content. ' +
      'apply_color_grade applies a look preset. gradient_fade fades a layer with a mask. sky_blend ' +
      'blends a supplied sky image along the horizon. sticker_outline adds a border around a cutout. ' +
      'organize_layers renames and groups layers.',
    actions: {
      enhance_portrait: ['photoshop_recipe_enhance_portrait'],
      frequency_separation: ['photoshop_recipe_frequency_separation'],
      dodge_burn: ['photoshop_recipe_dodge_burn'],
      remove_distraction: ['photoshop_recipe_remove_distraction'],
      apply_color_grade: ['photoshop_recipe_apply_color_grade'],
      gradient_fade: ['photoshop_recipe_gradient_fade'],
      sky_blend: ['photoshop_recipe_sky_blend'],
      sticker_outline: ['photoshop_recipe_sticker_outline'],
      organize_layers: ['photoshop_recipe_organize_layers'],
    },
  },
  photoshop_recipe_output: {
    description:
      'Run an export or batch workflow. prepare_for_web exports one web-optimized JPEG or PNG. ' +
      'export_social_variants exports platform-specific sizes; split_carousel slices a design into ' +
      'consecutive slides. passport_photo crops and exports an ID photo. batch_mockup_replace swaps ' +
      'Smart Object contents and exports each variant. batch_watermark marks and exports a folder of ' +
      'images. csv_to_cards exports designs from CSV rows.',
    actions: {
      prepare_for_web: ['photoshop_recipe_prepare_for_web'],
      export_social_variants: ['photoshop_recipe_export_social_variants'],
      split_carousel: ['photoshop_recipe_split_carousel'],
      passport_photo: ['photoshop_recipe_passport_photo'],
      batch_mockup_replace: ['photoshop_recipe_batch_mockup_replace'],
      batch_watermark: ['photoshop_recipe_batch_watermark'],
      csv_to_cards: ['photoshop_recipe_csv_to_cards'],
    },
  },
};

const aliases = new Map(
  Object.entries(groups).flatMap(([name, group]) =>
    Object.entries(group.actions).flatMap(([action, legacyNames]) =>
      legacyNames.map((legacyName) => [legacyName, { name, action }] as const)
    )
  )
);

export function isActionAlias(name: string): boolean {
  return aliases.has(name);
}

export function isGroupedActionTool(name: string): boolean {
  return Object.hasOwn(groups, name);
}

export function describeActionAliases(text: string): string {
  return text.replace(/`?\bphotoshop_\w+\b`?/g, (reference) => {
    const alias = aliases.get(reference.replaceAll('`', ''));
    return alias ? `${alias.name} (action: "${alias.action}")` : reference;
  });
}

/** Keep recovery hints discoverable for hosts that expose only tools/list entries. */
export function updateActionSuggestions(result: ToolResult): ToolResult {
  const item = result.content[0];
  if (result.content.length !== 1 || item?.type !== 'text') return result;
  try {
    const body = JSON.parse(item.text);
    if (typeof body?.ok !== 'boolean') return result;
    const key = body.ok ? 'next_suggested_tool' : 'suggested_next_tool';
    const alias = aliases.get(body[key]);
    if (!alias) return result;
    body[key] = alias.name;
    body.suggested_args = { ...body.suggested_args, action: alias.action };
    return { ...result, content: [{ ...item, text: JSON.stringify(body, null, 2) }] };
  } catch {
    return result;
  }
}

export function registerActionTools(registry: ToolRegistry): void {
  const ajv = new Ajv({ strict: false });
  for (const [name, group] of Object.entries(groups)) {
    const branches = Object.entries(group.actions).flatMap(([action, legacyNames]) =>
      legacyNames.map((legacyName) => {
        const definition = registry.get(legacyName);
        if (!definition) throw new Error(`Missing handler for ${name} action ${action}: ${legacyName}`);
        const original = definition.tool.inputSchema;
        const schema = {
          ...original,
          properties: { ...original.properties, action: { const: action } },
          required: ['action', ...(original.required ?? []).filter((key) => key !== 'document_id')],
          additionalProperties: false,
        };
        return { action, legacyName, schema, validate: ajv.compile(schema) };
      })
    );
    const inputSchema: Tool['inputSchema'] = {
      type: 'object',
      properties: { action: { type: 'string', enum: Object.keys(group.actions) } },
      required: ['action'],
      oneOf: branches.map(({ schema }) => schema),
    };
    const annotations = branches.map(({ legacyName }) => TOOL_ANNOTATIONS[legacyName]);
    registry.register(name, {
      tool: {
        name,
        description: group.description,
        inputSchema,
        annotations: {
          readOnlyHint: annotations.every((hints) => hints?.readOnlyHint === true),
          destructiveHint: annotations.some((hints) => hints?.destructiveHint !== false),
          idempotentHint: annotations.every((hints) => hints?.idempotentHint === true),
          openWorldHint: annotations.some((hints) => hints?.openWorldHint !== false),
        },
      },
      handler: async (args) => {
        const candidates = branches.filter(({ action }) => action === args.action);
        const match = candidates.find(({ validate }) => validate(args));
        if (!match) {
          let message = `Choose an action for ${name}: ${Object.keys(group.actions).join(', ')}.`;
          if (candidates.length === 1) {
            message = `Invalid arguments for ${name}.${candidates[0].action}: ${ajv.errorsText(candidates[0].validate.errors)}.`;
          } else if (candidates.length > 1) {
            message = 'Provide exactly one valid layer property to update: name, opacity, blendMode, visible, or locked.';
          }
          return envelopeToToolResult({ ok: false, code: 'invalid_arguments', phase: 'validation', message });
        }
        const legacyArgs = { ...args };
        delete legacyArgs.action;
        return registry.execute(match.legacyName, legacyArgs);
      },
    });
  }
}
