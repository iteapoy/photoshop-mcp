import { ToolDefinition } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { atomicFailureFromError, atomicSuccess, parseSnippetResult, runSnippet } from './atomic-shared.js';

export function shapeScript(args: Record<string, unknown>): string {
  const shape = args.type;
  if (!['rectangle', 'rounded_rectangle', 'ellipse', 'line'].includes(String(shape))) {
    throw new Error('Invalid shape type');
  }
  const number = (key: string, fallback?: number): number => {
    const value = args[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid ' + key);
    return value;
  };
  let left = number('left'), top = number('top');
  let right = number('right'), bottom = number('bottom');
  const width = number('line_width', 1);
  const radius = number('radius', 10);
  const opacity = number('opacity', 100);
  const red = number('red', 0), green = number('green', 0), blue = number('blue', 0);
  if (width <= 0 || radius < 0 || opacity < 0 || opacity > 100 ||
      [red, green, blue].some((value) => value < 0 || value > 255)) {
    throw new Error('Invalid width, radius, opacity, or RGB color');
  }
  if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) {
    throw new Error('name must be a non-empty string');
  }
  const strokeWidth = number('stroke_width', 0);
  const strokeOpacity = number('stroke_opacity', 100);
  const strokeRed = number('stroke_red', 0), strokeGreen = number('stroke_green', 0);
  const strokeBlue = number('stroke_blue', 0);
  const dashOffset = number('dash_offset', 0);
  const alignment = args.stroke_alignment ?? 'center';
  const fillEnabled = args.fill_enabled ?? true;
  const dash = args.dash_pattern ?? [];
  if (typeof fillEnabled !== 'boolean' || strokeWidth < 0 ||
      strokeOpacity < 0 || strokeOpacity > 100 ||
      [strokeRed, strokeGreen, strokeBlue].some((v) => v < 0 || v > 255) ||
      !['inside', 'center', 'outside'].includes(String(alignment)) ||
      !Array.isArray(dash) || dash.length > 32 || dash.length % 2 !== 0 ||
      dash.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
    throw new Error('Invalid stroke or fill parameters');
  }
  if (!fillEnabled && strokeWidth === 0) throw new Error('Enable fill or provide a positive stroke_width');
  const alignments: Record<string, string> = {
    inside: 'strokeStyleAlignInside', center: 'strokeStyleAlignCenter', outside: 'strokeStyleAlignOutside',
  };
  let angle = 0;
  if (shape === 'line') {
    const dx = right - left, dy = bottom - top;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) throw new Error('Line endpoints must differ');
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    left = cx - length / 2; right = cx + length / 2;
    top = cy - width / 2; bottom = cy + width / 2;
    angle = Math.atan2(dy, dx) * 180 / Math.PI;
  } else if (right <= left || bottom <= top) {
    throw new Error('right and bottom must exceed left and top');
  }
  const geometry = shape === 'ellipse' ? 'Elps' : 'Rctn';
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument;
    var layer = null, scratchId = null, createdId = null;
    function removeScratch(container) {
      for (var i = 0; i < container.layers.length; i++) {
        var candidate = container.layers[i];
        if (candidate.id === scratchId && candidate.id !== createdId) {
          candidate.remove(); return;
        }
        if (candidate.typename === 'LayerSet') removeScratch(candidate);
      }
    }
    // Explicit geometry creates a new vector mask regardless of the active work path.
    try {
      var scratch = doc.artLayers.add();
      scratchId = scratch.id;
      var d = new ActionDescriptor(), ref = new ActionReference();
      ref.putClass(stringIDToTypeID('contentLayer'));
      d.putReference(charIDToTypeID('null'), ref);
      var using = new ActionDescriptor(), solid = new ActionDescriptor(), rgb = new ActionDescriptor();
      rgb.putDouble(charIDToTypeID('Rd  '), ${red});
      rgb.putDouble(charIDToTypeID('Grn '), ${green});
      rgb.putDouble(charIDToTypeID('Bl  '), ${blue});
      solid.putObject(charIDToTypeID('Clr '), charIDToTypeID('RGBC'), rgb);
      using.putObject(charIDToTypeID('Type'), stringIDToTypeID('solidColorLayer'), solid);
      var bounds = new ActionDescriptor();
      bounds.putUnitDouble(charIDToTypeID('Left'), charIDToTypeID('#Pxl'), ${left});
      bounds.putUnitDouble(charIDToTypeID('Top '), charIDToTypeID('#Pxl'), ${top});
      bounds.putUnitDouble(charIDToTypeID('Rght'), charIDToTypeID('#Pxl'), ${right});
      bounds.putUnitDouble(charIDToTypeID('Btom'), charIDToTypeID('#Pxl'), ${bottom});
      ${shape === 'rounded_rectangle' ? `bounds.putUnitDouble(charIDToTypeID('Rds '), charIDToTypeID('#Pxl'), ${Math.min(radius, (right-left)/2, (bottom-top)/2)});` : ''}
      using.putObject(charIDToTypeID('Shp '), charIDToTypeID('${geometry}'), bounds);

      var style = new ActionDescriptor();
      style.putInteger(stringIDToTypeID('strokeStyleVersion'), 2);
      style.putBoolean(stringIDToTypeID('strokeEnabled'), ${strokeWidth > 0});
      style.putBoolean(stringIDToTypeID('fillEnabled'), ${fillEnabled});
      style.putUnitDouble(stringIDToTypeID('strokeStyleLineWidth'), charIDToTypeID('#Pxl'), ${strokeWidth});
      style.putUnitDouble(stringIDToTypeID('strokeStyleOpacity'), charIDToTypeID('#Prc'), ${strokeOpacity});
      style.putEnumerated(stringIDToTypeID('strokeStyleLineAlignment'),
        stringIDToTypeID('strokeStyleLineAlignment'), stringIDToTypeID('${alignments[String(alignment)]}'));
      var strokeColor = new ActionDescriptor(), strokeContent = new ActionDescriptor();
      strokeColor.putDouble(charIDToTypeID('Rd  '), ${strokeRed});
      strokeColor.putDouble(charIDToTypeID('Grn '), ${strokeGreen});
      strokeColor.putDouble(charIDToTypeID('Bl  '), ${strokeBlue});
      strokeContent.putObject(charIDToTypeID('Clr '), charIDToTypeID('RGBC'), strokeColor);
      style.putObject(stringIDToTypeID('strokeStyleContent'), stringIDToTypeID('solidColorLayer'), strokeContent);
      var dashList = new ActionList();
      ${dash.map((v) => `dashList.putDouble(${v});`).join(' ')}
      style.putList(stringIDToTypeID('strokeStyleLineDashSet'), dashList);
      style.putUnitDouble(stringIDToTypeID('strokeStyleLineDashOffset'), charIDToTypeID('#Nne'), ${dashOffset});
      using.putObject(stringIDToTypeID('strokeStyle'), stringIDToTypeID('strokeStyle'), style);
      d.putObject(charIDToTypeID('Usng'), stringIDToTypeID('contentLayer'), using);
      executeAction(charIDToTypeID('Mk  '), d, DialogModes.NO);
      layer = doc.activeLayer;
      createdId = layer.id;
      removeScratch(doc);
      ${angle ? `layer.rotate(${angle}, AnchorPosition.MIDDLECENTER);` : ''}
      ${args.name ? `layer.name = ${JSON.stringify(args.name)};` : ''}
      layer.opacity = ${opacity};
      var layerRef = new ActionReference();
      layerRef.putEnumerated(charIDToTypeID('Lyr '), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
      var layerInfo = executeActionGet(layerRef);
      var actualStyle = layerInfo.getObjectValue(stringIDToTypeID('AGMStrokeStyleInfo'));
      var actualDash = actualStyle.getList(stringIDToTypeID('strokeStyleLineDashSet'));
      var readDash = [];
      for (var dashIndex = 0; dashIndex < actualDash.count; dashIndex++) readDash.push(actualDash.getDouble(dashIndex));
      return { created: true,
        stroke_opacity: actualStyle.getUnitDoubleValue(stringIDToTypeID('strokeStyleOpacity')),
        dash_offset: actualStyle.getUnitDoubleValue(stringIDToTypeID('strokeStyleLineDashOffset')),
        stroke_width: actualStyle.getUnitDoubleValue(stringIDToTypeID('strokeStyleLineWidth')),
        dash_pattern: readDash,
        stroke_alignment: typeIDToStringID(actualStyle.getEnumerationValue(stringIDToTypeID('strokeStyleLineAlignment'))),
 type: ${JSON.stringify(shape)}, layer_id: layer.id, layer_name: layer.name,
        kind: String(layer.kind), opacity: layer.opacity };
    } catch (error) {
      if (layer) { try { layer.remove(); } catch (cleanupError) {} }
      try { removeScratch(doc); } catch (scratchError) {}
      throw error;
    }
  `;
}

export function createShapeTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [{
    tool: {
      name: 'photoshop_create_shape_layer',
      description: 'Create an editable vector shape layer with optional native solid/dashed stroke and optional fill. Types: rectangle, rounded_rectangle, ellipse, line. Coordinates are pixels. For line, left/top and right/bottom are endpoints and line_width is its thickness. Lines are rectangular vector geometry with square ends; native stroke outlines that rectangle. dash_pattern lengths and dash_offset are multiples of stroke_width. Preconditions: active RGB-compatible document. Side effects: creates and activates a new layer.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['rectangle', 'rounded_rectangle', 'ellipse', 'line'] },
          left: { type: 'number' }, top: { type: 'number' },
          right: { type: 'number' }, bottom: { type: 'number' },
          radius: { type: 'number', minimum: 0, default: 10 },
          line_width: { type: 'number', exclusiveMinimum: 0, default: 1 },
          red: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          green: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          blue: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          opacity: { type: 'number', minimum: 0, maximum: 100, default: 100 },
          fill_enabled: { type: 'boolean', default: true },
          stroke_width: { type: 'number', minimum: 0, default: 0, description: 'Native vector outline width in pixels. Zero disables stroke.' },
          stroke_red: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          stroke_green: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          stroke_blue: { type: 'number', minimum: 0, maximum: 255, default: 0 },
          stroke_opacity: { type: 'number', minimum: 0, maximum: 100, default: 100 },
          stroke_alignment: { type: 'string', enum: ['inside', 'center', 'outside'], default: 'center' },
          dash_pattern: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 }, maxItems: 32,
            description: 'Alternating dash/gap lengths in multiples of stroke_width, in pairs. Empty means solid. Example [4, 2].' },
          dash_offset: { type: 'number', default: 0, description: 'Dash phase in multiples of stroke_width.' },
          name: { type: 'string', minLength: 1 },
        },
        required: ['type', 'left', 'top', 'right', 'bottom'],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      try {
        const result = parseSnippetResult(await runSnippet(connection, shapeScript(args)));
        if (!result) throw new Error('Invalid shape creation result');
        return atomicSuccess('Vector shape layer created', result);
      } catch (error) { return atomicFailureFromError(error); }
    },
  }];
}
