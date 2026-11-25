export const toolCatalogCases = [
  {
    id: 'list-documents',
    prompt: '列出所有打开的 Photoshop 文档，不要切换工作文档。',
    legacy: 'photoshop_list_documents',
    compact: 'photoshop_document',
    action: 'list',
    args: {},
  },
  {
    id: 'translate-layer',
    prompt: '在文档 7，把 ID 为 42 的图层在画布上向右移 24 像素，垂直位置不变。',
    legacy: 'photoshop_move_layer',
    compact: 'photoshop_layer',
    action: 'translate',
    args: { document_id: 7, layer_id: 42, deltaX: 24, deltaY: 0 },
  },
  {
    id: 'move-layer-into-group',
    prompt: '在文档 7，把图层 42 移到图层组 81 里面，保留画布上的位置。',
    legacy: 'photoshop_move_layers_to_group',
    compact: 'photoshop_group',
    action: 'move_layers_into_group',
    args: { document_id: 7, layer_ids: [42], group_id: 81 },
  },
  {
    id: 'set-layer-opacity',
    prompt: '把文档 7 的图层 42 的不透明度设为 60%，保留其他图层属性。',
    legacy: 'photoshop_set_layer_opacity',
    compact: 'photoshop_layer',
    action: 'update',
    args: { document_id: 7, layer_id: 42, opacity: 60 },
  },
  {
    id: 'merge-visible',
    prompt: '把文档 7 中所有可见图层合并成一个，保留隐藏的图层。',
    legacy: 'photoshop_merge_visible_layers',
    compact: 'photoshop_layer',
    action: 'merge_visible',
    args: { document_id: 7 },
  },
  {
    id: 'select-subject',
    prompt: '对文档 7 的当前图层执行「选择主体」，只需要得到选区。',
    legacy: 'photoshop_select_subject',
    compact: 'photoshop_selection',
    action: 'subject',
    args: { document_id: 7 },
  },
  {
    id: 'create-editable-mask',
    prompt: '文档 7 已有像素选区，用它给图层 42 创建可编辑的图层蒙版。',
    legacy: 'photoshop_create_layer_mask',
    compact: 'photoshop_mask',
    action: 'create_from_selection',
    args: { document_id: 7, layer_id: 42 },
  },
  {
    id: 'delete-mask-keep-pixels',
    prompt: '移除文档 7 中图层 42 的蒙版，恢复此前隐藏的像素。',
    legacy: 'photoshop_delete_layer_mask',
    compact: 'photoshop_mask',
    action: 'delete',
    args: { document_id: 7, layer_id: 42 },
  },
  {
    id: 'bake-mask',
    prompt: '应用文档 7 中图层 42 的蒙版，把它烘焙进图层，永久删掉蒙版遮住的像素。',
    legacy: 'photoshop_apply_layer_mask',
    compact: 'photoshop_mask',
    action: 'bake_into_layer',
    args: { document_id: 7, layer_id: 42 },
  },
  {
    id: 'motion-blur',
    prompt: '给文档 7 的像素图层 42 添加动感模糊，角度 30°，距离 12 px。',
    legacy: 'photoshop_apply_motion_blur',
    compact: 'photoshop_filter',
    action: 'motion_blur',
    args: { document_id: 7, layer_id: 42, angle: 30, radius: 12 },
  },
  {
    id: 'stroke-path',
    prompt: '在文档 7 的图层 42 上，将已有的 Outline 路径描边，线宽 3 px。',
    legacy: 'photoshop_stroke_path',
    compact: 'photoshop_path',
    action: 'stroke',
    args: { document_id: 7, layer_id: 42, name: 'Outline', width: 3 },
  },
  {
    id: 'distribute-layer-gaps',
    prompt: '在文档 7，将图层 A、B、C 沿垂直方向等间距分布，按边缘之间的空隙计算。',
    legacy: 'photoshop_distribute_layers',
    compact: 'photoshop_layout',
    action: 'distribute',
    args: { document_id: 7, layer_names: ['A', 'B', 'C'], axis: 'vertical', mode: 'gaps' },
  },
  {
    id: 'remove-background-recipe',
    prompt: '文档 7 当前图层是一张商品图。去掉背景，保留可编辑蒙版。',
    legacy: 'photoshop_recipe_remove_background',
    compact: 'photoshop_recipe_remove_background',
    args: { document_id: 7 },
  },
] satisfies Array<{
  id: string;
  prompt: string;
  legacy: string;
  compact: string;
  action?: string;
  args: Record<string, unknown>;
}>;
