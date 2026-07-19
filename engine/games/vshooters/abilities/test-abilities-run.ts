import { buildNavGrid, findPath, hasLineOfSight, resetBotMemories, setBotDestination } from '../../../ai';
import { EntityManager, EventBus, runSimulation } from '../../../core';
import { EntityState, MapData } from '../../../types';
import { AEGIS, AGENT_REGISTRY, ARCHITECT, GALE, VANGUARD } from './agents';
import {
  AbilityWorldStateBox,
  applyEffectsToNavGrid,
  applyVisionOverrides,
  createAbilityLoadout,
  createAgentAbilitiesOnTick,
  createEmptyAbilityWorldState,
  getStatModifier,
  getUltimatePoints,
  hasLineOfSightWithAbilities,
} from './integration';
import { activateAbility, updateActiveEffects } from './types';
import { WEAPONS_BY_ID } from '../weapons';

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

function makeOpenMap(width: number, height: number): MapData {
  return { id: 'test', name: 'Test', imageUrl: 'test.webp', width, height, zones: [], walls: [], boxes: [], navGrid: null };
}

function makeEntity(overrides: Partial<EntityState> & { id: string; team: string }): EntityState {
  return { position: { x: 0, y: 0 }, rotation: 0, health: 100, status: 'alive', currentAction: null, ...overrides };
}

const eventBus = new EventBus();
const activationContext = (mapData: MapData, allEntities: EntityState[], tick: number) => ({
  tick,
  tickRate: 30,
  mapData,
  allEntities,
  eventBus,
});

// ============================================================================
// 1. Une fumée du Vanguard bloque hasLineOfSight entre deux points qui se voyaient avant
// ============================================================================
console.log('=== 1. Fumée du Vanguard bloque la ligne de vue ===\n');

const mapA = makeOpenMap(200, 200);
const pointA = { x: 20, y: 50 };
const pointB = { x: 180, y: 50 };
console.log(`  hasLineOfSight de base (${pointA.x},${pointA.y}) -> (${pointB.x},${pointB.y}) : ${hasLineOfSight(mapA, pointA, pointB)}`);
check('Les deux points se voient AVANT la fumée', hasLineOfSight(mapA, pointA, pointB) === true);

const vanguardEntity = makeEntity({ id: 'van-1', team: 'attackers', position: pointA, abilityLoadout: createAbilityLoadout(VANGUARD) });
const skySmoke = VANGUARD.abilities.find((a) => a.id === 'vanguard_sky_smoke')!;
const smokeResult = activateAbility(
  createEmptyAbilityWorldState(),
  vanguardEntity,
  skySmoke,
  { type: 'area', point: { x: 100, y: 50 } },
  activationContext(mapA, [vanguardEntity], 1),
);
check("L'activation de Sky Smoke réussit (charges disponibles)", smokeResult !== null);

const worldStateWithSmoke = smokeResult!.worldState;
console.log(`  Effet créé : ${JSON.stringify(worldStateWithSmoke.effects[0].type)} rayon=${worldStateWithSmoke.effects[0].radius}`);
check('hasLineOfSight SEUL (sans les abilities) reste vrai — non modifié', hasLineOfSight(mapA, pointA, pointB) === true);
check(
  'hasLineOfSightWithAbilities est bloqué APRÈS la fumée',
  hasLineOfSightWithAbilities(mapA, pointA, pointB, worldStateWithSmoke.effects) === false,
);
console.log();

// ============================================================================
// 2. Un mur de l'Aegis bloque le déplacement (findPath contourne) ET la vision
// ============================================================================
console.log("=== 2. Mur de l'Aegis bloque déplacement ET vision ===\n");

const mapB = makeOpenMap(200, 200);
const navGridB = buildNavGrid(mapB, 10);
const start = { x: 20, y: 100 };
const end = { x: 180, y: 100 };

function pathDistance(path: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return total;
}

const directPath = findPath(navGridB, start, end)!;
console.log(`  Chemin direct (sans mur) : ${directPath.length} points, distance=${pathDistance(directPath).toFixed(0)}`);
check('Un chemin direct existe avant la pose du mur', directPath !== null);
check('La ligne de vue directe existe avant la pose du mur', hasLineOfSight(mapB, start, end) === true);

