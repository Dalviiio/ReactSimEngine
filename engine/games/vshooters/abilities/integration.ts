/**
 * Branchement des capacités sur l'existant (vision, déplacement, botController,
 * eventBus, roundManager) — sans dupliquer ni modifier ce qui existe déjà (à
 * l'exception d'un tout petit ajout rétrocompatible à `createMatchOnTick`,
 * voir roundManager.ts, nécessaire pour lui fournir une NavGrid dynamique).
 */
import { getEngagingTarget, hasLineOfSight } from '../../../ai';
import { EntityManager, EventBus, TickContext } from '../../../core';
import { AbilitySlot, EntityState, MapData, NavGrid, Point } from '../../../types';
import { createMatchOnTick, MatchStateBox, RoundManagerConfig } from '../roundManager';
import {
  AbilityDefinition,
  AbilityEffect,
  AbilityTarget,
  AbilityWorldState,
  ModifiableStat,
  activateAbility,
  createEmptyAbilityWorldState,
  updateActiveEffects,
} from './types';

export { createEmptyAbilityWorldState };
export type { AbilityWorldState };

export interface AbilityWorldStateBox {
  current: AbilityWorldState;
}

export interface AgentDefinition {
  agentId: string;
  name: string;
  /** Exactement 4 : une par slot C/Q/E/X. */
  abilities: AbilityDefinition[];
  /** IA basique : décide quelles capacités activer ce tick pour ce bot. */
  decide: (context: AgentDecisionContext) => AgentDecisionResult[];
}

export interface AgentDecisionContext {
  entity: EntityState;
  allEntities: EntityState[];
  mapData: MapData;
  navGrid: NavGrid;
  worldState: AbilityWorldState;
  tick: number;
  tickRate: number;
}

export interface AgentDecisionResult {
  definition: AbilityDefinition;
  target: AbilityTarget;
}

// ---------------------------------------------------------------------------
// Géométrie (cercle) — pas dans ai/geometry.ts, qui ne traite que segments/rects.
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Filtre les effets "réellement actifs" à ce tick : exclut ceux encore en
 * délai d'armement (`activeFromTick` pas encore atteint, ex: Lockdown,
 * Nanoswarm). À utiliser avant toute vérification gameplay (vision,
 * déplacement) — `updateActiveEffects` s'en charge déjà pour les DoT/heal.
 */
export function getActiveEffectsAtTick(effects: AbilityEffect[], tick: number): AbilityEffect[] {
  return effects.filter((e) => e.activeFromTick === undefined || tick >= e.activeFromTick);
}

function segmentIntersectsCircle(p1: Point, p2: Point, center: Point, radius: number): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: p1.x + t * dx, y: p1.y + t * dy };
  return distance(center, closest) <= radius;
}

function circleIntersectsRect(center: Point, radius: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(center.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(center.y, rect.y + rect.height));
  return distance(center, { x: closestX, y: closestY }) <= radius;
}

// ---------------------------------------------------------------------------
// Wrappers vision / déplacement
// ---------------------------------------------------------------------------

/**
 * Étend `hasLineOfSight` (murs/caisses) avec les `AbilityEffect` de type
 * "blocksVision" actifs (fumées), et, si `targetEntityId` est fourni, la
 * règle "stealth" (Vesper) : une entité CIBLE sous un effet "stealth" actif
 * est ignorée (non détectée) sauf si elle est simultanément sous un effet
 * "reveal" actif — reveal a priorité sur stealth. `targetEntityId` est
 * optionnel et rétrocompatible : les appels existants sans 5e argument
 * ignorent simplement la règle stealth (comportement inchangé). Fonction
 * pure, réutilise `hasLineOfSight` tel quel — ne le modifie pas.
 */
export function hasLineOfSightWithAbilities(
  mapData: MapData,
  from: Point,
  to: Point,
  effects: AbilityEffect[],
  targetEntityId?: string,
): boolean {
  if (!hasLineOfSight(mapData, from, to)) return false;
  const blockedByAbility = effects.some(
    (effect) => effect.type === 'blocksVision' && segmentIntersectsCircle(from, to, effect.position, effect.radius),
  );
  if (blockedByAbility) return false;

  if (targetEntityId) {
    const isStealthed = effects.some((e) => e.type === 'stealth' && e.affectedEntityIds?.includes(targetEntityId));
    if (isStealthed) {
      const isRevealed = effects.some(
        (e) => e.type === 'reveal' && (e.affectedEntityIds?.includes(targetEntityId) || distance(to, e.position) <= e.radius),
      );
      if (!isRevealed) return false;
    }
  }

  return true;
}

