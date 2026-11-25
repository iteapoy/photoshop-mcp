# Available Tools

The default MCP catalog advertises **29 entries**. Nineteen tools group related operations by `action`. The 17 workflows are available through two grouped recipe tools and the standalone `photoshop_recipe_remove_background` tool. The original tool names below remain callable for compatibility. The standalone Web UI continues to advertise its existing 132-tool catalog for the intent router and planner.

| MCP tool | Actions |
| --- | --- |
| `photoshop_document` | `create`, `open`, `get_info`, `list`, `set_active`, `save`, `close`, `resize_image`, `crop`, `flatten`, `stack_images` |
| `photoshop_layer` | `create`, `list`, `select`, `update`, `duplicate`, `delete`, `translate`, `scale`, `rotate`, `reorder`, `rasterize`, `merge_visible`, `place_image`, `fit_to_document`, `fill`, `fill_gradient`, `apply_style`, `content_aware_fill`, `create_shape` |
| `photoshop_text` | `create`, `get`, `update_content`, `set_style`, `set_ranges` |
| `photoshop_history` | `list`, `undo`, `redo`, `save_snapshot`, `revert_to_state` |
| `photoshop_group` | `create`, `move_layers_into_group`, `ungroup` |
| `photoshop_artboard` | `list`, `create`, `set_active`, `export` |
| `photoshop_selection` | `get_bounds`, `rectangle`, `ellipse`, `subject`, `select_all`, `deselect`, `invert`, `expand`, `contract`, `feather`, `save` |
| `photoshop_mask` | `create_from_selection`, `delete`, `bake_into_layer`, `apply_gradient`, `create_clipping`, `release_clipping` |
| `photoshop_smart_object` | `convert`, `replace_contents`, `edit_contents`, `duplicate_independent` |
| `photoshop_filter` | `gaussian_blur`, `sharpen`, `noise`, `motion_blur`, `high_pass`, `smart_blur` |
| `photoshop_path` | `create`, `stroke`, `fill`, `delete` |
| `photoshop_layout` | `align`, `distribute`, `duplicate_array` |
| `photoshop_color` | `brightness_contrast`, `hue_saturation`, `auto_levels`, `auto_contrast`, `desaturate`, `invert`, `create_adjustment_layer` |
| `photoshop_dataset` | `list`, `import`, `generate` |
| `photoshop_export` | `document_or_artboard`, `layer` |
| `photoshop_ai` | `fill`, `remove`, `expand`, `upscale`, `replace_sky`, `generate_image`, `neural_filter` |
| `photoshop_font` | `list`, `install` |
| `photoshop_recipe_edit` | `enhance_portrait`, `frequency_separation`, `dodge_burn`, `remove_distraction`, `apply_color_grade`, `gradient_fade`, `sky_blend`, `sticker_outline`, `organize_layers` |
| `photoshop_recipe_output` | `prepare_for_web`, `export_social_variants`, `split_carousel`, `passport_photo`, `batch_mockup_replace`, `batch_watermark`, `csv_to_cards` |

```javascript
photoshop_layer({ action: "translate", document_id: 7, layer_id: 42, deltaX: 24, deltaY: 0 })
photoshop_group({ action: "move_layers_into_group", document_id: 7, layer_ids: [42], group_id: 81 })
```

`translate` changes a layer's pixel position on the canvas. `move_layers_into_group` changes its parent in the Layers panel. `reorder` controls stacking order. For `layer.update`, provide one property per call from `name`, `opacity`, `blendMode`, `visible`, and `locked`.

`layer.select` activates a layer by exact `name` or `layer_id`. `layer.rasterize` converts one layer to pixels. `layer.merge_visible` combines all visible layers in the target document and keeps hidden layers. `document.flatten` leaves one Background layer and discards hidden layers.

Use `selection.subject` to select pixels and `mask.create_from_selection` to create an editable mask from those pixels. `mask.delete` keeps the layer pixels, while `mask.bake_into_layer` permanently removes pixels hidden by the mask.

← Back to [README](../README.md)

### Connection & Info

#### `photoshop_ping`
Run a short script in Photoshop. Success means the scripting engine is idle. While a previous script is still running, the call returns `extendscript_timeout` instead of succeeding; retry ping before `photoshop_get_state` or `photoshop_get_layers`. If the OS drive has under 10 GB free, a timeout is reported as `scratch_disk_full` instead. Does not launch Photoshop when it is not running.

```javascript
// Example: Check if Photoshop is accessible
photoshop_ping()
```

On by default. 15 minutes after the first successful ping (and again after a 7-day cooldown if unanswered), a later successful ping may append a `FEEDBACK_NUDGE` block. Host agents must ask in the user's conversation language (never default to English), in first person (as if they will improve the MCP themselves — they must not start implementing), then call `photoshop_submit_feedback`, then continue the original request. Set `PSMCP_FEEDBACK=0` (or turn off MCPB **Product feedback prompts**) to skip the question.

When a newer `@alisaitteke/photoshop-mcp` release is on npm, a successful ping may instead append an `UPDATE_AVAILABLE` block with the installed and latest versions and one update step for how this copy was installed (npx, MCPB, global npm, or a git checkout). The server looks up the latest version in the background at most once a day and caches it in `~/.photoshop-mcp/update-check.json`, so ping never waits on the network. The notice is shown at most once every 7 days. Host agents mention it in one sentence in the user's language, do not ask a question or run the update, and continue the original request. A ping carries at most one of `UPDATE_AVAILABLE` / `FEEDBACK_NUDGE`. Set `PSMCP_UPDATE_CHECK=0` (or turn off MCPB **Update notices**) to disable it; `NO_UPDATE_NOTIFIER` and `CI` also disable it.

#### `photoshop_submit_feedback`
Record the user's answer to a product-feedback nudge from `photoshop_ping`.

**Parameters:**
- `choice` (string, required): `yes`, `not_now`, or `dont_ask`
- `suggestion` (string, optional): short feature request when `choice` is `yes`

```javascript
photoshop_submit_feedback({
  choice: 'yes',
  suggestion: 'batch rename layers from a CSV'
})
```

#### `photoshop_get_version`
Get Photoshop version information.

```javascript
// Example: Get version details
photoshop_get_version()
```

### Document Management

#### `photoshop_create_document`
Create a new Photoshop document.

**Parameters:**
- `width` (number, required): Document width in pixels
- `height` (number, required): Document height in pixels
- `resolution` (number, optional): DPI resolution (default: 72)
- `colorMode` (string, optional): Color mode - RGB, CMYK, or Grayscale (default: RGB)

```javascript
// Example: Create a 1920x1080 RGB document
photoshop_create_document({
  width: 1920,
  height: 1080,
  resolution: 72,
  colorMode: "RGB"
})
```

#### `photoshop_get_document_info`
Get information about the active document.

```javascript
// Example: Get current document details
photoshop_get_document_info()
```

#### `photoshop_list_documents`
List all open documents with id, name, dimensions, resolution, `saved`, `artboard_count`, and active-tab flag. Briefly activates each tab to count artboards, then restores the original active document.