const aegisEntity = makeEntity({ id: 'aegis-1', team: 'defenders', position: { x: 100, y: 100 }, abilityLoadout: createAbilityLoadout(AEGIS) });
const barrierOrb = AEGIS.abilities.find((a) => a.id === 'aegis_barrier_orb')!;
const wallResult = activateAbility(
  createEmptyAbilityWorldState(),
  aegisEntity,
  barrierOrb,
  { type: 'point', point: { x: 100, y: 100 } },
  activationContext(mapB, [aegisEntity], 1),
);
check("L'activation de Barrier Orb réussit et produit 2 effets (blocksVision + blocksMovement)", wallResult!.worldState.effects.length === 2);

const patchedNavGrid = applyEffectsToNavGrid(navGridB, wallResult!.worldState.effects);
const pathAfterWall = findPath(patchedNavGrid, start, end);
const wallEffect = wallResult!.worldState.effects.find((e) => e.type === 'blocksMovement')!;
const passesThroughWall = pathAfterWall?.some((p) => Math.hypot(p.x - wallEffect.position.x, p.y - wallEffect.position.y) <= wallEffect.radius) ?? true;
console.log(
  `  Chemin après le mur : ${pathAfterWall ? `${pathAfterWall.length} points, distance=${pathDistance(pathAfterWall).toFixed(0)} (détour)` : 'AUCUN'}`,
);
check('findPath trouve encore un chemin (contourne le mur)', pathAfterWall !== null);
check("Le chemin ne passe JAMAIS dans la zone du mur (vrai détour, pas un passage au travers)", !passesThroughWall);
check(
  "Le détour est bien plus long en distance réelle que le chemin direct (preuve que le mur a un coût)",
  pathAfterWall !== null && pathDistance(pathAfterWall) > pathDistance(directPath),
);
check(
  'La ligne de vue directe est bloquée APRÈS la pose du mur',
  hasLineOfSightWithAbilities(mapB, start, end, wallResult!.worldState.effects) === false,
);
console.log();

// ============================================================================
// 3. Un flash aveugle une entité (ne peut pas passer "engaging" même si un ennemi est visible)
// ============================================================================
console.log('=== 3. Flash : empêche de passer "engaging" ===\n');

const mapC = makeOpenMap(200, 200);
const blindEventBus = new EventBus();
const blindEntityManager = new EntityManager(blindEventBus);
const blindedEntity = makeEntity({ id: 'blinded-1', team: 'attackers', position: { x: 20, y: 50 }, currentAction: 'engaging' });
const enemyEntity = makeEntity({ id: 'enemy-1', team: 'defenders', position: { x: 30, y: 50 } });
blindEntityManager.addEntity(blindedEntity);
blindEntityManager.addEntity(enemyEntity);

const worldStateWithBlind: AbilityWorldStateBox = {
  current: { effects: [{ id: 'blind-1', abilityId: 'test_flash', sourceEntityId: 'enemy-1', type: 'blind', position: blindedEntity.position, radius: 0, createdAtTick: 0, expiresAtTick: 100, affectedEntityIds: ['blinded-1'] }] },
};

console.log(`  Avant override : currentAction = "${blindEntityManager.getEntity('blinded-1')!.currentAction}"`);
applyVisionOverrides({ tick: 1, timestamp: 33, mapData: mapC, entityManager: blindEntityManager, eventBus: blindEventBus }, worldStateWithBlind.current, 1);
const afterBlind = blindEntityManager.getEntity('blinded-1')!;
console.log(`  Après override : currentAction = "${afterBlind.currentAction}"`);
check('Une entité "engaging" flashée passe à "blinded" (pas engaging) malgré un ennemi visible', afterBlind.currentAction === 'blinded');
console.log();

// ============================================================================
// 4. Le soin de l'Aegis augmente la vie sur plusieurs ticks
// ============================================================================
console.log("=== 4. Soin de l'Aegis sur plusieurs ticks ===\n");

