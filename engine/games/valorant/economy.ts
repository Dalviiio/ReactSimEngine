import { EntityState } from '../../types';
import { ArmorItem, Weapon } from './weapons';

export const STARTING_MONEY = 800;
export const MAX_MONEY = 9000;

export const KILL_REWARD = 200;
export const ROUND_WIN_REWARD = 3000;

/** Loss bonus progressif : 1ère défaite consécutive 1900$, puis 2400/2900/3400, plafonné à 3400. */
const LOSS_BONUS_SCHEDULE = [1900, 2400, 2900, 3400];

/** Bonus pour TOUS les attaquants vivants/morts s'ils ont posé la spike, même si la manche est perdue ensuite. */
export const SPIKE_PLANT_BONUS = 300;
/** Bonus additionnel (en plus du gain de manche) si la spike explose. */
export const SPIKE_DETONATION_BONUS = 300;

export function clampMoney(amount: number): number {
  return Math.max(0, Math.min(MAX_MONEY, Math.round(amount)));
}

/** `consecutiveLosses` = nombre de défaites consécutives APRÈS la manche qui vient d'être perdue (1, 2, 3, ...). */
export function getLossBonus(consecutiveLosses: number): number {
  const index = Math.min(Math.max(consecutiveLosses - 1, 0), LOSS_BONUS_SCHEDULE.length - 1);
  return LOSS_BONUS_SCHEDULE[index];
}

export type ShopItem = Weapon | ArmorItem;

function isArmorItem(item: ShopItem): item is ArmorItem {
  return 'armorPoints' in item;
}

export function canAfford(entity: EntityState, item: ShopItem): boolean {
  return (entity.money ?? 0) >= item.price;
}

/**
 * Tente d'acheter une arme ou une armure. Retourne les changements à appliquer
 * via l'EntityManager, ou `null` si les fonds sont insuffisants (rien n'est modifié).
 */
export function buyItem(entity: EntityState, item: ShopItem): Partial<EntityState> | null {
  if (!canAfford(entity, item)) return null;

  const money = clampMoney((entity.money ?? 0) - item.price);

  if (isArmorItem(item)) {
    return { money, armor: item.armorPoints };
  }

  const weapons = Array.from(new Set([...(entity.weapons ?? []), item.id]));
  return {
    money,
    weapons,
    equippedWeaponId: item.id,
    currentAmmo: item.magazineSize,
  };
}
