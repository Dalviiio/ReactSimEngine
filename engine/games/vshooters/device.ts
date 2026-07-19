import { EventBus } from '../../core';
import { EntityState, Point, Zone } from '../../types';

export type DeviceStatus = 'carried' | 'planted' | 'defusing' | 'defused' | 'detonated';

export interface DevicePlantInfo {
  tick: number;
  position: Point;
  zoneId: string;
}

export interface DeviceDefuseInfo {
  defuserId: string;
  startedAtTick: number;
  completesAtTick: number;
}

export interface DeviceState {
  status: DeviceStatus;
  carrierId: string | null;
  plantedAt: DevicePlantInfo | null;
  /** Tick auquel la charge explose si elle n'est pas désamorcée avant. */
  detonationTick: number | null;
  defuse: DeviceDefuseInfo | null;
}

export const DEVICE_DETONATION_SECONDS = 45;
export const DEVICE_DEFUSE_SECONDS = 7;

export function createDeviceState(carrierId: string): DeviceState {
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
 * Pose la charge si `entity` la porte et se trouve dans une Zone de type "site".
 * Ne fait rien (retourne l'état inchangé) si l'une de ces conditions n'est pas remplie.
 */
export function plantDevice(
  device: DeviceState,
  entity: EntityState,
  zone: Zone,
  currentTick: number,
  tickRate: number,
  eventBus: EventBus,
): DeviceState {
  if (device.status !== 'carried' || device.carrierId !== entity.id) return device;
  if (zone.type !== 'site') return device;
  if (!pointInPolygon(entity.position, zone.polygon)) return device;

  const detonationTick = currentTick + Math.round(DEVICE_DETONATION_SECONDS * tickRate);

  eventBus.emit('device:planted', { entityId: entity.id, zoneId: zone.id, tick: currentTick });

  return {
    status: 'planted',
    carrierId: null,
    plantedAt: { tick: currentTick, position: { ...entity.position }, zoneId: zone.id },
    detonationTick,
    defuse: null,
  };
}

export function startDefuse(
  device: DeviceState,
  entity: EntityState,
  currentTick: number,
  tickRate: number,
  eventBus: EventBus,
): DeviceState {
  if (device.status !== 'planted') return device;

  const completesAtTick = currentTick + Math.round(DEVICE_DEFUSE_SECONDS * tickRate);
  eventBus.emit('device:defusing', { entityId: entity.id, tick: currentTick });

  return { ...device, status: 'defusing', defuse: { defuserId: entity.id, startedAtTick: currentTick, completesAtTick } };
}

/** Interrompt un désamorçage en cours (ex: le défuseur meurt ou est interrompu) ; repasse en "planted". */
export function interruptDefuse(device: DeviceState): DeviceState {
  if (device.status !== 'defusing') return device;
  return { ...device, status: 'planted', defuse: null };
}

export function completeDefuse(device: DeviceState, currentTick: number, eventBus: EventBus): DeviceState {
  if (device.status !== 'defusing') return device;
  eventBus.emit('device:defused', { tick: currentTick });
  return { ...device, status: 'defused', defuse: null };
}

export function detonateDevice(device: DeviceState, currentTick: number, eventBus: EventBus): DeviceState {
  if (device.status !== 'planted') return device;
  eventBus.emit('device:detonated', { tick: currentTick });
  return { ...device, status: 'detonated' };
}

/** À appeler chaque tick pendant la phase active : fait avancer les timers (détonation, fin de désamorçage). */
export function updateDeviceTimers(device: DeviceState, currentTick: number, eventBus: EventBus): DeviceState {
  if (device.status === 'planted' && device.detonationTick !== null && currentTick >= device.detonationTick) {
    return detonateDevice(device, currentTick, eventBus);
  }
  if (device.status === 'defusing' && device.defuse && currentTick >= device.defuse.completesAtTick) {
    return completeDefuse(device, currentTick, eventBus);
  }
  return device;
}