const healEventBus = new EventBus();
const healEntityManager = new EntityManager(healEventBus);
const hurtAlly = makeEntity({ id: 'ally-1', team: 'defenders', position: { x: 50, y: 50 }, health: 40 });
healEntityManager.addEntity(hurtAlly);

const healingOrb = AEGIS.abilities.find((a) => a.id === 'aegis_healing_orb')!;
const healerEntity = makeEntity({ id: 'aegis-2', team: 'defenders', position: { x: 55, y: 50 }, abilityLoadout: createAbilityLoadout(AEGIS) });
const healResult = activateAbility(
  createEmptyAbilityWorldState(),
  healerEntity,
  healingOrb,
  { type: 'entity', entityId: 'ally-1' },
  activationContext(makeOpenMap(200, 200), [healerEntity, hurtAlly], 1),
);
check('Healing Orb ciblant un allié s\'active', healResult !== null);

let healWorldState = healResult!.worldState;
console.log(`  Vie de départ : ${healEntityManager.getEntity('ally-1')!.health}`);
for (let t = 2; t <= 6; t += 1) {
  healWorldState = updateActiveEffects(healWorldState, t, healEntityManager, healEventBus);
  console.log(`  tick ${t} : vie = ${healEntityManager.getEntity('ally-1')!.health.toFixed(1)}`);
}
check('La vie a bien augmenté après plusieurs ticks de soin', healEntityManager.getEntity('ally-1')!.health > 40);
console.log();

// ============================================================================
// 5. La tourelle de l'Architect inflige des dégâts sans intervention du joueur
// ============================================================================
console.log("=== 5. Tourelle de l'Architect : dégâts automatiques ===\n");

// Test ISOLÉ (pas de createAgentAbilitiesOnTick complet) : l'Architect et l'ennemi se
// voient aussi directement, ce qui déclencherait EN PLUS un combat normal à la
// lame via botController/roundManager (aucune arme équipée) — pour prouver
// PRÉCISÉMENT que la tourelle elle-même inflige des dégâts, on n'exerce ici que
// le mécanisme propre à la capacité : decide() -> activateAbility -> updateActiveEffects,
// tick par tick, sans jamais toucher à l'ennemi nous-mêmes.
const mapD = makeOpenMap(200, 200);
const navGridD = buildNavGrid(mapD, 10);
const turretEventBus = new EventBus();
const turretEntityManager = new EntityManager(turretEventBus);

const architectEntity = makeEntity({ id: 'arch-1', team: 'defenders', position: { x: 100, y: 100 }, abilityLoadout: createAbilityLoadout(ARCHITECT) });
const turretEnemy = makeEntity({ id: 'enemy-2', team: 'attackers', position: { x: 120, y: 100 }, health: 100 });
turretEntityManager.addEntity(architectEntity);
turretEntityManager.addEntity(turretEnemy);

let turretWorldState = createEmptyAbilityWorldState();
let autofireCount = 0;
const healthSamples: Record<number, number> = {};

for (let tick = 1; tick <= 150; tick += 1) {
  turretWorldState = updateActiveEffects(turretWorldState, tick, turretEntityManager, turretEventBus);

  const architectNow = turretEntityManager.getEntity('arch-1')!;
  const decisions = ARCHITECT.decide({
    entity: architectNow,
    allEntities: turretEntityManager.getAllEntities(),
    mapData: mapD,
    navGrid: navGridD,
    worldState: turretWorldState,
    tick,
    tickRate: 30,
  });

  decisions.forEach(({ definition, target }) => {
    if (definition.id === 'architect_turret_autofire') autofireCount += 1;
    const result = activateAbility(turretWorldState, architectNow, definition, target, { tick, tickRate: 30, mapData: mapD, allEntities: turretEntityManager.getAllEntities(), eventBus: turretEventBus });
    if (!result) return;
    turretWorldState = result.worldState;
    if (result.selfChanges) turretEntityManager.updateEntity(architectNow.id, result.selfChanges);
  });

  if ([1, 30, 60, 90, 150].includes(tick)) healthSamples[tick] = turretEntityManager.getEntity('enemy-2')!.health;
}

