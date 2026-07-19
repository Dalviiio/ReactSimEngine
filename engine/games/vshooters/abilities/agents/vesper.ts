import { Point } from '../../../../types';
import { AgentDecisionContext, AgentDecisionResult, AgentDefinition } from '../integration';
import { AbilityDefinition, secondsToTicks } from '../types';

/**
 * Vesper — archétype "duelliste furtif", introduit le 10e type d'effet
 * "stealth" (types.ts) : invisibilité de soi, leurre, téléportation locale
 * furtive, assaut fantôme avec bonus au premier coup.
 */

const VANISH_DURATION_SECONDS = 4;

/** Vanish — stealth sur soi, courte durée. Mémorise la vie au moment de l'activation (instanceCustomState) pour détecter "a été touché" dans decide(). */
const VANISH: AbilityDefinition = {
  id: 'vesper_vanish',
  name: 'Vanish',
  agentId: 'vesper',
  slot: 'C',
  cost: 1,
  cooldownOrCharges: 1,
  targetingType: 'self',
  execute: ({ entity, tick, tickRate }) => ({
    effects: [
      {
        id: '',
        abilityId: 'vesper_vanish',
        sourceEntityId: entity.id,
        type: 'stealth',
        position: { ...entity.position },
        radius: 0,
        affectedEntityIds: [entity.id],
        createdAtTick: tick,
        expiresAtTick: tick + secondsToTicks(VANISH_DURATION_SECONDS, tickRate),
      },
    ],
    instanceCustomState: { healthAtVanish: entity.health },
  }),
};

/** Rupture de Vanish (coût 0, interne) : retire le stealth de l'entité — déclenché par decide() si elle tire ou a pris des dégâts. */
const BREAK_STEALTH: AbilityDefinition = {
  id: 'vesper_break_stealth',
  name: 'Vanish (rupture)',
  agentId: 'vesper',
  slot: 'C',
  cost: 0,
  cooldownOrCharges: 0,
  targetingType: 'self',
  execute: ({ entity, activeEffects }) => {
    const myStealth = activeEffects.find((e) => e.type === 'stealth' && e.sourceEntityId === entity.id);
    if (!myStealth) return {};
    return { effectIdsToRemove: [myStealth.id] };
  },
};

/**
 * Decoy — GAP D'ARCHITECTURE DOCUMENTÉ (comme demandé, plutôt qu'un mauvais
 * fit forcé) : un vrai leurre détectable par les autres bots nécessiterait
 * une entité fictive réellement enregistrée dans l'EntityManager (visible via
 * `hasLineOfSight`, ciblable par `botController`), ce que l'architecture pure
 * actuelle ne permet pas — `execute()` ne retourne que des `AbilityEffect`
 * génériques et des changements à des entités EXISTANTES (`selfChanges`/
 * `targetChanges`), jamais de nouvelle entité. Extension minimale proposée
 * pour une prochaine étape : un champ `AbilityExecutionResult.spawnEntities?:
 * EntityState[]`, appliqué par le composeur de tick (`createAgentAbilitiesOnTick`
 * dans integration.ts, qui SEUL a accès à l'EntityManager) via
 * `entityManager.addEntity(...)`, avec une expiration gérée en surveillant un
 * marqueur `AbilityEffect` dédié (même mécanisme que les pièges de Bramble)
 * pour dépeupler l'entité fictive à terme. Non implémenté ici : cette
 * activation ne fait donc que consommer sa charge, sans aucun effet
 * gameplay — même statut que le Stim Beacon du Vanguard avant son câblage
 * en statModifier.
 */
const DECOY: AbilityDefinition = {
  id: 'vesper_decoy',
  name: 'Decoy',
  agentId: 'vesper',
  slot: 'Q',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'self',
  execute: () => ({}),
};

const SHADOW_STEP_DISTANCE = 120;
const SHADOW_STEP_STEALTH_SECONDS = 1.5;