**Parameters:** none

```javascript
// Example: Discover document_id values before switching tabs
photoshop_list_documents()
```

#### `photoshop_set_active_document`
Switch the active document tab. Provide exactly one identifier.

**Parameters:**
- `document_id` (number, optional): Unique id from `photoshop_list_documents` (preferred)
- `index` (number, optional): Zero-based tab order (leftmost is 0)
- `document_name` (string, optional): Document name (ambiguous if multiple tabs share the name)

```javascript
// Example: Activate by unique id
photoshop_set_active_document({ document_id: 42 })

// Example: Activate leftmost tab
photoshop_set_active_document({ index: 0 })
```

Mutating tools (and most document-scoped reads) also accept `document_id`. Pass the id from `photoshop_get_state` / `photoshop_list_documents` so a Photoshop UI tab switch cannot retarget the edit. Omitted, `null`, and `0` use the active document. A positive unknown id fails with `document_not_found` when another document is open. When nothing is open, a stale id does not block the call. `photoshop_create_document` and `photoshop_open_image` ignore `document_id`.

#### `photoshop_list_artboards`
List artboards in the active document (id, name, pixel bounds, `is_active`). Empty when the file is a regular canvas.

```javascript
photoshop_list_artboards()
```

#### `photoshop_create_artboard`
Create an artboard. First artboard converts a regular document. Additional boards are placed 32px to the right unless `left`/`top` are set.

**Parameters:**
- `width` / `height` (number, required): size in pixels
- `name` (string, optional)
- `left` / `top` (number, optional): origin in pixels

```javascript
photoshop_create_artboard({ name: "iPhone", width: 390, height: 844 })
photoshop_create_artboard({ name: "iPad", width: 768, height: 1024 })
```

#### `photoshop_set_active_artboard`
Select an artboard by `artboard_id` (preferred) or unique `name`.

```javascript
photoshop_set_active_artboard({ artboard_id: 12 })
```

#### `photoshop_export_artboards`
Export every artboard to a folder (duplicate + crop). Uses a 600s script timeout.

**Parameters:**
- `folder` (string, required): absolute output directory
- `format` (string, optional): PNG, JPEG, WEBP, AVIF
- `quality` (number, optional): 0–100

```javascript
photoshop_export_artboards({ folder: "/tmp/boards", format: "PNG" })
```

#### `photoshop_save_document`
Save the active document.

**Parameters:**
- `path` (string, required): Full path where to save
- `format` (string, optional): PSD, JPEG, or PNG (default: PSD)
- `quality` (number, optional): JPEG quality 1-12 (default: 8)

```javascript
// Example: Save as JPEG
photoshop_save_document({
  path: "/Users/username/Desktop/output.jpg",
  format: "JPEG",
  quality: 10
})
```

#### `photoshop_close_document`
Close a document tab. Defaults to the active document; pass `document_id` from `photoshop_list_documents` to close a specific file.

**Parameters:**
- `save` (boolean, optional): Save before closing (default: false)
- `document_id` (number, optional): Close that open document instead of the front tab

```javascript
// Example: Close without saving
photoshop_close_document({ save: false })
photoshop_close_document({ save: false, document_id: 42 })
```

### Layer Operations

#### `photoshop_create_layer`
Create a new layer.

**Parameters:**
- `name` (string, optional): Layer name

```javascript
// Example: Create a named layer
photoshop_create_layer({ name: "Background" })
```

#### `photoshop_delete_layer`
Delete the active layer.

```javascript
// Example: Delete current layer
photoshop_delete_layer()
```

#### `photoshop_create_text_layer`
Create a text layer. Optional typography fields avoid a follow-up `execute_script`.

**Parameters:**
- `text` (string, required): Text content
- `x` (number, optional): X position in pixels (default: 100)
- `y` (number, optional): Y position in pixels (default: 100)
- `fontSize` (number, optional): Font size in points (default: 24)
- `fontName` (string, optional): Font display or PostScript name (see `photoshop_list_fonts`)
- `tracking` (number, optional): Character spacing in 1/1000 em (−1000 to 10000)
- `leading` (number, optional): Line height in points
- `auto_leading` (boolean, optional): Photoshop auto leading
- `kind` (string, optional): `point` or `paragraph`
- `box_width` / `box_height` (number, optional): Paragraph text box size in pixels (implies `kind=paragraph`)
- `alignment` (string, optional): LEFT, CENTER, RIGHT, LEFTJUSTIFIED, CENTERJUSTIFIED, RIGHTJUSTIFIED, FULLYJUSTIFIED
- `red` / `green` / `blue` (number, optional): Text color 0–255

```javascript
// Example: Paragraph title with tracking
photoshop_create_text_layer({
  text: "Hello World",
  x: 200,
  y: 150,
  fontSize: 48,
  fontName: "Arial",
  tracking: 80,
  leading: 56,
  kind: "paragraph",
  box_width: 600,
  box_height: 160,
  alignment: "CENTER"
})
```

#### `photoshop_fill_layer`
Fill the active layer with a solid color.

**Parameters:**
- `red` (number, required): Red component (0-255)
- `green` (number, required): Green component (0-255)
- `blue` (number, required): Blue component (0-255)

```javascript
// Example: Fill with blue
photoshop_fill_layer({
  red: 0,
  green: 100,
  blue: 255
})
```

#### `photoshop_get_layers`
List every layer recursively (id, parent, depth, kind, bounds, visibility, opacity, blend mode).

**Parameters:**
- `include_context` (boolean, optional): append the session context block of `photoshop_get_state` (default `false`; the layer list alone is much smaller)

```javascript
// Example: List all layers
photoshop_get_layers()
```

#### `photoshop_set_layer_opacity`
Set the opacity of the active layer.

**Parameters:**
- `opacity` (number, required): Opacity value (0-100)

```javascript
// Example: Set opacity to 75%
photoshop_set_layer_opacity({ opacity: 75 })
```

#### `photoshop_set_layer_blend_mode`
Set the blend mode of the active layer.

**Parameters:**
- `blendMode` (string, required): Photoshop UI blend-mode name (NORMAL, MULTIPLY, SCREEN, OVERLAY, COLOR, …)

```javascript
// Example: Set blend mode to multiply
photoshop_set_layer_blend_mode({ blendMode: "MULTIPLY" })
```

Available blend modes: NORMAL, DISSOLVE, DARKEN, MULTIPLY, COLORBURN, LINEARBURN, DARKERCOLOR, LIGHTEN, SCREEN, COLORDODGE, LINEARDODGE, LIGHTERCOLOR, OVERLAY, SOFTLIGHT, HARDLIGHT, VIVIDLIGHT, LINEARLIGHT, PINLIGHT, HARDMIX, DIFFERENCE, EXCLUSION, SUBTRACT, DIVIDE, HUE, SATURATION, COLOR, LUMINOSITY

