import { hasLineOfSight } from '../../../../ai';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Vanguard — archétype "contrôleur à zones ciblables sur la carte" : fumées
 * à distance, zone de dégâts, ultime en zone après délai.
 */

const INCENDIARY: AbilityDefinition = {
  id: 'vanguard_incendiary',
  name: 'Incendiary',
  agentId: 'vanguard',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const durationTicks = secondsToTicks(7, tickRate);
    return {
      effects: [
        {
          id: '',
          abilityId: 'vanguard_incendiary',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: target.point,
          radius: 15,
          createdAtTick: tick,
          expiresAtTick: tick + durationTicks,
          amountPerTick: 14 / tickRate,
        },
      ],
    };
  },
};

/**
 * Overdrive Beacon — buff de cadence de tir en zone. Utilise le 9e type
 * d'effet "statModifier" (voir types.ts / integration.ts#getStatModifier) :
 * toute entité dans le rayon voit sa cadence de tir multipliée tant que
 * l'effet est actif, sans qu'aucun code de combat n'ait besoin de connaître
 * cette capacité précise.
 */
const OVERDRIVE_BEACON: AbilityDefinition = {
  id: 'vanguard_overdrive_beacon',
  name: 'Overdrive Beacon',
  agentId: 'vanguard',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'vanguard_overdrive_beacon',
          sourceEntityId: entity.id,
          type: 'statModifier',
          statType: 'fireRate',
          multiplier: 1.3,
          position: target.point,
          radius: 15,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(8, tickRate),
        },
      ],
    };
  },
};

const SKY_SMOKE: AbilityDefinition = {
  id: 'vanguard_sky_smoke',
  name: 'Sky Smoke',
  agentId: 'vanguard',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 3,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'vanguard_sky_smoke',
          sourceEntityId: entity.id,
          type: 'blocksVision',
          position: target.point,
          radius: 8,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(15, tickRate),
        },
      ],
    };
  },
};

const ORBITAL_STRIKE: AbilityDefinition = {
  id: 'vanguard_orbital_strike',
  name: 'Orbital Strike',
  agentId: 'vanguard',
  slot: 'X',
  cost: 7,
  cooldownOrCharges: 7,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const prepDelayTicks = secondsToTicks(3.75, tickRate);
    const damageDurationTicks = secondsToTicks(5.75, tickRate);
    return {
      effects: [
        {
          id: '',
          abilityId: 'vanguard_orbital_strike',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: target.point,
          radius: 30,
          createdAtTick: tick,
          activeFromTick: tick + prepDelayTicks,
          expiresAtTick: tick + prepDelayTicks + damageDurationTicks,
          amountPerTick: 40 / tickRate,
        },
      ],
    };
  },
};

const ABILITIES = [INCENDIARY, OVERDRIVE_BEACON, SKY_SMOKE, ORBITAL_STRIKE];

/** IA simple : ultime sur un ennemi visible si prête, sinon fumée sur un ennemi visible s'il n'y en a pas déjà une. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData, worldState, tick } = context;
  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );
  if (!visibleEnemy) return [];

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (xInstance && Math.floor(xInstance.ultimatePoints) >= ORBITAL_STRIKE.cost) {
    return [{ definition: ORBITAL_STRIKE, target: { type: 'area', point: visibleEnemy.position } }];
  }

  const alreadySmoked = worldState.effects.some(
    (e) => e.type === 'blocksVision' && e.sourceEntityId === entity.id && tick < e.expiresAtTick,
  );
  const eInstance = entity.abilityLoadout?.abilities.E;
  if (!alreadySmoked && eInstance && eInstance.charges > 0) {
    return [{ definition: SKY_SMOKE, target: { type: 'area', point: visibleEnemy.position } }];
  }

  return [];
}

export const VANGUARD: AgentDefinition = {
  agentId: 'vanguard',
  name: 'Vanguard',
  abilities: ABILITIES,
  decide,
};
