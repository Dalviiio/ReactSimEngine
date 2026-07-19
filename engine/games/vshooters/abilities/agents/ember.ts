import { hasLineOfSight } from '../../../../ai';
import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, AbilityEffect, secondsToTicks } from '../types';

/**
 * Ember — archétype "duelliste pur dégâts agressif" : charge en ligne qui
 * blesse au passage, trainée de dégâts continus, marque qui amplifie les
 * dégâts sur une cible affaiblie, explosion différée à dégâts dégressifs.
 */

const FLARE_DASH_DISTANCE = 180;

/**
 * Flare Dash — charge en ligne droite, dégâts à tout ce qui est traversé.
 * Réutilise le pattern "chaîne de petits cercles le long du trajet" déjà
 * établi pour Hunter's Fury (Scout) : chaque cercle est un damageOverTime
 * classique à durée quasi instantanée (2 ticks), pas de nouveau concept.
 * Comme le dash de Gale, vérifie sa propre trajectoire via `hasLineOfSight`
 * (fizzle sans déplacement ni dégâts si un mur direct bloque).
 */
const FLARE_DASH: AbilityDefinition = {
  id: 'ember_flare_dash',
  name: 'Flare Dash',
  agentId: 'ember',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'point',
  execute: ({ entity, target, mapData, tick }) => {
    if (target.type !== 'point') return {};
    const dx = target.point.x - entity.position.x;
    const dy = target.point.y - entity.position.y;
    const rawDist = Math.hypot(dx, dy);
    if (rawDist === 0) return {};
    const dist = Math.min(FLARE_DASH_DISTANCE, rawDist);
    const destination: Point = {
      x: entity.position.x + (dx / rawDist) * dist,
      y: entity.position.y + (dy / rawDist) * dist,
    };
    if (!hasLineOfSight(mapData, entity.position, destination)) return {};

    const DASH_CIRCLE_RADIUS = 10;
    const steps = Math.max(1, Math.round(dist / 20));
    const effects: AbilityEffect[] = [];
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      effects.push({
        id: '',
        abilityId: 'ember_flare_dash',
        sourceEntityId: entity.id,
        type: 'damageOverTime',
        position: { x: entity.position.x + (destination.x - entity.position.x) * t, y: entity.position.y + (destination.y - entity.position.y) * t },
        radius: DASH_CIRCLE_RADIUS,
        createdAtTick: tick,
        expiresAtTick: tick + 2,
        amountPerTick: 40,
      });
    }
    // Exclut tout cercle qui engloberait la position d'ARRIVÉE du lanceur : sans ce filtre, le
    // dernier cercle du sentier tombe exactement sur `destination` (où le lanceur atterrit via
    // `selfChanges.position` juste en dessous) et s'auto-inflige des dégâts au tick suivant —
    // confirmé en diagnostic replay (voir le bilan "rééquilibrage IA"). damageOverTime reste par
    // ailleurs indiscriminé (touche aussi les alliés traversés, comportement existant assumé).
    const safeEffects = effects.filter((e) => Math.hypot(e.position.x - destination.x, e.position.y - destination.y) >= DASH_CIRCLE_RADIUS);
    return { effects: safeEffects, selfChanges: { position: destination } };
  },
};

const SCORCH_TRAIL_DURATION_SECONDS = 5;

/**
 * Scorch Trail — active un mode "trainée" pour une courte durée (stocké en
 * `instanceCustomState`, pas un AbilityEffect : ce n'est pas une zone mais un
 * état de l'entité). Chaque tick où le mode est actif, `decide()` déclenche
 * SCORCH_DROP (coût 0, interne) qui dépose une petite zone damageOverTime à
 * la position courante — la succession de dépôts forme la trainée.
 */
const SCORCH_TRAIL: AbilityDefinition = {
  id: 'ember_scorch_trail',
  name: 'Scorch Trail',
  agentId: 'ember',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'self',
  execute: ({ tick, tickRate }) => ({
    instanceCustomState: { activeUntilTick: tick + secondsToTicks(SCORCH_TRAIL_DURATION_SECONDS, tickRate) },
  }),
};

const SCORCH_DROP: AbilityDefinition = {
  id: 'ember_scorch_drop',
  name: 'Scorch Trail (dépôt)',
  agentId: 'ember',
  slot: 'Q',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'self',
  execute: ({ entity, tick, tickRate }) => ({
    effects: [
      {
        id: '',
        abilityId: 'ember_scorch_trail_active',
        sourceEntityId: entity.id,
        type: 'damageOverTime',
        position: { ...entity.position },
        radius: 8,
        createdAtTick: tick,
        expiresAtTick: tick + secondsToTicks(3, tickRate),
        amountPerTick: 6 / tickRate,
      },
    ],
  }),
};