console.log(`  Vie de l'ennemi : ${Object.entries(healthSamples).map(([t, h]) => `tick ${t}=${h.toFixed(0)}`).join(', ')}`);
console.log(`  Nombre de tirs automatiques de la tourelle : ${autofireCount}`);
check("La tourelle a tiré automatiquement (aucune action du script sur l'ennemi)", autofireCount > 0);
check("L'ennemi a bien perdu de la vie", turretEntityManager.getEntity('enemy-2')!.health < 100);
check(
  "Les dégâts correspondent au nombre de tirs (~18 par tir, aucune autre source de dégâts)",
  Math.abs((100 - turretEntityManager.getEntity('enemy-2')!.health) - autofireCount * 18) < 1,
);
console.log();

// ============================================================================
// 6. Les points d'ultimate s'accumulent (temps + kills) et l'ultime nécessite le seuil
// ============================================================================
console.log("=== 6. Accumulation des points d'ultimate ===\n");

const mapE = makeOpenMap(200, 200);
const navGridE = buildNavGrid(mapE, 10);
const vanguardForUlt = makeEntity({ id: 'van-2', team: 'attackers', position: { x: 20, y: 20 }, abilityLoadout: createAbilityLoadout(VANGUARD) });

const config = { attackerTeam: 'attackers', defenderTeam: 'defenders', tickRate: 30 };
const ultMatchStateBox = {
  current: {
    phase: 'active' as const,
    roundNumber: 1,
    phaseStartTick: 0,
    buyPhaseDurationTicks: 0,
    roundDurationTicks: 100000,
    device: { status: 'carried' as const, carrierId: null, plantedAt: null, detonationTick: null, defuse: null },
    teamStats: {},
    lastRoundResult: null,
  },
};
const ultAbilityWorldStateBox: AbilityWorldStateBox = { current: createEmptyAbilityWorldState() };
const ultOnTick = createAgentAbilitiesOnTick(navGridE, ultMatchStateBox, ultAbilityWorldStateBox, AGENT_REGISTRY, config);

let killInjected = false;
const ultTicks = runSimulation(mapE, [vanguardForUlt], {
  tickRate: 30,
  totalTicks: 300,
  onTick: (context) => {
    ultOnTick(context);
    // Simule un kill au tick 150 pour prouver le bonus de points par élimination.
    if (context.tick === 150 && !killInjected) {
      killInjected = true;
      context.eventBus.emit('player:killed', { killerId: 'van-2', victimId: 'someone-else', weaponId: 'warhawk', hitZone: 'body' });
    }
  },
});

// Valeur BRUTE (non arrondie par getUltimatePoints, qui floor() pour le seuil d'activation)
// pour bien montrer la progression continue, même avant d'atteindre un point entier.
const rawPointsAtTick = (tickNumber: number) => ultTicks[tickNumber - 1].snapshot.find((e) => e.id === 'van-2')!.abilityLoadout!.abilities.X!.ultimatePoints;
console.log(
  `  Points d'ultimate (bruts) : tick 1=${rawPointsAtTick(1).toFixed(3)}, tick 149=${rawPointsAtTick(149).toFixed(3)}, tick 150=${rawPointsAtTick(150).toFixed(3)}, tick 300=${rawPointsAtTick(300).toFixed(3)}`,
);
console.log(
  `  Points d'ultimate (seuil, floor) : tick 1=${getUltimatePoints(ultTicks[0].snapshot.find((e) => e.id === 'van-2')!)}, tick 300=${getUltimatePoints(ultTicks[299].snapshot.find((e) => e.id === 'van-2')!)}`,
);
check("Les points d'ultimate augmentent passivement avec le temps (valeur brute)", rawPointsAtTick(149) > rawPointsAtTick(1));
check('Un kill donne un bonus immédiat de points (+1 net au tick du kill)', rawPointsAtTick(150) - rawPointsAtTick(149) >= 0.9);

const orbitalStrike = VANGUARD.abilities.find((a) => a.id === 'vanguard_orbital_strike')!;
const tooEarlyEntity = makeEntity({ id: 'van-3', team: 'attackers', abilityLoadout: createAbilityLoadout(VANGUARD) });
const tooEarlyResult = activateAbility(createEmptyAbilityWorldState(), tooEarlyEntity, orbitalStrike, { type: 'area', point: { x: 0, y: 0 } }, activationContext(mapE, [tooEarlyEntity], 1));
check("L'ultime ne s'active PAS à 0 point (sous le seuil requis)", tooEarlyResult === null);

