/**
 * Agrégation de statistiques de performance par joueur sur un match complet,
 * pour alimenter la couche "management" (progression/forme/valeur d'un
 * joueur). Observateur PUR : écoute le bus d'événements via `eventBus.onAny`
 * pendant toute la durée du match, n'émet jamais rien lui-même et ne modifie
 * aucune logique de `matchManager.ts`/`roundManager.ts`/`abilities/`/
 * `device.ts` — il les enveloppe (`trackMatchStats` appelle `runFullMatch`
 * tel quel).
 *
 * Nuance sur "s'abonne AVANT de lancer la simulation" : le `EventBus` réel
 * n'existe qu'à l'INTÉRIEUR de `runFullMatch` (créé par `runSimulation`), pas
 * accessible depuis l'extérieur avant l'appel. L'abonnement `onAny` se fait
 * donc au tout premier tick reçu via le hook `onTick` déjà exposé par
 * `runFullMatch` (même pattern que les gardes `killSubscribed`/
 * `killRewardSubscribed` déjà utilisées dans `roundManager.ts`/
 * `matchManager.ts`) — c'est la première occasion réelle d'obtenir une
 * référence au bus, et cela reste un abonnement `onAny` pur, rien d'autre.
 */
import { EntityState, MapData } from '../../types';
import {
  FullMatchState,
  RoundHistoryEntry,
  RunFullMatchConfig,
  RunFullMatchOutcome,
  RunFullMatchTeamSetup,
  runFullMatch,
} from './matchManager';

export interface PlayerMatchStats {
  entityId: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  /** Tirs résolus (touchés + manqués) via `resolveShot` — uniquement le gunplay, voir le gap documenté plus bas pour les dégâts d'ability. */
  shotsFired: number;
  shotsHit: number;
  /** Dégâts de tir (gunplay) uniquement — voir "Gaps documentés" dans le README : les dégâts au tick des capacités (damageOverTime) ne sont pas comptés ici. */
  damageDealt: number;
  damageTaken: number;
  clutchRoundsWon: number;
  firstBloods: number;
  /** Compte d'activations par capacité (clé = `abilityId`, ex: "ember_flare_dash"). */
  abilitiesUsed: Record<string, number>;
  devicePlants: number;
  deviceDefuses: number;
  /** Déduit des baisses de `money` observées via "entity:updated" (voir le README : aucun événement d'achat n'existe, cette inférence est justifiée par l'invariant "seuls les achats font baisser l'argent"). */
  moneySpent: number;
}

function emptyPlayerStats(entityId: string, team: string): PlayerMatchStats {
  return {
    entityId,
    team,
    kills: 0,
    deaths: 0,
    assists: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    damageTaken: 0,
    clutchRoundsWon: 0,
    firstBloods: 0,
    abilitiesUsed: {},
    devicePlants: 0,
    deviceDefuses: 0,
    moneySpent: 0,
  };
}

/** Fenêtre après laquelle des dégâts antérieurs ne comptent plus pour un assist. 3s à 30 tick/s = 90 ticks ; ajustable. */
function assistWindowTicks(tickRate: number): number {
  return Math.round(tickRate * 3);
}
/** Dégâts cumulés minimum (d'un même coéquipier, hors le tueur) dans la fenêtre pour qu'un assist soit crédité — environ un tiers de la vie d'une cible non protégée. */
const ASSIST_MIN_DAMAGE = 40;

interface DamageLogEntry {
  shooterId: string;
  tick: number;
  damage: number;
}

interface ClutchCandidate {
  survivorId: string;
  team: string;
}