/**
 * Finisher Mark — marque un ennemi sous 30% de vie (santé sur 100 : <30) d'un
 * statModifier ciblé (`damageTaken`, ×1.5, `affectedEntityIds: [victime]`)
 * pendant une courte durée. Mécanisme construit et interrogeable via
 * `getStatModifier` exactement comme l'Overdrive Beacon du Vanguard, mais PAS
 * câblé dans `calculateDamage`/`resolveShot` cette fois (voir le bilan —
 * même situation que `fireRate` avant son câblage dans `createMatchOnTick`).
 */
const FINISHER_MARK: AbilityDefinition = {
  id: 'ember_finisher_mark',
  name: 'Finisher Mark',
  agentId: 'ember',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'entity',
  execute: ({ entity, target, allEntities, tick, tickRate }) => {
    if (target.type !== 'entity') return {};
    const victim = allEntities.find((e) => e.id === target.entityId);
    if (!victim || victim.health >= 30) return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'ember_finisher_mark',
          sourceEntityId: entity.id,
          type: 'statModifier',
          statType: 'damageTaken',
          multiplier: 1.5,
          position: { ...victim.position },
          radius: 0,
          affectedEntityIds: [victim.id],
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(6, tickRate),
        },
      ],
    };
  },
};

const WILDFIRE_PREP_SECONDS = 2.5;
/** Rayons décroissants du centre vers l'extérieur, dégâts croissants — voir la doc de WILDFIRE ci-dessous. */
const WILDFIRE_RINGS = [
  { radius: 45, amountPerTick: 8 },
  { radius: 30, amountPerTick: 10 },
  { radius: 15, amountPerTick: 12 },
];

/**
 * Wildfire — explosion en zone après un court délai de préparation, dégâts
 * dégressifs selon la distance au centre. Aucun nouveau champ de "falloff
 * radial" sur AbilityEffect : réutilise plusieurs damageOverTime concentriques
 * de rayon décroissant/dégâts croissants au même centre. Être proche du
 * centre veut dire être DANS PLUS de cercles à la fois, donc cumuler plus de
 * dégâts par tick — un pur effet de composition d'effets existants.
 */
const WILDFIRE: AbilityDefinition = {
  id: 'ember_wildfire',
  name: 'Wildfire',
  agentId: 'ember',
  slot: 'X',
  cost: 7,
  cooldownOrCharges: 7,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const prepTicks = secondsToTicks(WILDFIRE_PREP_SECONDS, tickRate);
    const durationTicks = secondsToTicks(4, tickRate);
    return {
      effects: WILDFIRE_RINGS.map((ring) => ({
        id: '',
        abilityId: 'ember_wildfire',
        sourceEntityId: entity.id,
        type: 'damageOverTime' as const,
        position: target.point,
        radius: ring.radius,
        amountPerTick: ring.amountPerTick / tickRate,
        createdAtTick: tick,
        activeFromTick: tick + prepTicks,
        expiresAtTick: tick + prepTicks + durationTicks,
      })),
    };
  },
};

const ABILITIES = [FLARE_DASH, SCORCH_TRAIL, FINISHER_MARK, WILDFIRE];

/** IA simple : entretient la trainée si active ; sinon ultime > marque > dash sur un ennemi visible. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData, tick } = context;

  const trailState = entity.abilityLoadout?.abilities.Q?.customState as { activeUntilTick?: number } | undefined;
  if (trailState?.activeUntilTick !== undefined && tick < trailState.activeUntilTick) {
    return [{ definition: SCORCH_DROP, target: { type: 'self' } }];
  }

  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );
  if (!visibleEnemy) return [];

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (xInstance && Math.floor(xInstance.ultimatePoints) >= WILDFIRE.cost) {
    return [{ definition: WILDFIRE, target: { type: 'area', point: visibleEnemy.position } }];
  }

  const eInstance = entity.abilityLoadout?.abilities.E;
  if (visibleEnemy.health < 30 && eInstance && eInstance.charges > 0) {
    return [{ definition: FINISHER_MARK, target: { type: 'entity', entityId: visibleEnemy.id } }];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  if (cInstance && cInstance.charges > 0) {
    return [{ definition: FLARE_DASH, target: { type: 'point', point: visibleEnemy.position } }];
  }

  return [];
}

export const EMBER: AgentDefinition = {
  agentId: 'ember',
  name: 'Ember',
  abilities: ABILITIES,
  decide,
};
