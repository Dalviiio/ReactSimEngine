import { Box, MapData, NavGrid, Point, Wall } from '../types';
import { Rect, boxToRect, rectsOverlap, segmentIntersectsRect } from './geometry';

function wallSegments(wall: Wall): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (let i = 0; i < wall.points.length - 1; i += 1) {
    segments.push([wall.points[i], wall.points[i + 1]]);
  }
  return segments;
}

function isCellBlocked(cellRect: Rect, walls: Wall[], boxes: Box[]): boolean {
  const blockedByWall = walls.some((wall) =>
    wallSegments(wall).some(([a, b]) => segmentIntersectsRect(a, b, cellRect)),
  );
  if (blockedByWall) return true;

  // Toutes les tailles de caisse bloquent le DÉPLACEMENT (seule la vision distingue
  // "small" des autres, cf. hasLineOfSight dans lineOfSight.ts).
  return boxes.some((box) => rectsOverlap(boxToRect(box), cellRect));
}

/**
 * Découpe la carte en grille de cellules carrées de `cellSize` et marque comme
 * bloquée (1) toute cellule qui chevauche un mur ou une caisse (quelle que soit
 * sa taille). Remplace le placeholder `MapData.navGrid`.
 */
export function buildNavGrid(mapData: MapData, cellSize: number): NavGrid {
  const cols = Math.max(1, Math.ceil(mapData.width / cellSize));
  const rows = Math.max(1, Math.ceil(mapData.height / cellSize));
  const cells: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cellRect: Rect = { x: col * cellSize, y: row * cellSize, width: cellSize, height: cellSize };
      cells[row][col] = isCellBlocked(cellRect, mapData.walls, mapData.boxes) ? 1 : 0;
    }
  }

  return { cellSize, cols, rows, cells };
}

export function cellIndexAt(navGrid: NavGrid, point: Point): { col: number; row: number } {
  return {
    col: Math.floor(point.x / navGrid.cellSize),
    row: Math.floor(point.y / navGrid.cellSize),
  };
}

export function cellCenter(navGrid: NavGrid, col: number, row: number): Point {
  return {
    x: col * navGrid.cellSize + navGrid.cellSize / 2,
    y: row * navGrid.cellSize + navGrid.cellSize / 2,
  };
}

export function isWalkable(navGrid: NavGrid, col: number, row: number): boolean {
  if (row < 0 || row >= navGrid.rows || col < 0 || col >= navGrid.cols) return false;
  return navGrid.cells[row][col] === 0;
}