export interface StatsAccumulator {
  playerStats: Map<string, PlayerMatchStats>;
  /**
   * À appeler pour chaque événement du bus, avec le tick auquel il s'est
   * produit (nécessaire pour la fenêtre d'assist — `player:killed` ne porte
   * pas de tick dans son payload réel, voir la note dans `trackMatchStats`).
   */
  handleEvent(type: string, data: unknown, tick: number): void;
  /**
   * À appeler dès qu'on détecte que le round courant a changé, AVEC
   * `roundHistory` à jour (contenant déjà le round qui vient de se
   * conclure) : finalise le clutch du round précédent, puis réinitialise le
   * suivi propre-au-round (premier sang, vivants par équipe) pour le nouveau.
   */
  setCurrentRound(roundNumber: number, roundHistory: RoundHistoryEntry[]): void;
  /** À appeler une fois le match terminé : aucun "round suivant" ne viendra jamais déclencher `setCurrentRound` pour finaliser le clutch du DERNIER round joué. */
  finalizeLastRound(roundHistory: RoundHistoryEntry[]): void;
}

/**
 * Cœur de l'accumulation de stats, extrait de `trackMatchStats` pour être
 * testable en isolation (voir `test-stats-run.ts`) : piloté par des
 * événements fabriqués à la main avec des ticks choisis, sans dépendre du
 * hasard d'un vrai match simulé — même esprit que les tests déterministes
 * d'`advanceMatch` dans `test-match-run.ts`. `trackMatchStats` s'en sert en
 * conditions réelles, en pilotant `handleEvent`/`setCurrentRound` depuis
 * `eventBus.onAny` + le hook `onTick` de `runFullMatch`.
 */