`COLOR` is the UI name for Color blend (colorize). The server maps it to ExtendScript `BlendMode.COLORBLEND`. `LUMINOSITY` is already the DOM name. `DARKERCOLOR` / `LIGHTERCOLOR` use Action Manager when the classic `BlendMode` enum does not expose them.

#### `photoshop_set_layer_visibility`
Show or hide a layer.

**Parameters:**
- `visible` (boolean, required): Visibility state
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to use the active layer

```javascript
// Example: Hide two reference layers without selecting them first
photoshop_set_layer_visibility({ visible: false, layer_name: "图层 2" })
photoshop_set_layer_visibility({ visible: false, layer_name: "图层 3" })
```

#### `photoshop_set_layer_locked`
Lock or unlock a layer (`layer_name` optional, otherwise the active layer).

**Parameters:**
- `locked` (boolean, required): Lock state
- `layer_name` (string, optional): Target layer by name

```javascript
// Example: Lock layer
photoshop_set_layer_locked({ locked: true })
```

#### `photoshop_rename_layer`
Rename the active layer.

**Parameters:**
- `name` (string, required): New layer name

```javascript
// Example: Rename layer
photoshop_rename_layer({ name: "Hero Image" })
```

#### `photoshop_duplicate_layer`
Duplicate a layer. The copy becomes the active layer.

**Parameters:**
- `newName` (string, optional): Name for duplicated layer
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Duplicate layer with new name
photoshop_duplicate_layer({ newName: "Background Copy" })
```

#### `photoshop_merge_visible_layers`
Merge all visible layers into one.

```javascript
// Example: Merge visible layers
photoshop_merge_visible_layers()
```

#### `photoshop_flatten_image`
Flatten all layers into a single background layer.

```javascript
// Example: Flatten image
photoshop_flatten_image()
```

#### `photoshop_rasterize_layer`
Rasterize a layer (convert text/smart object to normal layer).

**Parameters:**
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Rasterize layer
photoshop_rasterize_layer()

// Example: rasterize a named layer without selecting it
photoshop_rasterize_layer({ layer_name: "Title" })
```

### Layer Ordering

#### `photoshop_reorder_layer`
Change stacking order without changing canvas coordinates. `top` and `bottom` operate within the source layer's containing group.

**Parameters:**
- `position` (required): `up` | `down` | `top` | `bottom` | `above` | `below`
- `layer_id` or `layer_name` (optional): source; omit for the active layer
- `target_layer_id` or `target_layer_name`: exactly one is required for `above`/`below`; prohibited for the other positions

```javascript
photoshop_reorder_layer({ position: "top", layer_id: 12 })
photoshop_reorder_layer({ position: "above", layer_id: 12, target_layer_id: 34 })
```

#### `photoshop_fit_layer_to_document`
Scale a layer to fit the document canvas while maintaining aspect ratio.

**Parameters:**
- `fillDocument` (boolean, optional): If true, fills entire canvas (may crop). If false, fits within canvas (may have margins). Default: false
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Fit layer within canvas
photoshop_fit_layer_to_document({ fillDocument: false })

// Example: Fill entire canvas (cropping if needed)
photoshop_fit_layer_to_document({ fillDocument: true })
```

#### `photoshop_scale_layer`
Scale a layer by a percentage.

**Parameters:**
- `scalePercent` (number, required): Scale percentage (e.g., 50 for 50%, 200 for 200%)
- `centerAnchor` (boolean, optional): Scale from center (true) or top-left (false). Default: true
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Scale to 150%
photoshop_scale_layer({
  scalePercent: 150,
  centerAnchor: true
})
```

#### `photoshop_move_layer`
Move a layer by a pixel offset.

**Parameters:**
- `deltaX` (number, required): Horizontal offset in pixels
- `deltaY` (number, required): Vertical offset in pixels
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Move layer 100px right and 50px down
photoshop_move_layer({
  deltaX: 100,
  deltaY: 50
})
```

#### `photoshop_rotate_layer`
Rotate a layer around its center.

**Parameters:**
- `degrees` (number, required): Rotation angle in degrees (positive = clockwise)
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: Rotate 45 degrees clockwise
photoshop_rotate_layer({ degrees: 45 })
```

#### `photoshop_align_layers`
Align one or more layers to the canvas or to a reference layer. Without a shared align command, this replaces a hand-computed `photoshop_move_layer` delta per layer.

**Parameters:**
- `align` (string, required): `left` | `hcenter` | `right` | `top` | `vcenter` | `bottom`
- `target` (string, optional): `canvas` (default) or `layer`
- `target_layer_name` (string, optional): reference layer when `target` is `layer`
- `layer_names` (array, optional): layers to move; omit for the active layer

Returns `moved[]` and `skipped[]` (background layers, empty layers, layers already aligned).

```javascript
// Example: Center three labels on the canvas horizontally
photoshop_align_layers({ align: "hcenter", layer_names: ["字 · RA.18H", "字 · DEC.24"] })

// Example: Bottom-align a label with another layer
photoshop_align_layers({ align: "bottom", target: "layer", target_layer_name: "12 量角弧", layer_names: ["字 · +12"] })
```

#### `photoshop_distribute_layers`
Space three or more layers evenly along one axis. `gaps` sorts by leading edge and equalizes the space between edges; `centers` sorts by center coordinate, keeps the outer two centers, and spreads the centers between them.

**Parameters:**
- `layer_names` (array, required): at least three layers; sorted along the axis before spacing
- `axis` (string, optional): `horizontal` (default) | `vertical`
- `mode` (string, optional): `gaps` (default) | `centers`

```javascript
// Example: Equal vertical gaps between four ticks
photoshop_distribute_layers({ axis: "vertical", layer_names: ["04b 段端", "07 内梳齿", "08 内盘环", "12b 量角端"] })
```

#### `photoshop_duplicate_array`
Duplicate a layer into a rotated ring or a linear run — ticks, marks, labels, and stars without a duplicate/rotate/translate loop.

**Parameters:**
- `count` (number, required): total instances including the source (2-100)
- `mode` (string, optional): `rotate` (default) | `linear`
- `pivot_x` / `pivot_y` (number, optional): ring center in pixels (default: document center)
- `total_degrees` (number, optional): angle covered by the ring, source included (default 360)
- `start_degrees` (number, optional): angle of the first copy (default 0)
- `offset_x` / `offset_y` (number, optional): linear mode step per copy in pixels
- `layer_name` (string, optional): source layer; omit for the active layer

Copy names are the source name plus a 1-based index. Not idempotent: each call adds `count - 1` layers.

Alignment, distribution, and arrays reject position-locked or fully locked targets (including containing groups). If execution fails, they restore the pre-call history state, active layer, and visibility; a failed rollback is reported explicitly.

```javascript
// Example: 12 ticks around the canvas center
photoshop_duplicate_array({ layer_name: "06 外梳齿", count: 12, total_degrees: 360 })

// Example: a horizontal row of 5 marks, 40 px apart
photoshop_duplicate_array({ layer_name: "09 四角标记", count: 5, mode: "linear", offset_x: 40 })
```

### Filters

#### `photoshop_apply_gaussian_blur`
Apply Gaussian Blur filter to the active layer.

