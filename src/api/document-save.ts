import { jsStringLiteral } from '../utils/js-string.js';

export interface DocumentSaveOptions {
  path: string;
  format: 'PSD' | 'JPEG' | 'PNG';
  quality: number;
  as_copy: boolean;
}
/** Saving as a copy never rebinds the source document's file or clears its dirty state. */
export function documentSaveScript(options: DocumentSaveOptions): string {
  const formatOptions =
    options.format === 'PSD'
      ? 'var options = new PhotoshopSaveOptions(); options.layers = true; options.embedColorProfile = true;'
      : options.format === 'JPEG'
        ? `var options = new JPEGSaveOptions(); options.quality = ${options.quality}; options.embedColorProfile = true;`
        : 'var options = new PNGSaveOptions(); options.compression = 9; options.interlaced = false;';
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument;
    var asCopy = ${options.as_copy};
    if (!asCopy && '${options.format}' !== 'PSD' && (doc.layers.length > 1 || doc.activeLayer.typename === 'LayerSet')) {
      throw new Error('Invalid parameter: layered documents require PSD for normal saving; use as_copy:true for JPEG/PNG');
    }
    function documentState() {
      var path = null; try { path = doc.fullName.fsName; } catch (ePath) {}
      return { id: doc.id, name: String(doc.name), path: path, saved: doc.saved };
    }
    var before = documentState();
    var file = new File(${jsStringLiteral(options.path)});
    ${formatOptions}
    doc.saveAs(file, options, asCopy, Extension.LOWERCASE);
    var after = documentState();
    if (!file.exists) throw new Error('Document save did not create the requested file');
    if (!asCopy && (!after.path || !after.saved)) {
      throw new Error('Document state: Photoshop wrote a copy instead of binding the document to the requested path; use PSD or as_copy:true');
    }
    return { path: file.fsName, format: '${options.format}', as_copy: asCopy, before_document: before, document: after };
  `;
}
