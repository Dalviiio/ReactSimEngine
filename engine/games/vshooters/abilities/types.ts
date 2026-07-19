/**
 * Architecture générique des capacités d'agent. Pensée pour être réutilisée par
 * TOUT agent futur (duelliste, contrôleur, initiateur, sentinelle, ...) sans
 * refonte : ce fichier ne connaît le nom d'aucun agent précis — chaque agent (agents/*.ts)
 * fournit ses propres `AbilityDefinition`, chacune avec sa fonction `execute`
 * qui produit des `AbilityEffect` génériques. `activateAbility` orchestre la
 * validation (charges/coût) et l'application, sans jamais avoir besoin de
 * connaître la mécanique propre à une capacité précise.
 */
import { EntityManager, EventBus } from '../../../core';
import { AbilityInstanceState, AbilityLoadoutState, AbilitySlot, EntityState, MapData, Point } from '../../../types';

export type { AbilitySlot, AbilityInstanceState, AbilityLoadoutState };

export type TargetingType = 'self' | 'point' | 'direction' | 'entity' | 'area';

/**
 * Type d'effet produit par une capacité active dans le monde. 9 archétypes :
 * blocksVision/blocksMovement couvrent fumées/murs, damageOverTime/heal les
 * zones de dégâts/soin continus, blind les flashs, reveal/reconPing
 * l'information (drones, pings, tourelles-vision), slow les ralentissements
 * (toujours un frein, imposé par l'ennemi), et statModifier les buffs/debuffs
 * temporaires de statistique (cadence de tir, vitesse de déplacement,
 * précision) via un multiplicateur — ex: le buff de cadence de tir de
 * l'Overdrive Beacon du Vanguard (voir `getStatModifier` dans integration.ts).
 * Le 10e, "stealth", rend une entité ignorée comme CIBLE par
 * `hasLineOfSightWithAbilities` (elle n'est pas détectée), sauf si elle est
 * simultanément sous un effet "reveal" actif — reveal a priorité sur stealth,
 * voir le README du module et `hasLineOfSightWithAbilities` dans
 * integration.ts. Un effet qui ne rentre dans AUCUN de ces 10 cas ne doit PAS
 * être forcé dedans — voir le README du module.
 */
export type AbilityEffectType =
  | 'blocksVision'
  | 'blocksMovement'
  | 'damageOverTime'
  | 'heal'
  | 'blind'
  | 'reveal'
  | 'slow'
  | 'reconPing'
  | 'statModifier'
  | 'stealth';

/**
 * Statistiques modifiables par un effet "statModifier". `damageDealt`/
 * `damageTaken` (ajoutés pour Ember/Vesper) sont calculables via
 * `getStatModifier` comme les autres, mais ne sont PAS encore câblés dans
 * `calculateDamage`/`resolveShot` (games/vshooters/damage.ts,roundManager.ts)
 * — même situation que `fireRate` avant son câblage dans `createMatchOnTick` :
 * un câblage réel dans la résolution de dégâts est une suite logique, pas
 * forcée ici (voir le bilan de cette étape).
 */
export type ModifiableStat = 'fireRate' | 'moveSpeed' | 'accuracy' | 'damageDealt' | 'damageTaken';

export interface AbilityEffect {
  id: string;
  abilityId: string;
  sourceEntityId: string;
  type: AbilityEffectType;
  /** Centre de la zone d'effet (cercle) — forme unique et générique pour toute capacité. */
  position: Point;
  radius: number;
  createdAtTick: number;
  expiresAtTick: number;
  /**
   * Si défini, l'effet n'agit (DoT/heal) qu'à partir de ce tick — modélise un
   * délai de préparation/armement (ex: Orbital Strike, Nanoswarm, Lockdown)
   * pendant lequel l'effet existe déjà dans le monde mais n'agit pas encore.
   */
  activeFromTick?: number;
  /** Montant par tick pour damageOverTime/heal. */
  amountPerTick?: number;
  /**
   * Entités déjà déterminées comme affectées (ex: qui a été flashé/soigné) au
   * moment de la création, plutôt qu'un recalcul de zone à chaque tick — utilisé
   * par "blind" et "heal" (cible fixe), pas par les zones recalculées en direct
   * (damageOverTime, reveal, slow, blocksVision/Movement).
   */
  affectedEntityIds?: string[];
  /** Facteur multiplicatif de vitesse pour "slow" (0.5 = moitié vitesse). */
  slowFactor?: number;
  /** Statistique visée par un effet "statModifier". */
  statType?: ModifiableStat;
  /** Multiplicateur appliqué à la statistique visée (1.25 = +25%) pour "statModifier". */
  multiplier?: number;
}

