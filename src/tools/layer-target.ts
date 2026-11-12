/**
 * Shared `layer_name` selector for every tool that mutates one layer.
 *
 * Without it, a transform/ordering/style call silently hits whatever was
 * active — the classic "I scaled the wrong layer" bug. Tools that accept it
 * resolve the name in ExtendScript (`__mcp_resolveLayer`) and never require a
 * separate `photoshop_select_layer_by_name` round trip.
 */
export const LAYER_NAME_PROPERTY = {
  type: 'string',
  description:
    'Target layer by name (searches nested groups). Omit or leave empty to act on the active layer.',
} as const;

/** `layer_name` argument, or '' for "use the active layer". */
export function layerName(args: Record<string, unknown> | undefined): string {
  const raw = args?.layer_name;
  return typeof raw === 'string' ? raw.trim() : '';
}
