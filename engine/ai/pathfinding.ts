import { NavGrid, Point } from '../types';
import { cellCenter, cellIndexAt, isWalkable } from './navGrid';

interface AStarNode {
  col: number;
  row: number;
  g: number;
  f: number;
  parent: AStarNode | null;
}

interface NeighborOffset {
  dc: number;
  dr: number;
  cost: number;
}

const NEIGHBOR_OFFSETS: NeighborOffset[] = [
  { dc: 1, dr: 0, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: Math.SQRT2 },
  { dc: 1, dr: -1, cost: Math.SQRT2 },
  { dc: -1, dr: 1, cost: Math.SQRT2 },
  { dc: -1, dr: -1, cost: Math.SQRT2 },
];

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Distance octile : cohérente avec un coût diagonal de √2 (admissible pour A*). */
function heuristic(a: { col: number; row: number }, b: { col: number; row: number }): number {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function reconstructPath(node: AStarNode, navGrid: NavGrid, start: Point, end: Point): Point[] {
  const chain: AStarNode[] = [];
  let cur: AStarNode | null = node;
  while (cur) {
    chain.push(cur);
    cur = cur.parent;
  }
  chain.reverse();

  const points = chain.map((cell) => cellCenter(navGrid, cell.col, cell.row));
  points[0] = start;
  points[points.length - 1] = end;
  return points;
}

/**
 * A* classique sur la NavGrid (8 directions, coût 1 en orthogonal et √2 en
 * diagonal). Empêche de couper un coin bloqué : une diagonale n'est autorisée
 * que si les deux cellules orthogonales adjacentes sont aussi libres.
 * Retourne les points du chemin (départ → arrivée) ou `null` si aucun chemin
 * n'existe (départ/arrivée non-walkable ou zones déconnectées).
 */
export function findPath(navGrid: NavGrid, start: Point, end: Point): Point[] | null {
  const startCell = cellIndexAt(navGrid, start);
  const endCell = cellIndexAt(navGrid, end);

  if (!isWalkable(navGrid, startCell.col, startCell.row) || !isWalkable(navGrid, endCell.col, endCell.row)) {
    return null;
  }

  if (startCell.col === endCell.col && startCell.row === endCell.row) {
    return [end];
  }

  const open = new Map<string, AStarNode>();
  const closed = new Set<string>();

  const startNode: AStarNode = {
    col: startCell.col,
    row: startCell.row,
    g: 0,
    f: heuristic(startCell, endCell),
    parent: null,
  };
  open.set(cellKey(startNode.col, startNode.row), startNode);

  while (open.size > 0) {
    let current: AStarNode | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    const currentKey = cellKey(current.col, current.row);
    open.delete(currentKey);
    closed.add(currentKey);

    if (current.col === endCell.col && current.row === endCell.row) {
      return reconstructPath(current, navGrid, start, end);
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const nCol = current.col + offset.dc;
      const nRow = current.row + offset.dr;
      const key = cellKey(nCol, nRow);
      if (closed.has(key) || !isWalkable(navGrid, nCol, nRow)) continue;

      if (offset.dc !== 0 && offset.dr !== 0) {
        const cornerFree =
          isWalkable(navGrid, current.col + offset.dc, current.row) &&
          isWalkable(navGrid, current.col, current.row + offset.dr);
        if (!cornerFree) continue;
      }

      const tentativeG = current.g + offset.cost;
      const existing = open.get(key);
      if (existing && tentativeG >= existing.g) continue;

      open.set(key, {
        col: nCol,
        row: nRow,
        g: tentativeG,
        f: tentativeG + heuristic({ col: nCol, row: nRow }, endCell),
        parent: current,
      });
    }
  }

  return null;
}
