export interface PathStrokeOptions {
  width: number;
  opacity: number;
  alignment: 'inside' | 'center' | 'outside';
}

/** Render a native vector stroke into an alpha mask, then paint the original layer. */
export function nativePathStrokeScript(
  name: string, red: number, green: number, blue: number,
  dash: number, gap: number, options: PathStrokeOptions
): string {
  const alignments = {
    inside: 'strokeStyleAlignInside', center: 'strokeStyleAlignCenter', outside: 'strokeStyleAlignOutside',
  };
  return `
    if (!app.documents.length) throw new Error('No active document');
    var doc = app.activeDocument, targetLayer = doc.activeLayer;
    if (targetLayer.typename !== 'ArtLayer' || targetLayer.kind !== LayerKind.NORMAL) {
      throw new Error('Invalid parameter: path stroke requires a pixel layer');
    }
    if (targetLayer.allLocked || targetLayer.pixelsLocked || targetLayer.transparentPixelsLocked) {
      throw new Error('Invalid parameter: target layer must allow pixel edits');
    }
    var path = null;
    for (var i = 0; i < doc.pathItems.length; i++) {
      if (doc.pathItems[i].name === ${JSON.stringify(name)}) path = doc.pathItems[i];
    }
    if (!path) throw new Error('Invalid parameter: path not found');
    if (${options.alignment !== 'center'}) {
      for (var i = 0; i < path.subPathItems.length; i++) {
        if (!path.subPathItems[i].closed) {
          throw new Error('Invalid parameter: inside/outside alignment requires closed subpaths');
        }
      }
    }
    var targetId = targetLayer.id;
    function findTarget(container) {
      for (var ti = 0; ti < container.layers.length; ti++) {
        var candidate = container.layers[ti];
        if (candidate.id === targetId) return candidate;
        if (candidate.typename === 'LayerSet') {
          var nested = findTarget(candidate); if (nested) return nested;
        }
      }
      return null;
    }
    var baseline = doc.activeHistoryState;
    var originalChannels = doc.activeChannels;
    var originalForeground = app.foregroundColor;
    var savedSelection = null, tempLayer = null, renderPath = null;
    var hadSelection = false;
    try { hadSelection = doc.selection.bounds != null; } catch (noSelection) {}
    var token = '__mcp_stroke_' + new Date().getTime();
    function readBounds(layer) {
      try {
        var b = layer.bounds;
        return [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')];
      } catch (eBounds) { return null; }
    }
    function selectionBounds() {
      try {
        var b = doc.selection.bounds;
        return [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')];
      } catch (emptySelection) { return null; }
    }
    var strokePhase = 'prepare';
    try {
      if (hadSelection) {
        savedSelection = doc.channels.add();
        savedSelection.name = token;
        doc.selection.store(savedSelection);
      }
      doc.selection.deselect();
      doc.activeChannels = doc.componentChannels;
      // Photoshop can reuse an active empty pixel layer when making a shape.
      // Supply a disposable empty layer so the caller's target ID survives.
      tempLayer = doc.artLayers.add();
      tempLayer.name = token;
      strokePhase = 'select_path';
      renderPath = path.duplicate(token);
      var select = new ActionDescriptor(), selectedPath = new ActionReference();
      selectedPath.putName(charIDToTypeID('Path'), token);
      select.putReference(charIDToTypeID('null'), selectedPath);
      executeAction(charIDToTypeID('slct'), select, DialogModes.NO);

      var d = new ActionDescriptor(), ref = new ActionReference();
      ref.putClass(stringIDToTypeID('contentLayer'));
      d.putReference(charIDToTypeID('null'), ref);
      var using = new ActionDescriptor(), solid = new ActionDescriptor(), rgb = new ActionDescriptor();
      rgb.putDouble(charIDToTypeID('Rd  '), ${red});
      rgb.putDouble(charIDToTypeID('Grn '), ${green});
      rgb.putDouble(charIDToTypeID('Bl  '), ${blue});
      solid.putObject(charIDToTypeID('Clr '), charIDToTypeID('RGBC'), rgb);
      using.putObject(charIDToTypeID('Type'), stringIDToTypeID('solidColorLayer'), solid);
      var style = new ActionDescriptor();
      style.putInteger(stringIDToTypeID('strokeStyleVersion'), 2);
      style.putBoolean(stringIDToTypeID('strokeEnabled'), true);
      style.putBoolean(stringIDToTypeID('fillEnabled'), false);
      style.putUnitDouble(stringIDToTypeID('strokeStyleLineWidth'), charIDToTypeID('#Pxl'), ${options.width});
      style.putUnitDouble(stringIDToTypeID('strokeStyleOpacity'), charIDToTypeID('#Prc'), 100);
      style.putEnumerated(stringIDToTypeID('strokeStyleLineAlignment'),
        stringIDToTypeID('strokeStyleLineAlignment'), stringIDToTypeID('${alignments[options.alignment]}'));
      style.putObject(stringIDToTypeID('strokeStyleContent'), stringIDToTypeID('solidColorLayer'), solid);
      var dashList = new ActionList();
      ${dash > 0 ? `dashList.putDouble(${dash / options.width}); dashList.putDouble(${gap / options.width});` : ''}
      style.putList(stringIDToTypeID('strokeStyleLineDashSet'), dashList);
      using.putObject(stringIDToTypeID('strokeStyle'), stringIDToTypeID('strokeStyle'), style);
      d.putObject(charIDToTypeID('Usng'), stringIDToTypeID('contentLayer'), using);
      strokePhase = 'create_shape';
      executeAction(charIDToTypeID('Mk  '), d, DialogModes.NO);
      tempLayer = doc.activeLayer;
      strokePhase = 'rasterize';
      tempLayer.rasterize(RasterizeType.ENTIRELAYER);
      tempLayer = doc.activeLayer;

      strokePhase = 'load_alpha';
      var alpha = new ActionDescriptor(), selectionRef = new ActionReference(), alphaRef = new ActionReference();
      selectionRef.putProperty(charIDToTypeID('Chnl'), charIDToTypeID('fsel'));
      alpha.putReference(charIDToTypeID('null'), selectionRef);
      alphaRef.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Trsp'));
      alpha.putReference(charIDToTypeID('T   '), alphaRef);
      executeAction(charIDToTypeID('setd'), alpha, DialogModes.NO);
      strokePhase = 'clip_selection';
      if (savedSelection) doc.selection.load(savedSelection, SelectionType.INTERSECT);
      var affected = selectionBounds();
      strokePhase = 'remove_temp';
      tempLayer.remove(); tempLayer = null;
      strokePhase = 'activate_target';
      targetLayer = findTarget(doc);
      if (!targetLayer) throw new Error('layer_not_found: original target was removed');
      doc.activeLayer = targetLayer;
      strokePhase = 'activate_components';
      doc.activeChannels = doc.componentChannels;
      if (affected && ${options.opacity} > 0) {
        var color = new SolidColor();
        color.rgb.red = ${red}; color.rgb.green = ${green}; color.rgb.blue = ${blue};
        app.foregroundColor = color;
        doc.selection.fill(color, ColorBlendMode.NORMAL, ${options.opacity}, false);
      }
      return {
        ok: true, name: ${JSON.stringify(name)}, layer_id: targetLayer.id,
        width: ${options.width}, opacity: ${options.opacity}, alignment: ${JSON.stringify(options.alignment)},
        dashed: ${dash > 0}, dash: ${dash}, gap: ${gap},
        selection_bounds: affected, bounds_kind: 'stroke_mask',
        target_bounds: readBounds(targetLayer),
        warning: affected ? null : 'no_pixels_changed'
      };
    } catch (error) {
      try { doc.activeHistoryState = baseline; }
      catch (rollbackError) { throw new Error(error.message + ' (rollback failed: ' + rollbackError.message + ')'); }
      throw new Error('Path stroke ' + strokePhase + ': ' + error.message);
    } finally {
      try { if (tempLayer) tempLayer.remove(); } catch (eLayer) {}
      try { if (renderPath) renderPath.remove(); } catch (ePath) {}
      try {
        var originalTarget = findTarget(doc);
        if (originalTarget) doc.activeLayer = originalTarget;
        if (savedSelection) doc.selection.load(savedSelection);
        else if (!hadSelection) doc.selection.deselect();
      } catch (eSelection) {}
      try { if (savedSelection) savedSelection.remove(); } catch (eChannel) {}
      try { doc.activeChannels = originalChannels; } catch (eChannels) {}
      app.foregroundColor = originalForeground;
    }
  `;
}
