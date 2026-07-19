import { hasLineOfSight } from '../../../../ai';
import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Scout — archétype "initiateur à l'information" : reveal
 * (drone, flèche de reco), dégâts de zone perçant les murs (pas de vraie
 * simulation de projectile : les flèches "traversent les murs" ressort
 * naturellement puisque les zones de dégâts sont vérifiées par distance, pas
 * par ligne de vue).
 */

function pointAtAngle(from: Point, angle: number, dist: number): Point {
  const rad = (angle * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * dist, y: from.y + Math.sin(rad) * dist };
}

const OWL_DRONE: AbilityDefinition = {
  id: 'scout_owl_drone',
  name: 'Owl Drone',
  agentId: 'scout',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'area',
  // Simplification : pas de vol/pilotage en temps réel, le survol est abstrait en un reveal instantané.
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'scout_owl_drone',
          sourceEntityId: entity.id,
          type: 'reveal',
          position: target.point,
          radius: 20,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(4, tickRate),
        },
      ],
    };
  },
};

const SHOCK_BOLT: AbilityDefinition = {
  id: 'scout_shock_bolt',
  name: 'Shock Bolt',
  agentId: 'scout',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'area',
  execute: ({ entity, target, tick }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'scout_shock_bolt',
          sourceEntityId: entity.id,
          type: 'damageOverTime',
          position: target.point,
          radius: 10,
          createdAtTick: tick,
          // "Explosion" quasi instantanée : appliquée une seule fois au tick suivant (voir updateActiveEffects).
          expiresAtTick: tick + 2,
          amountPerTick: 75,
        },
      ],
    };
  },
};

const RECON_BOLT: AbilityDefinition = {
  id: 'scout_recon_bolt',
  name: 'Recon Bolt',
  agentId: 'scout',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'area',
  // "Perce un mur" : non modélisé (pas de simulation de trajectoire de flèche), le point ciblé est libre.
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'scout_recon_bolt',
          sourceEntityId: entity.id,
          type: 'reveal',
          position: target.point,
          radius: 30,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(5, tickRate),
        },
      ],
    };
  },
};

const HUNTERS_FURY: AbilityDefinition = {
  id: 'scout_hunters_fury',
  name: "Hunter's Fury",
  agentId: 'scout',
  slot: 'X',
  cost: 8,
  cooldownOrCharges: 8,
  targetingType: 'direction',
  // Ligne de dégâts approximée par une chaîne de petites zones circulaires le long de la direction visée —
  // réutilise le modèle circulaire générique plutôt que d'introduire une forme "ligne" à part.
  execute: ({ entity, target, tick }) => {
    if (target.type !== 'direction') return {};
    const effects = [];
    for (let step = 1; step <= 6; step += 1) {
      effects.push({
        id: '',
        abilityId: 'scout_hunters_fury',
        sourceEntityId: entity.id,
        type: 'damageOverTime' as const,
        position: pointAtAngle(entity.position, target.angle, step * 30),
        radius: 12,
        createdAtTick: tick,
        expiresAtTick: tick + 2,
        amountPerTick: 150,
      });
    }
    return { effects };
  },
};

const ABILITIES = [OWL_DRONE, SHOCK_BOLT, RECON_BOLT, HUNTERS_FURY];

/** IA simple : ultime dans la direction d'un ennemi visible si prête ; sinon reco vers l'avant si aucun ennemi visible. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData, worldState, tick } = context;
  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (visibleEnemy && xInstance && Math.floor(xInstance.ultimatePoints) >= HUNTERS_FURY.cost) {
    const angle = (Math.atan2(visibleEnemy.position.y - entity.position.y, visibleEnemy.position.x - entity.position.x) * 180) / Math.PI;
    return [{ definition: HUNTERS_FURY, target: { type: 'direction', angle } }];
  }

  if (!visibleEnemy) {
    const alreadyScouted = worldState.effects.some(
      (e) => e.type === 'reveal' && e.sourceEntityId === entity.id && tick < e.expiresAtTick,
    );
    const eInstance = entity.abilityLoadout?.abilities.E;
    if (!alreadyScouted && eInstance && eInstance.charges > 0) {
      const scoutPoint = pointAtAngle(entity.position, entity.rotation, 40);
      return [{ definition: RECON_BOLT, target: { type: 'area', point: scoutPoint } }];
    }
  }

  return [];
}

export const SCOUT: AgentDefinition = {
  agentId: 'scout',
  name: 'Scout',
  abilities: ABILITIES,
  decide,
};
