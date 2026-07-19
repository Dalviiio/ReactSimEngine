/**
 * Enregistreur de replay : enveloppe `trackMatchStats` (donc `runFullMatch`)
 * en observateur PUR — même principe que `statsTracker.ts` — pour produire
 * un objet `MatchReplay` autosuffisant, rejouable par `engine/replay-viewer/`
 * sans aucune dépendance à la simulation en direct.
 *
 * ## Compression : deltas + keyframes périodiques, pas un snapshot complet à chaque tick
 *
 * Un `EntityState` complet (~15 champs, dont `abilityLoadout` imbriqué) répété
 * pour chaque entité à CHAQUE tick d'un match de plusieurs dizaines de
 * milliers de ticks produirait un JSON de plusieurs dizaines de Mo, pour une
 * information très redondante (la plupart des champs — argent, armure,
 * armes, capacités — ne changent qu'occasionnellement ; seule la position
 * bouge en continu pendant les déplacements). Le format retenu :
 * - **`keyframes`** : un snapshot COMPLET de toutes les entités, toutes les
 *   `keyframeIntervalTicks` ticks (+ systématiquement au tout premier tick).
 *   Sert de point de départ pour un accès aléatoire rapide (scrubbing) sans
 *   avoir à rejouer tout le match depuis le tick 0.
 * - **`tickDeltas`** : un enregistrement PAR TICK (dense, aucun trou, y
 *   compris les ticks qui coïncident avec un keyframe), mais dont
 *   `changedEntities` ne contient QUE les entités ayant au moins un champ
 *   différent de leur état au tick précédent (comparaison champ par champ) —
 *   une entité totalement immobile un tick donné n'apparaît pas du tout dans
 *   ce tick. C'est la seule source des `events` (kills, capacités, charge...).
 *
 * Reconstruire l'état à un tick T : partir du DERNIER keyframe à un tick
 * <= T, puis appliquer dans l'ordre les `changedEntities` de chaque
 * `tickDeltas` strictement après ce keyframe et jusqu'à T inclus (fusion
 * champ par champ sur une Map par id). Le tout premier `tickDeltas` contient
 * en pratique un état complet (rien à diffé avant lui) : la reconstruction
 * n'a pas besoin de le savoir, la fusion est la même qu'un delta partiel.
 *
 * Cette compression ne réduit PAS le poids des déplacements eux-mêmes (une
 * entité qui bouge à chaque tick reste présente à chaque tick) : c'est un
 * choix assumé plutôt qu'une compression avec perte (ex: sous-échantillonner
 * la position) qui dégraderait la fidélité du rejeu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EntityState, MapData, SimulationEvent } from '../../types';
import { AbilityEffect } from './abilities/types';
import { FullMatchState, RoundHistoryEntry, RunFullMatchConfig, RunFullMatchTeamSetup } from './matchManager';
import { PlayerMatchStats, trackMatchStats } from './statsTracker';

export const DEFAULT_KEYFRAME_INTERVAL_TICKS = 300;

/**
 * Événements conservés dans `tickDeltas[].events` — tout le reste (mutations
 * d'entité à haute fréquence, tirs manqués/touchés bruts) est délibérément
 * omis, voir le commentaire au point d'usage.
 */
const NOTABLE_EVENT_TYPES = new Set([
  'player:killed',
  'ability:activated',
  'ability:effect-expired',
  'device:planted',
  'device:defusing',
  'device:defused',
  'device:detonated',
  'round:started',
  'round:phase-changed',
  'round:ended',
  'match:round-ended',
  'match:halftime',
  'match:overtime-started',
  'match:finished',
]);

/** Un `AbilityEffect` tel qu'observé au moins une fois, complété du round où il est apparu (pour le filtrage par round côté viewer). */
export interface ReplayAbilityEffect extends AbilityEffect {
  roundNumber: number;
}

export interface ReplayTickDelta {
  tick: number;
  roundNumber: number;
  timestamp: number;
  /** Entités ayant changé depuis le tick précédent — voir la note de compression en tête de fichier. */
  changedEntities: (Partial<EntityState> & { id: string })[];
  events: SimulationEvent[];
}

