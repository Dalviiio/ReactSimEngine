import type { MapData } from '../../../types/map';
import { validateMapData } from '../../../map/mapValidator';
import type { EditorState } from '../state/types';

export function buildMapData(state: EditorState): MapData {
  return {
    id: state.mapId,
    name: state.mapName,
    imageUrl: state.imageFileName,
    width: state.imageWidth,
    height: state.imageHeight,
    zones: state.zones,
    walls: state.walls,
    boxes: state.boxes,
    navGrid: null,
  };
}

export type ExportResult = { ok: true } | { ok: false; errors: string[] };

/** Valide (via mapValidator.ts partagé) puis télécharge le MapData en JSON si valide. */
export function exportMapData(state: EditorState): ExportResult {
  const mapData = buildMapData(state);
  const result = validateMapData(mapData);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }

  const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${mapData.id || 'map'}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { ok: true };
}
