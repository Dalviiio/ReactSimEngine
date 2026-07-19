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

  // Champs optionnels utilisés par l'économie/gunplay (games/valorant/) — absents/ignorés
  // pour tout jeu qui n'a pas ce concept. Le catalogue des armes/armures vit dans
  // games/valorant/weapons.ts ; ici on ne stocke que des identifiants génériques (string).
  /** Argent possédé. */
  money?: number;
  /** Points d'armure (0 = aucune) ; réduit les dégâts corps/jambes reçus. */
  armor?: number;
  /** Identifiants des armes possédées. */
  weapons?: string[];
  /** Identifiant de l'arme actuellement équipée, ou null (à mains nues / corps à corps). */
  equippedWeaponId?: string | null;
  /** Munitions restantes dans le chargeur de l'arme équipée. */
  currentAmmo?: number;
}
