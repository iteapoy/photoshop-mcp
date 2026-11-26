import { jsStringLiteral } from '../utils/js-string.js';
import { MAX_VERSION_PIXELS } from '../lib/version-images.js';

export const VERSION_DOCUMENT_INFO_SCRIPT = `
  if (!app.documents.length) throw new Error('No active document');
  var doc=app.activeDocument,path=null;try {path=doc.fullName.fsName;}catch(ePath){}
  return {id:doc.id,name:String(doc.name),path:path,saved:doc.saved,width:doc.width.as('px'),height:doc.height.as('px')};
`;
/** Full-resolution canonical render and an optional layered copy; the source document is never saved or edited. */
export function versionCaptureScript(
  documentId: number,
  pngPath: string,
  psdPath?: string
): string {
  return `
    var source=null;for(var i=0;i<app.documents.length;i++)if(app.documents[i].id===${documentId})source=app.documents[i];
    if (!source) throw new Error('document_not_found: version source is no longer open');
    app.activeDocument=source;
    if (source.mode!==DocumentMode.RGB || source.bitsPerChannel===BitsPerChannelType.THIRTYTWO) throw new Error('Invalid parameter: version verification requires an 8-bit or 16-bit RGB document');
    if (source.width.as('px')*source.height.as('px')>${MAX_VERSION_PIXELS}) throw new Error('Invalid parameter: version verification supports at most 32 million pixels');
    var sourcePath=null;try{sourcePath=source.fullName.fsName;}catch(ePath){}
    var before={id:source.id,name:String(source.name),path:sourcePath,saved:source.saved,width:source.width.as('px'),height:source.height.as('px')};
    var copy=null;
    try {
      ${psdPath ? `var psd=new PhotoshopSaveOptions();psd.layers=true;psd.embedColorProfile=true;source.saveAs(new File(${jsStringLiteral(psdPath)}),psd,true,Extension.LOWERCASE);` : ''}
      copy=source.duplicate('__mcp_version_render__',true);app.activeDocument=copy;
      if (copy.colorProfileName!=='sRGB IEC61966-2.1') copy.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
      copy.bitsPerChannel=BitsPerChannelType.EIGHT;
      var png=new PNGSaveOptions();png.compression=6;png.interlaced=false;
      copy.saveAs(new File(${jsStringLiteral(pngPath)}),png,true,Extension.LOWERCASE);
      return {document:before,render:{width:copy.width.as('px'),height:copy.height.as('px'),color_space:'sRGB',bit_depth:8}};
    } finally {
      if(copy){try{copy.close(SaveOptions.DONOTSAVECHANGES);}catch(eClose){}}
      app.activeDocument=source;
    }
  `;
}
