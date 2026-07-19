import type { BoxSize, ZoneType } from './state/types';

export const BOX_SIZE_DIMENSIONS: Record<BoxSize, { width: number; height: number }> = {
  small: { width: 40, height: 40 },
  medium: { width: 60, height: 60 },
  large: { width: 100, height: 100 },
};

export const BOX_SIZE_COLORS: Record<BoxSize, string> = {
  small: '#fbbf24',
  medium: '#f97316',
  large: '#78350f',
};

export const BOX_SIZE_LABELS: Record<BoxSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export const BOX_SIZE_RULES: Record<BoxSize, string> = {
  small: 'Bloque le déplacement, PAS le tir',
  medium: 'Bloque déplacement + tir direct, mais contournable',
  large: 'Bloque déplacement + tir — quasi-mur',
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
