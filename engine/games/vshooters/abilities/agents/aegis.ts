import { hasLineOfSight } from '../../../../ai';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Aegis — archétype "sentinelle support" : mur solide (bloque déplacement ET vision — deux effets
 * simultanés, pas un type composite), zone de ralentissement, soin ciblé,
 * ultime de résurrection.
 */

const BARRIER_ORB: AbilityDefinition = {
  id: 'aegis_barrier_orb',
  name: 'Barrier Orb',
  agentId: 'aegis',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'point',
  // Un mur = deux effets (blocksVision + blocksMovement) créés ensemble — aucun besoin
  // d'un type d'effet composite, l'array `effects` suffit.
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    const durationTicks = secondsToTicks(90, tickRate); // dure essentiellement tout le round (pas de mur destructible modélisé)
    const base = { sourceEntityId: entity.id, position: target.point, radius: 15, createdAtTick: tick, expiresAtTick: tick + durationTicks };
    return {
      effects: [
        { id: '', abilityId: 'aegis_barrier_orb', type: 'blocksMovement' as const, ...base },
        { id: '', abilityId: 'aegis_barrier_orb', type: 'blocksVision' as const, ...base },
      ],
    };
  },
};

const SLOW_ORB: AbilityDefinition = {
  id: 'aegis_slow_orb',
  name: 'Slow Orb',
  agentId: 'aegis',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'aegis_slow_orb',
          sourceEntityId: entity.id,
          type: 'slow',
          position: target.point,
          radius: 10,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(7, tickRate),
          slowFactor: 0.5,
        },
      ],
    };
  },
};

const HEALING_ORB: AbilityDefinition = {
  id: 'aegis_healing_orb',
  name: 'Healing Orb',
  agentId: 'aegis',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'entity',
  execute: ({ entity, target, allEntities, tick, tickRate }) => {
    if (target.type !== 'entity') return {};
    const healed = allEntities.find((e) => e.id === target.entityId);
    if (!healed) return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'aegis_healing_orb',
          sourceEntityId: entity.id,
          type: 'heal',
          position: healed.position,
          radius: 0,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(5, tickRate),
          amountPerTick: 16 / tickRate,
          affectedEntityIds: [target.entityId],
        },
      ],
    };
  },
};

const RESURRECTION: AbilityDefinition = {
  id: 'aegis_resurrection',
  name: 'Resurrection',
  agentId: 'aegis',
  slot: 'X',
  cost: 8,
  cooldownOrCharges: 8,
  targetingType: 'entity',
  // Simplification documentée : la fenêtre de délai depuis la mort n'est PAS vérifiée ici
  // (execute() n'a accès qu'à l'état courant, pas à l'historique des SimulationEvent).
  // Réactivable facilement si l'historique est un jour exposé au contexte d'exécution.
  execute: ({ target, allEntities }) => {
    if (target.type !== 'entity') return {};
    const targetEntity = allEntities.find((e) => e.id === target.entityId);
    if (!targetEntity || targetEntity.status !== 'dead') return {};
    return { targetChanges: { entityId: target.entityId, changes: { status: 'alive', health: 50 } } };
  },
};

const ABILITIES = [BARRIER_ORB, SLOW_ORB, HEALING_ORB, RESURRECTION];

/** IA simple : ressuscite un allié mort si l'ultime est prête ; sinon soigne l'allié le plus bas en vie ; sinon pose un mur si un ennemi est visible à distance. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData } = context;

  const xInstance = entity.abilityLoadout?.abilities.X;
  const deadAlly = allEntities.find((e) => e.team === entity.team && e.status === 'dead');
  if (deadAlly && xInstance && Math.floor(xInstance.ultimatePoints) >= RESURRECTION.cost) {
    return [{ definition: RESURRECTION, target: { type: 'entity', entityId: deadAlly.id } }];
  }

  const eInstance = entity.abilityLoadout?.abilities.E;
  const hurtAlly = allEntities.find((e) => e.team === entity.team && e.id !== entity.id && e.status === 'alive' && e.health < 50);
  if (hurtAlly && eInstance && eInstance.charges > 0) {
    return [{ definition: HEALING_ORB, target: { type: 'entity', entityId: hurtAlly.id } }];
  }

  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );
  const cInstance = entity.abilityLoadout?.abilities.C;
  if (visibleEnemy && cInstance && cInstance.charges > 0) {
    const midpoint = { x: (entity.position.x + visibleEnemy.position.x) / 2, y: (entity.position.y + visibleEnemy.position.y) / 2 };
    return [{ definition: BARRIER_ORB, target: { type: 'point', point: midpoint } }];
  }

  return [];
}

export const AEGIS: AgentDefinition = {
  agentId: 'aegis',
  name: 'Aegis',
  abilities: ABILITIES,
  decide,
};
