/**
 * Orchestration d'un MATCH complet (série de rounds), au-dessus de
 * `roundManager.ts` qui ne gère qu'UN round isolé (buy -> active -> ended).
 * `matchManager.ts` ne réimplémente AUCUNE règle de round/économie/charge :
 * il appelle `roundManager.ts`/`economy.ts`/`device.ts` au bon moment
 * (nouveau round, distribution d'argent, reset des charges/effets) et ajoute
 * la couche par-dessus : score de série, mi-temps (échange de camp),
 * overtime, historique.
 *
 * Note de nommage : le type d'état d'UN round s'appelle déjà `MatchState`
 * dans `roundManager.ts`. Pour éviter toute collision, l'état du match
 * COMPLET s'appelle ici `FullMatchState` ; le round en cours reste accessible
 * via `MatchStateBox['current']` (réutilisé tel quel, jamais réimporté sous
 * un autre nom puisqu'il n'est jamais référencé comme type autonome ici).
 */
import { buildNavGrid, resetBotMemories } from '../../ai';
import { EntityManager, EventBus, TickContext, runSimulation } from '../../core';
import { EntityState, MapData, Point, SimulationTick } from '../../types';
import {
  AbilityWorldStateBox,
  AgentDefinition,
  createAgentAbilitiesOnTick,
  createEmptyAbilityWorldState,
  resetAbilityChargesForNewRound,
} from './abilities/integration';
import { DEVICE_DEFUSE_SECONDS } from './device';
import {
  MatchStateBox,
  RoundEndReason,
  RoundManagerConfig,
  RoundResult,
  createMatchOnTick,
  createMatchState,
  startNewRound,
} from './roundManager';

export type MatchPhase = 'round' | 'halftime' | 'overtime' | 'finished';

export interface TeamState {
  name: string;
  entityIds: string[];
  roundsWon: number;
}

export interface RoundHistoryEntry {
  roundNumber: number;
  segment: 'regulation' | 'overtime';
  winner: string;
  reason: RoundEndReason;
  durationTicks: number;
  attackerTeam: string;
  defenderTeam: string;
  /** Nombre d'éliminations survenues pendant ce round (résumé des "événements clés"). */
  killCount: number;
  /** Score cumulé (rounds gagnés) de chaque équipe APRÈS ce round. */
  scoreAfter: Record<string, number>;
  /**
   * Argent total (somme des joueurs) de chaque équipe APRÈS la distribution de
   * fin de round. C'est ici que se vérifie la conservation de l'argent à la
   * mi-temps (economy.ts ne journalise pas les achats individuels — voir la
   * note sur `TeamState` plus haut : ce total suffit à suivre la richesse
   * cumulée sans dupliquer economy.ts).
   */
  moneyAfter: Record<string, number>;
}

export interface OvertimeFormatConfig {
  /**
   * Taille d'une "mini-manche" d'overtime, en rounds. Ne borne PAS quand la
   * victoire peut être déclarée (la condition d'écart est vérifiée après
   * CHAQUE round d'OT, pas seulement en fin de mini-manche) — sert surtout de
   * repère de journalisation/rythme, cohérent avec l'esprit "manches
   * supplémentaires de N rounds". Défaut 3.
   */
  roundsPerMiniMatch: number;
  /** Écart de victoires d'OT (cumulées, PAS remises à zéro entre mini-manches) nécessaire pour clore le match. Défaut 2. */
  winMargin: number;
  /** Nombre de rounds d'OT après lesquels les camps s'échangent. Défaut 1 (échange à chaque round, comme le format d'overtime réel du jeu de référence : chaque équipe attaque puis défend, en alternance). */
  sideSwitchEveryRounds: number;
}

export interface MatchFormatConfig {
  /** Rounds gagnants requis pour remporter le temps réglementaire. Défaut 13 (bo25 classique). */
  roundsToWinRegulation: number;
  /** Numéro du round après lequel intervient la mi-temps. Défaut 12 (pour un format à 13). */
  halftimeAfterRound: number;
  overtime: OvertimeFormatConfig;
}

