import { EventBus, TickContext } from '../core';
import { EntityState, MapData, NavGrid, Point } from '../types';
import { distance, moveToward } from './geometry';
import { hasLineOfSight } from './lineOfSight';
import { findPath } from './pathfinding';

export type BotState = 'idle' | 'movingTo' | 'engaging';

/** Distance parcourue par tick (unités carte). Provisoire tant qu'il n'y a pas de règles de jeu (étape 4). */
const DEFAULT_BOT_SPEED = 6;

interface BotMemory {
  state: BotState;
  destination: Point | null;
  path: Point[] | null;
  pathIndex: number;
  engagingTargetId: string | null;
}

// Mémoire par bot (chemin, destination, état) : ne fait pas partie d'EntityState
// (qui reste générique/agnostique de l'IA), tenue ici côté module IA.
const memories = new Map<string, BotMemory>();

function getMemory(entityId: string): BotMemory {
  let memory = memories.get(entityId);
  if (!memory) {
    memory = { state: 'idle', destination: null, path: null, pathIndex: 0, engagingTargetId: null };
    memories.set(entityId, memory);
  }
  return memory;
}

/** Assigne/change la destination d'un bot ; force le recalcul du chemin A* au prochain tick. */
export function setBotDestination(entityId: string, destination: Point): void {
  const memory = getMemory(entityId);
  memory.destination = destination;
  memory.path = null;
  memory.pathIndex = 0;
}

/** Vide la mémoire de tous les bots (utile entre deux runs de simulation/tests). */
export function resetBotMemories(): void {
  memories.clear();
}

/**
 * Décide de l'action d'un bot pour ce tick (state machine idle / movingTo / engaging)
 * et retourne les changements à appliquer à son EntityState via l'EntityManager.
 * Émet sur `eventBus` : "bot:state-changed", "bot:path-computed", "bot:enemy-spotted",
 * "bot:engaging" — pour rendre les décisions observables/debuggables sans coupler
 * ce module à qui écoute ces événements.
 */
export function updateBot(
  entity: EntityState,
  mapData: MapData,
  allEntities: EntityState[],
  navGrid: NavGrid,
  eventBus: EventBus,
): Partial<EntityState> {
  const memory = getMemory(entity.id);
  const previousState = memory.state;

  const visibleEnemy = allEntities.find(
    (other) =>
      other.id !== entity.id &&
      other.team !== entity.team &&
      other.status === 'alive' &&
      hasLineOfSight(mapData, entity.position, other.position),
  );

  let changes: Partial<EntityState>;

  if (visibleEnemy) {
    if (previousState !== 'engaging' || memory.engagingTargetId !== visibleEnemy.id) {
      eventBus.emit('bot:enemy-spotted', { botId: entity.id, targetId: visibleEnemy.id });
    }
    memory.engagingTargetId = visibleEnemy.id;
    memory.state = 'engaging';
    changes = { currentAction: 'engaging' };
  } else {
    memory.engagingTargetId = null;

    if (memory.destination && distance(entity.position, memory.destination) <= navGrid.cellSize / 2) {
      // Destination atteinte : on nettoie la mémoire et repasse idle.
      memory.destination = null;
      memory.path = null;
      memory.pathIndex = 0;
      memory.state = 'idle';
      changes = { currentAction: 'idle' };
    } else if (memory.destination) {
      if (!memory.path) {
        const path = findPath(navGrid, entity.position, memory.destination);
        memory.path = path;
        memory.pathIndex = 0;
        eventBus.emit('bot:path-computed', { botId: entity.id, path, found: path !== null });
        if (!path) memory.destination = null; // pas de chemin possible : abandonne la destination
      }

      if (memory.path) {
        const target = memory.path[Math.min(memory.pathIndex, memory.path.length - 1)];
        const nextPosition = moveToward(entity.position, target, DEFAULT_BOT_SPEED);
        if (distance(nextPosition, target) < 0.5) {
          memory.pathIndex = Math.min(memory.pathIndex + 1, memory.path.length - 1);
        }
        memory.state = 'movingTo';
        changes = { position: nextPosition, currentAction: 'movingTo' };
      } else {
        memory.state = 'idle';
        changes = { currentAction: 'idle' };
      }
    } else {
      memory.state = 'idle';
      changes = { currentAction: 'idle' };
    }
  }

  if (memory.state !== previousState) {
    eventBus.emit('bot:state-changed', { botId: entity.id, from: previousState, to: memory.state });
    if (memory.state === 'engaging') {
      eventBus.emit('bot:engaging', { botId: entity.id, targetId: memory.engagingTargetId });
    }
  }

  return changes;
}

/**
 * Câble l'IA sur le point d'extension `onTick` existant de `runSimulation`
 * (voir engine/core/simulation.ts) : à chaque tick, appelle `updateBot` pour
 * chaque entité vivante et applique le résultat via l'EntityManager. Ne modifie
 * pas engine/core/ — reste branché de l'extérieur, comme le reste de l'IA.
 */
export function createBotOnTick(navGrid: NavGrid): (context: TickContext) => void {
  return ({ mapData, entityManager, eventBus }: TickContext) => {
    // Snapshot pris en début de tick : chaque bot décide à partir du même état,
    // indépendamment de l'ordre de mise à jour des autres bots ce tick-ci.
    const snapshot = entityManager.getAllEntities().map((entity) => ({ ...entity }));

    snapshot
      .filter((entity) => entity.status === 'alive')
      .forEach((entity) => {
        const changes = updateBot(entity, mapData, snapshot, navGrid, eventBus);
        entityManager.updateEntity(entity.id, changes);
      });
  };
}
