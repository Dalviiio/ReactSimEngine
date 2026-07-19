import { hasLineOfSight } from '../../../../ai';
import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Havoc — archétype "initiateur de contrôle de zone" : révélation sans ligne
 * de vue, aveuglement multi-cible, immobilisation universelle (risque pour
 * ses propres alliés), et leur combinaison en une seule zone massive avec
 * délai d'alerte.
 */

/** Sonic Pulse — reveal en zone, ne nécessite aucune ligne de vue directe (juste un rayon). */
const SONIC_PULSE: AbilityDefinition = {
  id: 'havoc_sonic_pulse',
  name: 'Sonic Pulse',
  agentId: 'havoc',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    return {
      effects: [
        {
          id: '',
          abilityId: 'havoc_sonic_pulse',
          sourceEntityId: entity.id,
          type: 'reveal',
          position: target.point,
          radius: 35,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(5, tickRate),
        },
      ],
    };
  },
};

const DISORIENT_RADIUS = 25;

/**
 * Disorient Charge — aveugle TOUS les ennemis dans un petit rayon d'impact
 * (pas une cible unique) : `affectedEntityIds` est rempli en scannant
 * `allEntities` dans le rayon au moment de l'activation, le type "blind"
 * existant supporte nativement une liste à plusieurs entités.
 */
const DISORIENT_CHARGE: AbilityDefinition = {
  id: 'havoc_disorient_charge',
  name: 'Disorient Charge',
  agentId: 'havoc',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'area',
  execute: ({ entity, target, allEntities, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const affected = allEntities
      .filter((e) => e.id !== entity.id && e.team !== entity.team && e.status === 'alive' && distance(e.position, target.point) <= DISORIENT_RADIUS)
      .map((e) => e.id);
    return {
      effects: [
        {
          id: '',
          abilityId: 'havoc_disorient_charge',
          sourceEntityId: entity.id,
          type: 'blind',
          position: target.point,
          radius: DISORIENT_RADIUS,
          affectedEntityIds: affected,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(3, tickRate),
        },
      ],
    };
  },
};

/**
 * Root Field — immobilise QUICONQUE se trouve dans la zone, ennemis ET
 * alliés (risque/récompense). Un simple "blocksMovement" suffit : contrairement
 * à "blind" (filtré par équipe côté botController), `applyEffectsToNavGrid`
 * patche la NavGrid PARTAGÉE, utilisée par toutes les entités sans distinction
 * d'équipe — aucune extension nécessaire pour ce comportement universel.
 */
const ROOT_FIELD: AbilityDefinition = {
  id: 'havoc_root_field',
  name: 'Root Field',
  agentId: 'havoc',
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
          abilityId: 'havoc_root_field',
          sourceEntityId: entity.id,
          type: 'blocksMovement',
          position: target.point,
          radius: 20,
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(5, tickRate),
        },
      ],
    };
  },
};

const CATACLYSM_RADIUS = 40;

/**
 * Cataclysm — combine Disorient Charge + Root Field dans une seule zone
 * large, avec un délai de préparation avant activation (`activeFromTick`,
 * réutilisé tel quel comme pour Orbital Strike/Nanoswarm/Lockdown).
 *
 * La liste des ennemis aveuglés N'EST PAS déterminée à l'activation : le
 * volet "blind" est posé avec un `abilityId` "_pending" et une liste vide,
 * ignorée par `applyVisionOverrides` tant qu'elle est vide. `decide()`
 * détecte, au tick exact où `activeFromTick` est atteint, ce marqueur en
 * attente et déclenche CATACLYSM_ARM (coût 0, interne) qui le remplace
 * (`effectIdsToRemove` + nouvel effet, abilityId final sans "_pending") par
 * un effet identique mais avec `affectedEntityIds` recalculé à CE moment —
 * un ennemi qui a fui la zone pendant le délai n'y est donc plus. Le volet
 * "blocksMovement", lui, n'a jamais eu ce problème : `activeFromTick` +
 * `applyEffectsToNavGrid` (recalculée à chaque tick) suffisaient déjà.
 */
const CATACLYSM: AbilityDefinition = {
  id: 'havoc_cataclysm',
  name: 'Cataclysm',
  agentId: 'havoc',
  slot: 'X',
  cost: 8,
  cooldownOrCharges: 8,
  targetingType: 'area',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'area') return {};
    const prepTicks = secondsToTicks(3, tickRate);
    const base = {
      sourceEntityId: entity.id,
      position: target.point,
      radius: CATACLYSM_RADIUS,
      createdAtTick: tick,
      activeFromTick: tick + prepTicks,
      expiresAtTick: tick + prepTicks + secondsToTicks(4, tickRate),
    };
    return {
      effects: [
        { id: '', abilityId: 'havoc_cataclysm_pending', type: 'blind' as const, affectedEntityIds: [], ...base },
        { id: '', abilityId: 'havoc_cataclysm', type: 'blocksMovement' as const, ...base },
      ],
    };
  },
};

/** Armement de Cataclysm (coût 0, interne) : résout la liste des ennemis aveuglés au moment exact où le délai de préparation s'achève. */
const CATACLYSM_ARM: AbilityDefinition = {
  id: 'havoc_cataclysm_arm',
  name: 'Cataclysm (armement)',
  agentId: 'havoc',
  slot: 'X',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'entity',
  execute: ({ entity, target, allEntities, activeEffects }) => {
    if (target.type !== 'entity') return {};
    const marker = activeEffects.find((e) => e.id === target.entityId);
    if (!marker) return {};
    const affected = allEntities
      .filter((e) => e.id !== entity.id && e.team !== entity.team && e.status === 'alive' && distance(e.position, marker.position) <= marker.radius)
      .map((e) => e.id);
    return {
      effectIdsToRemove: [marker.id],
      effects: [{ ...marker, id: '', abilityId: 'havoc_cataclysm', affectedEntityIds: affected }],
    };
  },
};

const ABILITIES = [SONIC_PULSE, DISORIENT_CHARGE, ROOT_FIELD, CATACLYSM];

/** IA simple : arme Cataclysm dès que son délai de préparation s'achève ; sinon ultime sur un ennemi visible si prête, sinon Disorient Charge s'il y a un ennemi visible, sinon Sonic Pulse en éclaireur. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, mapData, worldState, tick } = context;

  const pendingCataclysm = worldState.effects.find(
    (e) => e.abilityId === 'havoc_cataclysm_pending' && e.sourceEntityId === entity.id && e.activeFromTick !== undefined && tick >= e.activeFromTick,
  );
  if (pendingCataclysm) {
    return [{ definition: CATACLYSM_ARM, target: { type: 'entity', entityId: pendingCataclysm.id } }];
  }

  const visibleEnemy = allEntities.find(
    (other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive' && hasLineOfSight(mapData, entity.position, other.position),
  );

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (visibleEnemy && xInstance && Math.floor(xInstance.ultimatePoints) >= CATACLYSM.cost) {
    return [{ definition: CATACLYSM, target: { type: 'area', point: visibleEnemy.position } }];
  }

  if (visibleEnemy) {
    const qInstance = entity.abilityLoadout?.abilities.Q;
    if (qInstance && qInstance.charges > 0) {
      return [{ definition: DISORIENT_CHARGE, target: { type: 'area', point: visibleEnemy.position } }];
    }
    return [];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  if (cInstance && cInstance.charges > 0) {
    return [{ definition: SONIC_PULSE, target: { type: 'area', point: entity.position } }];
  }

  return [];
}

export const HAVOC: AgentDefinition = {
  agentId: 'havoc',
  name: 'Havoc',
  abilities: ABILITIES,
  decide,
};
