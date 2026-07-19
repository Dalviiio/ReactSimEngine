import { EventBus } from '../../core';
import { EntityState, Point } from '../../types';
import { HitZone, Weapon } from './weapons';

/**
 * Simplification volontaire de l'armure : réduction de dégâts fixe tant que
 * l'armure est équipée (elle ne se dégrade pas coup par coup comme dans le
 * vrai jeu). La tête n'est presque pas protégée par l'armure.
 */
const HEAD_ARMOR_REDUCTION = 0.05;
const MAX_BODY_ARMOR_REDUCTION = 0.33;
/** targetArmor / ARMOR_REDUCTION_SCALE = fraction de réduction corps/jambes (25 -> ~17%, 50 -> ~33%). */
const ARMOR_REDUCTION_SCALE = 150;

/**
 * Vrai si `attackerPosition` se trouve dans un cône d'environ 120° derrière
 * `target` (par rapport à sa rotation). Convention : rotation en degrés,
 * 0° = direction +x, sens `atan2(dy, dx)`.
 */
export function isBehindTarget(target: EntityState, attackerPosition: Point): boolean {
  const angleToAttacker =
    Math.atan2(attackerPosition.y - target.position.y, attackerPosition.x - target.position.x) * (180 / Math.PI);
  // diff proche de 0 = l'attaquant est dans la direction regardée par la cible (devant elle) ;
  // diff proche de 180 = à l'opposé (dans son dos). On veut donc diff GRAND, pas petit.
  const diff = Math.abs(((angleToAttacker - target.rotation + 540) % 360) - 180);
  return diff > 120;
}

/**
 * Dégâts d'un tir, palier de distance de l'arme + réduction d'armure appliqués.
 * `isBackstab` (corps à corps uniquement) applique `weapon.backstabMultiplier`.
 */
export function calculateDamage(
  weapon: Weapon,
  hitZone: HitZone,
  distance: number,
  targetArmor: number,
  isBackstab = false,
): number {
  const bracket =
    weapon.damageFalloff.find((b) => distance <= b.maxDistance) ?? weapon.damageFalloff[weapon.damageFalloff.length - 1];
  let rawDamage = bracket.damage[hitZone];

  if (isBackstab && weapon.backstabMultiplier) {
    rawDamage *= weapon.backstabMultiplier;
  }

  if (hitZone === 'head') {
    return rawDamage * (targetArmor > 0 ? 1 - HEAD_ARMOR_REDUCTION : 1);
  }

  const reduction = targetArmor > 0 ? Math.min(MAX_BODY_ARMOR_REDUCTION, targetArmor / ARMOR_REDUCTION_SCALE) : 0;
  return rawDamage * (1 - reduction);
}

export interface DamageContext {
  killerId: string;
  weaponId: string;
  hitZone: HitZone;
}

/**
 * Applique des dégâts déjà calculés à une entité : retourne les changements à
 * appliquer via l'EntityManager (santé, statut). Émet "player:killed" sur le
 * bus si l'entité passe de vivante à morte.
 */
export function applyDamage(entity: EntityState, damage: number, context: DamageContext, eventBus: EventBus): Partial<EntityState> {
  const newHealth = Math.max(0, entity.health - damage);
  const changes: Partial<EntityState> = { health: newHealth };

  if (newHealth <= 0 && entity.status === 'alive') {
    changes.status = 'dead';
    eventBus.emit('player:killed', {
      killerId: context.killerId,
      victimId: entity.id,
      weaponId: context.weaponId,
      hitZone: context.hitZone,
    });
  }

  return changes;
}
