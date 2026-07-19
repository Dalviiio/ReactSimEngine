import { EntityState } from './entity';

/**
 * Événement générique de simulation. Le champ `type` est une simple string libre
 * (ex: "entity:added") pour ne coupler ce type à aucun jeu ni module précis.
 */
export interface SimulationEvent<T = unknown> {
  type: string;
  tick: number;
  data: T;
}

export interface SimulationTick {
  tick: number;
  /** Horodatage logique en ms depuis le début de la simulation (tick * durée d'un tick). */
  timestamp: number;
  events: SimulationEvent[];
  /** Snapshot immuable de l'état de toutes les entités à ce tick. */
  snapshot: EntityState[];
}
