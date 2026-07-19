import path from 'node:path';
import { buildNavGrid, resetBotMemories, setBotDestination } from '../../ai';
import { EventBus, runSimulation } from '../../core';
import { loadMapFromFile } from '../../map';
import { EntityState, Point, Zone } from '../../types';
import { calculateDamage, isBehindTarget } from './damage';
import { ROUND_WIN_REWARD, buyItem, canAfford, clampMoney, getLossBonus, MAX_MONEY, STARTING_MONEY } from './economy';
import {
  createMatchState,
  createMatchOnTick,
  MatchStateBox,
  RoundEndReason,
} from './roundManager';
import { createDeviceState, interruptDefuse, plantDevice, startDefuse, updateDeviceTimers } from './device';
import { ARMOR_BY_ID, BLADE, WEAPONS_BY_ID } from './weapons';

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function makeEntity(overrides: Partial<EntityState> & { id: string; team: string }): EntityState {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    health: 100,
    status: 'alive',
    currentAction: null,
    ...overrides,
  };
}

// ============================================================================
// PARTIE A — Vérifications unitaires déterministes (sans simulation, sans RNG)
// ============================================================================

console.log('=== A. Vérifications unitaires (déterministes) ===\n');

console.log('-- Armure --');
const warhawk = WEAPONS_BY_ID.warhawk;
const bodyNoArmor = calculateDamage(warhawk, 'body', 10, 0);
const bodyHeavyArmor = calculateDamage(warhawk, 'body', 10, 50);
const headNoArmor = calculateDamage(warhawk, 'head', 10, 0);
const headHeavyArmor = calculateDamage(warhawk, 'head', 10, 50);
console.log(`  Warhawk corps: sans armure=${bodyNoArmor.toFixed(1)}  avec Heavy Shield=${bodyHeavyArmor.toFixed(1)}`);
console.log(`  Warhawk tête : sans armure=${headNoArmor.toFixed(1)}  avec Heavy Shield=${headHeavyArmor.toFixed(1)}`);
check("L'armure réduit les dégâts au corps", bodyHeavyArmor < bodyNoArmor);
check('La tête est presque non protégée par l\'armure (< 10% de réduction)', headHeavyArmor > headNoArmor * 0.9);
console.log();

console.log('-- Dropoff de distance --');
const reaper = WEAPONS_BY_ID.reaper;
const reaperClose = calculateDamage(reaper, 'body', 5, 0);
const reaperFar = calculateDamage(reaper, 'body', 40, 0);
const warhawkClose = calculateDamage(warhawk, 'body', 5, 0);
const warhawkFar = calculateDamage(warhawk, 'body', 40, 0);
console.log(`  Reaper corps : proche=${reaperClose}  loin=${reaperFar}`);
console.log(`  Warhawk corps: proche=${warhawkClose}  loin=${warhawkFar}`);
check('Le Reaper a un dropoff (dégâts proches > dégâts loin)', reaperClose > reaperFar);
check('Le Warhawk a des dégâts constants quelle que soit la distance', warhawkClose === warhawkFar);
console.log();

console.log('-- Corps à corps : bonus dans le dos --');
const targetFacingEast = makeEntity({ id: 'target', team: 'defenders', position: { x: 100, y: 100 }, rotation: 0 });
const behind = isBehindTarget(targetFacingEast, { x: 80, y: 100 });
const front = isBehindTarget(targetFacingEast, { x: 120, y: 100 });
check('isBehindTarget détecte une attaque dans le dos', behind === true);
check('isBehindTarget ne détecte pas une attaque de face', front === false);
const bladeNormal = calculateDamage(BLADE, 'body', 1, 0, false);
const bladeBackstab = calculateDamage(BLADE, 'body', 1, 0, true);
check(`La lame fait plus de dégâts dans le dos (${bladeNormal} -> ${bladeBackstab})`, bladeBackstab > bladeNormal);
console.log();

console.log('-- Économie --');
check('clampMoney plafonne à MAX_MONEY', clampMoney(50000) === MAX_MONEY);
const poorEntity = makeEntity({ id: 'poor', team: 'attackers', money: STARTING_MONEY });
const longbowPurchase = buyItem(poorEntity, WEAPONS_BY_ID.longbow);
check(
  `Achat impossible sans les fonds (Longbow 4700$ avec ${STARTING_MONEY}$ de départ)`,
  longbowPurchase === null && !canAfford(poorEntity, WEAPONS_BY_ID.longbow),
);
const richEntity = makeEntity({ id: 'rich', team: 'attackers', money: 5000 });
const warhawkPurchase = buyItem(richEntity, warhawk);
check(
  `Achat réussi avec les fonds (Warhawk 2900$ avec 5000$) -> reste ${warhawkPurchase?.money}$`,
  warhawkPurchase !== null && warhawkPurchase.money === 5000 - warhawk.price,
);
console.log();