export const DEFAULT_MATCH_FORMAT: MatchFormatConfig = {
  roundsToWinRegulation: 13,
  halftimeAfterRound: 12,
  overtime: { roundsPerMiniMatch: 3, winMargin: 2, sideSwitchEveryRounds: 1 },
};

export interface FullMatchState {
  matchId: string;
  mapId: string;
  teamA: TeamState;
  teamB: TeamState;
  format: MatchFormatConfig;
  /** Numéro du round EN COURS ou du prochain à démarrer (1-based, continu à travers mi-temps ET overtime). */
  currentRoundNumber: number;
  currentPhase: MatchPhase;
  /** Nom de l'équipe (teamA.name ou teamB.name) actuellement attaquante / défenseuse. Échangé à la mi-temps et selon `overtime.sideSwitchEveryRounds`. */
  attackingTeam: string;
  defendingTeam: string;
  roundHistory: RoundHistoryEntry[];
  /**
   * Victoires d'OT par équipe, DISTINCTES de `teamX.roundsWon` (qui continue
   * d'incrémenter en OT aussi, pour un score total affichable classique du
   * genre "16-14") — `otWins` ne sert qu'à la condition d'écart de victoire de
   * l'overtime, remise à {} à l'entrée en overtime.
   */
  otWins: Record<string, number>;
  otRoundsPlayed: number;
  /** Nom de l'équipe gagnante, non-null seulement une fois `currentPhase === 'finished'`. */
  winner: string | null;
}

function emptyTeamState(name: string, entityIds: string[]): TeamState {
  return { name, entityIds, roundsWon: 0 };
}

export interface CreateFullMatchStateOptions {
  matchId: string;
  mapId: string;
  teamA: { name: string; entityIds: string[] };
  teamB: { name: string; entityIds: string[] };
  /** Équipe qui commence attaquante. Défaut teamA. */
  startingAttacker?: string;
  format?: Partial<Omit<MatchFormatConfig, 'overtime'>> & { overtime?: Partial<OvertimeFormatConfig> };
}

export function createFullMatchState(options: CreateFullMatchStateOptions): FullMatchState {
  const format: MatchFormatConfig = {
    roundsToWinRegulation: options.format?.roundsToWinRegulation ?? DEFAULT_MATCH_FORMAT.roundsToWinRegulation,
    halftimeAfterRound: options.format?.halftimeAfterRound ?? DEFAULT_MATCH_FORMAT.halftimeAfterRound,
    overtime: { ...DEFAULT_MATCH_FORMAT.overtime, ...options.format?.overtime },
  };
  const attackingTeam = options.startingAttacker ?? options.teamA.name;
  const defendingTeam = attackingTeam === options.teamA.name ? options.teamB.name : options.teamA.name;

  return {
    matchId: options.matchId,
    mapId: options.mapId,
    teamA: emptyTeamState(options.teamA.name, options.teamA.entityIds),
    teamB: emptyTeamState(options.teamB.name, options.teamB.entityIds),
    format,
    currentRoundNumber: 1,
    currentPhase: 'round',
    attackingTeam,
    defendingTeam,
    roundHistory: [],
    otWins: {},
    otRoundsPlayed: 0,
    winner: null,
  };
}

function otherTeamName(matchState: FullMatchState, name: string): string {
  return name === matchState.teamA.name ? matchState.teamB.name : matchState.teamA.name;
}

function teamStateByName(matchState: FullMatchState, name: string): TeamState {
  return matchState.teamA.name === name ? matchState.teamA : matchState.teamB;
}

function sumMoney(team: TeamState, entityManager: EntityManager): number {
  return team.entityIds.reduce((sum, id) => sum + (entityManager.getEntity(id)?.money ?? 0), 0);
}

export interface AdvanceMatchContext {
  tick: number;
  roundResult: RoundResult;
  roundDurationTicks: number;
  killCount: number;
  entityManager: EntityManager;
  eventBus: EventBus;
}

