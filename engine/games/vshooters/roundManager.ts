import { createBotOnTick, getEngagingTarget } from '../../ai';
import { EntityManager, EventBus, TickContext } from '../../core';
import { EntityState, NavGrid, Point } from '../../types';
import { applyDamage, calculateDamage, isBehindTarget } from './damage';
import {
  DEVICE_DETONATION_BONUS,
  DEVICE_PLANT_BONUS,
  KILL_REWARD,
  ROUND_WIN_REWARD,
  clampMoney,
  getLossBonus,
} from './economy';
import { DeviceState, createDeviceState, updateDeviceTimers } from './device';
import { BLADE, HitZone, WEAPONS_BY_ID, Weapon } from './weapons';

export type RoundPhase = 'buy' | 'active' | 'ended';

export interface TeamRoundStats {
  wins: number;
  consecutiveLosses: number;
}

export type RoundEndReason = 'elimination' | 'device_defused' | 'device_detonated' | 'time_expired';

export interface RoundResult {
  winner: string;
  reason: RoundEndReason;
}

export interface MatchState {
  phase: RoundPhase;
  roundNumber: number;
  phaseStartTick: number;
  buyPhaseDurationTicks: number;
  roundDurationTicks: number;
  device: DeviceState;
  teamStats: Record<string, TeamRoundStats>;
  lastRoundResult: RoundResult | null;
}

export interface RoundManagerConfig {
  attackerTeam: string;
  defenderTeam: string;
  tickRate: number;
  /** Défaut 30s. */
  buyPhaseSeconds?: number;
  /** Défaut 100s (temps max pour poser la charge). */
  roundTimeSeconds?: number;
}

/** Boîte mutable : `runSimulation` ne renvoie que le journal des ticks, donc l'appelant
 * garde ici l'état de match évolutif entre les ticks (et le relit après coup). */
export interface MatchStateBox {
  current: MatchState;
}

const DEFAULT_BUY_PHASE_SECONDS = 30;
const DEFAULT_ROUND_TIME_SECONDS = 100;

function emptyTeamStats(): TeamRoundStats {
  return { wins: 0, consecutiveLosses: 0 };
}

export function createMatchState(config: RoundManagerConfig, initialDeviceCarrierId: string, startTick = 0): MatchState {
  return {
    phase: 'buy',
    roundNumber: 1,
    phaseStartTick: startTick,
    buyPhaseDurationTicks: Math.round((config.buyPhaseSeconds ?? DEFAULT_BUY_PHASE_SECONDS) * config.tickRate),
    roundDurationTicks: Math.round((config.roundTimeSeconds ?? DEFAULT_ROUND_TIME_SECONDS) * config.tickRate),
    device: createDeviceState(initialDeviceCarrierId),
    teamStats: {
      [config.attackerTeam]: emptyTeamStats(),
      [config.defenderTeam]: emptyTeamStats(),
    },
    lastRoundResult: null,
  };
}

export interface StartRoundOptions {
  entityManager: EntityManager;
  eventBus: EventBus;
  tick: number;
  spawns: Record<string, Point>;
  initialDeviceCarrierId: string;
}

/**
 * Démarre un nouveau round : réinitialise santé/statut/position/armure pour
 * toutes les entités. NE réinitialise PAS l'argent ni les armes (persistent
 * tant qu'elles ne sont pas rachetées) — l'armure, elle, doit être rachetée
 * chaque round, comme dans le vrai jeu.
 */
export function startNewRound(matchState: MatchState, options: StartRoundOptions): MatchState {
  const { entityManager, eventBus, tick, spawns, initialDeviceCarrierId } = options;

  entityManager.getAllEntities().forEach((entity) => {
    entityManager.updateEntity(entity.id, {
      health: 100,
      status: 'alive',
      position: spawns[entity.id] ?? entity.position,
      armor: 0,
      currentAction: null,
    });
  });

  eventBus.emit('round:started', { roundNumber: matchState.roundNumber + 1, tick });

  return {
    ...matchState,
    phase: 'buy',
    roundNumber: matchState.roundNumber + 1,
    phaseStartTick: tick,
    device: createDeviceState(initialDeviceCarrierId),
    lastRoundResult: null,
  };
}

export interface RoundContext {
  tick: number;
  entities: EntityState[];
  eventBus: EventBus;
}