console.log('-- Loss bonus progressif --');
const lossBonuses = [1, 2, 3, 4, 5].map(getLossBonus);
console.log(`  Séquence (défaites consécutives 1..5) : ${lossBonuses.join(', ')}`);
check('Progression 1900 -> 2400 -> 2900 -> 3400 -> 3400 (plafonné)', JSON.stringify(lossBonuses) === JSON.stringify([1900, 2400, 2900, 3400, 3400]));
console.log();

console.log('-- Cycle de la charge --');
const dummyEventBus = new EventBus();
const carrier = makeEntity({ id: 'atk-1', team: 'attackers', position: { x: 250, y: 50 } });
const nonSiteZone: Zone = {
  id: 'corridor',
  name: 'Corridor',
  type: 'corridor',
  polygon: [
    { x: 200, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 200 },
    { x: 200, y: 200 },
  ],
};
const siteZoneForUnitTest: Zone = {
  id: 'site_b',
  name: 'Site B',
  type: 'site',
  polygon: [
    { x: 220, y: 10 },
    { x: 290, y: 10 },
    { x: 290, y: 110 },
    { x: 220, y: 110 },
  ],
};

let device = createDeviceState('atk-1');
check('Charge créée en état "carried"', device.status === 'carried');

const rejectedPlant = plantDevice(device, carrier, nonSiteZone, 0, 30, dummyEventBus);
check('Pose refusée hors zone de type "site"', rejectedPlant.status === 'carried');

device = plantDevice(device, carrier, siteZoneForUnitTest, 0, 30, dummyEventBus);
check('Charge "planted" après pose valide sur le site', device.status === 'planted' && device.detonationTick === 45 * 30);

const defuser = makeEntity({ id: 'def-1', team: 'defenders', position: { x: 250, y: 50 } });
device = startDefuse(device, defuser, 100, 30, dummyEventBus);
check('Charge "defusing" après début de désamorçage', device.status === 'defusing');

device = interruptDefuse(device);
check('Charge repasse "planted" après interruption du désamorçage', device.status === 'planted');

device = startDefuse(device, defuser, 200, 30, dummyEventBus);
device = updateDeviceTimers(device, device.defuse!.completesAtTick, dummyEventBus);
check('Charge "defused" une fois le timer de désamorçage écoulé', device.status === 'defused');

let device2 = plantDevice(createDeviceState('atk-2'), makeEntity({ id: 'atk-2', team: 'attackers', position: { x: 250, y: 50 } }), siteZoneForUnitTest, 0, 30, dummyEventBus);
device2 = updateDeviceTimers(device2, device2.detonationTick! - 1, dummyEventBus);
check('Pas de détonation avant le timer', device2.status === 'planted');
device2 = updateDeviceTimers(device2, device2.detonationTick!, dummyEventBus);
check('Charge "detonated" une fois le timer de détonation écoulé', device2.status === 'detonated');
console.log();

// ============================================================================
// PARTIE B — Simulation intégrée d'un round complet
// ============================================================================

console.log('=== B. Simulation intégrée : un round complet ===\n');

resetBotMemories();

const mapData = loadMapFromFile(path.join(__dirname, 'test-map.json'));
const navGrid = buildNavGrid(mapData, 10);
mapData.navGrid = navGrid;

const CONFIG = {
  attackerTeam: 'attackers',
  defenderTeam: 'defenders',
  tickRate: 30,
  buyPhaseSeconds: 30,
  roundTimeSeconds: 100,
};

const initialEntities: EntityState[] = [
  makeEntity({ id: 'atk-1', team: 'attackers', position: { x: 20, y: 30 }, money: 5000, armor: 0, weapons: [], equippedWeaponId: null, currentAmmo: 0 }),
  makeEntity({ id: 'atk-2', team: 'attackers', position: { x: 20, y: 50 }, money: 5000, armor: 0, weapons: [], equippedWeaponId: null, currentAmmo: 0 }),
  makeEntity({ id: 'def-1', team: 'defenders', position: { x: 270, y: 30 }, rotation: 180, money: 5000, armor: 0, weapons: [], equippedWeaponId: null, currentAmmo: 0 }),
  makeEntity({ id: 'def-2', team: 'defenders', position: { x: 270, y: 50 }, rotation: 180, money: 5000, armor: 0, weapons: [], equippedWeaponId: null, currentAmmo: 0 }),
];

const matchStateBox: MatchStateBox = { current: createMatchState(CONFIG, 'atk-1') };

setBotDestination('atk-1', { x: 255, y: 60 });
setBotDestination('atk-2', { x: 255, y: 40 });

const siteZone = mapData.zones.find((z) => z.id === 'site_b')!;
const matchOnTick = createMatchOnTick(navGrid, matchStateBox, CONFIG);

