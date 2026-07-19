import fs from 'node:fs';
import { MapData } from '../types';
import { validateMapData } from './mapValidator';

/** Charge et valide une carte depuis un objet déjà parsé (ex: JSON.parse d'une requête HTTP). */
export function loadMapFromJson(json: unknown): MapData {
  const result = validateMapData(json);
  if (!result.valid) {
    throw new Error(`Données de carte invalides : ${result.errors.join(', ')}`);
  }
  return json as MapData;
}

/** Charge et valide une carte depuis un fichier JSON sur disque. */
export function loadMapFromFile(filePath: string): MapData {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  return loadMapFromJson(parsed);
}