function checkRoundEndCondition(matchState: MatchState, context: RoundContext, config: RoundManagerConfig): RoundResult | null {
  const alive = context.entities.filter((e) => e.status === 'alive');
  const attackersAlive = alive.some((e) => e.team === config.attackerTeam);
  const defendersAlive = alive.some((e) => e.team === config.defenderTeam);

  if (!attackersAlive) return { winner: config.defenderTeam, reason: 'elimination' };
  if (!defendersAlive) return { winner: config.attackerTeam, reason: 'elimination' };

  if (matchState.device.status === 'defused') return { winner: config.defenderTeam, reason: 'device_defused' };
  if (matchState.device.status === 'detonated') return { winner: config.attackerTeam, reason: 'device_detonated' };

  if (matchState.device.status === 'carried') {
    const elapsed = context.tick - matchState.phaseStartTick;
    if (elapsed >= matchState.roundDurationTicks) {
      return { winner: config.defenderTeam, reason: 'time_expired' };
    }
  }
  // Charge planted/defusing : pas de limite de temps propre au round, le timer de détonation gère déjà la fin.

  return null;
}

/**
 * Calcule la transition de phase du round courant (buy -> active -> ended).
 * Une fois "ended", n'agit plus : attend un `startNewRound` explicite de l'appelant.
 */
export function advanceRound(matchState: MatchState, context: RoundContext, config: RoundManagerConfig): MatchState {
  if (matchState.phase === 'buy') {
    if (context.tick - matchState.phaseStartTick >= matchState.buyPhaseDurationTicks) {
      context.eventBus.emit('round:phase-changed', { from: 'buy', to: 'active', tick: context.tick });
      return { ...matchState, phase: 'active', phaseStartTick: context.tick };
    }
    return matchState;
  }

  if (matchState.phase === 'active') {
    const result = checkRoundEndCondition(matchState, context, config);
    if (result) {
      context.eventBus.emit('round:ended', { winner: result.winner, reason: result.reason, tick: context.tick });
      return { ...matchState, phase: 'ended', lastRoundResult: result, phaseStartTick: context.tick };
    }
    return matchState;
  }

  return matchState;
}

/**
 * Distribue l'argent de fin de round (victoire/défaite, loss bonus progressif,
 * bonus de charge). Les récompenses de kill sont créditées en direct pendant le
 * round (voir `createMatchOnTick`), pas ici.
 */