**Parameters:**
- `radius` (number, required): Blur radius in pixels (0.1-250)

```javascript
// Example: Apply 10px blur
photoshop_apply_gaussian_blur({ radius: 10 })
```

#### `photoshop_apply_sharpen`
Apply Unsharp Mask (sharpen) filter.

**Parameters:**
- `amount` (number, required): Sharpening amount in percent (1-500)
- `radius` (number, required): Radius in pixels (0.1-250)
- `threshold` (number, optional): Threshold levels (0-255, default: 0)

```javascript
// Example: Sharpen image
photoshop_apply_sharpen({
  amount: 100,
  radius: 1.5,
  threshold: 0
})
```

#### `photoshop_apply_noise`
Apply Add Noise filter.

**Parameters:**
- `amount` (number, required): Noise amount in percent (0.1-400)
- `distribution` (string, optional): UNIFORM or GAUSSIAN (default: UNIFORM)
- `monochromatic` (boolean, optional): Monochromatic noise (default: false)

```javascript
// Example: Add noise
photoshop_apply_noise({
  amount: 10,
  distribution: "GAUSSIAN",
  monochromatic: false
})
```

#### `photoshop_apply_motion_blur`
Apply Motion Blur filter.

**Parameters:**
- `angle` (number, required): Blur angle in degrees (-360 to 360)
- `radius` (number, required): Blur distance in pixels (1-999)

```javascript
// Example: Apply motion blur
photoshop_apply_motion_blur({
  angle: 45,
  radius: 20
})
```

#### `photoshop_apply_high_pass`
Apply High Pass filter to the active raster layer (edge/detail extraction).

**Parameters:**
- `radius` (number, required): Edge retention radius in pixels (0.1-250)

```javascript
// Example: Apply 5px high pass for sharpening workflow
photoshop_apply_high_pass({ radius: 5 })
```

**Returns:** JSON `{ ok, summary, details: { filter, radius, context } }`. Fails on text, Smart Object, or Background layers — rasterize first.

#### `photoshop_apply_smart_blur`
Apply Smart Blur filter (edge-preserving blur) to the active raster layer.

**Parameters:**
- `radius` (number, required): Blur radius (0.1-100)
- `threshold` (number, required): Blur threshold (0.1-100)
- `mode` (string, optional): NORMAL, EDGEONLY, or OVERLAYEDGE (default: NORMAL)
- `quality` (string, optional): LOW, MEDIUM, or HIGH (default: MEDIUM)

```javascript
// Example: Subtle edge-preserving blur
photoshop_apply_smart_blur({
  radius: 10,
  threshold: 25,
  mode: "NORMAL",
  quality: "MEDIUM"
})
```

**Returns:** JSON `{ ok, summary, details: { filter, radius, threshold, mode, quality, context } }`.

### Color Adjustments

#### `photoshop_adjust_brightness_contrast`
Adjust brightness and contrast.

**Parameters:**
- `brightness` (number, required): Brightness adjustment (-100 to 100)
- `contrast` (number, required): Contrast adjustment (-100 to 100)

```javascript
// Example: Increase brightness and contrast
photoshop_adjust_brightness_contrast({
  brightness: 20,
  contrast: 15
})
```

#### `photoshop_adjust_hue_saturation`
Adjust hue, saturation, and lightness.

**Parameters:**
- `hue` (number, required): Hue shift (-180 to 180)
- `saturation` (number, required): Saturation adjustment (-100 to 100)
- `lightness` (number, required): Lightness adjustment (-100 to 100)

```javascript
// Example: Adjust colors
photoshop_adjust_hue_saturation({
  hue: 30,
  saturation: 20,
  lightness: 0
})
```

#### `photoshop_auto_levels`
Apply auto levels adjustment.

```javascript
// Example: Auto levels
photoshop_auto_levels()
```

#### `photoshop_auto_contrast`
Apply auto contrast adjustment.

```javascript
// Example: Auto contrast
photoshop_auto_contrast()
```


#### `photoshop_desaturate`
Desaturate the layer (convert to grayscale).

```javascript
// Example: Desaturate
photoshop_desaturate()
```

#### `photoshop_invert`
Invert colors of the layer.

```javascript
// Example: Invert colors
photoshop_invert()
```

### Text Formatting

#### `photoshop_list_fonts`
List installed fonts available to Photoshop. First call may be slow (`app.fonts` can exceed 1000 entries).

**Parameters:**
- `query` (string, optional): Substring filter (matches name, postScriptName, or family)
- `limit` (number, optional): Maximum fonts to return (default: 200)

**Returns:** `{ fonts: [{ name, postScriptName, family, style }], total, truncated }`

Use `postScriptName` when setting fonts manually via `execute_script`; `photoshop_set_text_style` and `photoshop_create_text_layer` resolve display names automatically. A font that is not installed can be added with `photoshop_install_font`, which reloads the open app's font list.

```javascript
// Example: Find Arial variants
photoshop_list_fonts({ query: "Arial", limit: 20 })
```

#### `photoshop_install_font`
Install a `.ttf`, `.otf`, `.ttc`, or `.otc` for the current user. Does not download the file.

- macOS: copies it to `~/Library/Fonts` (Font Book, Current User).
- Windows: installs it for the current user only.

If Photoshop is open, the tool calls `app.refreshFonts()` (`Application.refreshFonts` in the Photoshop JavaScript Reference) so `photoshop_list_fonts` sees the new names without quitting. The result includes `post_script_names` to pass to `photoshop_set_text_style`.

Fredoka Bold is the named instance `Fredoka-Bold` inside Google Fonts' variable file `Fredoka[wdth,wght].ttf` (SIL Open Font License). It is not a separate Bold file.

**Parameters:**
- `file_path` (string, required): Absolute path to the font file

```javascript
photoshop_install_font({ file_path: "/Users/me/Fonts/Fredoka[wdth,wght].ttf" })
```




#### `photoshop_update_text_content`
Update text content of active text layer.

**Parameters:**
- `text` (string, required): New text content

```javascript
// Example: Update text
photoshop_update_text_content({ text: "New Text" })
```

#### `photoshop_get_text`
Read a text layer's content and typography. Set `all: true` to audit every text layer in the document at once.

**Parameters:**
- `all` (boolean, optional): return every text layer instead of one (default `false`)
- `layer_name` (string, optional): target text layer by name; omit for the active layer

Returns `contents`, `font`, `size` (pt), `tracking`, `leading`, `kind`, `box_width`/`box_height`, `alignment`, `red`/`green`/`blue`, and pixel `bounds`. This is the read counterpart of `photoshop_update_text_content` / `photoshop_set_text_style`.

```javascript
// Example: What does this label say, and in what font?
photoshop_get_text({ layer_name: "字 · RA.18H" })

// Example: audit every label in the document
photoshop_get_text({ all: true })
```

#### `photoshop_set_text_style`
Layer-wide typography on the active text layer (tracking, leading, paragraph box, alignment, font, size, color).