export function createStatsAccumulator(entities: { id: string; team: string; money?: number }[], tickRate: number): StatsAccumulator {
  const playerStats = new Map<string, PlayerMatchStats>();
  const teamOf = new Map<string, string>();
  entities.forEach((e) => {
    playerStats.set(e.id, emptyPlayerStats(e.id, e.team));
    teamOf.set(e.id, e.team);
  });

  const windowTicks = assistWindowTicks(tickRate);

  let firstBloodClaimedThisRound = false;
  let aliveByTeam = new Map<string, Set<string>>();
  function resetAliveSets(): void {
    aliveByTeam = new Map();
    entities.forEach((e) => {
      if (!aliveByTeam.has(e.team)) aliveByTeam.set(e.team, new Set());
      aliveByTeam.get(e.team)!.add(e.id);
    });
  }
  resetAliveSets();

  let clutchCandidate: ClutchCandidate | null = null;
  const recentDamageLog = new Map<string, DamageLogEntry[]>();
  const lastKnownMoney = new Map<string, number>();
  entities.forEach((e) => lastKnownMoney.set(e.id, e.money ?? 0));
  let lastDefuserEntityId: string | null = null;

  /** Évalue le clutch éventuel du round qui vient de se conclure. */
  function finalizeRoundClutch(concludedRoundNumber: number, roundHistory: RoundHistoryEntry[]): void {
    if (!clutchCandidate) return;
    const entry = roundHistory.find((h) => h.roundNumber === concludedRoundNumber);
    if (entry && entry.winner === clutchCandidate.team) {
      const stats = playerStats.get(clutchCandidate.survivorId);
      if (stats) stats.clutchRoundsWon += 1;
    }
  }

  let currentRoundNumber = 1;

  function handleEvent(type: string, data: unknown, tick: number): void {
    switch (type) {
      case 'combat:shot-hit': {
        const d = data as { shooterId: string; targetId: string; damage: number };
        const shooter = playerStats.get(d.shooterId);
        const target = playerStats.get(d.targetId);
        if (shooter) {
          shooter.shotsFired += 1;
          shooter.shotsHit += 1;
          shooter.damageDealt += d.damage;
        }
        if (target) target.damageTaken += d.damage;
        if (!recentDamageLog.has(d.targetId)) recentDamageLog.set(d.targetId, []);
        recentDamageLog.get(d.targetId)!.push({ shooterId: d.shooterId, tick, damage: d.damage });
        break;
      }
      case 'combat:shot-missed': {
        const d = data as { shooterId: string };
        const shooter = playerStats.get(d.shooterId);
        if (shooter) shooter.shotsFired += 1;
        break;
      }
      case 'player:killed': {
        const d = data as { killerId: string; victimId: string; hitZone: string };
        const killer = playerStats.get(d.killerId);
        const victim = playerStats.get(d.victimId);
        if (killer && d.killerId !== d.victimId) {
          killer.kills += 1;
          if (d.hitZone === 'head') killer.headshots += 1;
          if (!firstBloodClaimedThisRound) {
            firstBloodClaimedThisRound = true;
            killer.firstBloods += 1;
          }
        }
        if (victim) victim.deaths += 1;

        // --- Assists : coéquipiers du tueur (hors tueur) ayant infligé des dégâts significatifs récents à la victime ---
        const killerTeam = teamOf.get(d.killerId);
        const log = recentDamageLog.get(d.victimId) ?? [];
        const contributionByShooter = new Map<string, number>();
        log.forEach((entry) => {
          if (entry.shooterId === d.killerId) return;
          if (teamOf.get(entry.shooterId) !== killerTeam) return;
          if (tick - entry.tick > windowTicks) return;
          contributionByShooter.set(entry.shooterId, (contributionByShooter.get(entry.shooterId) ?? 0) + entry.damage);
        });
        contributionByShooter.forEach((totalDamage, shooterId) => {
          if (totalDamage < ASSIST_MIN_DAMAGE) return;
          const assister = playerStats.get(shooterId);
          if (assister) assister.assists += 1;
        });
        recentDamageLog.delete(d.victimId);

        // --- Suivi des vivants par équipe (clutch) ---
        const victimTeam = teamOf.get(d.victimId);
        if (victimTeam) {
          aliveByTeam.get(victimTeam)?.delete(d.victimId);
          const remaining = aliveByTeam.get(victimTeam);
          const otherTeamName = [...aliveByTeam.keys()].find((t) => t !== victimTeam);
          const otherAlive = otherTeamName ? aliveByTeam.get(otherTeamName)!.size : 0;
          if (!clutchCandidate && remaining && remaining.size === 1 && otherAlive >= 1) {
            clutchCandidate = { survivorId: [...remaining][0], team: victimTeam };
          }
        }
        break;
      }
      case 'ability:activated': {
        const d = data as { entityId: string; abilityId: string };
        const stats = playerStats.get(d.entityId);
        if (stats) stats.abilitiesUsed[d.abilityId] = (stats.abilitiesUsed[d.abilityId] ?? 0) + 1;
        break;
      }
      case 'device:planted': {
        const d = data as { entityId: string };
        const stats = playerStats.get(d.entityId);
        if (stats) stats.devicePlants += 1;
        break;
      }
      case 'device:defusing': {
        const d = data as { entityId: string };
        lastDefuserEntityId = d.entityId;
        break;
      }
      case 'device:defused': {
        if (lastDefuserEntityId) {
          const stats = playerStats.get(lastDefuserEntityId);
          if (stats) stats.deviceDefuses += 1;
          lastDefuserEntityId = null;
        }
        break;
      }
      case 'entity:updated': {
        // Aucun événement d'achat n'existe dans economy.ts (`buyItem` est pur, sans effet
        // de bord) : on infère la dépense depuis la baisse de `money` observée ici. Sûr
        // car dans ce moteur SEUL un achat fait baisser l'argent (kills/victoires/loss
        // bonus ne font que l'augmenter) — voir le README pour la justification complète.
        const d = data as EntityState;
        if (d.money === undefined || !playerStats.has(d.id)) break;
        const previous = lastKnownMoney.get(d.id) ?? d.money;
        if (d.money < previous) {
          const stats = playerStats.get(d.id)!;
          stats.moneySpent += previous - d.money;
        }
        lastKnownMoney.set(d.id, d.money);
        break;
      }
      default:
        break;
    }
  }

  return {
    playerStats,
    handleEvent,
    setCurrentRound(roundNumber, roundHistory) {
      if (roundNumber === currentRoundNumber) return;
      finalizeRoundClutch(currentRoundNumber, roundHistory);
      currentRoundNumber = roundNumber;
      firstBloodClaimedThisRound = false;
      clutchCandidate = null;
      resetAliveSets();
    },
    finalizeLastRound(roundHistory) {
      finalizeRoundClutch(currentRoundNumber, roundHistory);
    },
  };
}

