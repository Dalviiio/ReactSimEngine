import { EventBus } from '../../core';
import { EntityState, Point, Zone } from '../../types';

export type SpikeStatus = 'carried' | 'planted' | 'defusing' | 'defused' | 'detonated';

export interface SpikePlantInfo {
  tick: number;
  position: Point;
  zoneId: string;
}

export interface SpikeDefuseInfo {
  defuserId: string;
  startedAtTick: number;
  completesAtTick: number;
}

export interface SpikeState {
  status: SpikeStatus;
  carrierId: string | null;
  plantedAt: SpikePlantInfo | null;
  /** Tick auquel la spike explose si elle n'est pas désamorcée avant. */
  detonationTick: number | null;
  defuse: SpikeDefuseInfo | null;
}

export const SPIKE_DETONATION_SECONDS = 45;
export const SPIKE_DEFUSE_SECONDS = 7;

export function createSpikeState(carrierId: string): SpikeState {
  return { status: 'carried', carrierId, plantedAt: null, detonationTick: null, defuse: null };
}

/** Ray casting classique. `polygon` doit être fermé implicitement (dernier point relié au premier). */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Pose la spike si `entity` la porte et se trouve dans une Zone de type "site".
 * Ne fait rien (retourne l'état inchangé) si l'une de ces conditions n'est pas remplie.
 */
export function plantSpike(
  spike: SpikeState,
  entity: EntityState,
  zone: Zone,
  currentTick: number,
  tickRate: number,
  eventBus: EventBus,
): SpikeState {
  if (spike.status !== 'carried' || spike.carrierId !== entity.id) return spike;
  if (zone.type !== 'site') return spike;
  if (!pointInPolygon(entity.position, zone.polygon)) return spike;

  const detonationTick = currentTick + Math.round(SPIKE_DETONATION_SECONDS * tickRate);

  eventBus.emit('spike:planted', { entityId: entity.id, zoneId: zone.id, tick: currentTick });

  return {
    status: 'planted',
    carrierId: null,
    plantedAt: { tick: currentTick, position: { ...entity.position }, zoneId: zone.id },
    detonationTick,
    defuse: null,
  };
}

export function startDefuse(
  spike: SpikeState,
  entity: EntityState,
  currentTick: number,
  tickRate: number,
  eventBus: EventBus,
): SpikeState {
  if (spike.status !== 'planted') return spike;

  const completesAtTick = currentTick + Math.round(SPIKE_DEFUSE_SECONDS * tickRate);
  eventBus.emit('spike:defusing', { entityId: entity.id, tick: currentTick });

  return { ...spike, status: 'defusing', defuse: { defuserId: entity.id, startedAtTick: currentTick, completesAtTick } };
}

/** Interrompt un désamorçage en cours (ex: le défuseur meurt ou est interrompu) ; repasse en "planted". */
export function interruptDefuse(spike: SpikeState): SpikeState {
  if (spike.status !== 'defusing') return spike;
  return { ...spike, status: 'planted', defuse: null };
}

export function completeDefuse(spike: SpikeState, currentTick: number, eventBus: EventBus): SpikeState {
  if (spike.status !== 'defusing') return spike;
  eventBus.emit('spike:defused', { tick: currentTick });
  return { ...spike, status: 'defused', defuse: null };
}

export function detonateSpike(spike: SpikeState, currentTick: number, eventBus: EventBus): SpikeState {
  if (spike.status !== 'planted') return spike;
  eventBus.emit('spike:detonated', { tick: currentTick });
  return { ...spike, status: 'detonated' };
}

/** À appeler chaque tick pendant la phase active : fait avancer les timers (détonation, fin de désamorçage). */
export function updateSpikeTimers(spike: SpikeState, currentTick: number, eventBus: EventBus): SpikeState {
  if (spike.status === 'planted' && spike.detonationTick !== null && currentTick >= spike.detonationTick) {
    return detonateSpike(spike, currentTick, eventBus);
  }
  if (spike.status === 'defusing' && spike.defuse && currentTick >= spike.defuse.completesAtTick) {
    return completeDefuse(spike, currentTick, eventBus);
  }
  return spike;
}