**Parameters:** all optional, at least one required — same names as `photoshop_create_text_layer` style fields (`tracking`, `leading`, `auto_leading`, `kind`, `box_width`, `box_height`, `alignment`, `fontName`, `fontSize`, `red`/`green`/`blue`).

```javascript
photoshop_set_text_style({
  tracking: 120,
  leading: 40,
  kind: "paragraph",
  box_width: 500,
  box_height: 180,
  alignment: "CENTER"
})
```

#### `photoshop_set_text_ranges`
Mixed fonts/sizes/colors inside one text layer (`textStyleRange`). `from` inclusive, `to` exclusive.

**Parameters:**
- `ranges` (array, required): `{ from, to, fontName?, fontSize?, red?, green?, blue? }[]` (max 64, no overlaps)

```javascript
photoshop_set_text_ranges({
  ranges: [
    { from: 0, to: 5, red: 220, green: 40, blue: 40, fontName: "Arial" },
    { from: 6, to: 11, red: 30, green: 80, blue: 200, fontName: "Times New Roman" }
  ]
})
```

### Selections & Masks

#### `photoshop_get_selection_bounds`
Read the active pixel selection bounds in document pixels (read-only). Does not create or modify selections.

**Returns:** JSON `{ ok, summary, details: { has_selection, bounds?, context } }` where `bounds` is `{ left, top, right, bottom, width, height }` in pixels when `has_selection` is true.

```javascript
// Example: Verify selection before creating a mask
photoshop_get_selection_bounds()
```

#### `photoshop_select_rectangle`
Create a rectangular selection.

**Parameters:**
- `left`, `top`, `right`, `bottom` (number, required): Selection bounds in pixels

```javascript
// Example: Select area
photoshop_select_rectangle({
  left: 100,
  top: 100,
  right: 500,
  bottom: 400
})
```

#### `photoshop_select_ellipse`
Create an elliptical pixel selection from a bounding box (anti-aliased).

**Parameters:**
- `left`, `top`, `right`, `bottom` (number, required): Bounding box in pixels (`right` > `left`, `bottom` > `top`)

**Returns:** JSON `{ ok, summary, details: { shape, bounds?, context } }`

```javascript
// Example: Oval selection for vignette
photoshop_select_ellipse({
  left: 50,
  top: 50,
  right: 200,
  bottom: 200
})
```

#### `photoshop_expand_selection`
Expand the active pixel selection outward by pixels.

**Parameters:**
- `pixels` (number, required): Amount to expand (minimum 1)

**Returns:** JSON `{ ok, summary, details: { pixels, bounds?, context } }`

```javascript
// Example: Grow a tight subject selection
photoshop_expand_selection({ pixels: 5 })
```

#### `photoshop_contract_selection`
Shrink the active pixel selection inward by pixels.

**Parameters:**
- `pixels` (number, required): Amount to contract (minimum 1)

**Returns:** JSON `{ ok, summary, details: { pixels, bounds?, context } }`

```javascript
// Example: Tighten a loose selection
photoshop_contract_selection({ pixels: 3 })
```

#### `photoshop_feather_selection`
Feather (soften) the edges of the active pixel selection.

**Parameters:**
- `pixels` (number, required): Feather radius in pixels (minimum 1)

**Returns:** JSON `{ ok, summary, details: { pixels, bounds?, context } }`

```javascript
// Example: Soften edges before fill
photoshop_feather_selection({ pixels: 2 })
```

#### `photoshop_save_selection`
Save the active pixel selection to a new alpha channel.

**Parameters:**
- `channel_name` (string, optional): Name for the new channel (auto-generated if omitted)

**Returns:** JSON `{ ok, summary, details: { channel_name, context } }`

```javascript
// Example: Preserve selection for later
photoshop_save_selection({ channel_name: 'MCP_Test_Sel' })
```

#### `photoshop_select_all`
Select the entire document.

```javascript
// Example: Select all
photoshop_select_all()
```

#### `photoshop_deselect`
Clear all selections.

```javascript
// Example: Deselect
photoshop_deselect()
```

#### `photoshop_invert_selection`
Invert the current selection.

```javascript
// Example: Invert selection
photoshop_invert_selection()
```

#### `photoshop_create_layer_mask`
Create a layer mask from the current selection.

```javascript
// Example: Create mask
photoshop_create_layer_mask()
```

#### `photoshop_delete_layer_mask`
Delete the layer mask from active layer.

```javascript
// Example: Delete mask
photoshop_delete_layer_mask()
```

#### `photoshop_apply_layer_mask`
Apply (merge) the layer mask to the layer.

```javascript
// Example: Apply mask
photoshop_apply_layer_mask()
```

#### `photoshop_select_subject`
Run Select Subject on the active layer (pixel selection only, no mask). Requires Photoshop 23+.

**Parameters:**
- `sample_all_layers` (boolean, optional): Sample all layers for autoCutout fallback; default `false`

```javascript
// Example: Select the main subject
photoshop_select_subject()
```

#### `photoshop_content_aware_fill`
Fill the current pixel selection using Content-Aware Fill. Requires an active selection.

```javascript
// Example: Remove selected distraction
photoshop_content_aware_fill()
```

#### `photoshop_apply_gradient_mask`
Apply a linear black-to-white gradient on the active layer mask (fade/blend).

**Parameters:**
- `direction` (string, optional): Fade direction — `bottom_to_top`, `top_to_bottom`, `left_to_right`, `right_to_left`; default `bottom_to_top`
- `start_pct` (number, optional): Gradient start along fade axis (0–100); default `0`
- `end_pct` (number, optional): Gradient end along fade axis (0–100); default `100`
- `angle_deg` (number, optional): Override gradient angle in degrees

```javascript
// Example: Fade subject into background from bottom
photoshop_apply_gradient_mask({
  direction: 'bottom_to_top',
  start_pct: 0,
  end_pct: 100
})
```

#### `photoshop_create_clipping_mask`
Create a clipping mask on the active layer (or a named layer). The target layer must sit directly above the base layer it clips into.

**Parameters:**
- `layer_name` (string, optional): Exact layer name (recursive search). Default: active layer.

```javascript
// Example: Clip the active layer to the one below
photoshop_create_clipping_mask()

// Example: Clip a named layer
photoshop_create_clipping_mask({ layer_name: 'Texture' })
```

#### `photoshop_release_clipping_mask`
Release (remove) the clipping mask from the active layer (or a named layer).

**Parameters:**
- `layer_name` (string, optional): Exact layer name (recursive search). Default: active layer.

```javascript
// Example: Unclip the active layer
photoshop_release_clipping_mask()
```

### History & Undo/Redo

#### `photoshop_undo`
Undo the last operation(s) - equivalent to Ctrl/Cmd+Z.

**Parameters:**
- `steps` (number, optional): Number of steps to undo (default: 1)

```javascript
// Example: Undo last operation
photoshop_undo()

// Example: Undo last 3 operations
photoshop_undo({ steps: 3 })
```

#### `photoshop_redo`
Redo previously undone operation(s) - equivalent to Ctrl/Cmd+Shift+Z.

