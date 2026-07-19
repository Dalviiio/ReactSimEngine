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

  // Champs optionnels utilisés par l'économie/gunplay (games/vshooters/) — absents/ignorés
  // pour tout jeu qui n'a pas ce concept. Le catalogue des armes/armures vit dans
  // games/vshooters/weapons.ts ; ici on ne stocke que des identifiants génériques (string).
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

  /** Capacités d'agent (games/vshooters/abilities/) — absent pour toute entité sans agent assigné. */
  abilityLoadout?: AbilityLoadoutState;
}

/** Emplacement générique d'une capacité (C/Q/E = capacités, X = ultime). */
export type AbilitySlot = 'C' | 'Q' | 'E' | 'X';

/**
 * État minimal et générique d'une capacité pour une entité. Le catalogue réel
 * (dégâts, ciblage, effets produits) vit dans games/vshooters/abilities/, pas ici —
 * ce type ne stocke que ce qui doit persister sur l'entité elle-même.
 */
export interface AbilityInstanceState {
  /** Charges actuellement disponibles (C/Q/E). Sans effet pour X (voir ultimatePoints). */
  charges: number;
  /** Points d'ultimate accumulés. Toujours 0 pour C/Q/E ; ne se réinitialise PAS entre rounds pour X. */
  ultimatePoints: number;
  /**
   * État libre propre à CETTE capacité, persistant sur l'entité d'un tick à
   * l'autre, pour tout ce qui ne se modélise pas comme un `AbilityEffect`
   * (zone/liste d'entités affectées) : un marqueur de téléportation (Warp),
   * un drapeau d'upgrade actif (réseau de pièges de Bramble), une baseline de
   * vie au moment de l'activation (Vesper), etc. Générique et non typé ici à
   * dessein — chaque agent définit et caste la forme qu'il y stocke.
   */
  customState?: Record<string, unknown>;
}

export interface AbilityLoadoutState {
  agentId: string;
  abilities: Partial<Record<AbilitySlot, AbilityInstanceState>>;
}
