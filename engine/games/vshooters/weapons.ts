/**
 * Catalogue des armes/armures. Stats plausibles et cohérentes entre elles,
 * pas garanties pixel-perfect — ajustables plus tard sans changer les types/API.
 *
 * Simplification volontaire pour les fusils à pompe (Buckshot Snub/Scattergun/
 * Verdict), qui tirent normalement plusieurs projectiles : ici un seul "dégât
 * effectif par tir" agrégé, pas de simulation projectile par projectile.
 */

export type WeaponCategory = 'sidearm' | 'smg' | 'shotgun' | 'rifle' | 'mg' | 'sniper' | 'melee';
export type WallPenetration = 'low' | 'medium' | 'high';
export type HitZone = 'head' | 'body' | 'leg';

export type DamageRange = Record<HitZone, number>;

export interface DamageFalloffBracket {
  /** Distance max (unités carte) à laquelle ce palier s'applique. Infinity = dernier palier, sans limite. */
  maxDistance: number;
  damage: DamageRange;
}

export interface Weapon {
  id: string;
  name: string;
  category: WeaponCategory;
  price: number;
  fireRatePerSecond: number;
  magazineSize: number;
  wallPenetration: WallPenetration;
  /**
   * Paliers de dégâts par distance croissante. Un seul palier (maxDistance: Infinity)
   * = dégâts constants quelle que soit la distance (ex: Warhawk). Plusieurs paliers
   * = dropoff progressif (ex: Reaper).
   */
  damageFalloff: DamageFalloffBracket[];
  /** Multiplicateur si frappe dans le dos (corps à corps uniquement pour l'instant). */
  backstabMultiplier?: number;
}

export interface ArmorItem {
  id: string;
  name: string;
  price: number;
  armorPoints: number;
}

function constant(head: number, body: number, leg: number): DamageFalloffBracket[] {
  return [{ maxDistance: Infinity, damage: { head, body, leg } }];
}

export const BLADE: Weapon = {
  id: 'blade',
  name: 'Blade',
  category: 'melee',
  price: 0,
  fireRatePerSecond: 2,
  magazineSize: Infinity,
  wallPenetration: 'low',
  damageFalloff: constant(150, 55, 50),
  backstabMultiplier: 2.2,
};