/**
 * Fait avancer l'état de match d'UN round déjà conclu (le `RoundResult` vient
 * de `roundManager.ts`, matchManager ne recalcule aucune condition de victoire
 * de round). Incrémente le score, journalise dans `roundHistory`, puis
 * détermine la transition de phase (round normal -> mi-temps -> overtime ->
 * fin de match) et émet les événements correspondants sur `eventBus` :
 * "match:round-ended" (toujours), puis au plus un de
 * "match:halftime" / "match:overtime-started" / "match:finished".
 *
 * No-op (retourne `matchState` tel quel) si le match est déjà "finished" —
 * protège contre un appel tardif après la fin.
 */
export function advanceMatch(matchState: FullMatchState, context: AdvanceMatchContext): FullMatchState {
  if (matchState.currentPhase === 'finished') return matchState;

  const { roundResult } = context;
  const inOvertime = matchState.currentPhase === 'overtime';
  const winnerName = roundResult.winner;

  const teamA =
    matchState.teamA.name === winnerName ? { ...matchState.teamA, roundsWon: matchState.teamA.roundsWon + 1 } : matchState.teamA;
  const teamB =
    matchState.teamB.name === winnerName ? { ...matchState.teamB, roundsWon: matchState.teamB.roundsWon + 1 } : matchState.teamB;

  const otWins = inOvertime ? { ...matchState.otWins, [winnerName]: (matchState.otWins[winnerName] ?? 0) + 1 } : matchState.otWins;

  const scoreAfter = { [teamA.name]: teamA.roundsWon, [teamB.name]: teamB.roundsWon };
  const historyEntry: RoundHistoryEntry = {
    roundNumber: matchState.currentRoundNumber,
    segment: inOvertime ? 'overtime' : 'regulation',
    winner: winnerName,
    reason: roundResult.reason,
    durationTicks: context.roundDurationTicks,
    attackerTeam: matchState.attackingTeam,
    defenderTeam: matchState.defendingTeam,
    killCount: context.killCount,
    scoreAfter,
    moneyAfter: {
      [teamA.name]: sumMoney(teamA, context.entityManager),
      [teamB.name]: sumMoney(teamB, context.entityManager),
    },
  };

  context.eventBus.emit('match:round-ended', {
    roundNumber: historyEntry.roundNumber,
    winner: winnerName,
    reason: roundResult.reason,
    scoreAfter,
  });

  const base: FullMatchState = { ...matchState, teamA, teamB, otWins, roundHistory: [...matchState.roundHistory, historyEntry] };

  // --- Overtime en cours : condition d'écart, sinon bascule de camp périodique ---
  if (inOvertime) {
    const otRoundsPlayed = base.otRoundsPlayed + 1;
    const margin = Math.abs((otWins[teamA.name] ?? 0) - (otWins[teamB.name] ?? 0));

    if (margin >= base.format.overtime.winMargin) {
      const otWinner = (otWins[teamA.name] ?? 0) > (otWins[teamB.name] ?? 0) ? teamA.name : teamB.name;
      const finished: FullMatchState = { ...base, otRoundsPlayed, currentPhase: 'finished', winner: otWinner };
      context.eventBus.emit('match:finished', { winner: otWinner, finalScore: scoreAfter, tick: context.tick });
      return finished;
    }

    const shouldSwitchSides = otRoundsPlayed % base.format.overtime.sideSwitchEveryRounds === 0;
    return {
      ...base,
      otRoundsPlayed,
      currentRoundNumber: base.currentRoundNumber + 1,
      currentPhase: 'overtime',
      attackingTeam: shouldSwitchSides ? base.defendingTeam : base.attackingTeam,
      defendingTeam: shouldSwitchSides ? base.attackingTeam : base.defendingTeam,
    };
  }

  // --- Victoire directe en temps réglementaire ---
  if (teamA.roundsWon >= base.format.roundsToWinRegulation || teamB.roundsWon >= base.format.roundsToWinRegulation) {
    const regWinner = teamA.roundsWon >= base.format.roundsToWinRegulation ? teamA.name : teamB.name;
    const finished: FullMatchState = { ...base, currentPhase: 'finished', winner: regWinner };
    context.eventBus.emit('match:finished', { winner: regWinner, finalScore: scoreAfter, tick: context.tick });
    return finished;
  }

  // --- Égalité exacte en fin de temps réglementaire (ex: 12-12 pour un format à 13) -> overtime ---
  const tieThreshold = base.format.roundsToWinRegulation - 1;
  if (teamA.roundsWon === tieThreshold && teamB.roundsWon === tieThreshold) {
    const overtimeState: FullMatchState = {
      ...base,
      currentPhase: 'overtime',
      otWins: {},
      otRoundsPlayed: 0,
      currentRoundNumber: base.currentRoundNumber + 1,
    };
    context.eventBus.emit('match:overtime-started', { tick: context.tick, score: scoreAfter });
    return overtimeState;
  }

  // --- Mi-temps : échange de camp, l'argent/l'inventaire ne sont PAS remis à zéro ici (voir runFullMatch/startNewRound : seuls santé/statut/position/armure le sont, comme pour un round normal) ---
  if (base.currentRoundNumber === base.format.halftimeAfterRound) {
    const halftimeState: FullMatchState = {
      ...base,
      currentPhase: 'halftime',
      currentRoundNumber: base.currentRoundNumber + 1,
      attackingTeam: base.defendingTeam,
      defendingTeam: base.attackingTeam,
    };
    context.eventBus.emit('match:halftime', { tick: context.tick, newAttacker: halftimeState.attackingTeam, newDefender: halftimeState.defendingTeam });
    return halftimeState;
  }

  // --- Round normal : le match continue, même camp ---
  return { ...base, currentRoundNumber: base.currentRoundNumber + 1, currentPhase: 'round' };
}

