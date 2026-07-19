export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validation basique : vérifie juste que les champs requis de MapData sont
 * présents et du bon type de base. Ne valide pas la géométrie (polygones
 * bien formés, etc.) — ce n'est pas l'objet de cette étape.
 */
export function validateMapData(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Les données de carte doivent être un objet'] };
  }

  const map = data as Record<string, unknown>;

  if (typeof map.id !== 'string' || !map.id) errors.push('"id" est requis (string)');
  if (typeof map.name !== 'string' || !map.name) errors.push('"name" est requis (string)');
  if (typeof map.imageUrl !== 'string' || !map.imageUrl) errors.push('"imageUrl" est requis (string)');
  if (typeof map.width !== 'number') errors.push('"width" est requis (number)');
  if (typeof map.height !== 'number') errors.push('"height" est requis (number)');
  if (!Array.isArray(map.zones)) errors.push('"zones" doit être un tableau');
  if (!Array.isArray(map.walls)) errors.push('"walls" doit être un tableau');
  if (!Array.isArray(map.boxes)) errors.push('"boxes" doit être un tableau');
  if (!('navGrid' in map)) errors.push('"navGrid" est requis (peut être null en placeholder)');

  return { valid: errors.length === 0, errors };
}