const readyEntity = { ...tooEarlyEntity, abilityLoadout: { agentId: 'vanguard', abilities: { ...tooEarlyEntity.abilityLoadout!.abilities, X: { charges: 0, ultimatePoints: 7 } } } };
const readyResult = activateAbility(createEmptyAbilityWorldState(), readyEntity, orbitalStrike, { type: 'area', point: { x: 0, y: 0 } }, activationContext(mapE, [readyEntity], 1));
check("L'ultime s'active une fois le seuil (7 points) atteint", readyResult !== null);
console.log();

// ============================================================================
// 7. Un dash de Gale (Tailwind) déplace instantanément l'entité dans la direction visée
// ============================================================================
console.log('=== 7. Dash Tailwind de Gale ===\n');

const mapF = makeOpenMap(400, 200);
const galeEntity = makeEntity({ id: 'gale-1', team: 'attackers', position: { x: 50, y: 100 }, abilityLoadout: createAbilityLoadout(GALE) });
const tailwind = GALE.abilities.find((a) => a.id === 'gale_tailwind')!;

const dashResult = activateAbility(createEmptyAbilityWorldState(), galeEntity, tailwind, { type: 'direction', angle: 0 }, activationContext(mapF, [galeEntity], 1));
const newPosition = dashResult?.selfChanges?.position;
console.log(`  Position avant : (${galeEntity.position.x}, ${galeEntity.position.y})`);
console.log(`  Position après dash (angle 0°) : ${newPosition ? `(${newPosition.x.toFixed(0)}, ${newPosition.y.toFixed(0)})` : 'AUCUN DÉPLACEMENT'}`);
check('Le dash déplace instantanément (position.x augmente fortement, y inchangé, angle 0°)', !!newPosition && newPosition.x > galeEntity.position.x + 200 && Math.abs(newPosition.y - galeEntity.position.y) < 1);

// Cas "fizzle" : un mur direct sur la trajectoire du dash doit l'empêcher (pas de faux passage à travers un mur).
const mapWithWall: MapData = { ...makeOpenMap(400, 200), walls: [{ id: 'w1', points: [{ x: 150, y: 0 }, { x: 150, y: 200 }] }] };
const galeEntity2 = makeEntity({ id: 'gale-2', team: 'attackers', position: { x: 50, y: 100 }, abilityLoadout: createAbilityLoadout(GALE) });
const dashBlockedResult = activateAbility(createEmptyAbilityWorldState(), galeEntity2, tailwind, { type: 'direction', angle: 0 }, activationContext(mapWithWall, [galeEntity2], 1));
console.log(`  Dash vers un mur direct : ${dashBlockedResult?.selfChanges?.position ? 'a bougé (BUG)' : "n'a pas bougé (fizzle, comme attendu)"}`);
check('Le dash ne traverse pas un mur direct (fizzle plutôt que de le traverser)', !dashBlockedResult?.selfChanges?.position);

console.log();

// ============================================================================
// 8. Overdrive Beacon (statModifier) : buff de cadence de tir en zone, puis expiration
// ============================================================================
console.log('=== 8. Overdrive Beacon (statModifier) : buff de cadence de tir ===\n');

const mapG = makeOpenMap(200, 200);
const beaconEventBus = new EventBus();
const beaconEntityManager = new EntityManager(beaconEventBus);

const vanguardBuffer = makeEntity({ id: 'van-4', team: 'attackers', position: { x: 100, y: 100 }, abilityLoadout: createAbilityLoadout(VANGUARD) });
const buffedAlly = makeEntity({ id: 'ally-buffed', team: 'attackers', position: { x: 105, y: 100 } }); // à 5 unités du centre, dans le rayon 15
const farAlly = makeEntity({ id: 'ally-far', team: 'attackers', position: { x: 180, y: 100 } }); // bien hors du rayon
beaconEntityManager.addEntity(vanguardBuffer);
beaconEntityManager.addEntity(buffedAlly);
beaconEntityManager.addEntity(farAlly);