export interface ReplayKeyframe {
  tick: number;
  snapshot: EntityState[];
}

export interface ReplayRoundIndexEntry {
  roundNumber: number;
  startTick: number;
  endTick: number;
  /** `null` si ce round n'a pas conclu avec un résultat enregistré (ne devrait pas arriver pour un round complet). */
  history: RoundHistoryEntry | null;
}

export interface MatchReplay {
  replayId: string;
  /** Date ISO de l'enregistrement (pas du match simulé, qui n'a pas de date réelle). */
  recordedAt: string;
  mapData: MapData;
  /**
   * Image de fond encodée en data URL (base64), si un fichier a pu être lu
   * sur disque à côté de la carte — voir le gap documenté dans le README du
   * viewer : aucune image réelle n'accompagne les cartes de TEST de ce
   * projet (`mapData.imageUrl` n'est qu'un nom de fichier indicatif, jamais
   * un vrai `.webp` sur disque). Absent dans ce cas ; le viewer doit alors
   * afficher un fond neutre, exactement comme `map-editor` le fait déjà
   * quand aucune image n'est chargée.
   */
  mapImageDataUrl?: string;
  tickRate: number;
  keyframeIntervalTicks: number;
  keyframes: ReplayKeyframe[];
  /** TOUS les ticks de TOUS les rounds, dans l'ordre chronologique (numérotation continue à travers le match, jamais remise à zéro par round). */
  tickDeltas: ReplayTickDelta[];
  roundIndex: ReplayRoundIndexEntry[];
  /** Tous les `AbilityEffect` qui ont existé au moins un tick, avec leur fenêtre de validité complète (`createdAtTick`/`activeFromTick`/`expiresAtTick`, déjà portée par `AbilityEffect` lui-même). */
  abilityEffects: ReplayAbilityEffect[];
  matchState: FullMatchState;
  /** `Map` sérialisée en objet (id d'entité -> stats) pour rester du JSON valide. */
  playerStats: Record<string, PlayerMatchStats>;
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Arrondit position/rotation à 2 décimales pour le STOCKAGE du replay
 * uniquement (n'affecte jamais l'entité réelle de la simulation, seule une
 * copie l'est) : un rejeu visuel n'a aucun besoin de la pleine précision
 * flottante (`123.45678901234568`) produite par les calculs de déplacement —
 * 1/100e d'unité carte est largement sous le pixel à l'échelle d'affichage.
 * Réduit sensiblement la taille du JSON (beaucoup de chiffres significatifs
 * en moins par coordonnée, sur potentiellement chaque tick de chaque entité
 * qui bouge).
 */
function roundEntityForReplay(entity: EntityState): EntityState {
  return {
    ...entity,
    position: { x: roundTo(entity.position.x, 2), y: roundTo(entity.position.y, 2) },
    rotation: roundTo(entity.rotation, 2),
  };
}

/**
 * `abilityLoadout` change techniquement à CHAQUE tick pour chaque entité
 * vivante ayant une ultime : `accrueUltimatePoints` (abilities/integration.ts)
 * ajoute une fraction de point à chaque tick. Comparer les valeurs brutes
 * ferait donc "changer" `abilityLoadout` en permanence et annulerait presque
 * toute la compression par delta. On compare une version normalisée où
 * `ultimatePoints` est arrondi à l'entier inférieur — exactement ce que
 * `getUltimatePoints()` fait déjà pour la logique de seuil d'activation, donc
 * un replay visuel n'a de toute façon pas besoin de plus de précision — tout
 * en stockant la valeur RÉELLE (non arrondie) dans le delta si un changement
 * est détecté par ailleurs.
 */
function normalizeForDiff(key: keyof EntityState, value: unknown): unknown {
  if (key !== 'abilityLoadout' || !value) return value;
  const loadout = value as EntityState['abilityLoadout'];
  return {
    agentId: loadout!.agentId,
    abilities: Object.fromEntries(
      Object.entries(loadout!.abilities).map(([slot, instance]) => [
        slot,
        instance ? { ...instance, ultimatePoints: Math.floor(instance.ultimatePoints) } : instance,
      ]),
    ),
  };
}

function diffEntity(prev: EntityState, curr: EntityState): (Partial<EntityState> & { id: string }) | null {
  const changed: Record<string, unknown> = {};
  let hasChange = false;
  (Object.keys(curr) as (keyof EntityState)[]).forEach((key) => {
    if (key === 'id') return;
    if (JSON.stringify(normalizeForDiff(key, curr[key])) !== JSON.stringify(normalizeForDiff(key, prev[key]))) {
      changed[key] = curr[key];
      hasChange = true;
    }
  });
  return hasChange ? ({ id: curr.id, ...changed } as Partial<EntityState> & { id: string }) : null;
}

/**
 * Tente de lire une image réelle à côté du fichier de carte et de l'encoder
 * en data URL. Retourne `undefined` (jamais ne fabrique une image de
 * substitution) si rien n'est trouvé — voir la doc de `mapImageDataUrl`.
 */
function loadMapImageAsDataUrl(mapData: MapData, explicitDir?: string): string | undefined {
  const candidatePath = path.join(explicitDir ?? __dirname, mapData.imageUrl);
  try {
    const bytes = fs.readFileSync(candidatePath);
    const ext = path.extname(candidatePath).slice(1) || 'webp';
    return `data:image/${ext};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export interface RecordFullMatchOptions {
  replayId?: string;
  keyframeIntervalTicks?: number;
  /** Dossier où chercher `mapData.imageUrl` sur disque (défaut : ce fichier). Voir `loadMapImageAsDataUrl`. */
  mapImageDir?: string;
}

/**
 * Enregistre un match complet : enveloppe `trackMatchStats` (qui enveloppe
 * lui-même `runFullMatch`) SANS dupliquer la moindre règle de simulation, en
 * composant son propre hook `onTick` par-dessus celui, optionnel, fourni par
 * l'appelant (achats/mouvements/pose-désamorçage scriptés, comme dans
 * `test-match-run.ts`/`test-stats-run.ts`) — même schéma de composition en
 * couches que `statsTracker.ts` par-dessus `matchManager.ts`.
 */
export function recordFullMatch(
  mapData: MapData,
  teamASetup: RunFullMatchTeamSetup,
  teamBSetup: RunFullMatchTeamSetup,
  config: RunFullMatchConfig,
  options: RecordFullMatchOptions = {},
): MatchReplay {
  const keyframeIntervalTicks = options.keyframeIntervalTicks ?? DEFAULT_KEYFRAME_INTERVAL_TICKS;

  const discoveredEffects = new Map<string, ReplayAbilityEffect>();
  const tickDeltas: ReplayTickDelta[] = [];
  const keyframes: ReplayKeyframe[] = [];
  const roundBounds = new Map<number, { startTick: number; endTick: number }>();

  let subscribed = false;
  let rawPending: { type: string; data: unknown }[] = [];
  let lastFullState: Map<string, EntityState> | null = null;
  let ticksSinceKeyframe = 0;
  let matchFinishedAtIndex = -1;

  const outerOnTick = config.onTick;
  const onTick: RunFullMatchConfig['onTick'] = (context, roundStateBox, fullMatchState, abilityWorldStateBox) => {
    const { eventBus, tick, timestamp, entityManager } = context;

    if (!subscribed) {
      subscribed = true;
      eventBus.onAny((type, data) => {
        rawPending.push({ type, data });
      });
    }

    const roundNumber = roundStateBox.current.roundNumber;
    const bounds = roundBounds.get(roundNumber);
    if (bounds) bounds.endTick = tick;
    else roundBounds.set(roundNumber, { startTick: tick, endTick: tick });

    const currentEntities = entityManager.getAllEntities().map(roundEntityForReplay);
    const changedEntities: (Partial<EntityState> & { id: string })[] = [];
    currentEntities.forEach((entity) => {
      const prev = lastFullState?.get(entity.id);
      const diff = prev ? diffEntity(prev, entity) : { ...entity };
      if (diff) changedEntities.push(diff);
    });
    lastFullState = new Map(currentEntities.map((e) => [e.id, e]));

    const eventsRaw = rawPending;
    rawPending = [];
    // "entity:updated"/"entity:added"/"entity:removed" portent un `EntityState` complet et
    // sont émis à CHAQUE mutation (donc plusieurs fois par tick et par entité, via le
    // mouvement des bots, le combat, l'économie...) : entièrement redondants avec
    // `changedEntities` ci-dessus (calculé nous-mêmes, avec la vraie compression par delta).
    // Les stocker en plus ferait exploser la taille du replay pour zéro information nouvelle
    // — voir le commentaire de tête de fichier. "combat:shot-missed"/"combat:shot-hit" sont
    // également omis (bruit à haute fréquence, non narratif) ; les dégâts/tirs agrégés
    // restent disponibles via `playerStats`. Seuls les événements NOTABLES pour un flux
    // d'activité lisible (panneau latéral du viewer) sont conservés.
    const events: SimulationEvent[] = eventsRaw.filter(({ type }) => NOTABLE_EVENT_TYPES.has(type)).map(({ type, data }) => ({ type, tick, data }));

    tickDeltas.push({ tick, roundNumber, timestamp, changedEntities, events });

    ticksSinceKeyframe += 1;
    if (keyframes.length === 0 || ticksSinceKeyframe >= keyframeIntervalTicks) {
      keyframes.push({ tick, snapshot: currentEntities });
      ticksSinceKeyframe = 0;
    }

    abilityWorldStateBox.current.effects.forEach((effect) => {
      if (!discoveredEffects.has(effect.id)) {
        discoveredEffects.set(effect.id, { ...effect, roundNumber });
      }
    });

    if (matchFinishedAtIndex === -1 && events.some((e) => e.type === 'match:finished')) {
      matchFinishedAtIndex = tickDeltas.length - 1;
    }

    outerOnTick?.(context, roundStateBox, fullMatchState, abilityWorldStateBox);
  };

  const { matchState, playerStats } = trackMatchStats(mapData, teamASetup, teamBSetup, { ...config, onTick });

  // `runFullMatch` alloue un budget de ticks fixe et continue à tourner jusqu'au bout
  // même une fois le match terminé (voir matchManager.ts) : on coupe la queue de ticks
  // "morts" pour ne pas gonfler le replay avec des dizaines de milliers de ticks inutiles.
  const lastUsefulIndex = matchFinishedAtIndex >= 0 ? matchFinishedAtIndex : tickDeltas.length - 1;
  const trimmedDeltas = tickDeltas.slice(0, lastUsefulIndex + 1);
  const lastUsefulTick = trimmedDeltas[trimmedDeltas.length - 1]?.tick ?? 0;
  const trimmedKeyframes = keyframes.filter((k) => k.tick <= lastUsefulTick);

  const roundIndex: ReplayRoundIndexEntry[] = [...roundBounds.entries()]
    .filter(([roundNumber]) => trimmedDeltas.some((d) => d.roundNumber === roundNumber))
    .map(([roundNumber, b]) => ({
      roundNumber,
      startTick: b.startTick,
      endTick: Math.min(b.endTick, lastUsefulTick),
      history: matchState.roundHistory.find((h) => h.roundNumber === roundNumber) ?? null,
    }))
    .sort((a, b) => a.roundNumber - b.roundNumber);

  return {
    replayId: options.replayId ?? `replay-${Date.now()}`,
    recordedAt: new Date().toISOString(),
    mapData,
    mapImageDataUrl: loadMapImageAsDataUrl(mapData, options.mapImageDir),
    tickRate: config.tickRate ?? 30,
    keyframeIntervalTicks,
    keyframes: trimmedKeyframes,
    tickDeltas: trimmedDeltas,
    roundIndex,
    abilityEffects: [...discoveredEffects.values()],
    matchState,
    playerStats: Object.fromEntries(playerStats),
  };
}

/** Sérialise un `MatchReplay` en JSON et l'écrit sur disque. Retourne la taille écrite (octets, UTF-8) pour affichage/diagnostic par l'appelant. */
export function exportReplayToFile(replay: MatchReplay, filepath: string): { bytesWritten: number } {
  const json = JSON.stringify(replay);
  fs.writeFileSync(filepath, json, 'utf-8');
  return { bytesWritten: Buffer.byteLength(json, 'utf-8') };
}