/** Shadow Step — courte téléportation locale (comme Tailwind de Gale), applique en plus stealth 1-2s après l'arrivée. */
const SHADOW_STEP: AbilityDefinition = {
  id: 'vesper_shadow_step',
  name: 'Shadow Step',
  agentId: 'vesper',
  slot: 'E',
  cost: 1,
  cooldownOrCharges: 2,
  targetingType: 'direction',
  execute: ({ entity, target, tick, tickRate }) => {
    if (target.type !== 'direction') return {};
    const rad = (target.angle * Math.PI) / 180;
    const destination: Point = {
      x: entity.position.x + Math.cos(rad) * SHADOW_STEP_DISTANCE,
      y: entity.position.y + Math.sin(rad) * SHADOW_STEP_DISTANCE,
    };
    return {
      selfChanges: { position: destination },
      effects: [
        {
          id: '',
          abilityId: 'vesper_shadow_step',
          sourceEntityId: entity.id,
          type: 'stealth',
          position: { ...destination },
          radius: 0,
          affectedEntityIds: [entity.id],
          createdAtTick: tick,
          expiresAtTick: tick + secondsToTicks(SHADOW_STEP_STEALTH_SECONDS, tickRate),
        },
      ],
    };
  },
};

/**
 * Phantom Assault — stealth prolongée + bonus de dégâts approximant "premier
 * coup porté" par une fenêtre courte en début d'effet (statModifier ciblé,
 * `damageDealt`, ×2). Comme Finisher Mark de l'Ember, ce statType est
 * calculable via `getStatModifier` mais pas encore câblé dans
 * `calculateDamage`/`resolveShot` — `damage.ts`'s `isBackstab` existant ne
 * s'applique qu'à l'arme de mêlée (seule à avoir un `backstabMultiplier`
 * défini), donc ne peut pas représenter tel quel un bonus universel "premier
 * coup, quelle que soit l'arme" sans modifier `weapons.ts` (hors de portée
 * ici) — voir le bilan.
 */
const PHANTOM_ASSAULT: AbilityDefinition = {
  id: 'vesper_phantom_assault',
  name: 'Phantom Assault',
  agentId: 'vesper',
  slot: 'X',
  cost: 7,
  cooldownOrCharges: 7,
  targetingType: 'self',
  execute: ({ entity, tick, tickRate }) => ({
    effects: [
      {
        id: '',
        abilityId: 'vesper_phantom_assault',
        sourceEntityId: entity.id,
        type: 'stealth',
        position: { ...entity.position },
        radius: 0,
        affectedEntityIds: [entity.id],
        createdAtTick: tick,
        expiresAtTick: tick + secondsToTicks(8, tickRate),
      },
      {
        id: '',
        abilityId: 'vesper_phantom_assault_bonus',
        sourceEntityId: entity.id,
        type: 'statModifier',
        statType: 'damageDealt',
        multiplier: 2,
        position: { ...entity.position },
        radius: 0,
        affectedEntityIds: [entity.id],
        createdAtTick: tick,
        expiresAtTick: tick + secondsToTicks(3, tickRate),
      },
    ],
  }),
};

const ABILITIES = [VANISH, DECOY, SHADOW_STEP, PHANTOM_ASSAULT];

/** IA simple : rompt son propre stealth si elle engage ou a pris des dégâts ; sinon ultime > vanish > shadow step selon la situation. */
function decide(context: AgentDecisionContext): AgentDecisionResult[] {
  const { entity, allEntities, worldState, tick } = context;

  const myStealth = worldState.effects.find((e) => e.type === 'stealth' && e.sourceEntityId === entity.id && tick < e.expiresAtTick);
  if (myStealth) {
    const healthAtVanish = (entity.abilityLoadout?.abilities.C?.customState as { healthAtVanish?: number } | undefined)?.healthAtVanish;
    const tookDamage = healthAtVanish !== undefined && entity.health < healthAtVanish;
    if (entity.currentAction === 'engaging' || tookDamage) {
      return [{ definition: BREAK_STEALTH, target: { type: 'self' } }];
    }
    return [];
  }

  const visibleEnemy = allEntities.find((other) => other.id !== entity.id && other.team !== entity.team && other.status === 'alive');

  const xInstance = entity.abilityLoadout?.abilities.X;
  if (visibleEnemy && xInstance && Math.floor(xInstance.ultimatePoints) >= PHANTOM_ASSAULT.cost) {
    return [{ definition: PHANTOM_ASSAULT, target: { type: 'self' } }];
  }

  const cInstance = entity.abilityLoadout?.abilities.C;
  if (visibleEnemy && entity.health < 40 && cInstance && cInstance.charges > 0) {
    return [{ definition: VANISH, target: { type: 'self' } }];
  }

  return [];
}

export const VESPER: AgentDefinition = {
  agentId: 'vesper',
  name: 'Vesper',
  abilities: ABILITIES,
  decide,
};
