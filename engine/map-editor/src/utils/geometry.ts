import type { Point } from '../state/types';

/** Convertit une position écran (client) en coordonnées carte, en tenant compte du pan/zoom du canvas. */
export function screenToMap(rect: DOMRect, clientX: number, clientY: number, pan: Point, zoom: number): Point {
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  };
}

export function pointsToAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