// ---------------------------------------------------------------------------
// Orchestration complète : enchaîne les rounds automatiquement via roundManager.
// ---------------------------------------------------------------------------

export interface RunFullMatchTeamSetup {
  name: string;
  /** État initial des entités (position écrasée à chaque round par les spawns attaquant/défenseur assignés selon le camp courant). */
  entities: EntityState[];
}

export interface RunFullMatchConfig {
  matchId: string;
  tickRate?: number;
  buyPhaseSeconds?: number;
  roundTimeSeconds?: number;
  format?: CreateFullMatchStateOptions['format'];
  startingAttacker?: string;
  /** Points de spawn "camp attaquant", appariés par index aux joueurs de l'équipe qui attaque CE round (pas figés à une équipe). */
  attackerSpawnPoints: Point[];
  defenderSpawnPoints: Point[];
  /** Taille de cellule pour `buildNavGrid` (réutilisé tel quel). Défaut 10. */
  navGridCellSize?: number;
  /**
   * Si fourni, câble les capacités d'agent (`createAgentAbilitiesOnTick`,
   * réutilisé tel quel) ; sinon combat nu (`createMatchOnTick` seul).
   */
  agentRegistry?: Record<string, AgentDefinition>;
  /** Garde-fou anti-boucle infinie (ex: config d'overtime pathologique qui ne conclut jamais). Défaut 60 rounds. */
  maxRoundsSafety?: number;
  /**
   * Appelé à CHAQUE tick, après le traitement du round en cours (mouvement,
   * combat, capacités, économie, phases de round). Reçoit le `TickContext`
   * standard, la vraie `MatchStateBox` MUTABLE du round EN COURS (pour
   * scripter achats/pose/désamorçage en écrivant `roundStateBox.current`,
   * exactement comme `roundManager.ts` le laisse déjà à l'appelant — voir
   * `test-round-run.ts`), le `FullMatchState` actuel (lecture seule), et
   * (4e paramètre, ajout rétrocompatible — les callbacks existants à 3
   * paramètres restent valides) la vraie `AbilityWorldStateBox` du round en
   * cours, pour un observateur (ex: `replayRecorder.ts`) qui a besoin de lire
   * les `AbilityEffect` actifs sans dupliquer la capture d'état. Lecture
   * seule par convention : matchManager n'impose aucune stratégie de jeu.
   */
  onTick?: (context: TickContext, roundStateBox: MatchStateBox, fullMatchState: FullMatchState, abilityWorldStateBox: AbilityWorldStateBox) => void;
}