**Parameters:**
- `steps` (number, optional): Number of steps to redo (default: 1)

```javascript
// Example: Redo last undone operation
photoshop_redo()

// Example: Redo last 2 undone operations
photoshop_redo({ steps: 2 })
```

#### `photoshop_get_history`
Get the history states of the active document.

```javascript
// Example: View history
photoshop_get_history()
```

### Actions & Automation

#### `photoshop_play_action`
Play a recorded action from the Actions palette.

**Parameters:**
- `actionName` (string, required): Action name
- `actionSetName` (string, required): Action set name

```javascript
// Example: Play action
photoshop_play_action({
  actionName: "My Action",
  actionSetName: "Default Actions"
})
```

#### `photoshop_execute_script`
Execute custom ExtendScript code (advanced).

**Parameters:**
- `code` (string, required): ExtendScript code
- `timeout_ms` (number, optional): 1000–600000 (default 30000, or `PHOTOSHOP_SCRIPT_TIMEOUT`)

Your code runs inside a wrapping IIFE on the server side. Use an explicit `return` to pass data back — a bare trailing expression or assignment (e.g. `layer.name = "X"`) evaluates to `undefined`, so the tool result shows `"undefined"` even when the mutation succeeded.

Long loops should pass `timeout_ms`. Batch recipes (`batch_watermark`, `csv_to_cards`, …) already use 600s.

```javascript
// Example: Rename the active layer and return confirmation
photoshop_execute_script({
  code: `
    var layer = app.activeDocument.activeLayer;
    layer.name = "Renamed";
    return { ok: true, name: layer.name };
  `
})

// Example: Read-only query (always return a value you can inspect)
photoshop_execute_script({
  code: "return app.documents.length;"
})
```

### Image Manipulation

#### `photoshop_resize_image`
Resize the active image.

**Parameters:**
- `width` (number, required): New width in pixels
- `height` (number, required): New height in pixels

```javascript
// Example: Resize to Instagram post size
photoshop_resize_image({
  width: 1080,
  height: 1080
})
```

#### `photoshop_crop_document`
Crop the document to specified bounds.

**Parameters:**
- `left` (number, required): Left edge in pixels
- `top` (number, required): Top edge in pixels
- `right` (number, required): Right edge in pixels
- `bottom` (number, required): Bottom edge in pixels

```javascript
// Example: Crop document
photoshop_crop_document({
  left: 100,
  top: 100,
  right: 1820,
  bottom: 980
})
```

#### `photoshop_place_image`
Place an image file as a layer in the active document, at an exact pixel position and size.

**Parameters:**
- `filePath` (string, required): Full path to the image file
- `x` (number, optional): Absolute canvas X of the **anchor point**, in pixels (default: 0)
- `y` (number, optional): Absolute canvas Y of the **anchor point**, in pixels (default: 0)
- `anchor` (string, optional): Which point of the image `x`/`y` refers to — `top_left` (default), `top_center`, `top_right`, `center_left`, `center`, `center_right`, `bottom_left`, `bottom_center`, `bottom_right`
- `scale` (number, optional): Percentage of the image's natural pixel size (default: 100 — one image pixel per canvas pixel). Ignored when `fit_to_canvas` is true
- `fit_to_canvas` (boolean, optional): Scale to fit inside the canvas, keeping aspect ratio
- `rasterize` (boolean, optional): Rasterize the placed smart object immediately (default: false)

`x`/`y` are **not** an offset from Photoshop's default centered Place. Photoshop's Place fits the image into the canvas and reports
`layer.bounds`, which may be the **non-transparent** content box rather than the image rectangle — anchoring on that box is what
shifts PNGs with transparent margins off-canvas. The server measures the source file, detects which bounds it got, and translates
by the real image rectangle, so the result is exact either way. The response reports `boundsMode` (`untrimmed` or
`trim_compensated`), `trimInsets`, `imageSize`, `scalePercent`, `layerBounds` and `pixelBounds`.

```javascript
// Example: place a 2000×2276 overlay at 1:1, top-left at (100, 200)
photoshop_place_image({
  filePath: "/Users/username/Pictures/overlay.png",
  x: 100,
  y: 200
})

// Example: center a 50%-size logo on the canvas
photoshop_place_image({
  filePath: "/Users/username/Pictures/logo.png",
  x: 1000,
  y: 1138,
  anchor: "center",
  scale: 50
})
```

#### `photoshop_open_image`
Open an image file as a new document.

**Parameters:**
- `filePath` (string, required): Full path to the image file

```javascript
// Example: Open an image
photoshop_open_image({
  filePath: "/Users/username/Pictures/photo.jpg"
})
```

### Generative AI (Firefly)

Requires Photoshop 24+ and signed-in Adobe generative credits. Call `photoshop_get_capabilities` first.

#### `photoshop_generative_fill`
Fill the current selection with Generative Fill. **Parameters:** `prompt` (required)

#### `photoshop_generative_remove`
AI Remove on the current selection. **Parameters:** `feather_px`, `auto_select_subject`

#### `photoshop_generative_expand`
Extend canvas with Generative Expand. **Parameters:** `prompt`, `direction`

#### `photoshop_generative_upscale`
Generative Upscale (PS 27+). **Parameters:** `target_scale` (2 or 4)

#### `photoshop_sky_replacement`
Native Sky Replacement. **Parameters:** `sky_image_path` (optional)

#### `photoshop_generate_image`
Text-to-image. **Parameters:** `prompt`, `width`, `height`

### Neural Filters (UXP bridge)

Requires `uxp-plugin/` — see [development.md](development.md).

#### `photoshop_neural_filter`
**Parameters:** `filter` (skin_smoothing|harmonize|depth_blur|super_zoom|colorize), `smoothness`, `blur`

### Layer Styles

#### `photoshop_apply_layer_style`
Apply a layer effect (Action Manager `layerEffects`) to the active layer.

**Parameters:**
- `style` (string, required): `drop_shadow` | `outer_glow` | `stroke` | `bevel_emboss`
- `red`, `green`, `blue` (number, optional): Effect color (default 0/0/0)
- `opacity` (number, optional): 0-100 (default 60)
- `size` (number, optional): Blur/size in px — stroke width for stroke (default 10)
- `distance` (number, optional): Offset in px, drop shadow only (default 8)
- `angle` (number, optional): Light angle in degrees (default 120). Drop shadow uses this local angle (`Use Global Light` is off).
- `layer_name` (string, optional): Target layer by name (searches nested groups). Omit to act on the active layer.

```javascript
// Example: soft drop shadow on the active layer
photoshop_apply_layer_style({ style: "drop_shadow", opacity: 55, size: 14, distance: 10 })
```

#### `photoshop_recipe_sticker_outline`
One-click sticker / white-border outline. In `single` mode it applies a solid stroke **and** an optional soft drop shadow as one layer style (use this instead of calling `photoshop_apply_layer_style` twice — the atomic tool applies one effect at a time and overwrites the previous one). In `die_cut` mode it builds the classic double outline — a white border plus a thin dark outer line — by adding two stroked copies of the active layer. Both run in a single undoable step. Other layer effects already on the layer (outer glow, bevel, color/gradient/pattern overlays) are preserved; only the stroke and the drop shadow are set or replaced.