/**
 * Retourne une NavGrid "patchée" : toute cellule chevauchant un effet
 * "blocksMovement" actif (mur de l'Aegis, zone de Lockdown, ...) devient
 * non-walkable. Ne mute PAS `navGrid` d'origine — la carte statique reste la
 * source de vérité, les effets sont recalculés à la volée.
 */
export function applyEffectsToNavGrid(navGrid: NavGrid, effects: AbilityEffect[]): NavGrid {
  const blockingEffects = effects.filter((e) => e.type === 'blocksMovement');
  if (blockingEffects.length === 0) return navGrid;

  const cells = navGrid.cells.map((row) => [...row]);

  blockingEffects.forEach((effect) => {
    const minCol = Math.max(0, Math.floor((effect.position.x - effect.radius) / navGrid.cellSize));
    const maxCol = Math.min(navGrid.cols - 1, Math.floor((effect.position.x + effect.radius) / navGrid.cellSize));
    const minRow = Math.max(0, Math.floor((effect.position.y - effect.radius) / navGrid.cellSize));
    const maxRow = Math.min(navGrid.rows - 1, Math.floor((effect.position.y + effect.radius) / navGrid.cellSize));

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const cellRect: Rect = { x: col * navGrid.cellSize, y: row * navGrid.cellSize, width: navGrid.cellSize, height: navGrid.cellSize };
        if (circleIntersectsRect(effect.position, effect.radius, cellRect)) cells[row][col] = 1;
      }
    }
  });

  return { ...navGrid, cells };
}

// ---------------------------------------------------------------------------
// Chargement / points d'ultimate
// ---------------------------------------------------------------------------

/** Construit le loadout initial d'un agent (charges pleines pour C/Q/E, 0 point d'ultimate). */
export function createAbilityLoadout(agent: AgentDefinition) {
  const abilities: Partial<Record<AbilitySlot, { charges: number; ultimatePoints: number }>> = {};
  agent.abilities.forEach((def) => {
    abilities[def.slot] = def.slot === 'X' ? { charges: 0, ultimatePoints: 0 } : { charges: def.cooldownOrCharges, ultimatePoints: 0 };
  });
  return { agentId: agent.agentId, abilities };
}

/** Recharge les charges C/Q/E en début de round. Les points d'ultimate NE sont PAS réinitialisés (persistent, comme dans le vrai jeu). */
export function resetAbilityChargesForNewRound(entityManager: EntityManager, agentRegistry: Record<string, AgentDefinition>): void {
  entityManager.getAllEntities().forEach((entity) => {
    if (!entity.abilityLoadout) return;
    const agent = agentRegistry[entity.abilityLoadout.agentId];
    if (!agent) return;

    const abilities: Partial<Record<AbilitySlot, { charges: number; ultimatePoints: number }>> = {};
    agent.abilities.forEach((def) => {
      const existing = entity.abilityLoadout!.abilities[def.slot];
      abilities[def.slot] =
        def.slot === 'X'
          ? { charges: 0, ultimatePoints: existing?.ultimatePoints ?? 0 }
          : { charges: def.cooldownOrCharges, ultimatePoints: 0 };
    });

    entityManager.updateEntity(entity.id, { abilityLoadout: { agentId: entity.abilityLoadout.agentId, abilities } });
  });
}

export function getUltimatePoints(entity: EntityState): number {
  return Math.floor(entity.abilityLoadout?.abilities.X?.ultimatePoints ?? 0);
}

/** Points d'ultimate requis pour la capacité X d'un agent (0 si l'agent n'a pas d'ultime définie). */
export function getUltimateCost(agent: AgentDefinition): number {
  return agent.abilities.find((a) => a.slot === 'X')?.cost ?? 0;
}

const ULTIMATE_POINTS_PER_SECOND = 1 / 45;
const ULTIMATE_POINTS_PER_KILL = 1;

