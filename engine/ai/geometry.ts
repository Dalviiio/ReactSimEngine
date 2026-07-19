import { Point } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boxToRect(box: { position: Point; width: number; height: number }): Rect {
  return {
    x: box.position.x - box.width / 2,
    y: box.position.y - box.height / 2,
    width: box.width,
    height: box.height,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInRect(p: Point, rect: Rect): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

function orientation(a: Point, b: Point, c: Point): number {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

/** Intersection segment/segment classique (test d'orientation), cas colinéaires inclus. */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;

  return false;
}

/** Intersection segment/rectangle : un point à l'intérieur ou un croisement avec un des 4 côtés. */
export function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect): boolean {
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) return true;

  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (segmentsIntersect(p1, p2, a, b)) return true;
  }

  return false;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Avance de `from` vers `to` d'au plus `maxDistance` ; retourne `to` tel quel si déjà assez proche. */
export function moveToward(from: Point, to: Point, maxDistance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDistance || dist === 0) return { x: to.x, y: to.y };
  const ratio = maxDistance / dist;
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
}
