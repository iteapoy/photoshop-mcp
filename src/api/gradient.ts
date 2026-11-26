import { jsStringLiteral } from '../utils/js-string.js';

type Point = { x: number; y: number };
type Stop = { position: number; midpoint: number };
export interface GradientOptions {
  type: 'linear' | 'radial' | 'reflected';
  from: Point;
  to: Point;
  color_stops: Array<Stop & { red: number; green: number; blue: number }>;
  opacity_stops: Array<Stop & { opacity: number }>;
  reverse: boolean;
  dither: boolean;
}
const pointSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const stopProperties = {
  position: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description: 'Normalized position; first 0 and last 1, strictly increasing.',
  },
  midpoint: { type: 'number', minimum: 0.01, maximum: 0.99, default: 0.5 },
};
export const GRADIENT_PROPERTIES = {
  type: { type: 'string', enum: ['linear', 'radial', 'reflected'], default: 'linear' },
  from: { ...pointSchema, description: 'Start or radial center, in canvas pixels.' },
  to: {
    ...pointSchema,
    description: 'End or radial radius point, in canvas pixels; must differ from from.',
  },
  color_stops: {
    type: 'array',
    minItems: 2,
    maxItems: 64,
    items: {
      type: 'object',
      properties: {
        ...stopProperties,
        red: { type: 'number', minimum: 0, maximum: 255 },
        green: { type: 'number', minimum: 0, maximum: 255 },
        blue: { type: 'number', minimum: 0, maximum: 255 },
      },
      required: ['position', 'red', 'green', 'blue'],
      additionalProperties: false,
    },
  },
  opacity_stops: {
    type: 'array',
    minItems: 2,
    maxItems: 64,
    description:
      'Independent transparency ramp. Omit for opaque. Transparent stops leave existing pixels intact; use an empty layer for transparent output.',
    items: {
      type: 'object',
      properties: {
        ...stopProperties,
        opacity: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['position', 'opacity'],
      additionalProperties: false,
    },
  },
  reverse: { type: 'boolean', default: false },
  dither: { type: 'boolean', default: true },
};
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid parameter: ' + name + ' must be an object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new Error('Invalid parameter: unknown fields ' + unknown.join(', '));
}
function number(value: unknown, name: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Invalid parameter: ' + name + ' is outside its finite numeric range');
  return value;
}
export function parseGradientArgs(args: Record<string, unknown>): GradientOptions {
  keys(args, [...Object.keys(GRADIENT_PROPERTIES), 'layer_name', 'layer_id', 'document_id']);
  const type = args.type ?? 'linear';
  if (!['linear', 'radial', 'reflected'].includes(type as string))
    throw new Error('Invalid parameter: gradient type');
  const point = (raw: unknown, name: string): Point => {
    const p = object(raw, name);
    keys(p, ['x', 'y']);
    return { x: number(p.x, name + '.x'), y: number(p.y, name + '.y') };
  };
  const from = point(args.from, 'from'),
    to = point(args.to, 'to');
  if (Math.hypot(from.x - to.x, from.y - to.y) < 0.000001)
    throw new Error('Invalid parameter: gradient endpoints must differ');
  function stops(raw: unknown, channels: string[]): Array<Record<string, number> & Stop> {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 64)
      throw new Error('Invalid parameter: gradient needs 2–64 stops');
    let previous = -1;
    const result = raw.map((entry, i) => {
      const stop = object(entry, 'stop');
      keys(stop, ['position', 'midpoint', ...channels]);
      const position = number(stop.position, 'position', 0, 1);
      const location = Math.round(position * 4096);
      if (location <= previous)
        throw new Error(
          'Invalid parameter: stop positions must increase at Photoshop 1/4096 precision'
        );
      previous = location;
      const out: Record<string, number> & Stop = {
        position,
        midpoint: number(stop.midpoint ?? 0.5, 'midpoint', 0.01, 0.99),
      };
      for (const channel of channels)
        out[channel] = number(stop[channel], channel, 0, channel === 'opacity' ? 100 : 255);
      if ((i === 0 && position !== 0) || (i === raw.length - 1 && position !== 1))
        throw new Error('Invalid parameter: endpoint stops must be at 0 and 1');
      return out;
    });
    return result;
  }
  for (const key of ['reverse', 'dither'])
    if (args[key] !== undefined && typeof args[key] !== 'boolean')
      throw new Error('Invalid parameter: ' + key + ' must be boolean');
  return {
    type: type as GradientOptions['type'],
    from,
    to,
    color_stops: stops(args.color_stops, [
      'red',
      'green',
      'blue',
    ]) as GradientOptions['color_stops'],
    opacity_stops: stops(
      args.opacity_stops === undefined
        ? [
            { position: 0, opacity: 100 },
            { position: 1, opacity: 100 },
          ]
        : args.opacity_stops,
      ['opacity']
    ) as GradientOptions['opacity_stops'],
    reverse: args.reverse === true,
    dither: args.dither !== false,
  };
}
/** Expects shared cTID and exact layer-target helpers in the enclosing script. */
export function nativeGradientScript(options: GradientOptions, layerName = ''): string {
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument;
    var layer = __mcp_resolveLayer(doc, ${jsStringLiteral(layerName)}, 0);
    if (layer.typename !== 'ArtLayer' || layer.kind !== LayerKind.NORMAL) throw new Error('Invalid parameter: gradient requires a pixel layer');
    if (layer.allLocked || layer.pixelsLocked || layer.transparentPixelsLocked) throw new Error('Invalid parameter: gradient target is locked');
    var opts = ${JSON.stringify(options)};
    if (layer.isBackgroundLayer) {
      for (var oi=0; oi<opts.opacity_stops.length; oi++) if (opts.opacity_stops[oi].opacity < 100) throw new Error('Invalid parameter: transparency requires a non-background pixel layer');
    }
    doc.activeLayer = layer;
    function point(p) { var d = new ActionDescriptor(); d.putUnitDouble(cTID('Hrzn'), cTID('#Pxl'), p.x); d.putUnitDouble(cTID('Vrtc'), cTID('#Pxl'), p.y); return d; }
    var args = new ActionDescriptor();
    args.putObject(cTID('From'), cTID('Pnt '), point(opts.from));
    args.putObject(cTID('T   '), cTID('Pnt '), point(opts.to));
    args.putEnumerated(cTID('Md  '), cTID('BlnM'), cTID('Nrml'));
    args.putEnumerated(cTID('Type'), cTID('GrdT'), cTID('${{ linear: 'Lnr ', radial: 'Rdl ', reflected: 'Rflc' }[options.type]}'));
    args.putBoolean(cTID('Dthr'), opts.dither); args.putBoolean(cTID('UsMs'), true); args.putBoolean(cTID('Rvrs'), opts.reverse);
    var grad = new ActionDescriptor(); grad.putString(cTID('Nm  '), 'MCP Custom');
    grad.putEnumerated(cTID('GrdF'), cTID('GrdF'), cTID('CstS')); grad.putDouble(cTID('Intr'), 4096);
    var colors = new ActionList();
    for (var i=0; i<opts.color_stops.length; i++) {
      var s = opts.color_stops[i], stop = new ActionDescriptor(), rgb = new ActionDescriptor();
      rgb.putDouble(cTID('Rd  '), s.red); rgb.putDouble(cTID('Grn '), s.green); rgb.putDouble(cTID('Bl  '), s.blue);
      stop.putInteger(cTID('Lctn'), Math.round(s.position*4096)); stop.putInteger(cTID('Mdpn'), Math.round(s.midpoint*100));
      stop.putObject(cTID('Clr '), cTID('RGBC'), rgb); stop.putEnumerated(cTID('Type'), cTID('Clry'), cTID('UsrS'));
      colors.putObject(cTID('Clrt'), stop);
    }
    grad.putList(cTID('Clrs'), colors);
    var transfers = new ActionList();
    for (var j=0; j<opts.opacity_stops.length; j++) {
      var s = opts.opacity_stops[j], stop = new ActionDescriptor();
      stop.putInteger(cTID('Lctn'), Math.round(s.position*4096)); stop.putInteger(cTID('Mdpn'), Math.round(s.midpoint*100));
      stop.putUnitDouble(cTID('Opct'), cTID('#Prc'), s.opacity); transfers.putObject(cTID('TrnS'), stop);
    }
    grad.putList(cTID('Trns'), transfers); args.putObject(cTID('Grad'), cTID('Grdn'), grad);
    executeAction(cTID('Grdn'), args, DialogModes.NO);
    var selection = null; try { var b=doc.selection.bounds; selection=[b[0].as('px'),b[1].as('px'),b[2].as('px'),b[3].as('px')]; } catch(eSelection) {}
    return { filled: true, layer_id: layer.id, layer_name: layer.name, type: opts.type, from: opts.from, to: opts.to,
      color_stops: opts.color_stops, opacity_stops: opts.opacity_stops, selection_bounds: selection,
      bounds_kind: 'selection_or_canvas', requested_bounds: selection || [0,0,doc.width.as('px'),doc.height.as('px')] };
  `;
}
