import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Warp — archétype "contrôleur de téléportation" : marqueur de rappel,
 * champ qui déplace aléatoirement les intrus, échange de position ultime.
 */

const ANCHOR_DURATION_SECONDS = 20;

/**
 * Anchor Point — NE produit PAS d'AbilityEffect : ce n'est pas une zone ni
 * une liste d'entités affectées, mais un marqueur ponctuel propre à CETTE
 * entité. Stocké via `instanceCustomState` (extension ajoutée pour ce cas,
 * voir `AbilityInstanceState.customState` dans types/entity.ts et le bilan) —
 * sur le slot C lui-même, relu par Return (slot Q) via
 * `entity.abilityLoadout.abilities.C.customState`.
 */
const ANCHOR_POINT: AbilityDefinition = {
  id: 'warp_anchor_point',
  name: 'Anchor Point',
  agentId: 'warp',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'self',
  execute: ({ entity, tick, tickRate }) => ({
    instanceCustomState: { position: { ...entity.position }, expiresAtTick: tick + secondsToTicks(ANCHOR_DURATION_SECONDS, tickRate) },
  }),
};

/**
 * Return — téléporte vers l'Anchor Point s'il existe et n'a pas expiré ;
 * échoue proprement (execute() retourne {}, aucun changement) sinon. Comme
 * le dash de Gale contre un mur, la charge est tout de même consommée par
 * `activateAbility` même en cas d'échec — comportement cohérent avec
 * l'existant, pas une nouvelle règle.
 */
const RETURN: AbilityDefinition = {
  id: 'warp_return',
  name: 'Return',
  agentId: 'warp',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'self',
  execute: ({ entity, tick }) => {
    const anchor = entity.abilityLoadout?.abilities.C?.customState as { position: Point; expiresAtTick: number } | undefined;
    if (!anchor || tick >= anchor.expiresAtTick) return {};
    return { selfChanges: { position: { ...anchor.position } } };
  },
};

/**
 * Displacement Field — pose une zone marqueur (type "reconPing", générique,
 * pas de type dédié pour "zone de déplacement" — cf. README) ; `decide()`
 * détecte chaque tick un ennemi entré dans la zone et déclenche
 * DISPLACEMENT_TRIGGER (coût 0, interne) qui le téléporte vers un point
 * aléatoire proche. Aucun dégât.
 */
const DISPLACEMENT_FIELD: AbilityDefinition = {
  id: 'warp_displacement_field',
  name: 'Displacement Field',
  agentId: 'warp',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'warp_displacement_field',
          sourceEntityId: entity.id,
          type: 'reconPing',
          position: target.point,
          radius: 20,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(10, tickRate),
        },
      ],
    };
  },
};

const DISPLACEMENT_TRIGGER: AbilityDefinition = {
  id: 'warp_displacement_trigger',
  name: 'Displacement Field (déclenchement)',
  agentId: 'warp',
  slot: 'E',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'entity',
  execute: ({ target, allEntities }) => {
    if (target.type !== 'entity') return {};
    const victim = allEntities.find((e) => e.id === target.entityId);
    if (!victim) return {};
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 10;
    const newPosition: Point = { x: victim.position.x + Math.cos(angle) * dist, y: victim.position.y + Math.sin(angle) * dist };
    return { targetChanges: { entityId: victim.id, changes: { position: newPosition } } };
  },
};

/** Rift Swap — échange instantané de position avec un allié ciblé, n'importe où sur la carte. */
const RIFT_SWAP: AbilityDefinition = {
  id: 'warp_rift_swap',
  name: 'Rift Swap',
  agentId: 'warp',
  slot: 'X',
  cost: 6,
  cooldownOrCharges: 6,
  targetingType: 'entity',
  execute: ({ entity, target, allEntities }) => {
    if (target.type !== 'entity') return {};
    const ally = allEntities.find((e) => e.id === target.entityId);
    if (!ally || ally.status !== 'alive') return {};
    return {
      selfChanges: { position: { ...ally.position } },
      targetChanges: { entityId: ally.id, changes: { position: { ...entity.position } } },
    };
  },
};

const ABILITIES = [ANCHOR_POINT, RETURN, DISPLACEMENT_FIELD, RIFT_SWAP];

/** IA simple : rentre à l'ancre si en danger, sinon pose une ancre si aucune active ; déclenche le champ de déplacement ; échange avec un allié en détresse si l'ultime est prête. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, worldState, tick } = context;

  const myField = worldState.effects.find((e) => e.abilityId === 'warp_displacement_field' && e.sourceEntityId === entity.id && tick < e.expiresAtTick);
  if (myField) {
    const intruder = allEntities.find(
      (other) => other.team !== entity.team && other.status === 'alive' && Math.hypot(other.position.x - myField.position.x, other.position.y - myField.position.y) <= myField.radius,
    );
    if (intruder) return [{ definition: DISPLACEMENT_TRIGGER, target: { type: 'entity', entityId: intruder.id } }];
  }

  const anchor = entity.abilityLoadout?.abilities.C?.customState as { position: Point; expiresAtTick: number } | undefined;
  const qInstance = entity.abilityLoadout?.abilities.Q;
  if (entity.health < 30 && anchor && tick < anchor.expiresAtTick && qInstance && qInstance.charges > 0) {
    return [{ definition: RETURN, target: { type: 'self' } }];
  }

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (xInstance && Math.floor(xInstance.ultimatePoints) >= RIFT_SWAP.cost) {
    const allyInDanger = allEntities.find((other) => other.id !== entity.id && other.team === entity.team && other.status === 'alive' && other.health < 30);
    if (allyInDanger) return [{ definition: RIFT_SWAP, target: { type: 'entity', entityId: allyInDanger.id } }];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  if (!anchor && cInstance && cInstance.charges > 0) {
    return [{ definition: ANCHOR_POINT, target: { type: 'self' } }];
  }

  return [];
}

export const WARP: AgentDefinition = {
  agentId: 'warp',
  name: 'Warp',
  abilities: ABILITIES,
  decide,
};
