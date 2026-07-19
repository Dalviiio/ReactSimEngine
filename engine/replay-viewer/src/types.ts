// Réutilise directement les types du moteur (aucune redéfinition) — même convention que
// engine/map-editor, qui importe déjà engine/types/map.ts et engine/map/mapValidator.ts
// en TypeScript brut (le viewer n'a pas de dépendance runtime au moteur, juste ses types
// et quelques constantes de règles pures, réutilisées pour rester cohérent).
export type { MapData, Zone, Wall, Box, BoxSize, ZoneType, Point, EntityState, SimulationEvent, AbilityLoadoutState } from '../../types';
export type { AbilityEffect, AbilityEffectType } from '../../games/vshooters/abilities/types';
export type { DeviceStatus } from '../../games/vshooters/device';
export { DEVICE_DETONATION_SECONDS, DEVICE_DEFUSE_SECONDS } from '../../games/vshooters/device';
export type { FullMatchState, TeamState, RoundHistoryEntry, MatchPhase } from '../../games/vshooters/matchManager';
export type { PlayerMatchStats } from '../../games/vshooters/statsTracker';
export type {
  MatchReplay,
  ReplayTickDelta,
  ReplayKeyframe,
  ReplayRoundIndexEntry,
  ReplayAbilityEffect,
} from '../../games/vshooters/replayRecorder';
