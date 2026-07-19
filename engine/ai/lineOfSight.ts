import { MapData, Point } from '../types';
import { boxToRect, segmentIntersectsRect, segmentsIntersect } from './geometry';

/**
 * Vérifie l'existence d'une ligne de vue directe entre deux points.
 * Bloquée par : un mur (segment), une caisse "medium" ou "large".
 * Ignorée par : une caisse "small" (bloque le déplacement mais pas le tir/la
 * vision — cf. règles documentées dans engine/types/map.ts).
 */
export function hasLineOfSight(mapData: MapData, from: Point, to: Point): boolean {
  const blockedByWall = mapData.walls.some((wall) => {
    for (let i = 0; i < wall.points.length - 1; i += 1) {
      if (segmentsIntersect(from, to, wall.points[i], wall.points[i + 1])) return true;
    }
    return false;
  });
  if (blockedByWall) return false;

  const blockedByBox = mapData.boxes.some(
    (box) => box.size !== 'small' && segmentIntersectsRect(from, to, boxToRect(box)),
  );

  return !blockedByBox;
}