export type AbilityTarget =
  | { type: 'self' }
  | { type: 'point'; point: Point }
  | { type: 'direction'; angle: number }
  | { type: 'entity'; entityId: string }
  | { type: 'area'; point: Point };

export interface AbilityExecutionContext {
  entity: EntityState;
  target: AbilityTarget;
  tick: number;
  tickRate: number;
  mapData: MapData;
  allEntities: EntityState[];
  /**
   * Effets actuellement dans le monde (avant cette activation) — permet à une
   * capacité de raisonner sur l'existant : compter ses propres pièges déjà
   * posés (Bramble), retrouver l'id de son propre effet "stealth" à retirer
   * (Vesper), etc. Lecture seule, jamais muté ici (cf. `effectIdsToRemove`
   * pour en retirer).
   */
  activeEffects: AbilityEffect[];
}

export interface AbilityExecutionResult {
  /** Nouveaux effets à ajouter au monde (fumée posée, mur, tourelle, DoT, etc.). */
  effects?: AbilityEffect[];
  /** Changements instantanés à l'entité qui active (ex: dash, téléportation, auto-buff). */
  selfChanges?: Partial<EntityState>;
  /** Changements instantanés à une autre entité ciblée (ex: soin, résurrection). */
  targetChanges?: { entityId: string; changes: Partial<EntityState> };
  /**
   * Ids d'effets existants à retirer du monde, appliqué AVANT l'ajout des
   * nouveaux `effects` de cette même activation — permet de consommer un
   * marqueur au déclenchement (piège de Bramble), remplacer le plus ancien
   * quand un plafond est atteint (Trap Network), ou rompre son propre effet
   * (stealth de Vesper). Voir `activateAbility`.
   */
  effectIdsToRemove?: string[];
  /**
   * Fusionné dans `customState` de l'instance qui active CETTE capacité (même
   * slot), une fois le coût déduit — état libre persistant qui ne se modélise
   * pas comme un `AbilityEffect` de zone/liste (marqueur de téléportation de
   * Warp, drapeau d'upgrade de Bramble, baseline de vie de Vesper...). Voir
   * `AbilityInstanceState.customState` (types/entity.ts).
   */
  instanceCustomState?: Record<string, unknown>;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  agentId: string;
  slot: AbilitySlot;
  /** Coût consommé par activation : charges (C/Q/E, presque toujours 1) ou points d'ultimate (X). */
  cost: number;
  /** Charges rechargeables par round (C/Q/E) ou seuil de points d'ultimate requis (X). */
  cooldownOrCharges: number;
  targetingType: TargetingType;
  /**
   * Produit le(s) effet(s) et/ou changements instantanés de l'activation. C'est
   * le SEUL point où la mécanique propre à une capacité est branchée sur
   * l'architecture générique — `activateAbility` ne l'interprète jamais.
   */
  execute: (context: AbilityExecutionContext) => AbilityExecutionResult;
}

export interface AbilityWorldState {
  effects: AbilityEffect[];
}

export function createEmptyAbilityWorldState(): AbilityWorldState {
  return { effects: [] };
}

export function secondsToTicks(seconds: number, tickRate: number): number {
  return Math.round(seconds * tickRate);
}

let nextEffectId = 1;
function genEffectId(): string {
  nextEffectId += 1;
  return `effect-${nextEffectId}`;
}

export interface ActivateAbilityContext {
  tick: number;
  tickRate: number;
  mapData: MapData;
  allEntities: EntityState[];
  eventBus: EventBus;
}

export interface ActivateAbilityResult {
  worldState: AbilityWorldState;
  selfChanges?: Partial<EntityState>;
  targetChanges?: { entityId: string; changes: Partial<EntityState> };
}

/**
 * Valide les charges/points d'ultimate, exécute la capacité (via sa fonction
 * `execute`), déduit le coût, ajoute les effets produits au monde, et émet
 * "ability:activated". Retourne `null` si l'activation est invalide (mauvais
 * agent, charges/points insuffisants). Fonction pure : ne touche à aucun
 * EntityManager — l'appelant applique `selfChanges`/`targetChanges` lui-même.
 */