export interface RunFullMatchOutcome {
  matchState: FullMatchState;
  ticks: SimulationTick[];
}

function computeSpawns(matchState: FullMatchState, config: RunFullMatchConfig): Record<string, Point> {
  const attacker = teamStateByName(matchState, matchState.attackingTeam);
  const defender = teamStateByName(matchState, matchState.defendingTeam);
  const spawns: Record<string, Point> = {};
  attacker.entityIds.forEach((id, i) => {
    spawns[id] = config.attackerSpawnPoints[i % config.attackerSpawnPoints.length];
  });
  defender.entityIds.forEach((id, i) => {
    spawns[id] = config.defenderSpawnPoints[i % config.defenderSpawnPoints.length];
  });
  return spawns;
}

function carrierIdFor(matchState: FullMatchState): string {
  return teamStateByName(matchState, matchState.attackingTeam).entityIds[0];
}

function buildRoundConfig(matchState: FullMatchState, tickRate: number, buyPhaseSeconds: number, roundTimeSeconds: number): RoundManagerConfig {
  return {
    attackerTeam: matchState.attackingTeam,
    defenderTeam: matchState.defendingTeam,
    tickRate,
    buyPhaseSeconds,
    roundTimeSeconds,
  };
}

/**
 * Enchaîne automatiquement tous les rounds d'un match complet (pas
 * d'intervention manuelle round par round) : une seule simulation continue
 * (`runSimulation`, réutilisé tel quel) dont le composeur de round
 * (`createMatchOnTick` ou `createAgentAbilitiesOnTick`, réutilisés sans
 * duplication) est construit UNE SEULE FOIS pour tout le match. Chaque fois
 * qu'un round se termine, `advanceMatch` met à jour le score/la phase, puis
 * (si le match continue) `startNewRound` réinitialise santé/statut/position/
 * armure/charges pour le round suivant et le camp attaquant/défenseur est mis
 * à jour EN PLACE sur l'objet de config du round (voir le commentaire sur
 * `roundConfig` plus bas) — jusqu'à `currentPhase === 'finished'`.
 */
