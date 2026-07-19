import { Point } from './common';

/** Identifiant d'équipe générique — le vocabulaire réel (attaquants/défenseurs, etc.) vient avec les règles de jeu. */
export type EntityTeam = string;

export type EntityStatus = 'alive' | 'dead';

export interface EntityState {
  id: string;
  team: EntityTeam;
  position: Point;
  /** Orientation en degrés. */
  rotation: number;
  health: number;
  status: EntityStatus;
  /** Étiquette d'action générique (ex: "moving", "shooting"...) — le vocabulaire précis vient avec les règles de jeu. */
  currentAction: string | null;
}