export const WEAPONS: Weapon[] = [
  BLADE,

  // Pistolets
  {
    id: 'recruit',
    name: 'Recruit',
    category: 'sidearm',
    price: 0,
    fireRatePerSecond: 6.75,
    magazineSize: 12,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 30, damage: { head: 78, body: 26, leg: 22 } },
      { maxDistance: Infinity, damage: { head: 66, body: 22, leg: 18 } },
    ],
  },
  {
    id: 'buckshot_snub',
    name: 'Buckshot Snub',
    category: 'sidearm',
    price: 200,
    fireRatePerSecond: 3.3,
    magazineSize: 2,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 7, damage: { head: 36, body: 18, leg: 15 } },
      { maxDistance: Infinity, damage: { head: 18, body: 9, leg: 8 } },
    ],
  },
  {
    id: 'rattler',
    name: 'Rattler',
    category: 'sidearm',
    price: 450,
    fireRatePerSecond: 10,
    magazineSize: 13,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 9, damage: { head: 78, body: 26, leg: 22 } },
      { maxDistance: Infinity, damage: { head: 63, body: 21, leg: 18 } },
    ],
  },
  {
    id: 'wolfpack',
    name: 'Wolfpack',
    category: 'sidearm',
    price: 500,
    fireRatePerSecond: 6.75,
    magazineSize: 15,
    wallPenetration: 'medium',
    damageFalloff: [
      { maxDistance: 30, damage: { head: 105, body: 30, leg: 25 } },
      { maxDistance: Infinity, damage: { head: 88, body: 25, leg: 21 } },
    ],
  },
  {
    id: 'falcon',
    name: 'Falcon',
    category: 'sidearm',
    price: 800,
    fireRatePerSecond: 4,
    magazineSize: 6,
    wallPenetration: 'medium',
    damageFalloff: constant(159, 55, 47),
  },

  // SMG
  {
    id: 'wisp',
    name: 'Wisp',
    category: 'smg',
    price: 1100,
    fireRatePerSecond: 18,
    magazineSize: 20,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 15, damage: { head: 67, body: 19, leg: 16 } },
      { maxDistance: Infinity, damage: { head: 58, body: 16, leg: 14 } },
    ],
  },
  {
    id: 'nightshade',
    name: 'Nightshade',
    category: 'smg',
    price: 1600,
    fireRatePerSecond: 13.33,
    magazineSize: 30,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 15, damage: { head: 78, body: 22, leg: 19 } },
      { maxDistance: Infinity, damage: { head: 66, body: 19, leg: 16 } },
    ],
  },

  // Fusils à pompe
  {
    id: 'scattergun',
    name: 'Scattergun',
    category: 'shotgun',
    price: 850,
    fireRatePerSecond: 1.1,
    magazineSize: 5,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 6, damage: { head: 180, body: 60, leg: 50 } },
      { maxDistance: Infinity, damage: { head: 36, body: 12, leg: 10 } },
    ],
  },
  {
    id: 'verdict',
    name: 'Verdict',
    category: 'shotgun',
    price: 1850,
    fireRatePerSecond: 3.5,
    magazineSize: 7,
    wallPenetration: 'low',
    damageFalloff: [
      { maxDistance: 8, damage: { head: 150, body: 60, leg: 52 } },
      { maxDistance: Infinity, damage: { head: 40, body: 16, leg: 14 } },
    ],
  },

  // Fusils
  {
    id: 'ridgeback',
    name: 'Ridgeback',
    category: 'rifle',
    price: 2050,
    fireRatePerSecond: 9.15,
    magazineSize: 24,
    wallPenetration: 'medium',
    damageFalloff: [
      { maxDistance: 25, damage: { head: 87, body: 35, leg: 29 } },
      { maxDistance: Infinity, damage: { head: 70, body: 28, leg: 23 } },
    ],
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    category: 'rifle',
    price: 2250,
    fireRatePerSecond: 5,
    magazineSize: 12,
    wallPenetration: 'high',
    damageFalloff: constant(195, 65, 55),
  },
  {
    id: 'reaper',
    name: 'Reaper',
    category: 'rifle',
    price: 2900,
    fireRatePerSecond: 11,
    magazineSize: 25,
    wallPenetration: 'medium',
    damageFalloff: [
      { maxDistance: 15, damage: { head: 156, body: 39, leg: 33 } },
      { maxDistance: 30, damage: { head: 140, body: 35, leg: 30 } },
      { maxDistance: Infinity, damage: { head: 124, body: 31, leg: 26 } },
    ],
  },
  {
    id: 'warhawk',
    name: 'Warhawk',
    category: 'rifle',
    price: 2900,
    fireRatePerSecond: 9.75,
    magazineSize: 25,
    wallPenetration: 'medium',
    // Pas de dropoff : dégâts constants quelle que soit la distance.
    damageFalloff: constant(160, 40, 34),
  },

  // Mitrailleuses
  {
    id: 'grinder',
    name: 'Grinder',
    category: 'mg',
    price: 1600,
    fireRatePerSecond: 10,
    magazineSize: 50,
    wallPenetration: 'high',
    damageFalloff: [
      { maxDistance: 20, damage: { head: 72, body: 30, leg: 25 } },
      { maxDistance: Infinity, damage: { head: 58, body: 24, leg: 20 } },
    ],
  },
  {
    id: 'juggernaut',
    name: 'Juggernaut',
    category: 'mg',
    price: 3200,
    fireRatePerSecond: 12.5,
    magazineSize: 100,
    wallPenetration: 'high',
    damageFalloff: [
      { maxDistance: 20, damage: { head: 78, body: 32, leg: 27 } },
      { maxDistance: Infinity, damage: { head: 63, body: 26, leg: 22 } },
    ],
  },

  // Snipers
  {
    id: 'ranger',
    name: 'Ranger',
    category: 'sniper',
    price: 950,
    fireRatePerSecond: 1.16,
    magazineSize: 5,
    wallPenetration: 'high',
    damageFalloff: constant(202, 101, 85),
  },
  {
    id: 'renegade',
    name: 'Renegade',
    category: 'sniper',
    price: 2400,
    fireRatePerSecond: 0.75,
    magazineSize: 2,
    wallPenetration: 'high',
    damageFalloff: constant(238, 170, 145),
  },
  {
    id: 'longbow',
    name: 'Longbow',
    category: 'sniper',
    price: 4700,
    fireRatePerSecond: 0.6,
    magazineSize: 5,
    wallPenetration: 'high',
    damageFalloff: constant(255, 150, 127),
  },
];

export const ARMOR_ITEMS: ArmorItem[] = [
  { id: 'light_shield', name: 'Light Shield', price: 400, armorPoints: 25 },
  { id: 'heavy_shield', name: 'Heavy Shield', price: 1000, armorPoints: 50 },
];

export const WEAPONS_BY_ID: Record<string, Weapon> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const ARMOR_BY_ID: Record<string, ArmorItem> = Object.fromEntries(ARMOR_ITEMS.map((a) => [a.id, a]));