export function runFullMatch(
  mapData: MapData,
  teamASetup: RunFullMatchTeamSetup,
  teamBSetup: RunFullMatchTeamSetup,
  config: RunFullMatchConfig,
): RunFullMatchOutcome {
  const tickRate = config.tickRate ?? 30;
  const buyPhaseSeconds = config.buyPhaseSeconds ?? 30;
  const roundTimeSeconds = config.roundTimeSeconds ?? 100;
  const maxRoundsSafety = config.maxRoundsSafety ?? 60;
  // Marge après le temps réglementaire du round pour laisser un désamorçage en cours se terminer.
  const perRoundTickBudget = Math.round((buyPhaseSeconds + roundTimeSeconds + DEVICE_DEFUSE_SECONDS + 5) * tickRate);
  const totalTickBudget = perRoundTickBudget * maxRoundsSafety;

  resetBotMemories();

  const navGrid = buildNavGrid(mapData, config.navGridCellSize ?? 10);
  mapData.navGrid = navGrid;

  let matchState = createFullMatchState({
    matchId: config.matchId,
    mapId: mapData.id,
    teamA: { name: teamASetup.name, entityIds: teamASetup.entities.map((e) => e.id) },
    teamB: { name: teamBSetup.name, entityIds: teamBSetup.entities.map((e) => e.id) },
    startingAttacker: config.startingAttacker,
    format: config.format,
  });

  // Positionne les entités du ROUND 1 selon le camp initial (les rounds suivants sont
  // repositionnés par `startNewRound`, appelé depuis le onTick ci-dessous).
  const initialSpawns = computeSpawns(matchState, config);
  const initialEntities = [...teamASetup.entities, ...teamBSetup.entities].map((entity) => ({
    ...entity,
    position: initialSpawns[entity.id] ?? entity.position,
  }));

  // `roundConfig` est un objet MUTABLE construit UNE SEULE FOIS pour tout le match : à la
  // mi-temps/l'overtime, on modifie ses champs `attackerTeam`/`defenderTeam` EN PLACE plutôt
  // que de reconstruire le composeur de tick. `createMatchOnTick`/`createAgentAbilitiesOnTick`
  // relisent `config.attackerTeam`/`config.defenderTeam` par référence à CHAQUE tick (jamais
  // capturés par valeur à la construction), donc la mutation est bien prise en compte au tick
  // suivant. Reconstruire `roundTickFn` à chaque round re-souscrirait un NOUVEAU listener
  // "player:killed" (récompense de kill) sur le même `eventBus` persistant à chaque fois SANS
  // jamais désabonner le précédent (`EventBus.on` ne dédoublonne que par référence de fonction),
  // ce qui aurait multiplié la récompense de kill par le nombre de rounds déjà joués — d'où la
  // construction unique ci-dessous.
  const roundConfig = buildRoundConfig(matchState, tickRate, buyPhaseSeconds, roundTimeSeconds);
  const roundStateBox: MatchStateBox = { current: createMatchState(roundConfig, carrierIdFor(matchState), 0) };
  const abilityWorldStateBox: AbilityWorldStateBox = { current: createEmptyAbilityWorldState() };
  const roundTickFn = config.agentRegistry
    ? createAgentAbilitiesOnTick(navGrid, roundStateBox, abilityWorldStateBox, config.agentRegistry, roundConfig)
    : createMatchOnTick(navGrid, roundStateBox, roundConfig);

  let roundStartTick = 0;
  let killsThisRound = 0;
  let matchFinished = false;
  let killSubscribed = false;

  const ticks = runSimulation(mapData, initialEntities, {
    tickRate,
    totalTicks: totalTickBudget,
    onTick: (context) => {
      const { tick, entityManager, eventBus } = context;

      if (!killSubscribed) {
        killSubscribed = true;
        eventBus.on('player:killed', () => {
          killsThisRound += 1;
        });
      }

      if (matchFinished) return;

      const phaseBefore = roundStateBox.current.phase;
      roundTickFn(context);
      const phaseAfter = roundStateBox.current.phase;

      config.onTick?.(context, roundStateBox, matchState, abilityWorldStateBox);

      if (phaseBefore !== 'ended' && phaseAfter === 'ended' && roundStateBox.current.lastRoundResult) {
        const roundResult = roundStateBox.current.lastRoundResult;
        matchState = advanceMatch(matchState, {
          tick,
          roundResult,
          roundDurationTicks: tick - roundStartTick,
          killCount: killsThisRound,
          entityManager,
          eventBus,
        });

        if (matchState.currentPhase === 'finished') {
          matchFinished = true;
          return;
        }

        // Mutation en place (voir commentaire ci-dessus) : PAS de nouvel objet, PAS de nouveau composeur.
        roundConfig.attackerTeam = matchState.attackingTeam;
        roundConfig.defenderTeam = matchState.defendingTeam;
        const spawns = computeSpawns(matchState, config);
        roundStateBox.current = startNewRound(roundStateBox.current, {
          entityManager,
          eventBus,
          tick,
          spawns,
          initialDeviceCarrierId: carrierIdFor(matchState),
        });
        abilityWorldStateBox.current = createEmptyAbilityWorldState();
        if (config.agentRegistry) resetAbilityChargesForNewRound(entityManager, config.agentRegistry);

        roundStartTick = tick;
        killsThisRound = 0;
      }
    },
  });

  if (!matchFinished) {
    // Budget de ticks épuisé sans conclusion (config pathologique ou maxRoundsSafety trop bas) :
    // ne force rien, l'appelant peut inspecter `matchState.currentPhase` (toujours != 'finished') et augmenter le budget.
    console.warn(`runFullMatch: budget de ${totalTickBudget} ticks épuisé sans que le match ne se termine (currentPhase="${matchState.currentPhase}").`);
  }

  return { matchState, ticks };
}

export { otherTeamName };