let purchasesLogged = false;
let devicePlantLogged = false;
let defuseStartLogged = false;

const SHOPPING_LIST: Record<string, { weapon: string; armor: string }> = {
  'atk-1': { weapon: 'warhawk', armor: 'heavy_shield' },
  'atk-2': { weapon: 'reaper', armor: 'light_shield' },
  'def-1': { weapon: 'reaper', armor: 'heavy_shield' },
  'def-2': { weapon: 'sentinel', armor: 'light_shield' },
};

const TOTAL_TICKS = 4500;

const ticks = runSimulation(mapData, initialEntities, {
  tickRate: CONFIG.tickRate,
  totalTicks: TOTAL_TICKS,
  onTick: (context) => {
    const { entityManager, eventBus, tick } = context;

    // Phase d'achat scriptée : chaque entité fait ses achats une fois, au début de la phase "buy".
    if (!purchasesLogged && matchStateBox.current.phase === 'buy') {
      purchasesLogged = true;
      Object.entries(SHOPPING_LIST).forEach(([entityId, purchase]) => {
        const entity = entityManager.getEntity(entityId)!;
        const weaponChanges = buyItem(entity, WEAPONS_BY_ID[purchase.weapon]);
        if (weaponChanges) {
          entityManager.updateEntity(entityId, weaponChanges);
          console.log(`  [achat] ${entityId} achète ${purchase.weapon} (reste ${weaponChanges.money}$)`);
        }
        const afterWeapon = entityManager.getEntity(entityId)!;
        const armorChanges = buyItem(afterWeapon, ARMOR_BY_ID[purchase.armor]);
        if (armorChanges) {
          entityManager.updateEntity(entityId, armorChanges);
          console.log(`  [achat] ${entityId} achète ${purchase.armor} (reste ${armorChanges.money}$)`);
        }
      });
      console.log();
    }

    matchOnTick(context);

    // Scénario scripté (pas de l'IA) : pose la charge une fois arrivé sur site sans
    // ennemi visible ; démarre le désamorçage si un défenseur libre est à proximité ;
    // interrompt si le défuseur meurt ou repère un ennemi.
    const state = matchStateBox.current;
    if (state.phase !== 'active') return;

    if (state.device.status === 'carried') {
      const carrier = entityManager.getEntity(state.device.carrierId!);
      if (carrier && carrier.status === 'alive' && carrier.currentAction !== 'engaging') {
        const planted = plantDevice(state.device, carrier, siteZone, tick, CONFIG.tickRate, eventBus);
        if (planted.status === 'planted') {
          matchStateBox.current = { ...state, device: planted };
          if (!devicePlantLogged) {
            devicePlantLogged = true;
            console.log(`  [scénario] ${carrier.id} pose la charge au tick ${tick}`);
          }
        }
      }
    } else if (state.device.status === 'planted') {
      const nearbyDefender = entityManager
        .getAllEntities()
        .find(
          (e) =>
            e.team === CONFIG.defenderTeam &&
            e.status === 'alive' &&
            e.currentAction !== 'engaging' &&
            distanceBetween(e.position, state.device.plantedAt!.position) < 25,
        );
      if (nearbyDefender) {
        matchStateBox.current = { ...state, device: startDefuse(state.device, nearbyDefender, tick, CONFIG.tickRate, eventBus) };
        if (!defuseStartLogged) {
          defuseStartLogged = true;
          console.log(`  [scénario] ${nearbyDefender.id} démarre le désamorçage au tick ${tick}`);
        }
      }
    } else if (state.device.status === 'defusing') {
      const defuser = entityManager.getEntity(state.device.defuse!.defuserId);
      if (!defuser || defuser.status !== 'alive' || defuser.currentAction === 'engaging') {
        matchStateBox.current = { ...state, device: interruptDefuse(state.device) };
        console.log(`  [scénario] désamorçage interrompu au tick ${tick}`);
      }
    }
  },
});

console.log(`\n${ticks.length} ticks simulés.\n`);

interface PhaseChangedData {
  from: string;
  to: string;
}
interface ShotHitData {
  shooterId: string;
  targetId: string;
  weaponId: string;
  hitZone: string;
  damage: number;
}
interface KillData {
  killerId: string;
  victimId: string;
  weaponId: string;
  hitZone: string;
}
interface RoundEndedData {
  winner: string;
  reason: RoundEndReason;
}

const phaseChangedEvents = ticks.flatMap((t) => t.events.filter((e) => e.type === 'round:phase-changed'));
const shotHitEvents = ticks.flatMap((t) => t.events.filter((e) => e.type === 'combat:shot-hit'));
const killEvents = ticks.flatMap((t) => t.events.filter((e) => e.type === 'player:killed'));
const deviceEvents = ticks.flatMap((t) => t.events.filter((e) => e.type.startsWith('device:')));
const roundEndedEvents = ticks.flatMap((t) => t.events.filter((e) => e.type === 'round:ended'));

