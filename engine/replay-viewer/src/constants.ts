import type { AbilityEffectType, BoxSize, DeviceStatus, ZoneType } from './types';

// Conventions visuelles reprises TELLES QUELLES de engine/map-editor/src/constants.ts, pour
// que zones/murs/caisses se reconnaissent d'un outil à l'autre.
export const BOX_SIZE_COLORS: Record<BoxSize, string> = {
  small: '#fbbf24',
  medium: '#f97316',
  large: '#78350f',
};

export const ZONE_TYPE_COLORS: Record<ZoneType, string> = {
  site: '#a855f7',
  spawn: '#22c55e',
  corridor: '#38bdf8',
  open_area: '#94a3b8',
};

export const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  site: 'Site',
  spawn: 'Spawn',
  corridor: 'Corridor',
  open_area: 'Zone ouverte',
};

export const WALL_COLOR = '#dc2626';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

/** Couleurs par équipe — teamA (1ère équipe créée) vs teamB, appliquées dans l'ordre de FullMatchState.teamA/teamB. */
export const TEAM_COLORS = ['#38bdf8', '#f87171'] as const;
export const TEAM_COLOR_DEAD = '#475569';

/**
 * Rendu par type d'AbilityEffect : couleur + libellé. `stealth`/`statModifier`
 * ne sont pas des zones visuellement significatives (rayon souvent nul) — pas
 * de rendu de zone dédié pour eux (voir ReplayCanvas).
 */
export const EFFECT_TYPE_STYLE: Record<AbilityEffectType, { color: string; label: string }> = {
  blocksVision: { color: '#e2e8f0', label: 'Fumée' },
  blocksMovement: { color: '#f59e0b', label: 'Mur' },
  damageOverTime: { color: '#ef4444', label: 'Dégâts' },
  heal: { color: '#22c55e', label: 'Soin' },
  blind: { color: '#facc15', label: 'Aveuglement' },
  reveal: { color: '#38bdf8', label: 'Détection' },
  slow: { color: '#818cf8', label: 'Ralentissement' },
  reconPing: { color: '#2dd4bf', label: 'Ping' },
  statModifier: { color: '#c084fc', label: 'Altération' },
  stealth: { color: '#94a3b8', label: 'Furtivité' },
};

/**
 * Capacités considérées comme des PIÈGES DISCRETS (voir ReplayCanvas) :
 * seules celles-ci sont masquées à l'équipe adverse hors "reveal" — le reste
 * (fumées, murs, DoT, pings...) est un phénomène physiquement visible dans
 * l'univers du jeu, donc toujours affiché.
 */
export const HIDDEN_TRAP_ABILITY_IDS = new Set(['bramble_snare_trap', 'bramble_spike_trap']);

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  carried: 'Portée',
  planted: 'Posée',
  defusing: 'Désamorçage en cours',
  defused: 'Désamorcée',
  detonated: 'Explosée',
};