export function activateAbility(
  worldState: AbilityWorldState,
  entity: EntityState,
  definition: AbilityDefinition,
  target: AbilityTarget,
  context: ActivateAbilityContext,
): ActivateAbilityResult | null {
  const loadout = entity.abilityLoadout;
  if (!loadout || loadout.agentId !== definition.agentId) return null;

  const instance = loadout.abilities[definition.slot];
  if (!instance) return null;

  if (definition.slot === 'X') {
    if (Math.floor(instance.ultimatePoints) < definition.cost) return null;
  } else if (instance.charges < definition.cost) {
    // Comparé au coût (pas juste "< 1") : permet par ex. une capacité "gratuite" (cost: 0),
    // comme le tir automatique d'une tourelle déjà placée (voir architect.ts) — elle réutilise
    // le même emplacement Q que sa pose sans jamais entamer les charges restantes.
    return null;
  }

  const result = definition.execute({
    entity,
    target,
    tick: context.tick,
    tickRate: context.tickRate,
    mapData: context.mapData,
    allEntities: context.allEntities,
    activeEffects: worldState.effects,
  });

  const newEffects = (result.effects ?? []).map((effect) => ({ ...effect, id: effect.id || genEffectId() }));
  const survivingEffects = result.effectIdsToRemove
    ? worldState.effects.filter((e) => !result.effectIdsToRemove!.includes(e.id))
    : worldState.effects;
  const newWorldState: AbilityWorldState = { ...worldState, effects: [...survivingEffects, ...newEffects] };

  context.eventBus.emit('ability:activated', {
    entityId: entity.id,
    abilityId: definition.id,
    agentId: definition.agentId,
    slot: definition.slot,
    tick: context.tick,
  });

  const customState = result.instanceCustomState ?? instance.customState;
  const updatedInstance: AbilityInstanceState =
    definition.slot === 'X'
      ? { charges: 0, ultimatePoints: instance.ultimatePoints - definition.cost, customState }
      : { charges: instance.charges - definition.cost, ultimatePoints: instance.ultimatePoints, customState };

  const abilityLoadoutChanges: AbilityLoadoutState = {
    agentId: loadout.agentId,
    abilities: { ...loadout.abilities, [definition.slot]: updatedInstance },
  };

  const selfChanges: Partial<EntityState> = { ...(result.selfChanges ?? {}), abilityLoadout: abilityLoadoutChanges };

  return { worldState: newWorldState, selfChanges, targetChanges: result.targetChanges };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function applyPerTickEffect(effect: AbilityEffect, entityManager: EntityManager, eventBus: EventBus): void {
  if (effect.amountPerTick === undefined) return;
  if (effect.type !== 'damageOverTime' && effect.type !== 'heal') return;

  const targets = effect.affectedEntityIds
    ? effect.affectedEntityIds.map((id) => entityManager.getEntity(id)).filter((e): e is EntityState => !!e)
    : entityManager.getAllEntities().filter((e) => distance(e.position, effect.position) <= effect.radius);

  targets.forEach((target) => {
    if (target.status !== 'alive') return;

    if (effect.type === 'heal') {
      entityManager.updateEntity(target.id, { health: Math.min(100, target.health + effect.amountPerTick!) });
      return;
    }

    // damageOverTime : dégâts bruts (pas d'armure/wallbang ici, cf. damage.ts pour le gunplay).
    // Touche TOUT le monde dans la zone, y compris les alliés (tir ami réel sur ce type d'utilitaire).
    const newHealth = Math.max(0, target.health - effect.amountPerTick!);
    entityManager.updateEntity(target.id, { health: newHealth });
    if (newHealth <= 0 && target.status === 'alive') {
      entityManager.updateEntity(target.id, { status: 'dead' });
      eventBus.emit('player:killed', {
        killerId: effect.sourceEntityId,
        victimId: target.id,
        weaponId: effect.abilityId,
        hitZone: 'body',
      });
    }
  });
}

/**
 * À appeler chaque tick : fait expirer les effets dont la durée est écoulée
 * (émet "ability:effect-expired"), et applique les dégâts/soin par tick pour
 * les effets damageOverTime/heal actifs (respecte `activeFromTick` : un effet
 * pas encore armé existe mais n'agit pas).
 */
export function updateActiveEffects(
  worldState: AbilityWorldState,
  currentTick: number,
  entityManager: EntityManager,
  eventBus: EventBus,
): AbilityWorldState {
  const stillActive: AbilityEffect[] = [];

  worldState.effects.forEach((effect) => {
    if (currentTick >= effect.expiresAtTick) {
      eventBus.emit('ability:effect-expired', { effectId: effect.id, type: effect.type, tick: currentTick });
      return;
    }

    if (effect.activeFromTick === undefined || currentTick >= effect.activeFromTick) {
      applyPerTickEffect(effect, entityManager, eventBus);
    }

    stillActive.push(effect);
  });

  return { ...worldState, effects: stillActive };
}
