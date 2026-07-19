import { hasLineOfSight } from '../../../../ai';
import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Gale — archétype "duelliste mobile" : petite fumée
 * mobile (simplifiée en fumée fixe), déplacements instantanés (dash/téléport,
 * pas de vraie 3D), ultime qui change temporairement l'équipement.
 */

function pointAtAngle(from: Point, angle: number, dist: number): Point {
  const rad = (angle * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * dist, y: from.y + Math.sin(rad) * dist };
}

const CLOUDBURST: AbilityDefinition = {
  id: 'gale_cloudburst',
  name: 'Cloudburst',
  agentId: 'gale',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'area',
  // Simplification : fumée fixe au point ciblé (pas de redirection en plein vol modélisée).
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'gale_cloudburst',
          sourceEntityId: entity.id,
          type: 'blocksVision',
          position: target.point,
          radius: 6,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(4, tickRate),
        },
      ],
    };
  },
};

const UPDRAFT: AbilityDefinition = {
  id: 'gale_updraft',
  name: 'Updraft',
  agentId: 'gale',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'point',
  // Mobilité verticale traitée comme un déplacement instantané (pas de vraie 3D, cf. consigne).
  execute: ({ target }) => {
    if (target.type !== 'point') return {};
    return { selfChanges: { position: target.point } };
  },
};

const TAILWIND_DASH_DISTANCE = 250;

const TAILWIND: AbilityDefinition = {
  id: 'gale_tailwind',
  name: 'Tailwind',
  agentId: 'gale',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'direction',
  execute: ({ entity, target, mapData }) => {
    if (target.type !== 'direction') return {};
    const destination = pointAtAngle(entity.position, target.angle, TAILWIND_DASH_DISTANCE);
    // Pas de raycast fin : si un mur coupe la trajectoire directe, le dash "fizzle" (aucun déplacement)
    // plutôt que de risquer de traverser un mur.
    if (!hasLineOfSight(mapData, entity.position, destination)) return {};
    return { selfChanges: { position: destination } };
  },
};

const BLADE_STORM: AbilityDefinition = {
  id: 'gale_blade_storm',
  name: 'Blade Storm',
  agentId: 'gale',
  slot: 'X',
  cost: 6,
  cooldownOrCharges: 6,
  targetingType: 'self',
  // Simplification : pas de pool de munitions séparé pour les couteaux — réutilise l'arme
  // de corps à corps existante (weapons.ts) comme équivalent mécanique le plus proche
  // (dégâts élevés à courte portée), plutôt que d'inventer un nouveau système d'arme temporaire.
  execute: () => ({ selfChanges: { equippedWeaponId: 'blade', currentAmmo: 5 } }),
};

const ABILITIES = [CLOUDBURST, UPDRAFT, TAILWIND, BLADE_STORM];

/** IA simple : ultime si prête et ennemi visible ; dash de fuite si vie basse et ennemi visible. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData } = context;
  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );
  if (!visibleEnemy) return [];

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (xInstance && Math.floor(xInstance.ultimatePoints) >= BLADE_STORM.cost && entity.equippedWeaponId !== 'blade') {
    return [{ definition: BLADE_STORM, target: { type: 'self' } }];
  }

  const eInstance = entity.abilityLoadout?.abilities.E;
  if (entity.health < 30 && eInstance && eInstance.charges > 0) {
    const angleAway = (Math.atan2(entity.position.y - visibleEnemy.position.y, entity.position.x - visibleEnemy.position.x) * 180) / Math.PI;
    return [{ definition: TAILWIND, target: { type: 'direction', angle: angleAway } }];
  }

  return [];
}

export const GALE: AgentDefinition = {
  agentId: 'gale',
  name: 'Gale',
  abilities: ABILITIES,
  decide,
};
