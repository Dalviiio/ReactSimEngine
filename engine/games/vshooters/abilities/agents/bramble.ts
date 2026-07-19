import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Bramble — archétype "sentinelle à pièges multiples" : deux pièges au sol
 * déclenchés par le passage ennemi (ralentissement ou dégâts), une upgrade
 * qui augmente le nombre de pièges actifs simultanés, une zone-piège massive
 * en ultime.
 */

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const TRAP_ABILITY_IDS = ['bramble_snare_trap', 'bramble_spike_trap'];

/**
 * Trap Network — plafond de pièges actifs simultanés pour CET agent. Pas un
 * AbilityEffect (ce n'est pas une zone) : un drapeau persistant en
 * `instanceCustomState` sur le slot E, relu par les poses de pièges (C/Q) via
 * `entity.abilityLoadout.abilities.E.customState`.
 */
const TRAP_NETWORK: AbilityDefinition = {
  id: 'bramble_trap_network',
  name: 'Trap Network',
  agentId: 'bramble',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'self',
  execute: () => ({ instanceCustomState: { networkActive: true } }),
};

function maxTrapsFor(entity: Parameters<AbilityDefinition['execute']>[0]['entity']): number {
  const networkActive = !!(entity.abilityLoadout?.abilities.E?.customState as { networkActive?: boolean } | undefined)?.networkActive;
  return networkActive ? 3 : 1;
}

/**
 * Pose commune à Snare Trap et Spike Trap : si le plafond de pièges actifs
 * (1, ou 3 avec Trap Network — voir `activeEffects`, extension qui donne à
 * `execute()` une visibilité en lecture sur le monde courant) est atteint, le
 * PLUS ANCIEN est remplacé (`effectIdsToRemove`, extension permettant de
 * retirer un effet existant dans la même activation) plutôt que refusé —
 * choix explicite, voir le bilan.
 */
function placeTrap(abilityId: string, entity: Parameters<AbilityDefinition['execute']>[0]['entity'], point: Point, activeEffects: Parameters<AbilityDefinition['execute']>[0]['activeEffects'], tick: number, tickRate: number) {
  const maxTraps = maxTrapsFor(entity);
  const myTraps = activeEffects
    .filter((e) => e.sourceEntityId === entity.id && TRAP_ABILITY_IDS.includes(e.abilityId) && tick < e.expiresAtTick)
    .sort((a, b) => a.createdAtTick - b.createdAtTick);

  const effectIdsToRemove = myTraps.length >= maxTraps ? [myTraps[0].id] : undefined;

  return {
    effectIdsToRemove,
    effects: [
      {
        id: '',
        abilityId,
        sourceEntityId: entity.id,
        type: 'reveal' as const,
        position: point,
        radius: 12,
        createdAtTick: tick,
        expiresAtTick: tick + secondsToTicks(30, tickRate),
      },
    ],
  };
}