/**
 * Enveloppe `runFullMatch` : lance le même match (aucune règle dupliquée),
 * observe passivement tous les événements pertinents via `eventBus.onAny`, et
 * retourne l'état de match final accompagné des statistiques par joueur.
 *
 * Note sur le tick des événements : `eventBus.onAny` ne fournit que
 * `(type, payload)`, jamais le tick courant, et `player:killed` ne porte pas
 * de tick dans son payload réel (voir `damage.ts#applyDamage`). Les
 * événements sont donc bufferisés le temps du tick (via `onAny`), puis
 * "drainés" et horodatés avec `context.tick` dans le hook `onTick` déjà
 * exposé par `runFullMatch` (appelé une fois par tick, APRÈS que les
 * événements de ce tick aient été émis) — même principe que `runSimulation`
 * qui fait exactly ceci pour construire son propre journal de `SimulationTick`.
 * Le numéro de round est lu la même façon : `roundStateBox.current.roundNumber`
 * n'est mis à jour par `runFullMatch` qu'APRÈS avoir appelé ce hook, donc il
 * reflète encore correctement le round auquel appartiennent les événements
 * bufferisés ce tick, jusqu'à ce qu'on le relise au tick SUIVANT la transition.
 */
export function trackMatchStats(
  mapData: MapData,
  teamASetup: RunFullMatchTeamSetup,
  teamBSetup: RunFullMatchTeamSetup,
  config: RunFullMatchConfig,
): { matchState: FullMatchState; playerStats: Map<string, PlayerMatchStats> } {
  const allEntities: EntityState[] = [...teamASetup.entities, ...teamBSetup.entities];
  const accumulator = createStatsAccumulator(allEntities, config.tickRate ?? 30);

  let subscribed = false;
  let pendingEvents: { type: string; data: unknown }[] = [];

  const outerOnTick = config.onTick;
  // Reçoit et relaie le 4e paramètre (`abilityWorldStateBox`, ajout rétrocompatible de
  // matchManager.ts) même si statsTracker.ts ne s'en sert pas lui-même — nécessaire pour
  // qu'un observateur en aval (ex: `replayRecorder.ts`, qui enveloppe `trackMatchStats`)
  // continue d'y avoir accès sans dupliquer la capture d'état.
  const onTick: RunFullMatchConfig['onTick'] = (context, roundStateBox, fullMatchState, abilityWorldStateBox) => {
    const { eventBus, tick } = context;

    if (!subscribed) {
      subscribed = true;
      eventBus.onAny((type, data) => {
        pendingEvents.push({ type, data });
      });
    }

    accumulator.setCurrentRound(roundStateBox.current.roundNumber, fullMatchState.roundHistory);

    const eventsThisTick = pendingEvents;
    pendingEvents = [];
    eventsThisTick.forEach(({ type, data }) => accumulator.handleEvent(type, data, tick));

    outerOnTick?.(context, roundStateBox, fullMatchState, abilityWorldStateBox);
  };

  const outcome: RunFullMatchOutcome = runFullMatch(mapData, teamASetup, teamBSetup, { ...config, onTick });

  // Le tout dernier round joué ne déclenche jamais `setCurrentRound` ci-dessus
  // (aucun round suivant ne démarre pour le signaler) : on finalise son clutch explicitement.
  accumulator.finalizeLastRound(outcome.matchState.roundHistory);

  return { matchState: outcome.matchState, playerStats: accumulator.playerStats };
}

/**
 * Formule de MVP simple et VOLONTAIREMENT ajustable (voir `MVP_WEIGHTS`) :
 * les kills pèsent le plus (x2, l'objectif premier du jeu), les clutchs sont
 * valorisés fortement (x3, une performance rare qui gagne un round à elle
 * seule), les assists comptent mais moins qu'un kill (x1), les headshots et
 * first bloods ajoutent un bonus de skill/impact (x0.5 / x1), et les dégâts
 * bruts (gunplay uniquement, voir le gap documenté) sont inclus à faible
 * poids pour départager les égalités sans dominer le score.
 */
