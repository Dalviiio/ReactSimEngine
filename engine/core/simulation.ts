import { EntityState, MapData, SimulationEvent, SimulationTick } from '../types';
import { EntityManager } from './entityManager';
import { EventBus } from './eventBus';
import { TickLoop } from './tickLoop';

export interface TickContext {
  tick: number;
  timestamp: number;
  mapData: MapData;
  entityManager: EntityManager;
  eventBus: EventBus;
}

export interface SimulationConfig {
  /** Ticks par seconde, défaut 30. */
  tickRate?: number;
  /** Nombre total de ticks à simuler. */
  totalTicks: number;
  /**
   * Point d'extension appelé à chaque tick. C'est ici que les futurs modules
   * (IA, règles de jeu) viendront brancher leur logique — le moteur lui-même
   * n'en contient aucune à ce stade.
   */
  onTick?: (context: TickContext) => void;
}

/**
 * Fait tourner une boucle de ticks basique sur une carte et des entités initiales,
 * et retourne l'historique complet des snapshots. Ne contient aucune règle de jeu :
 * sert uniquement à prouver que la boucle de tick, le gestionnaire d'entités et le
 * bus d'événements s'articulent correctement.
 */
export function runSimulation(
  mapData: MapData,
  initialEntities: EntityState[],
  config: SimulationConfig,
): SimulationTick[] {
  const tickRate = config.tickRate ?? 30;
  const eventBus = new EventBus();
  const entityManager = new EntityManager(eventBus);
  const tickLoop = new TickLoop({ tickRate });

  const ticks: SimulationTick[] = [];
  let currentTick = 0;
  let pendingEvents: SimulationEvent[] = [];

  // Capture TOUT événement émis sur le bus (entity:*, mais aussi ceux de n'importe
  // quel futur module branché via onTick, ex: bot:* côté IA) dans le journal du tick
  // courant — sans que ce module ait besoin de connaître leurs types à l'avance.
  eventBus.onAny((type, data) => {
    pendingEvents.push({ type, tick: currentTick, data });
  });

  initialEntities.forEach((entity) => entityManager.addEntity(entity));

  tickLoop.runFixedTicks(config.totalTicks, (tick, timestamp) => {
    currentTick = tick;

    config.onTick?.({ tick, timestamp, mapData, entityManager, eventBus });

    const events = pendingEvents;
    pendingEvents = [];

    ticks.push({
      tick,
      timestamp,
      events,
      snapshot: entityManager.getAllEntities().map((entity) => ({ ...entity })),
    });
  });

  return ticks;
}
