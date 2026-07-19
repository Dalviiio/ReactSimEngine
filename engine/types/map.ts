import { Point } from './common';

/** Type de zone nommée sur la carte. Les règles de jeu (étape 4) décideront quoi faire de chaque type. */
export type ZoneType = 'site' | 'spawn' | 'corridor' | 'open_area';

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  /** Polygone fermé délimitant la zone, en coordonnées carte. */
  polygon: Point[];
}

/**
 * Mur : segment ou polygone infranchissable.
 * Bloque à la fois le déplacement et le tir (ligne de vue totalement coupée).
 */
export interface Wall {
  id: string;
  /** 2 points = segment, 3+ points = polygone. */
  points: Point[];
}

/**
 * Taille d'une caisse, qui détermine son comportement vis-à-vis du déplacement et du tir :
 * - small  : bloque le déplacement mais PAS le tir (on peut tirer par-dessus/à travers).
 * - medium : bloque le déplacement et le tir direct, mais reste contournable (pas un mur).
 * - large  : bloque le déplacement ET le tir, quasiment comme un mur.
 * Ces règles ne sont pas encore appliquées par le moteur (pas de logique de collision/tir
 * à ce stade) : elles ne font que documenter le contrat de données pour les étapes suivantes.
 */
export type BoxSize = 'small' | 'medium' | 'large';

export interface Box {
  id: string;
  position: Point;
  width: number;
  height: number;
  size: BoxSize;
}

/**
 * Placeholder pour la grille de navigation utilisée par le pathfinding de l'IA.
 * Sera généré et rempli à l'étape mapping/IA — `null` tant qu'elle n'existe pas.
 */
export interface NavGrid {
  cellSize: number;
  cols: number;
  rows: number;
  /** 0 = libre, 1 = bloqué. Vide/placeholder pour l'instant. */
  cells: number[][];
}

export interface MapData {
  id: string;
  name: string;
  /** URL de l'image de fond de la carte, format webp. */
  imageUrl: string;
  width: number;
  height: number;
  zones: Zone[];
  walls: Wall[];
  boxes: Box[];
  navGrid: NavGrid | null;
}