const overdriveBeacon = VANGUARD.abilities.find((a) => a.id === 'vanguard_overdrive_beacon')!;
const beaconResult = activateAbility(
  createEmptyAbilityWorldState(),
  vanguardBuffer,
  overdriveBeacon,
  { type: 'area', point: { x: 100, y: 100 } },
  activationContext(mapG, beaconEntityManager.getAllEntities(), 1),
);
check(
  "L'activation d'Overdrive Beacon réussit et produit un effet \"statModifier\"",
  beaconResult !== null && beaconResult.worldState.effects[0]?.type === 'statModifier',
);

let beaconWorldState = beaconResult!.worldState;
const beaconEffect = beaconWorldState.effects[0];
console.log(
  `  Effet créé : statType=${beaconEffect.statType} multiplicateur=x${beaconEffect.multiplier} rayon=${beaconEffect.radius} expire au tick ${beaconEffect.expiresAtTick}`,
);

const baseFireRate = WEAPONS_BY_ID.warhawk.fireRatePerSecond;
const multiplierInZone = getStatModifier(buffedAlly, 'fireRate', beaconWorldState.effects, 2);
const multiplierOutOfZone = getStatModifier(farAlly, 'fireRate', beaconWorldState.effects, 2);
console.log(`  Cadence de base (Warhawk) : ${baseFireRate}/s`);
console.log(`  Dans la zone (à 5 unités) : x${multiplierInZone} -> ${(baseFireRate * multiplierInZone).toFixed(2)}/s`);
console.log(`  Hors zone (à 80 unités)   : x${multiplierOutOfZone} -> ${(baseFireRate * multiplierOutOfZone).toFixed(2)}/s`);
check('Une entité DANS la zone a une cadence de tir augmentée (multiplicateur > 1)', multiplierInZone > 1);
check("Une entité HORS zone n'est pas affectée (multiplicateur === 1)", multiplierOutOfZone === 1);

const tickAfterExpiry = beaconEffect.expiresAtTick + 1;
beaconWorldState = updateActiveEffects(beaconWorldState, tickAfterExpiry, beaconEntityManager, beaconEventBus);
const multiplierAfterExpiry = getStatModifier(buffedAlly, 'fireRate', beaconWorldState.effects, tickAfterExpiry);
console.log(
  `  Après expiration (tick ${tickAfterExpiry}) : effets actifs restants=${beaconWorldState.effects.length}, multiplicateur=x${multiplierAfterExpiry}`,
);
check("L'effet expire bien après sa durée : la cadence revient à la normale (multiplicateur === 1)", multiplierAfterExpiry === 1);
console.log();

// ============================================================================
// 9. Bout en bout : Overdrive Beacon augmente réellement la cadence de tir en combat simulé
// ============================================================================
console.log('=== 9. Cadence de tir en combat simulé : avec vs sans Overdrive Beacon ===\n');

function createActiveMatchState() {
  return {
    phase: 'active' as const,
    roundNumber: 1,
    phaseStartTick: 0,
    buyPhaseDurationTicks: 0,
    roundDurationTicks: 100000,
    device: { status: 'carried' as const, carrierId: null, plantedAt: null, detonationTick: null, defuse: null },
    teamStats: {},
    lastRoundResult: null,
  };
}

function countEventsForShooter(ticks: ReturnType<typeof runSimulation>, shooterId: string): number {
  return ticks.reduce(
    (count, t) =>
      count +
      t.events.filter(
        (e) =>
          (e.type === 'combat:shot-hit' || e.type === 'combat:shot-missed') &&
          (e.data as { shooterId: string }).shooterId === shooterId,
      ).length,
    0,
  );
}

const FIRE_RATE_TEST_TICKS = 90;