console.log('--- Changements de phase ---');
phaseChangedEvents.forEach((e) => {
  const d = e.data as PhaseChangedData;
  console.log(`  tick ${e.tick}: ${d.from} -> ${d.to}`);
});
console.log();

console.log(`--- Tirs touchés (${shotHitEvents.length}) ---`);
shotHitEvents.slice(0, 25).forEach((e) => {
  const d = e.data as ShotHitData;
  console.log(`  tick ${e.tick}: ${d.shooterId} touche ${d.targetId} (${d.weaponId}, ${d.hitZone}) pour ${d.damage} dégâts`);
});
if (shotHitEvents.length > 25) console.log(`  ... et ${shotHitEvents.length - 25} de plus`);
console.log();

console.log('--- Éliminations ---');
if (killEvents.length === 0) console.log('  (aucune)');
killEvents.forEach((e) => {
  const d = e.data as KillData;
  console.log(`  tick ${e.tick}: ${d.killerId} élimine ${d.victimId} (${d.weaponId}, ${d.hitZone})`);
});
console.log();

console.log('--- Événements charge ---');
if (deviceEvents.length === 0) console.log('  (aucun)');
deviceEvents.forEach((e) => console.log(`  tick ${e.tick}: ${e.type} ${JSON.stringify(e.data)}`));
console.log();

const roundEndedEvent = roundEndedEvents[0];
console.log('=== Vérifications de la simulation intégrée ===\n');
check('Le round se termine avant la fin du budget de ticks', roundEndedEvent !== undefined);

if (roundEndedEvent) {
  const result = roundEndedEvent.data as RoundEndedData;
  console.log(`  Résultat : ${result.winner} gagne (${result.reason}) au tick ${roundEndedEvent.tick}`);

  const finalSnapshot = ticks[ticks.length - 1].snapshot;
  console.log('\n--- Argent final (après distribution de fin de round) ---');
  finalSnapshot.forEach((e) => {
    console.log(`  ${e.id} [${e.team}] : ${e.money}$ (armure=${e.armor}, arme=${e.equippedWeaponId ?? '-'})`);
  });

  const stats = matchStateBox.current.teamStats;
  console.log('\n--- Stats d\'équipe après le round ---');
  Object.entries(stats).forEach(([team, s]) => console.log(`  ${team}: ${s.wins} victoire(s), ${s.consecutiveLosses} défaite(s) consécutive(s)`));

  const loserTeam = result.winner === CONFIG.attackerTeam ? CONFIG.defenderTeam : CONFIG.attackerTeam;

  // Delta d'argent au tick précis de la distribution (avant/après), pour vérifier le
  // MONTANT de la récompense elle-même — indépendamment de l'argent restant des achats
  // ou des kills gagnés en cours de round, qui varient par joueur.
  const endedIndex = ticks.findIndex((t) => t.tick === roundEndedEvent.tick);
  const beforePayout = ticks[endedIndex - 1].snapshot;
  const afterPayout = ticks[endedIndex].snapshot;
  const deltaFor = (entityId: string) =>
    (afterPayout.find((e) => e.id === entityId)!.money ?? 0) - (beforePayout.find((e) => e.id === entityId)!.money ?? 0);

  const winnerDeltas = afterPayout.filter((e) => e.team === result.winner).map((e) => deltaFor(e.id));
  const loserDeltas = afterPayout.filter((e) => e.team === loserTeam).map((e) => deltaFor(e.id));
  console.log(`\n  Gain de manche (delta au tick ${roundEndedEvent.tick}) : gagnants=${winnerDeltas.join(',')}  perdants=${loserDeltas.join(',')}`);

  check(`Chaque gagnant reçoit au moins ROUND_WIN_REWARD (${ROUND_WIN_REWARD}$) ce tick-là`, winnerDeltas.every((d) => d >= ROUND_WIN_REWARD));
  check('Chaque perdant reçoit le loss bonus (>= 1900$, 1ère défaite) ce tick-là', loserDeltas.every((d) => d >= 1900));
  check(`L'équipe perdante a bien 1 défaite consécutive enregistrée`, stats[loserTeam]?.consecutiveLosses === 1);
  check(`L'équipe gagnante a 0 défaite consécutive (reset)`, stats[result.winner]?.consecutiveLosses === 0);

  if (deviceEvents.some((e) => e.type === 'device:planted')) {
    console.log('\n  (La charge a été posée pendant ce round — cycle observé ci-dessus.)');
  }
} else {
  console.log('  Le round tourne encore après le budget de ticks alloué (augmenter TOTAL_TICKS si besoin).');
}

console.log();
const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