const SNARE_TRAP: AbilityDefinition = {
  id: 'bramble_snare_trap',
  name: 'Snare Trap',
  agentId: 'bramble',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'point',
  execute: ({ entity, target, activeEffects, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    return placeTrap('bramble_snare_trap', entity, target.point, activeEffects, tick, tickRate);
  },
};

const SPIKE_TRAP: AbilityDefinition = {
  id: 'bramble_spike_trap',
  name: 'Spike Trap',
  agentId: 'bramble',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'point',
  execute: ({ entity, target, activeEffects, tick, tickRate }) => {
    if (target.type !== 'point') return {};
    return placeTrap('bramble_spike_trap', entity, target.point, activeEffects, tick, tickRate);
  },
};

/** Déclenchement d'un Snare Trap : retire le marqueur, dépose un ralentissement local. */
const SNARE_TRIGGER: AbilityDefinition = {
  id: 'bramble_snare_trigger',
  name: 'Snare Trap (déclenchement)',
  agentId: 'bramble',
  slot: 'C',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'entity',
  execute: ({ entity, target, activeEffects, tick, tickRate }) => {
    if (target.type !== 'entity') return {};
    const marker = activeEffects.find((e) => e.id === target.entityId);
    if (!marker) return {};
    return {
      effectIdsToRemove: [marker.id],
      effects: [
        {
          id: '',
          abilityId: 'bramble_snare_trap_active',
          sourceEntityId: entity.id,
          type: 'slow',
          slowFactor: 0.4,
          position: marker.position,
          radius: marker.radius,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(4, tickRate),
        },
      ],
    };
  },
};

/** Déclenchement d'un Spike Trap : retire le marqueur, inflige des dégâts directs (quasi instantanés, 2 ticks). */
const SPIKE_TRIGGER: AbilityDefinition = {
  id: 'bramble_spike_trigger',
  name: 'Spike Trap (déclenchement)',
  agentId: 'bramble',
  slot: 'Q',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'entity',
  execute: ({ entity, target, activeEffects, tick }) => {
    if (target.type !== 'entity') return {};
    const marker = activeEffects.find((e) => e.id === target.entityId);
    if (!marker) return {};
    return {
      effectIdsToRemove: [marker.id],
      effects: [
        {
          id: '',
          abilityId: 'bramble_spike_trap_active',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: marker.position,
          radius: marker.radius,
          createdAtTick: tick,
          expiresAtTick: tick + 2,
          amountPerTick: 55,
        },
      ],
    };
  },
};

/** Kill Zone — transforme une zone large en champ de pièges : damageOverTime + reveal jusqu'à expiration. */
const KILL_ZONE: AbilityDefinition = {
  id: 'bramble_kill_zone',
  name: 'Kill Zone',
  agentId: 'bramble',
  slot: 'X',
  cost: 7,
  cooldownOrCharges: 7,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const base = { sourceEntityId: entity.id, position: target.point, radius: 25, createdAtTick: tick, expiresAtTick: tick + secondsToTicks(10, tickRate) };
    return {
      effects: [
        { id: '', abilityId: 'bramble_kill_zone', type: 'damageOverTime' as const, amountPerTick: 15 / tickRate, ...base },
        { id: '', abilityId: 'bramble_kill_zone', type: 'reveal' as const, ...base },
      ],
    };
  },
};

const ABILITIES = [SNARE_TRAP, SPIKE_TRAP, TRAP_NETWORK, KILL_ZONE];

/** IA simple : déclenche un piège armé si un ennemi (jamais un allié) marche dessus ; sinon pose pièges/upgrade/ultime. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, worldState, tick } = context;

  const myTraps = worldState.effects.filter((e) => e.sourceEntityId === entity.id && TRAP_ABILITY_IDS.includes(e.abilityId) && tick < e.expiresAtTick);
  for (const trap of myTraps) {
    const enemyOnTrap = allEntities.find(
      (other) => other.team !== entity.team && other.status === 'alive' && distance(other.position, trap.position) <= trap.radius,
    );
    if (enemyOnTrap) {
      const triggerDef = trap.abilityId === 'bramble_snare_trap' ? SNARE_TRIGGER : SPIKE_TRIGGER;
      return [{ definition: triggerDef, target: { type: 'entity', entityId: trap.id } }];
    }
  }

  const visibleEnemy = allEntities.find((other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive');

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (visibleEnemy && xInstance && Math.floor(xInstance.ultimatePoints) >= KILL_ZONE.cost) {
    return [{ definition: KILL_ZONE, target: { type: 'area', point: visibleEnemy.position } }];
  }

  const eInstance = entity.abilityLoadout?.abilities.E;
  const networkActive = !!(eInstance?.customState as { networkActive?: boolean } | undefined)?.networkActive;
  if (!networkActive && eInstance && eInstance.charges > 0) {
    return [{ definition: TRAP_NETWORK, target: { type: 'self' } }];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  if (cInstance && cInstance.charges > 0) {
    return [{ definition: SNARE_TRAP, target: { type: 'point', point: entity.position } }];
  }

  const qInstance = entity.abilityLoadout?.abilities.Q;
  if (qInstance && qInstance.charges > 0) {
    return [{ definition: SPIKE_TRAP, target: { type: 'point', point: entity.position } }];
  }

  return [];
}

export const BRAMBLE: AgentDefinition = {
  agentId: 'bramble',
  name: 'Bramble',
  abilities: ABILITIES,
  decide,
};