function runFireRateScenario(withBuff: boolean): number {
  const map = makeOpenMap(200, 200);
  const navGrid = buildNavGrid(map, 10);
  // Santé énorme des deux côtés : le combat continue sur toute la durée du test,
  // sans qu'une élimination n'interrompe l'engagement prématurément.
  const shooter = makeEntity({
    id: 'firerate-shooter',
    team: 'attackers',
    position: { x: 50, y: 50 },
    health: 1_000_000,
    equippedWeaponId: 'warhawk',
    currentAmmo: 999,
  });
  const target = makeEntity({ id: 'firerate-target', team: 'defenders', position: { x: 60, y: 50 }, health: 1_000_000 });

  const matchStateBox = { current: createActiveMatchState() };
  const abilityWorldStateBox: AbilityWorldStateBox = {
    current: {
      effects: withBuff
        ? [
            {
              id: 'e2e-firerate-buff',
              abilityId: 'vanguard_overdrive_beacon',
              sourceEntityId: 'firerate-shooter',
              type: 'statModifier' as const,
              statType: 'fireRate' as const,
              multiplier: 1.3,
              position: { x: 50, y: 50 },
              radius: 20,
              createdAtTick: 0,
              expiresAtTick: 100000,
            },
          ]
        : [],
    },
  };
  const onTick = createAgentAbilitiesOnTick(navGrid, matchStateBox, abilityWorldStateBox, AGENT_REGISTRY, config);

  const ticks = runSimulation(map, [shooter, target], { tickRate: 30, totalTicks: FIRE_RATE_TEST_TICKS, onTick });
  return countEventsForShooter(ticks, 'firerate-shooter');
}

const baselineShots = runFireRateScenario(false);
const buffedShots = runFireRateScenario(true);
console.log(`  Tirs sur ${FIRE_RATE_TEST_TICKS} ticks (3s à 30 tick/s) : sans buff=${baselineShots}, avec Overdrive Beacon=${buffedShots}`);
check(
  'Une entité sous Overdrive Beacon tire effectivement plus vite en combat simulé (plus de tirs sur la même durée)',
  buffedShots > baselineShots,
);
console.log();

// ============================================================================
// 10. Bout en bout : le "slow" réduit réellement la distance parcourue en combat simulé
// ============================================================================
console.log('=== 10. Vitesse de déplacement en combat simulé : avec vs sans "slow" ===\n');

const SLOW_TEST_TICKS = 40;
const moveStart = { x: 20, y: 100 };

function runMovementScenario(entityId: string, withSlow: boolean): number {
  resetBotMemories();
  const map = makeOpenMap(700, 200);
  const navGrid = buildNavGrid(map, 10);
  const mover = makeEntity({ id: entityId, team: 'attackers', position: { ...moveStart } });

  const matchStateBox = { current: createActiveMatchState() };
  const abilityWorldStateBox: AbilityWorldStateBox = {
    current: {
      effects: withSlow
        ? [
            {
              id: 'e2e-slow',
              abilityId: 'aegis_slow_orb',
              sourceEntityId: 'test-source',
              type: 'slow' as const,
              slowFactor: 0.5,
              // Rayon très large centré sur le point de départ : couvre tout le trajet
              // du mover sur la durée du test (pas besoin de suivre sa position).
              position: { ...moveStart },
              radius: 1000,
              createdAtTick: 0,
              expiresAtTick: 100000,
            },
          ]
        : [],
    },
  };
  const onTick = createAgentAbilitiesOnTick(navGrid, matchStateBox, abilityWorldStateBox, AGENT_REGISTRY, config);

  setBotDestination(entityId, { x: 650, y: 100 });
  const ticks = runSimulation(map, [mover], { tickRate: 30, totalTicks: SLOW_TEST_TICKS, onTick });
  const finalPosition = ticks[ticks.length - 1].snapshot.find((e) => e.id === entityId)!.position;
  return Math.hypot(finalPosition.x - moveStart.x, finalPosition.y - moveStart.y);
}

const baselineDistance = runMovementScenario('mover-baseline', false);
const slowedDistance = runMovementScenario('mover-slowed', true);
console.log(
  `  Distance parcourue sur ${SLOW_TEST_TICKS} ticks : sans slow=${baselineDistance.toFixed(0)}, avec slow=${slowedDistance.toFixed(0)}`,
);
check(
  'Une entité sous "slow" se déplace effectivement plus lentement en combat simulé (distance parcourue réduite)',
  slowedDistance < baselineDistance,
);

console.log();
const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