function accrueUltimatePoints(entityManager: EntityManager, tickRate: number): void {
  entityManager.getAllEntities().forEach((entity) => {
    const xInstance = entity.abilityLoadout?.abilities.X;
    if (!xInstance || entity.status !== 'alive') return;
    entityManager.updateEntity(entity.id, {
      abilityLoadout: {
        agentId: entity.abilityLoadout!.agentId,
        abilities: { ...entity.abilityLoadout!.abilities, X: { ...xInstance, ultimatePoints: xInstance.ultimatePoints + ULTIMATE_POINTS_PER_SECOND / tickRate } },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Overrides post-traitement (blind / fumée sur "engaging", slow sur le déplacement)
// ---------------------------------------------------------------------------

/**
 * Si un bot est marqué "engaging" par botController mais qu'un effet "blind"
 * l'affecte, OU que la ligne de vue vers sa cible est en fait coupée par une
 * fumée (que botController ignore), on annule sa décision. Ne recalcule PAS la
 * détection de visibilité elle-même (réutilise `getEngagingTarget`), ne modifie
 * pas botController.ts.
 */
export function applyVisionOverrides(context: TickContext, worldState: AbilityWorldState, tick: number): void {
  const { entityManager, mapData } = context;
  const activeEffects = getActiveEffectsAtTick(worldState.effects, tick);

  entityManager.getAllEntities().forEach((entity) => {
    if (entity.status !== 'alive' || entity.currentAction !== 'engaging') return;

    const blinded = activeEffects.some((e) => e.type === 'blind' && e.affectedEntityIds?.includes(entity.id));
    if (blinded) {
      entityManager.updateEntity(entity.id, { currentAction: 'blinded' });
      return;
    }

    const targetId = getEngagingTarget(entity.id);
    const target = targetId ? entityManager.getEntity(targetId) : undefined;
    if (target && !hasLineOfSightWithAbilities(mapData, entity.position, target.position, activeEffects, target.id)) {
      entityManager.updateEntity(entity.id, { currentAction: 'idle' });
    }
  });
}

/** Réduit le déplacement effectué ce tick si l'entité était dans une zone "slow" avant de bouger. */
export function applySlowOverrides(context: TickContext, worldState: AbilityWorldState, tick: number, positionsBefore: Map<string, Point>): void {
  const { entityManager } = context;
  const activeEffects = getActiveEffectsAtTick(worldState.effects, tick);

  entityManager.getAllEntities().forEach((entity) => {
    if (entity.status !== 'alive' || entity.currentAction !== 'movingTo') return;
    const before = positionsBefore.get(entity.id);
    if (!before) return;

    const slowEffect = activeEffects.find((e) => e.type === 'slow' && distance(before, e.position) <= e.radius);
    if (!slowEffect) return;

    const factor = slowEffect.slowFactor ?? 0.5;
    const after = entity.position;
    entityManager.updateEntity(entity.id, {
      position: { x: before.x + (after.x - before.x) * factor, y: before.y + (after.y - before.y) * factor },
    });
  });
}

/**
 * Multiplicateur combiné (produit) de tous les effets "statModifier" actifs
 * du type demandé qui affectent `entity` — par zone (position/rayon, comme
 * "slow") ou par liste fixe (`affectedEntityIds`, comme "heal"/"blind").
 * Retourne 1 si aucun effet ne s'applique (neutre). Fonction pure : ne modifie
 * ni les effets ni l'entité — c'est à l'appelant de l'utiliser pour ajuster
 * la valeur de base (ex: `weapon.fireRatePerSecond * getStatModifier(...)`).
 */
export function getStatModifier(entity: EntityState, statType: ModifiableStat, effects: AbilityEffect[], tick: number): number {
  const activeEffects = getActiveEffectsAtTick(effects, tick);
  return activeEffects
    .filter((e) => e.type === 'statModifier' && e.statType === statType)
    .filter((e) => (e.affectedEntityIds ? e.affectedEntityIds.includes(entity.id) : distance(entity.position, e.position) <= e.radius))
    .reduce((multiplier, e) => multiplier * (e.multiplier ?? 1), 1);
}

// ---------------------------------------------------------------------------
// Composeur de tick
// ---------------------------------------------------------------------------

/**
 * Compose le `onTick` complet capacités + moteur de match : réutilise
 * `createMatchOnTick` tel quel (mouvement/combat/économie/round/charge), et
 * ajoute par-dessus : expiration/DoT-heal des effets, corrections vision/slow,
 * accumulation des points d'ultimate, et l'IA basique par agent qui décide
 * d'activer des capacités. Ne modifie pas `engine/core/`.
 */
export function createAgentAbilitiesOnTick(
  baseNavGrid: NavGrid,
  matchStateBox: MatchStateBox,
  abilityWorldStateBox: AbilityWorldStateBox,
  agentRegistry: Record<string, AgentDefinition>,
  config: RoundManagerConfig,
): (context: TickContext) => void {
  // `currentTick` est mis à jour en tout début de tick, AVANT que `matchOnTick`
  // n'appelle ce getter en interne — lui permet de filtrer les effets encore en
  // délai d'armement (activeFromTick) sans changer la signature de createMatchOnTick.
  let currentTick = 0;
  const navGridGetter = () =>
    applyEffectsToNavGrid(baseNavGrid, getActiveEffectsAtTick(abilityWorldStateBox.current.effects, currentTick));
  const fireRateMultiplierGetter = (entity: EntityState, tick: number) =>
    getStatModifier(entity, 'fireRate', abilityWorldStateBox.current.effects, tick);
  // Combine le buff de dégâts INFLIGÉS du tireur (ex: Phantom Assault) et le
  // debuff de dégâts SUBIS de la cible (ex: Finisher Mark) en un seul multiplicateur.
  const damageMultiplierGetter = (shooter: EntityState, target: EntityState, tick: number) =>
    getStatModifier(shooter, 'damageDealt', abilityWorldStateBox.current.effects, tick) *
    getStatModifier(target, 'damageTaken', abilityWorldStateBox.current.effects, tick);
  const matchOnTick = createMatchOnTick(navGridGetter, matchStateBox, config, fireRateMultiplierGetter, damageMultiplierGetter);
  let ultimateKillBonusSubscribed = false;

  return (context: TickContext) => {
    const { tick, entityManager, eventBus, mapData } = context;
    currentTick = tick;

    if (!ultimateKillBonusSubscribed) {
      ultimateKillBonusSubscribed = true;
      eventBus.on('player:killed', (data) => {
        const { killerId } = data as { killerId: string };
        const killer = entityManager.getEntity(killerId);
        if (!killer?.abilityLoadout?.abilities.X) return;
        const xInstance = killer.abilityLoadout.abilities.X;
        entityManager.updateEntity(killerId, {
          abilityLoadout: {
            agentId: killer.abilityLoadout.agentId,
            abilities: { ...killer.abilityLoadout.abilities, X: { ...xInstance, ultimatePoints: xInstance.ultimatePoints + ULTIMATE_POINTS_PER_KILL } },
          },
        });
      });
    }

    // 1. Expire les effets / applique dégâts-sur-la-durée et soin.
    abilityWorldStateBox.current = updateActiveEffects(abilityWorldStateBox.current, tick, entityManager, eventBus);

    // 2. Accumulation passive des points d'ultimate.
    accrueUltimatePoints(entityManager, config.tickRate);

    // 3. Snapshot des positions AVANT mouvement, pour pouvoir appliquer "slow" après coup.
    const positionsBefore = new Map(entityManager.getAllEntities().map((e) => [e.id, { ...e.position }]));

    // 4. Mouvement + détection + combat + charge + round (réutilisé tel quel).
    matchOnTick(context);

    // 5. Corrections : blind/fumée invalident "engaging" ; slow réduit le déplacement.
    applyVisionOverrides(context, abilityWorldStateBox.current, tick);
    applySlowOverrides(context, abilityWorldStateBox.current, tick, positionsBefore);

    // 6. IA basique par agent : chaque bot avec un agent assigné peut activer une capacité.
    // Uniquement pendant la phase "active" — même règle que le gunplay (`resolveShot`, déjà
    // gardé par `matchState.phase === 'active'` dans `createMatchOnTick`). Corrige un vrai
    // déséquilibre observé : sans cette garde, une capacité de mobilité/dégâts (ex: le dash
    // offensif d'Ember) pouvait se déclencher PENDANT la phase d'achat, avant même que
    // l'entité n'ait d'arme, la précipitant dans une position exposée sans pouvoir se
    // défendre — voir le bilan de l'étape "rééquilibrage IA".
    const currentNavGrid = navGridGetter();
    if (matchStateBox.current.phase !== 'active') return;
    entityManager
      .getAllEntities()
      .filter((entity) => entity.status === 'alive' && entity.abilityLoadout)
      .forEach((entity) => {
        const agent = agentRegistry[entity.abilityLoadout!.agentId];
        if (!agent) return;

        const decisions = agent.decide({
          entity,
          allEntities: entityManager.getAllEntities(),
          mapData,
          navGrid: currentNavGrid,
          worldState: abilityWorldStateBox.current,
          tick,
          tickRate: config.tickRate,
        });

        decisions.forEach(({ definition, target }) => {
          const result = activateAbility(abilityWorldStateBox.current, entity, definition, target, {
            tick,
            tickRate: config.tickRate,
            mapData,
            allEntities: entityManager.getAllEntities(),
            eventBus,
          });
          if (!result) return;

          abilityWorldStateBox.current = result.worldState;
          if (result.selfChanges) entityManager.updateEntity(entity.id, result.selfChanges);
          if (result.targetChanges) entityManager.updateEntity(result.targetChanges.entityId, result.targetChanges.changes);
        });
      });
  };
}