**Parameters:**
- `outline_style` (string, optional): `single` (default) or `die_cut`
- `red`, `green`, `blue` (number, optional): Stroke (white border) color (default 255/255/255 = white)
- `stroke_width` (number, optional): Stroke width in px (default 12)
- `stroke_opacity` (number, optional): Stroke opacity 0-100 (default 100)
- `stroke_position` (string, optional): `outside` | `inside` | `center` (default `outside`; forced to `outside` for `die_cut`)
- `shadow` (boolean, optional): Add a soft drop shadow (default `true`)
- `shadow_opacity`, `shadow_size`, `shadow_distance`, `shadow_angle` (number, optional): Shadow tuning (defaults 40 / 12 / 6 / 120)
- `line_width` (number, optional): `die_cut` only — thickness of the dark outer line in px (default 3)
- `line_red`, `line_green`, `line_blue` (number, optional): `die_cut` only — dark line color (default 0/0/0 = black)
- `document_id` (number, optional): Target a specific open document

```javascript
// Single white sticker border + shadow
photoshop_recipe_sticker_outline({ stroke_width: 14 })

// Die-cut double outline: 16px white border + 4px black outer line
photoshop_recipe_sticker_outline({ outline_style: "die_cut", stroke_width: 16, line_width: 4 })
```

### Color Grading

Use `photoshop_create_adjustment_layer` with `type` and validated per-type `params`:

| Type | Parameters |
| --- | --- |
| `color_lookup` | Required `lut`: built-in LUT name or an absolute `.cube`/`.3dl`/`.look` path. |
| `vibrance` | `vibrance` (-100..100), `saturation` (-100..100). |
| `exposure` | `exposure` in stops, `offset`, `gamma`. |
| `photo_filter` | `red`, `green`, `blue`, `density`, `preserve_luminosity`. |
| `black_and_white` | Photoshop defaults; no parameters. |
| `posterize` | `levels` (2..255). |
| `threshold` | `level` (1..255). |
| `gradient_map` | `reverse` (boolean). |
| `curves` | `preset`: `auto_tone` or `neutral`. |

```javascript
photoshop_create_adjustment_layer({ type: "color_lookup", params: { lut: "Crisp_Warm.3dl" } })
```

### Data-Driven Graphics

Photoshop's hidden "mail merge for images": template PSD with variable-bound layers (Image > Variables > Define) + data sets → one image per row.

#### `photoshop_list_datasets`
List data sets on the active document. **Returns:** `{ datasets, active, count }`

#### `photoshop_import_datasets`
Import a variables/data-sets XML file. **Parameters:** `xml_path` (required)

#### `photoshop_generate_from_datasets`
Batch-export the document once per data set.

**Parameters:**
- `output_dir` (string, required)
- `format` (string, optional): `JPEG` | `PNG` | `PSD` (default JPEG)
- `dataset_names` (string[], optional): subset to export (default all)

```javascript
photoshop_generate_from_datasets({ output_dir: "/Users/me/cards", format: "PNG" })
```

**One-shot alternative:** `photoshop_recipe_csv_to_cards` converts a CSV straight into data sets and exports every row (prompt template `ps.csv_to_cards`).

### Smart Objects

#### `photoshop_convert_to_smart_object`
Convert the active or named layer to an embedded Smart Object (`newPlacedLayer`). Background layers are rejected.

**Parameters:**
- `layer_name` (string, optional): exact layer name (recursive search)

```javascript
photoshop_convert_to_smart_object({ layer_name: "Logo" })
```

#### `photoshop_replace_smart_object_contents`
Replace embedded Smart Object pixels from a file (`placedLayerReplaceContents`). Preserves transforms and Smart Filters on the layer.

**Parameters:**
- `file_path` (string, required): absolute path to replacement image
- `layer_name` (string, optional): Smart Object layer name

```javascript
photoshop_replace_smart_object_contents({
  layer_name: "Screen",
  file_path: "/Users/me/designs/hero.png"
})
```

#### `photoshop_edit_smart_object_contents`
Open Smart Object embedded contents for editing (`placedLayerEditContents`). **Active document becomes the embedded .psb** until you save and close it.

**Parameters:**
- `layer_name` (string, optional): Smart Object layer name

**Returns:** `parent_document`, `embedded_document`, `layer_name`

```javascript
photoshop_edit_smart_object_contents({ layer_name: "Product" })
// ... edit embedded doc, then save/close to return to parent
```

#### `photoshop_create_smart_object_via_copy`
Create an independent Smart Object duplicate (`placedLayerMakeCopy`) — unlinked from the original embedded data.

**Parameters:**
- `layer_name` (string, optional): source Smart Object layer name

```javascript
photoshop_create_smart_object_via_copy({ layer_name: "Logo" })
```

### Image Stacking

#### `photoshop_image_stack`
Load 2+ images into one document, convert to a smart object, apply a stack mode — classic tourist removal / noise reduction without generative AI.

**Parameters:**
- `files` (string[], required): 2+ absolute image paths
- `mode` (string, optional): `mean` | `median` | `maximum` | `minimum` | `summation` | `stddev` (default `median`)

```javascript
// Example: remove tourists from 3 aligned shots
photoshop_image_stack({
  files: ["/shots/a.jpg", "/shots/b.jpg", "/shots/c.jpg"],
  mode: "median"
})
```

### Modern Export

#### `photoshop_export_as`
Export a copy as PNG/JPEG (Save for Web) or WebP/AVIF (native, PS 23.2+). Returns `version_unsupported` when the build lacks WebP/AVIF.

**Parameters:**
- `path` (string, required): Absolute output path
- `format` (string, optional): `PNG` | `JPEG` | `WEBP` | `AVIF` (default PNG)
- `quality` (number, optional): 0-100 (default 80)
- `artboard_id` (number, optional): export only that artboard (from `photoshop_list_artboards`)

#### `photoshop_export_layer`
Export one layer as its own image file, trimmed to its content by default. The source document is not modified; the tool works on a temporary duplicate. Group exports preserve visibility inside the target group. Use `layer_id` to select an exact target when names repeat; the duplicate is located by its hierarchy index path, not by name.

**Parameters:**
- `path` (string, optional): absolute output path; omit to auto-name in `~/.photoshop-mcp/exports`
- `format` (string, optional): `PNG` | `JPEG` | `WEBP` (default PNG; WebP needs PS 23.2+)
- `quality` (number, optional): 0-100 for JPEG/WebP (default 90)
- `trim` (boolean, optional): trim transparent margins (default `true`)
- `layer_name` (string, optional): target layer; omit for the active layer

```javascript
// Example: Export a star layer as a standalone PNG
photoshop_export_layer({ layer_name: "10b 主星", format: "PNG" })
```

#### `photoshop_create_adjustment_layer`