export function applyRoundEndEconomy(
  matchState: MatchState,
  result: RoundResult,
  config: RoundManagerConfig,
  entityManager: EntityManager,
): Record<string, TeamRoundStats> {
  const losingTeam = result.winner === config.attackerTeam ? config.defenderTeam : config.attackerTeam;

  const previousWinStats = matchState.teamStats[result.winner] ?? emptyTeamStats();
  const previousLoseStats = matchState.teamStats[losingTeam] ?? emptyTeamStats();
  const newLoseConsecutive = previousLoseStats.consecutiveLosses + 1;
  const lossBonus = getLossBonus(newLoseConsecutive);

  const teamStats: Record<string, TeamRoundStats> = {
    ...matchState.teamStats,
    [result.winner]: { wins: previousWinStats.wins + 1, consecutiveLosses: 0 },
    [losingTeam]: { wins: previousLoseStats.wins, consecutiveLosses: newLoseConsecutive },
  };

  const deviceWasPlanted = matchState.device.plantedAt !== null;

  entityManager.getAllEntities().forEach((entity) => {
    const isWinner = entity.team === result.winner;
    let reward = isWinner ? ROUND_WIN_REWARD : lossBonus;

    if (!isWinner && entity.team === config.attackerTeam && deviceWasPlanted && result.reason !== 'device_detonated') {
      reward += DEVICE_PLANT_BONUS;
    }
    if (isWinner && result.reason === 'device_detonated') {
      reward += DEVICE_DETONATION_BONUS;
    }

    entityManager.updateEntity(entity.id, { money: clampMoney((entity.money ?? 0) + reward) });
  });

  return teamStats;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const BASE_ACCURACY = 0.85;
const ACCURACY_FALLOFF_PER_UNIT = 0.002;
const MIN_ACCURACY = 0.1;

function rollAccuracy(dist: number): boolean {
  const accuracy = Math.max(MIN_ACCURACY, BASE_ACCURACY - dist * ACCURACY_FALLOFF_PER_UNIT);
  return Math.random() < accuracy;
}

function rollHitZone(): HitZone {
  const roll = Math.random();
  if (roll < 0.15) return 'head';
  if (roll < 0.85) return 'body';
  return 'leg';
}

/**
 * Mélange en place (Fisher-Yates). Utilisé pour l'ordre de résolution des tirs
 * du tick : `EntityManager.getAllEntities()` renvoie les entités dans leur
 * ordre d'INSERTION, toujours le même — sans mélange, l'équipe insérée en
 * premier tirerait systématiquement avant l'autre à chaque tick, avec un
 * avantage structurel dans les échanges mutuellement fatals (l'entité traitée
 * en premier tue avant que l'autre n'ait sa chance de riposter CE tick-là).
 */
function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Getter générique de multiplicateur de cadence de tir : `roundManager.ts` ne
 * connaît pas les capacités, ce hook lui permet d'en tenir compte sans créer
 * de dépendance vers `abilities/` (même principe que le `NavGrid` dynamique
 * ci-dessous). Retourne 1 (aucun effet) si non fourni par l'appelant.
 */
export type FireRateMultiplierGetter = (entity: EntityState, tick: number) => number;

/**
 * Getter générique de multiplicateur de dégâts (attaquant ET cible combinés,
 * ex: Finisher Mark de l'Ember amplifie les dégâts SUBIS par sa cible marquée,
 * Phantom Assault de Vesper amplifie les dégâts INFLIGÉS par le porteur) —
 * même principe que `FireRateMultiplierGetter` : `roundManager.ts` ne connaît
 * pas les capacités, ce hook lui permet d'en tenir compte sans dépendance vers
 * `abilities/`. Retourne 1 (aucun effet) si non fourni par l'appelant.
 */
export type DamageMultiplierGetter = (shooter: EntityState, target: EntityState, tick: number) => number;

/**
 * Résolution d'un tir simple : jet de précision basé sur la distance, puis zone
 * touchée et dégâts via `damage.ts`. Pas de système de visée pixel-perfect.
 * Relit `shooterId`/target depuis l'EntityManager à chaque appel (pas de valeurs
 * mises en cache) pour rester correct si une entité vient d'être tuée plus tôt
 * dans le même tick.
 */
function resolveShot(
  shooterId: string,
  entityManager: EntityManager,
  eventBus: EventBus,
  tick: number,
  tickRate: number,
  lastShotTick: Map<string, number>,
  getFireRateMultiplier?: FireRateMultiplierGetter,
  getDamageMultiplier?: DamageMultiplierGetter,
): void {
  const shooter = entityManager.getEntity(shooterId);
  if (!shooter || shooter.status !== 'alive' || shooter.currentAction !== 'engaging') return;

  const targetId = getEngagingTarget(shooter.id);
  if (!targetId) return;

  const target = entityManager.getEntity(targetId);
  if (!target || target.status !== 'alive') return;

  const weapon: Weapon = (shooter.equippedWeaponId && WEAPONS_BY_ID[shooter.equippedWeaponId]) || BLADE;

  // Cadence effective = cadence de base * modificateur d'effets actifs (ex: Overdrive Beacon).
  const fireRateMultiplier = getFireRateMultiplier ? getFireRateMultiplier(shooter, tick) : 1;
  const effectiveFireRate = weapon.fireRatePerSecond * fireRateMultiplier;
  const ticksPerShot = Math.max(1, Math.round(tickRate / effectiveFireRate));
  const lastTick = lastShotTick.get(shooter.id) ?? -Infinity;
  if (tick - lastTick < ticksPerShot) return;

  const currentAmmo = shooter.currentAmmo ?? weapon.magazineSize;
  if (weapon.magazineSize !== Infinity && currentAmmo <= 0) return; // chargeur vide, pas de rechargement modélisé ici

  lastShotTick.set(shooter.id, tick);
  if (weapon.magazineSize !== Infinity) {
    entityManager.updateEntity(shooter.id, { currentAmmo: currentAmmo - 1 });
  }

  const dist = distance(shooter.position, target.position);

  if (!rollAccuracy(dist)) {
    eventBus.emit('combat:shot-missed', { shooterId: shooter.id, targetId: target.id, weaponId: weapon.id, tick });
    return;
  }

  const hitZone = rollHitZone();
  const backstab = weapon.id === 'blade' && isBehindTarget(target, shooter.position);
  // Dégâts effectifs = dégâts de base (armure/backstab déjà appliqués) * modificateur
  // d'effets actifs (ex: Finisher Mark sur la cible, Phantom Assault sur le tireur).
  const damageMultiplier = getDamageMultiplier ? getDamageMultiplier(shooter, target, tick) : 1;
  const damage = calculateDamage(weapon, hitZone, dist, target.armor ?? 0, backstab) * damageMultiplier;

  eventBus.emit('combat:shot-hit', {
    shooterId: shooter.id,
    targetId: target.id,
    weaponId: weapon.id,
    hitZone,
    damage: Math.round(damage),
    tick,
  });

  const changes = applyDamage(target, damage, { killerId: shooter.id, weaponId: weapon.id, hitZone }, eventBus);
  entityManager.updateEntity(target.id, changes);
}

/**
 * Compose le `onTick` complet des règles du moteur (gunplay + économie + round + charge) :
 * réutilise `createBotOnTick` tel quel pour le mouvement/la détection (aucune
 * duplication de botController), résout les tirs des bots "engaging" pendant la
 * phase active, fait avancer les timers de la charge, crédite l'argent de kill en
 * direct, et fait avancer les phases de round. Ne modifie pas `engine/core/`.
 *
 * `navGrid` accepte aussi une fonction `() => NavGrid`, résolue à CHAQUE tick :
 * permet à un appelant (ex: abilities/integration.ts) de fournir une grille
 * patchée dynamiquement (murs/effets d'ability temporaires) sans dupliquer cette
 * fonction ni modifier `createBotOnTick`. `getFireRateMultiplier` (optionnel,
 * même principe) permet de faire varier la cadence de tir effective (ex:
 * `abilities/integration.ts#getStatModifier`) sans que ce fichier n'ait besoin
 * de connaître les capacités. `getDamageMultiplier` (optionnel, même principe)
 * fait de même pour les dégâts d'un tir (ex: Finisher Mark, Phantom Assault).
 */
export function createMatchOnTick(
  navGrid: NavGrid | (() => NavGrid),
  matchStateBox: MatchStateBox,
  config: RoundManagerConfig,
  getFireRateMultiplier?: FireRateMultiplierGetter,
  getDamageMultiplier?: DamageMultiplierGetter,
): (context: TickContext) => void {
  const lastShotTick = new Map<string, number>();
  let killRewardSubscribed = false;

  return (context: TickContext) => {
    const { tick, entityManager, eventBus } = context;
    const botOnTick = createBotOnTick(typeof navGrid === 'function' ? navGrid() : navGrid);

    if (!killRewardSubscribed) {
      killRewardSubscribed = true;
      eventBus.on('player:killed', (data) => {
        const { killerId } = data as { killerId: string };
        const killer = entityManager.getEntity(killerId);
        if (!killer) return;
        entityManager.updateEntity(killerId, { money: clampMoney((killer.money ?? 0) + KILL_REWARD) });
      });
    }

    botOnTick(context);

    let matchState = matchStateBox.current;

    if (matchState.phase === 'active') {
      shuffleInPlace(
        entityManager
          .getAllEntities()
          .filter((entity) => entity.status === 'alive' && entity.currentAction === 'engaging')
          .map((entity) => entity.id),
      ).forEach((shooterId) => resolveShot(shooterId, entityManager, eventBus, tick, config.tickRate, lastShotTick, getFireRateMultiplier, getDamageMultiplier));

      matchState = { ...matchState, device: updateDeviceTimers(matchState.device, tick, eventBus) };
    }

    const previousPhase = matchState.phase;
    matchState = advanceRound(matchState, { tick, entities: entityManager.getAllEntities(), eventBus }, config);

    // Distribution de l'argent de fin de round : doit se faire ICI (dans le tick),
    // car `entityManager` n'existe plus une fois `runSimulation` terminé — l'appelant
    // ne peut relire l'état de match qu'après coup (via `matchStateBox`).
    if (previousPhase !== 'ended' && matchState.phase === 'ended' && matchState.lastRoundResult) {
      const teamStats = applyRoundEndEconomy(matchState, matchState.lastRoundResult, config, entityManager);
      matchState = { ...matchState, teamStats };
    }

    matchStateBox.current = matchState;
  };
}
