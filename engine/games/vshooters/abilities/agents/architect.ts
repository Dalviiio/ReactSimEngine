import { hasLineOfSight } from '../../../../ai';
import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Architect — archétype "sentinelle à gadgets posés" : entités placées qui
 * agissent seules (tourelle, alarmbot), charge au sol à retardement, ultime à
 * zone après délai de préparation.
 */

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const ALARMBOT: AbilityDefinition = {
  id: 'architect_alarmbot',
  name: 'Alarmbot',
  agentId: 'architect',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'point',
  // Simplification : zone persistante slow+reveal pour toute sa durée, plutôt que le
  // vrai déclenchement ponctuel (bond + vulnérable qui décroît) du jeu réel.
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    const base = { sourceEntityId: entity.id, position: target.point, radius: 15, createdAtTick: tick, expiresAtTick: tick + secondsToTicks(60, tickRate) };
    return {
      effects: [
        { id: '', abilityId: 'architect_alarmbot', type: 'slow' as const, slowFactor: 0.5, ...base },
        { id: '', abilityId: 'architect_alarmbot', type: 'reveal' as const, ...base },
      ],
    };
  },
};

const TURRET: AbilityDefinition = {
  id: 'architect_turret',
  name: 'Turret',
  agentId: 'architect',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'point',
  // Pose un marqueur "reveal" au point ciblé, représentant la position/portée de la
  // tourelle. Le tir automatique lui-même est une capacité séparée à coût 0 (voir
  // TURRET_AUTOFIRE plus bas), déclenchée par decide() — pas par le joueur.
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'architect_turret',
          sourceEntityId: entity.id,
          type: 'reveal',
          position: target.point,
          radius: 40,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(60, tickRate),
        },
      ],
    };
  },
};

/**
 * Tir automatique de la tourelle déjà posée. Coût 0 : ne consomme PAS de
 * charge (réutilise le slot 'Q' déjà à 0 après la pose de TURRET, cf. le
 * correctif de `activateAbility` — `charges < cost` et non `< 1`). N'apparaît
 * PAS dans `ABILITIES`/`agent.abilities` : ne fait donc pas partie du
 * recharge-round normal, seulement utilisée en interne par `decide()`.
 */
const TURRET_AUTOFIRE: AbilityDefinition = {
  id: 'architect_turret_autofire',
  name: 'Turret (tir automatique)',
  agentId: 'architect',
  slot: 'Q',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'entity',
  execute: ({ entity, target, allEntities, tick }) => {
    if (target.type !== 'entity') return {};
    const enemy = allEntities.find((e) => e.id === target.entityId);
    if (!enemy) return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'architect_turret_autofire',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: enemy.position,
          radius: 5,
          createdAtTick: tick,
          expiresAtTick: tick + 2, // application quasi instantanée (voir updateActiveEffects)
          amountPerTick: 18,
        },
      ],
    };
  },
};

const NANOSWARM: AbilityDefinition = {
  id: 'architect_nanoswarm',
  name: 'Nanoswarm',
  agentId: 'architect',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'point',
  // Simplification : s'arme automatiquement après le délai (pas de second déclenchement manuel requis).
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    const armDelay = secondsToTicks(3, tickRate);
    return {
      effects: [
        {
          id: '',
          abilityId: 'architect_nanoswarm',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: target.point,
          radius: 8,
          createdAtTick: tick,
          activeFromTick: tick + armDelay,
          expiresAtTick: tick + armDelay + secondsToTicks(5, tickRate),
          amountPerTick: 25 / tickRate,
        },
      ],
    };
  },
};

const LOCKDOWN: AbilityDefinition = {
  id: 'architect_lockdown',
  name: 'Lockdown',
  agentId: 'architect',
  slot: 'X',
  cost: 8,
  cooldownOrCharges: 8,
  targetingType: 'point',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    const prepDelay = secondsToTicks(8, tickRate);
    const base = {
      sourceEntityId: entity.id,
      position: target.point,
      radius: 50,
      createdAtTick: tick,
      activeFromTick: tick + prepDelay,
      expiresAtTick: tick + prepDelay + secondsToTicks(8, tickRate),
    };
    return {
      effects: [
        { id: '', abilityId: 'architect_lockdown', type: 'blocksMovement' as const, ...base },
        { id: '', abilityId: 'architect_lockdown', type: 'reveal' as const, ...base },
      ],
    };
  },
};

const ABILITIES = [ALARMBOT, TURRET, NANOSWARM, LOCKDOWN];

// Mémoire locale (comme botController.ts) : dernier tick de tir par tourelle, pour éviter
// un tir à chaque tick. Ne fait pas partie d'EntityState — bookkeeping interne à l'agent.
const turretLastFireTick = new Map<string, number>();

/** IA simple : la tourelle posée tire seule sur un ennemi dans sa portée+ligne de vue (~1 tir/s) ; sinon pose tourelle/alarmbot si pas déjà fait. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData, worldState, tick, tickRate } = context;

  const turretMarker = worldState.effects.find((e) => e.abilityId === 'architect_turret' && e.sourceEntityId === entity.id && tick < e.expiresAtTick);
  if (turretMarker) {
    const lastFire = turretLastFireTick.get(entity.id) ?? -Infinity;
    if (tick - lastFire >= tickRate) {
      const enemyInRange = allEntities.find(
        (other) =>
          other.team !== entity.team &&
          other.status === 'alive' &&
          distance(other.position, turretMarker.position) <= turretMarker.radius &&
          hasLineOfSight(mapData, turretMarker.position, other.position),
      );
      if (enemyInRange) {
        turretLastFireTick.set(entity.id, tick);
        return [{ definition: TURRET_AUTOFIRE, target: { type: 'entity', entityId: enemyInRange.id } }];
      }
    }
    return [];
  }

  const qInstance = entity.abilityLoadout?.abilities.Q;
  if (qInstance && qInstance.charges > 0) {
    return [{ definition: TURRET, target: { type: 'point', point: entity.position } }];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  const alreadyAlarmed = worldState.effects.some((e) => e.abilityId === 'architect_alarmbot' && e.sourceEntityId === entity.id && tick < e.expiresAtTick);
  if (!alreadyAlarmed && cInstance && cInstance.charges > 0) {
    return [{ definition: ALARMBOT, target: { type: 'point', point: entity.position } }];
  }

  return [];
}

export const ARCHITECT: AgentDefinition = {
  agentId: 'architect',
  name: 'Architect',
  abilities: ABILITIES,
  decide,
};