Create an editable adjustment layer using `{ type, params }`. Supported types
are `black_and_white`, `posterize`, `threshold`, `exposure`, `vibrance`,
`curves`, `photo_filter`, `color_lookup`, and `gradient_map`.
Each type has its own schema. Unknown parameters, incorrect
types, and out-of-range values return an error before Photoshop is called.
Use `adjust/create_adjustment_layer` in grouped mode. Individual adjustment-layer
tool names have been removed.

Example: `{ "type": "threshold", "params": { "level": 160 } }`.

#### `photoshop_create_shape_layer`

Create an editable vector fill layer using `type` (`rectangle`,
`rounded_rectangle`, `ellipse`, or `line`) and pixel coordinates
`left`, `top`, `right`, `bottom`. For a line these are endpoints.
Optional parameters are `name`, `red`, `green`, `blue` (0–255, default 0),
`opacity` (0–100, default 100), `radius` (rounded rectangle, default 10,
clamped to half the shorter side), and `line_width` (positive, default 1).
A line is filled rectangular vector geometry with square ends. Shapes are filled
and do not configure native stroke or dash styles. Use `document_id` to pin
the destination document. The result includes the new layer ID and name.
The HTTP group action is `path/create_shape_layer`.

Native shape stroke options on `photoshop_create_shape_layer`:
`fill_enabled` (default true), `stroke_width` (pixels, default 0 disables stroke),
`stroke_red/green/blue` (0–255), `stroke_opacity` (0–100),
`stroke_alignment` (`inside`, `center`, `outside`),
`dash_pattern` (positive alternating dash/gap values in pairs, at most 32 entries),
and `dash_offset`. Dash values and offset are multiples of stroke width.
An empty pattern produces a solid stroke. For example, width 4 and pattern
[4, 2] produces 16 px dashes and 8 px gaps. Set `fill_enabled:false` for an
outline-only rectangle or ellipse. For line shapes, stroke outlines the narrow
rectangle used for line geometry.

### Explicit layer targets and reported ranges

Tools with a `layer_name` parameter, plus pixel fills and path strokes/fills,
accept optional `layer_id`. IDs come from `photoshop_get_layers`, which returns
`id`, `kind`, `parent_id`, and pixel `bounds` for each layer. Pass
`document_id` together with `layer_id` to pin both targets. IDs must be positive
integers. Combining `layer_id` with `layer_name` or `layer_index` is rejected.
Name-based calls remain supported. Target activation and the operation run in
the same script, and missing IDs fail before the operation.

Selection results expose `selection_bounds` alongside legacy `bounds`.
Solid fills return `requested_bounds` (selection or whole canvas),
`selection_bounds` (null when absent), and `target_bounds` (the target layer's
content after filling). Legacy `affected_bounds` remains an alias for the
selection/canvas region, labeled `bounds_kind: "selection_or_canvas"`.
Path strokes report `target_bounds` with `bounds_kind: "layer_content_after"`.
These ranges do not measure a before/after pixel difference.

Tool failures include `operation` and `phase` where available. Phases are
`validation`, `target_resolution`, `execution`, `timeout`, and `unknown`.
An execution-phase parameter error originates in Photoshop, while a
validation-phase error was rejected before execution. Timeouts leave the
operation's completion uncertain.

### Groups, visibility, and history recovery

Layer targeting preserves visibility of existing layers and ancestor groups.
The explicit visibility tool still applies the requested visibility. Selection
by ID is also accepted by `photoshop_select_layer_by_name`; omit `name` in that
case. Text, filter, mask and pixel-edit tools accept `layer_id` where applicable.
`get_layers` reports `id`, `parent_id` (null at root), `depth` (root is 0),
`kind: "group"` for groups, and pixel `bounds`. `layerCount` and
`total_layer_count` include descendants and groups; `root_layer_count` and
`context.document.layerCount` count only root entries.

Group actions under `photoshop_layer`:

| Action | Parameters |
| --- | --- |
| `create_group` | Optional `name`, `parent_group_id`, and sibling `layer_ids`; omit IDs for an empty group or supply IDs to group layers. |
| `move_layers_to_group` | `group_id` and nonempty sibling `layer_ids`. |
| `ungroup` | `group_id`. |

Input IDs are validated before moving layers. Existing stack order determines
the result, independently of ID array order. Moving into a group inserts the
selected layers above existing children. Ancestor/descendant cycles and
artboards are rejected. Failed operations attempt to restore their document
history checkpoint. Grouping noncontiguous layers changes their placement
relative to intervening layers. Ungrouping removes group-level compositing,
masks, effects and visibility inheritance, which can change appearance.

History actions under `photoshop_document`:

- `save_snapshot` takes a unique `name` and creates an in-memory full-document
  snapshot. Closing the document discards it.
- `revert_to_state` takes exactly one of `snapshot_name` or zero-based
  `state_index`. Indices are returned by `get_history` and can change after
  edits, so read history immediately before using an index.

`execute_script` accepts `rollback_on_error: true` (default false). It records
the target document history state before execution and attempts restoration
when the script throws or returns an object with `ok:false`. The error/result
reports `rollback` as `succeeded` or `failed: ...`. Recovery covers only
recoverable history edits in that open document. Other documents, saved files,
external side effects, closed documents and discarded history are outside that
scope. A timeout does not guarantee that execution stopped or rollback finished.

### Path stroke width, opacity and alignment

`photoshop_stroke_path` accepts `width` (0.1–1000 px, default 1),
`opacity` (0–100, default 100), and `alignment` (`center`, `inside`,
`outside`; default `center`). Open subpaths support center alignment only.
`dash` and `gap` are pixel lengths and must both be positive or both zero.
The tool renders native vector stroke geometry into a temporary alpha mask
and paints the original pixel layer, preserving its ID and the caller's
selection and foreground color. Temporary layers, paths and channels are
cleaned up. The target must be an unlocked pixel layer without transparency
lock. The returned `selection_bounds` describes the clipped stroke mask;
`target_bounds` describes layer contents after painting.

### Name ambiguity and Action Manager ID diagnostics

Name-based layer operations reject duplicate names with `ambiguous_name`.
Use `layer_id` to disambiguate. Unique-name and active-layer calls remain
supported for compatibility.

`photoshop_resolve_ids` (HTTP `system/resolve_ids`) accepts
`{ "ids": [{ "kind": "char", "value": "Usng" }, { "kind": "string", "value": "using" }] }`.
Invalid charID lengths return `invalid_arguments` before Photoshop execution
and explain the four-character requirement. Four-character inputs also return
both interpretations for comparison. A four-character stringID can be valid;
ID kind must be explicit and numeric IDs alone do not prove descriptor semantics.

### Breaking tool consolidation

Only the canonical entries are registered: `create_adjustment_layer` replaces
nine individual adjustment-layer tools, `set_text_style` replaces font/color/
alignment setters, `reorder_layer` replaces five stacking-order tools, and
`create_group` with optional `layer_ids` replaces `group_layers`. Old tool names
and group actions are rejected; no aliases or legacy schema discovery remain.
