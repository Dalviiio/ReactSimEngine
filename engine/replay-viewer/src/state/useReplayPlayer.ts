import { useEffect, useMemo, useRef, useState } from 'react';
import { HIDDEN_TRAP_ABILITY_IDS } from '../constants';
import type { DeviceStatus, EntityState, MatchReplay, ReplayAbilityEffect, SimulationEvent } from '../types';
import { DEVICE_DEFUSE_SECONDS, DEVICE_DETONATION_SECONDS } from '../types';

export type Perspective = 'observer' | string;

export interface DerivedDeviceState {
  status: DeviceStatus | 'none';
  plantedAtTick?: number;
  zoneId?: string;
  defusingSinceTick?: number;
  defuserId?: string;
  /** Secondes restantes avant détonation/fin de désamorçage, si applicable. */
  countdownSeconds?: number;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Reconstruit l'état de toutes les entités à `targetTick` : part du dernier
 * keyframe à un tick <= targetTick, puis applique les deltas jusqu'à
 * targetTick inclus. S'appuie sur la garantie de `replayRecorder.ts` que
 * `tickDeltas` est dense et strictement séquentiel (un enregistrement par
 * tick, sans trou) pour un accès direct par index plutôt qu'une recherche.
 */
function buildEntitiesAtTick(replay: MatchReplay, targetTick: number): Map<string, EntityState> {
  let keyframe = replay.keyframes[0];
  for (const k of replay.keyframes) {
    if (k.tick > targetTick) break;
    keyframe = k;
  }
  const map = new Map<string, EntityState>(keyframe.snapshot.map((e) => [e.id, e]));

  const firstTick = replay.tickDeltas[0]?.tick ?? 0;
  const startIndex = Math.max(0, keyframe.tick - firstTick + 1);
  const endIndex = Math.min(replay.tickDeltas.length - 1, targetTick - firstTick);
  for (let i = startIndex; i <= endIndex; i += 1) {
    const delta = replay.tickDeltas[i];
    if (!delta || delta.tick > targetTick) break;
    delta.changedEntities.forEach((changes) => {
      const prev = map.get(changes.id);
      map.set(changes.id, prev ? { ...prev, ...changes } : (changes as EntityState));
    });
  }
  return map;
}

function activeEffectsAtTick(replay: MatchReplay, tick: number): ReplayAbilityEffect[] {
  return replay.abilityEffects.filter((e) => e.createdAtTick <= tick && tick < e.expiresAtTick);
}

/** Un piège discret (voir HIDDEN_TRAP_ABILITY_IDS) n'est visible que pour son équipe, ou si un "reveal" actif couvre sa position — sinon toujours visible (fumées/murs/DoT sont des phénomènes physiques, pas des pièges cachés). */
function isEffectVisibleForPerspective(
  effect: ReplayAbilityEffect,
  perspective: Perspective,
  entitiesById: Map<string, EntityState>,
  allActiveEffects: ReplayAbilityEffect[],
): boolean {
  if (perspective === 'observer') return true;
  if (!HIDDEN_TRAP_ABILITY_IDS.has(effect.abilityId)) return true;
  const ownerTeam = entitiesById.get(effect.sourceEntityId)?.team;
  if (ownerTeam === perspective) return true;
  return allActiveEffects.some((e) => e.type === 'reveal' && distance(e.position, effect.position) <= e.radius);
}

function deriveDeviceState(roundEvents: SimulationEvent[], currentTick: number, tickRate: number): DerivedDeviceState {
  let state: DerivedDeviceState = { status: 'carried' };
  roundEvents
    .filter((e) => e.tick <= currentTick)
    .forEach((e) => {
      if (e.type === 'device:planted') {
        const d = e.data as { entityId: string; zoneId: string };
        state = { status: 'planted', plantedAtTick: e.tick, zoneId: d.zoneId };
      } else if (e.type === 'device:defusing') {
        const d = e.data as { entityId: string };
        state = { ...state, status: 'defusing', defusingSinceTick: e.tick, defuserId: d.entityId };
      } else if (e.type === 'device:defused') {
        state = { ...state, status: 'defused' };
      } else if (e.type === 'device:detonated') {
        state = { ...state, status: 'detonated' };
      }
    });

  if (state.status === 'planted' && state.plantedAtTick !== undefined) {
    const detonationTick = state.plantedAtTick + DEVICE_DETONATION_SECONDS * tickRate;
    state.countdownSeconds = Math.max(0, (detonationTick - currentTick) / tickRate);
  } else if (state.status === 'defusing' && state.defusingSinceTick !== undefined) {
    const completesTick = state.defusingSinceTick + DEVICE_DEFUSE_SECONDS * tickRate;
    state.countdownSeconds = Math.max(0, (completesTick - currentTick) / tickRate);
  }
  return state;
}

export interface ReplayPlayerApi {
  currentTick: number;
  minTick: number;
  maxTick: number;
  isPlaying: boolean;
  speed: number;
  perspective: Perspective;
  entities: EntityState[];
  visibleEffects: ReplayAbilityEffect[];
  deviceState: DerivedDeviceState;
  currentRoundNumber: number | null;
  /** Phase du round EN COURS ("buy"/"active"/"ended"), déduite des événements "round:phase-changed"/"round:ended". */
  roundPhase: 'buy' | 'active' | 'ended';
  /** Segment du MATCH (distinct de la phase du round) : "overtime"/"finished" persistent une fois atteints ; "halftime" n'est qu'un bandeau transitoire juste après le round de mi-temps (matchManager ne reste pas dans cette phase). */
  matchSegment: 'regulation' | 'halftime' | 'overtime' | 'finished';
  recentEvents: SimulationEvent[];
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  setPerspective: (perspective: Perspective) => void;
  seek: (tick: number) => void;
  stepBy: (deltaTicks: number) => void;
  seekToRound: (roundNumber: number) => void;
}

const MAX_RECENT_EVENTS = 40;

export function useReplayPlayer(replay: MatchReplay | null): ReplayPlayerApi {
  const minTick = replay?.tickDeltas[0]?.tick ?? 0;
  const maxTick = replay?.tickDeltas[replay.tickDeltas.length - 1]?.tick ?? 0;

  const [currentTick, setCurrentTick] = useState(minTick);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [perspective, setPerspective] = useState<Perspective>('observer');

  const tickRate = replay?.tickRate ?? 30;
  const currentTickRef = useRef(currentTick);
  currentTickRef.current = currentTick;

  // Réinitialise la lecture quand un nouveau replay est chargé.
  useEffect(() => {
    setCurrentTick(minTick);
    setIsPlaying(false);
  }, [replay, minTick]);

  useEffect(() => {
    if (!isPlaying || !replay) return;
    const interval = setInterval(() => {
      setCurrentTick((t) => {
        const next = t + speed;
        if (next >= maxTick) {
          setIsPlaying(false);
          return maxTick;
        }
        return next;
      });
    }, 1000 / tickRate);
    return () => clearInterval(interval);
  }, [isPlaying, speed, replay, maxTick, tickRate]);

  const allNotableEvents = useMemo<SimulationEvent[]>(() => {
    if (!replay) return [];
    return replay.tickDeltas.flatMap((d) => d.events);
  }, [replay]);

  const entitiesById = useMemo(() => (replay ? buildEntitiesAtTick(replay, currentTick) : new Map<string, EntityState>()), [replay, currentTick]);

  const allActiveEffects = useMemo(() => (replay ? activeEffectsAtTick(replay, currentTick) : []), [replay, currentTick]);

  const visibleEffects = useMemo(
    () => allActiveEffects.filter((e) => isEffectVisibleForPerspective(e, perspective, entitiesById, allActiveEffects)),
    [allActiveEffects, perspective, entitiesById],
  );

  const currentRoundEntry = useMemo(() => replay?.roundIndex.find((r) => currentTick >= r.startTick && currentTick <= r.endTick) ?? null, [replay, currentTick]);

  const roundEvents = useMemo(() => {
    if (!replay || !currentRoundEntry) return [];
    return replay.tickDeltas.filter((d) => d.roundNumber === currentRoundEntry.roundNumber && d.tick <= currentTick).flatMap((d) => d.events);
  }, [replay, currentRoundEntry, currentTick]);

  const deviceState = useMemo(() => deriveDeviceState(roundEvents, currentTick, tickRate), [roundEvents, currentTick, tickRate]);

  const roundPhase = useMemo<'buy' | 'active' | 'ended'>(() => {
    let phase: 'buy' | 'active' | 'ended' = 'buy';
    roundEvents.forEach((e) => {
      if (e.type === 'round:phase-changed') phase = (e.data as { to: 'buy' | 'active' | 'ended' }).to;
      else if (e.type === 'round:ended') phase = 'ended';
    });
    return phase;
  }, [roundEvents]);

  const matchSegment = useMemo<'regulation' | 'halftime' | 'overtime' | 'finished'>(() => {
    const upTo = allNotableEvents.filter((e) => e.tick <= currentTick);
    if (upTo.some((e) => e.type === 'match:finished')) return 'finished';
    if (upTo.some((e) => e.type === 'match:overtime-started')) return 'overtime';
    const halftime = upTo.find((e) => e.type === 'match:halftime');
    if (halftime && currentTick - halftime.tick < 30) return 'halftime';
    return 'regulation';
  }, [allNotableEvents, currentTick]);

  const recentEvents = useMemo(
    () =>
      allNotableEvents
        .filter((e) => e.tick <= currentTick)
        .slice(-MAX_RECENT_EVENTS)
        .reverse(),
    [allNotableEvents, currentTick],
  );

  const clampTick = (tick: number) => Math.min(maxTick, Math.max(minTick, tick));

  return {
    currentTick,
    minTick,
    maxTick,
    isPlaying,
    speed,
    perspective,
    entities: [...entitiesById.values()],
    visibleEffects,
    deviceState,
    currentRoundNumber: currentRoundEntry?.roundNumber ?? null,
    roundPhase,
    matchSegment,
    recentEvents,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    togglePlay: () => setIsPlaying((p) => !p),
    setSpeed: (s) => setSpeedState(s),
    setPerspective,
    seek: (tick) => setCurrentTick(clampTick(tick)),
    stepBy: (deltaTicks) => setCurrentTick((t) => clampTick(t + deltaTicks)),
    seekToRound: (roundNumber) => {
      const round = replay?.roundIndex.find((r) => r.roundNumber === roundNumber);
      if (round) setCurrentTick(round.startTick);
    },
  };
}
