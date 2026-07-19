import type { MapData } from '../../../types/map';
import { validateMapData } from '../../../map/mapValidator';

export type ParseResult = { ok: true; data: MapData } | { ok: false; errors: string[] };

/** Parse + valide (via mapValidator.ts partagé) un fichier JSON MapData importé. */
export function parseMapDataFile(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['Le fichier ne contient pas du JSON valide.'] };
  }

  const result = validateMapData(parsed);
  if (!result.valid) {
    return { ok: false, errors: result.errors };
  }

  return { ok: true, data: parsed as MapData };
}