export const MVP_WEIGHTS = {
  kill: 2,
  assist: 1,
  clutchRoundWon: 3,
  headshot: 0.5,
  firstBlood: 1,
  damageDealtPer100: 1,
};

export function mvpScore(stats: PlayerMatchStats): number {
  return (
    stats.kills * MVP_WEIGHTS.kill +
    stats.assists * MVP_WEIGHTS.assist +
    stats.clutchRoundsWon * MVP_WEIGHTS.clutchRoundWon +
    stats.headshots * MVP_WEIGHTS.headshot +
    stats.firstBloods * MVP_WEIGHTS.firstBlood +
    (stats.damageDealt / 100) * MVP_WEIGHTS.damageDealtPer100
  );
}

/** Retourne l'id de l'entité au score de MVP le plus élevé (voir `mvpScore`/`MVP_WEIGHTS`). */
export function calculateMVP(playerStats: Map<string, PlayerMatchStats>, _matchState: FullMatchState): string {
  let bestId = '';
  let bestScore = -Infinity;
  playerStats.forEach((stats, entityId) => {
    const score = mvpScore(stats);
    if (score > bestScore) {
      bestScore = score;
      bestId = entityId;
    }
  });
  return bestId;
}

export interface MatchReportPlayerRow extends PlayerMatchStats {
  accuracy: number | null;
  killsPerRound: number;
}

export interface MatchReport {
  matchId: string;
  mapId: string;
  finalScore: Record<string, number>;
  winner: string | null;
  totalRounds: number;
  mvp: { entityId: string; score: number } | null;
  topFragger: { entityId: string; kills: number } | null;
  bestClutcher: { entityId: string; clutchRoundsWon: number } | null;
  /** Trié par kills décroissants. */
  playerRows: MatchReportPlayerRow[];
}

/**
 * Résumé structuré et lisible du match : score final, MVP (avec son score),
 * top fragger, meilleur "clutcher", et une ligne de stats par joueur (avec
 * précision et kills/round dérivés, jamais stockés en dur sur
 * `PlayerMatchStats` pour éviter une donnée dupliquée/périmée).
 */
export function formatMatchReport(matchState: FullMatchState, playerStats: Map<string, PlayerMatchStats>): MatchReport {
  const totalRounds = matchState.roundHistory.length;
  const mvpId = calculateMVP(playerStats, matchState);
  const mvpStats = playerStats.get(mvpId);

  const playerRows: MatchReportPlayerRow[] = [...playerStats.values()]
    .map((stats) => ({
      ...stats,
      accuracy: stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : null,
      killsPerRound: totalRounds > 0 ? stats.kills / totalRounds : 0,
    }))
    .sort((a, b) => b.kills - a.kills);

  const topFraggerRow = playerRows[0] ?? null;
  const bestClutcherRow = [...playerRows].sort((a, b) => b.clutchRoundsWon - a.clutchRoundsWon)[0] ?? null;

  return {
    matchId: matchState.matchId,
    mapId: matchState.mapId,
    finalScore: { [matchState.teamA.name]: matchState.teamA.roundsWon, [matchState.teamB.name]: matchState.teamB.roundsWon },
    winner: matchState.winner,
    totalRounds,
    mvp: mvpStats ? { entityId: mvpId, score: mvpScore(mvpStats) } : null,
    topFragger: topFraggerRow ? { entityId: topFraggerRow.entityId, kills: topFraggerRow.kills } : null,
    bestClutcher:
      bestClutcherRow && bestClutcherRow.clutchRoundsWon > 0
        ? { entityId: bestClutcherRow.entityId, clutchRoundsWon: bestClutcherRow.clutchRoundsWon }
        : null,
    playerRows,
  };
}
