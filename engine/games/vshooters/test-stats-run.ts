import path from 'node:path';
import { setBotDestination } from '../../ai';
import { EntityManager, TickContext } from '../../core';
import { loadMapFromFile } from '../../map';
import { EntityState, Point } from '../../types';
import { AEGIS, AGENT_REGISTRY, ARCHITECT, BRAMBLE, EMBER, GALE, HAVOC, SCOUT, VANGUARD, VESPER, WARP } from './abilities/agents';
import { createAbilityLoadout } from './abilities/integration';
import { ARMOR_ITEMS, WEAPONS } from './weapons';
import { buyItem, canAfford, STARTING_MONEY } from './economy';
import { DeviceState, interruptDefuse, plantDevice, startDefuse } from './device';
import { RoundHistoryEntry } from './matchManager';
import { MatchStateBox } from './roundManager';
import {
  MatchReport,
  MVP_WEIGHTS,
  PlayerMatchStats,
  calculateMVP,
  createStatsAccumulator,
  formatMatchReport,
  mvpScore,
  trackMatchStats,
} from './statsTracker';

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function makeEntity(overrides: Partial<EntityState> & { id: string; team: string }): EntityState {
  return { position: { x: 0, y: 0 }, rotation: 0, health: 100, status: 'alive', currentAction: null, ...overrides };
}

// ============================================================================
// PARTIE A — createStatsAccumulator en isolation (événements FABRIQUÉS, ticks
// choisis à la main) : c'est le "scénario forcé" qui garantit de vérifier
// assist/premier sang/clutch sans dépendre du hasard d'un vrai match.
// ============================================================================
console.log('=== A. createStatsAccumulator en isolation (assist / first blood / clutch / capacités / argent) ===\n');

const ROSTER = [
  { id: 'r1', team: 'RedTeam' },
  { id: 'r2', team: 'RedTeam' },
  { id: 'r3', team: 'RedTeam' },
  { id: 'b1', team: 'BlueTeam' },
  { id: 'b2', team: 'BlueTeam' },
  { id: 'b3', team: 'BlueTeam' },
  { id: 'b4', team: 'BlueTeam' },
];
const acc = createStatsAccumulator(ROSTER, 30); // tickRate=30 -> fenêtre d'assist = 90 ticks (3s)

console.log('-- Round 1 : assist dans la fenêtre, assist refusé (dégâts insuffisants), assist refusé (hors fenêtre), clutch gagné --\n');

// r1 blesse b1 (60 dmg) puis r3 achève -> assist pour r1, kill+headshot+first blood pour r3.
acc.handleEvent('combat:shot-hit', { shooterId: 'r1', targetId: 'b1', weaponId: 'warhawk', hitZone: 'body', damage: 60, tick: 10 }, 10);
acc.handleEvent('player:killed', { killerId: 'r3', victimId: 'b1', weaponId: 'warhawk', hitZone: 'head' }, 40);

// r2 blesse b2 (20 dmg, sous le seuil de 40) puis r1 achève -> PAS d'assist pour r2, PAS de 2e first blood.
acc.handleEvent('combat:shot-hit', { shooterId: 'r2', targetId: 'b2', weaponId: 'warhawk', hitZone: 'body', damage: 20, tick: 50 }, 50);
acc.handleEvent('player:killed', { killerId: 'r1', victimId: 'b2', weaponId: 'warhawk', hitZone: 'body' }, 60);

// r2 blesse b3 (60 dmg) à tick 100, mais r1 achève à tick 250 (150 ticks plus tard, hors fenêtre 90 ticks) -> PAS d'assist.
acc.handleEvent('combat:shot-hit', { shooterId: 'r2', targetId: 'b3', weaponId: 'warhawk', hitZone: 'body', damage: 60, tick: 100 }, 100);
acc.handleEvent('player:killed', { killerId: 'r1', victimId: 'b3', weaponId: 'warhawk', hitZone: 'body' }, 250);
// -> BlueTeam n'a plus que b4 en vie (3 morts sur 4), RedTeam est au complet : situation de clutch pour b4.

const round1History: RoundHistoryEntry[] = [
  {
    roundNumber: 1,
    segment: 'regulation',
    winner: 'BlueTeam', // b4 gagne malgré la situation défavorable
    reason: 'elimination',
    durationTicks: 300,
    attackerTeam: 'RedTeam',
    defenderTeam: 'BlueTeam',
    killCount: 3,
    scoreAfter: { RedTeam: 0, BlueTeam: 1 },
    moneyAfter: { RedTeam: 0, BlueTeam: 0 },
  },
];
acc.setCurrentRound(2, round1History);

const r3Stats = acc.playerStats.get('r3')!;
const r1Stats = acc.playerStats.get('r1')!;
const r2Stats = acc.playerStats.get('r2')!;
const b4Stats = acc.playerStats.get('b4')!;
console.log(`  r1: kills=${r1Stats.kills} assists=${r1Stats.assists}`);
console.log(`  r2: kills=${r2Stats.kills} assists=${r2Stats.assists}`);
console.log(`  r3: kills=${r3Stats.kills} headshots=${r3Stats.headshots} firstBloods=${r3Stats.firstBloods}`);
console.log(`  b4: clutchRoundsWon=${b4Stats.clutchRoundsWon}`);

check("r1 reçoit bien un assist (60 dmg à 30 ticks du kill, sous le seuil de fenêtre)", r1Stats.assists === 1);
check('r2 ne reçoit PAS d\'assist pour 20 dmg (sous le seuil minimum de 40)', r2Stats.assists === 0);
check("r2 ne reçoit PAS d'assist pour son 2e coup (60 dmg mais 150 ticks avant le kill, hors fenêtre de 90 ticks)", acc.playerStats.get('r2')!.assists === 0);
check('r3 obtient bien le kill + le headshot du round 1', r3Stats.kills === 1 && r3Stats.headshots === 1);
check("r3 obtient bien le FIRST BLOOD du round (le premier kill, pas le 2e ni le 3e)", r3Stats.firstBloods === 1);
check("r1 (2e ET 3e kill du round) n'obtient PAS de first blood supplémentaire", r1Stats.firstBloods === 0);
check('b4, dernier survivant de BlueTeam (1 contre 3), est bien crédité du clutch puisque BlueTeam gagne quand même', b4Stats.clutchRoundsWon === 1);
console.log();

console.log('-- Round 2 : situation de clutch qui échoue (le survivant perd) -> PAS de clutch crédité --\n');

acc.handleEvent('player:killed', { killerId: 'b1', victimId: 'r1', weaponId: 'reaper', hitZone: 'body' }, 400);
acc.handleEvent('player:killed', { killerId: 'b2', victimId: 'r2', weaponId: 'reaper', hitZone: 'body' }, 420);
// -> RedTeam n'a plus que r3 en vie face aux 4 BlueTeam : situation de clutch pour r3, mais BlueTeam va gagner.

const round2History: RoundHistoryEntry[] = [
  ...round1History,
  {
    roundNumber: 2,
    segment: 'regulation',
    winner: 'BlueTeam', // le camp du "survivant" r3 (RedTeam) PERD -> pas de clutch pour lui
    reason: 'elimination',
    durationTicks: 300,
    attackerTeam: 'BlueTeam',
    defenderTeam: 'RedTeam',
    killCount: 2,
    scoreAfter: { RedTeam: 0, BlueTeam: 2 },
    moneyAfter: { RedTeam: 0, BlueTeam: 0 },
  },
];
acc.setCurrentRound(3, round2History);
check("r3, dernier survivant du round 2, N'EST PAS crédité d'un clutch puisque son équipe a PERDU le round", acc.playerStats.get('r3')!.clutchRoundsWon === 0);
console.log();

console.log('-- Round 3 : un 2e clutch réussi, finalisé via finalizeLastRound (fin de match, pas de round suivant) --\n');

acc.handleEvent('player:killed', { killerId: 'r1', victimId: 'b1', weaponId: 'warhawk', hitZone: 'body' }, 500);
acc.handleEvent('player:killed', { killerId: 'r1', victimId: 'b2', weaponId: 'warhawk', hitZone: 'body' }, 520);
acc.handleEvent('player:killed', { killerId: 'r1', victimId: 'b3', weaponId: 'warhawk', hitZone: 'body' }, 540);
// -> BlueTeam retombe à b4 seul en vie (tout le monde réapparaît vivant à chaque round) : re-situation de clutch pour b4.

const round3History: RoundHistoryEntry[] = [
  ...round2History,
  {
    roundNumber: 3,
    segment: 'regulation',
    winner: 'BlueTeam',
    reason: 'elimination',
    durationTicks: 300,
    attackerTeam: 'RedTeam',
    defenderTeam: 'BlueTeam',
    killCount: 3,
    scoreAfter: { RedTeam: 0, BlueTeam: 3 },
    moneyAfter: { RedTeam: 0, BlueTeam: 0 },
  },
];
acc.finalizeLastRound(round3History); // pas de round 4 : c'est ainsi que le DERNIER round joué doit être finalisé
check('b4 obtient un 2e clutch au round 3, finalisé via finalizeLastRound (fin de match)', acc.playerStats.get('b4')!.clutchRoundsWon === 2);
console.log();

console.log('-- Capacités, pose/désamorçage, argent dépensé --\n');
acc.handleEvent('ability:activated', { entityId: 'r1', abilityId: 'vanguard_incendiary', agentId: 'vanguard', slot: 'C', tick: 5 }, 5);
acc.handleEvent('ability:activated', { entityId: 'r1', abilityId: 'vanguard_incendiary', agentId: 'vanguard', slot: 'C', tick: 200 }, 200);
acc.handleEvent('ability:activated', { entityId: 'r1', abilityId: 'vanguard_orbital_strike', agentId: 'vanguard', slot: 'X', tick: 600 }, 600);
check(
  'Le compte de capacités utilisées est correct par capacité (2x Incendiary, 1x Orbital Strike pour r1)',
  acc.playerStats.get('r1')!.abilitiesUsed['vanguard_incendiary'] === 2 && acc.playerStats.get('r1')!.abilitiesUsed['vanguard_orbital_strike'] === 1,
);

acc.handleEvent('device:planted', { entityId: 'r1', zoneId: 'site_b', tick: 700 }, 700);
check('La pose de la charge est bien créditée au poseur', acc.playerStats.get('r1')!.devicePlants === 1);

// Un défuseur commence, est interrompu (aucun événement émis par interruptDefuse — voir device.ts),
// un second défuseur reprend et termine : "device:defused" n'a pas d'entityId, donc le désamorçage
// doit être attribué au DERNIER "device:defusing" observé (b4, pas b1).
acc.handleEvent('device:defusing', { entityId: 'b1', tick: 710 }, 710);
acc.handleEvent('device:defusing', { entityId: 'b4', tick: 730 }, 730);
acc.handleEvent('device:defused', { tick: 737 }, 737);
check("Le désamorçage est attribué au DERNIER joueur ayant démarré le désamorçage (b4), pas au premier (b1) interrompu", acc.playerStats.get('b4')!.deviceDefuses === 1 && acc.playerStats.get('b1')!.deviceDefuses === 0);

// Argent : une baisse = achat (déduit), une hausse = gain de round/kill (ignorée pour "dépensé").
acc.handleEvent('entity:updated', makeEntity({ id: 'r2', team: 'RedTeam', money: 800 }), 1);
acc.handleEvent('entity:updated', makeEntity({ id: 'r2', team: 'RedTeam', money: 200 }), 2); // achat de 600$
acc.handleEvent('entity:updated', makeEntity({ id: 'r2', team: 'RedTeam', money: 2500 }), 3); // gain de round (+2300$, ignoré)
acc.handleEvent('entity:updated', makeEntity({ id: 'r2', team: 'RedTeam', money: 1600 }), 4); // achat de 900$
check("L'argent dépensé cumule les BAISSES de money (600$ + 900$ = 1500$) et ignore les hausses (gains)", acc.playerStats.get('r2')!.moneySpent === 1500);
console.log();

console.log('-- Formule de MVP (pondérations documentées, ajustables) --\n');
console.log(`  Pondérations : ${JSON.stringify(MVP_WEIGHTS)}`);
const sampleStats: PlayerMatchStats = {
  entityId: 'sample', team: 'RedTeam', kills: 10, deaths: 5, assists: 3, headshots: 4, shotsFired: 40, shotsHit: 20,
  damageDealt: 1500, damageTaken: 900, clutchRoundsWon: 1, firstBloods: 2, abilitiesUsed: {}, devicePlants: 0, deviceDefuses: 0, moneySpent: 0,
};
const expectedScore = 10 * MVP_WEIGHTS.kill + 3 * MVP_WEIGHTS.assist + 1 * MVP_WEIGHTS.clutchRoundWon + 4 * MVP_WEIGHTS.headshot + 2 * MVP_WEIGHTS.firstBlood + (1500 / 100) * MVP_WEIGHTS.damageDealtPer100;
console.log(`  Score attendu pour un profil de test (10 kills, 3 assists, 1 clutch, 4 headshots, 2 first bloods, 1500 dmg) = ${expectedScore}`);
check('mvpScore applique exactement la formule documentée', mvpScore(sampleStats) === expectedScore);

const mvpMap = new Map<string, PlayerMatchStats>([
  ['low', { ...sampleStats, entityId: 'low', kills: 1, assists: 0, clutchRoundsWon: 0, headshots: 0, firstBloods: 0, damageDealt: 100 }],
  ['high', sampleStats],
]);
check("calculateMVP désigne bien le score le plus élevé", calculateMVP(mvpMap, {} as never) === 'high');
console.log();

// ============================================================================
// PARTIE B — Match complet intégré (5v5, 10 agents, via trackMatchStats)
// ============================================================================
console.log('=== B. Match complet intégré (5v5, trackMatchStats) ===\n');

const mapData = loadMapFromFile(path.join(__dirname, 'test-map.json'));
const siteZone = mapData.zones.find((z) => z.type === 'site')!;

const TEAM_A_AGENTS = [VANGUARD, SCOUT, GALE, EMBER, WARP];
const TEAM_B_AGENTS = [AEGIS, ARCHITECT, BRAMBLE, HAVOC, VESPER];

function makeTeamEntities(teamName: string, prefix: string, agents: typeof TEAM_A_AGENTS): EntityState[] {
  return agents.map((agent, i) =>
    makeEntity({
      id: `${prefix}-${i + 1}`,
      team: teamName,
      money: STARTING_MONEY,
      armor: 0,
      weapons: [],
      equippedWeaponId: null,
      currentAmmo: 0,
      abilityLoadout: createAbilityLoadout(agent),
    }),
  );
}

const teamAEntities = makeTeamEntities('Titans', 'titan', TEAM_A_AGENTS);
const teamBEntities = makeTeamEntities('Wardens', 'warden', TEAM_B_AGENTS);

const ATTACKER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 20, y }));
const DEFENDER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 270, y }));
const SITE_TARGETS: Point[] = [30, 45, 60, 75, 90].map((y) => ({ x: 255, y }));

function autoBuy(entityId: string, entityManager: EntityManager): void {
  let current = entityManager.getEntity(entityId)!;
  const bestWeapon = [...WEAPONS].filter((w) => w.price > 0).sort((a, b) => b.price - a.price).find((w) => canAfford(current, w) && current.equippedWeaponId !== w.id);
  if (bestWeapon) {
    const changes = buyItem(current, bestWeapon);
    if (changes) {
      entityManager.updateEntity(entityId, changes);
      current = entityManager.getEntity(entityId)!;
    }
  }
  const bestArmor = [...ARMOR_ITEMS].sort((a, b) => b.armorPoints - a.armorPoints).find((a) => canAfford(current, a) && (current.armor ?? 0) < a.armorPoints);
  if (bestArmor) {
    const changes = buyItem(current, bestArmor);
    if (changes) entityManager.updateEntity(entityId, changes);
  }
}

let lastHandledRoundNumber = 0;
let independentAbilityActivationCount = 0;
let abilityCounterSubscribed = false;

function onMatchTick(context: TickContext, roundStateBox: MatchStateBox, fullMatchState: { attackingTeam: string; defendingTeam: string; teamA: { name: string }; teamB: { name: string } }): void {
  const { entityManager, eventBus, tick } = context;
  const roundState = roundStateBox.current;

  if (!abilityCounterSubscribed) {
    abilityCounterSubscribed = true;
    eventBus.on('ability:activated', () => {
      independentAbilityActivationCount += 1;
    });
  }

  if (roundState.phase === 'buy' && roundState.roundNumber !== lastHandledRoundNumber) {
    lastHandledRoundNumber = roundState.roundNumber;
    entityManager.getAllEntities().forEach((e) => autoBuy(e.id, entityManager));

    // Les DEUX camps reçoivent une destination vers le site — pas seulement l'attaquant
    // (sinon l'équipe qui défend ce round reste figée à son spawn, dépendante de la seule
    // géométrie de ligne de vue de sa position — voir le bilan de "rééquilibrage IA").
    const attackerTeam = fullMatchState.attackingTeam === fullMatchState.teamA.name ? teamAEntities : teamBEntities;
    const defenderTeam = attackerTeam === teamAEntities ? teamBEntities : teamAEntities;
    attackerTeam.forEach((e, i) => setBotDestination(e.id, SITE_TARGETS[i % SITE_TARGETS.length]));
    defenderTeam.forEach((e, i) => setBotDestination(e.id, SITE_TARGETS[i % SITE_TARGETS.length]));
  }

  if (roundState.phase !== 'active') return;

  if (roundState.device.status === 'carried') {
    const carrier = entityManager.getEntity(roundState.device.carrierId!);
    if (carrier && carrier.status === 'alive' && carrier.currentAction !== 'engaging') {
      const planted = plantDevice(roundState.device, carrier, siteZone, tick, 30, eventBus);
      if (planted.status === 'planted') roundStateBox.current = { ...roundState, device: planted };
    }
  } else if (roundState.device.status === 'planted') {
    const nearbyDefender = entityManager
      .getAllEntities()
      .find(
        (e) =>
          e.team === fullMatchState.defendingTeam &&
          e.status === 'alive' &&
          e.currentAction !== 'engaging' &&
          distance(e.position, (roundState.device as DeviceState).plantedAt!.position) < 25,
      );
    if (nearbyDefender) roundStateBox.current = { ...roundState, device: startDefuse(roundState.device, nearbyDefender, tick, 30, eventBus) };
  } else if (roundState.device.status === 'defusing') {
    const defuser = entityManager.getEntity(roundState.device.defuse!.defuserId);
    if (!defuser || defuser.status !== 'alive' || defuser.currentAction === 'engaging') {
      roundStateBox.current = { ...roundState, device: interruptDefuse(roundState.device) };
    }
  }
}

const startTime = Date.now();
const { matchState, playerStats } = trackMatchStats(mapData, { name: 'Titans', entities: teamAEntities }, { name: 'Wardens', entities: teamBEntities }, {
  matchId: 'stats-match-1',
  tickRate: 30,
  buyPhaseSeconds: 6,
  roundTimeSeconds: 35,
  format: { roundsToWinRegulation: 6, halftimeAfterRound: 5 },
  startingAttacker: 'Titans',
  attackerSpawnPoints: ATTACKER_SPAWNS,
  defenderSpawnPoints: DEFENDER_SPAWNS,
  agentRegistry: AGENT_REGISTRY,
  onTick: onMatchTick,
});
console.log(`  (simulé en ${Date.now() - startTime}ms)\n`);

const report: MatchReport = formatMatchReport(matchState, playerStats);

console.log('--- Rapport de match ---');
console.log(`  Match ${report.matchId} sur ${report.mapId} — score final ${JSON.stringify(report.finalScore)} — vainqueur : ${report.winner}`);
console.log(`  ${report.totalRounds} rounds joués.\n`);

console.log('--- Classement par kills ---');
report.playerRows.forEach((row, i) => {
  const acc2 = row.accuracy !== null ? `${(row.accuracy * 100).toFixed(0)}%` : 'n/a';
  console.log(
    `  ${i + 1}. ${row.entityId} [${row.team}] — ${row.kills}K/${row.deaths}D/${row.assists}A, ${row.headshots} headshots, précision=${acc2}, dégâts infligés=${row.damageDealt} (gunplay), clutchs=${row.clutchRoundsWon}, first bloods=${row.firstBloods}, capacités=${Object.values(row.abilitiesUsed).reduce((a, b) => a + b, 0)}`,
  );
});
console.log();

console.log('--- MVP ---');
if (report.mvp) {
  const mvpRow = report.playerRows.find((r) => r.entityId === report.mvp!.entityId)!;
  console.log(`  ${report.mvp.entityId} — score MVP = ${report.mvp.score.toFixed(1)}`);
  console.log(
    `  Détail : ${mvpRow.kills} kills (x${MVP_WEIGHTS.kill}) + ${mvpRow.assists} assists (x${MVP_WEIGHTS.assist}) + ${mvpRow.clutchRoundsWon} clutchs (x${MVP_WEIGHTS.clutchRoundWon}) + ${mvpRow.headshots} headshots (x${MVP_WEIGHTS.headshot}) + ${mvpRow.firstBloods} first bloods (x${MVP_WEIGHTS.firstBlood}) + ${mvpRow.damageDealt} dégâts (/100 x${MVP_WEIGHTS.damageDealtPer100})`,
  );
}
console.log(`  Top fragger : ${report.topFragger?.entityId} (${report.topFragger?.kills} kills)`);
console.log(`  Meilleur clutcher : ${report.bestClutcher ? `${report.bestClutcher.entityId} (${report.bestClutcher.clutchRoundsWon} clutch(s))` : "aucun clutch dans ce run naturel — déjà vérifié explicitement en PARTIE A (scénario forcé)"}`);
console.log();

console.log('--- Vérifications ---');
const totalKills = report.playerRows.reduce((s, r) => s + r.kills, 0);
const totalDeaths = report.playerRows.reduce((s, r) => s + r.deaths, 0);
console.log(`  Total kills=${totalKills}, total deaths=${totalDeaths}`);
check('La somme des kills de Titans + Wardens correspond au nombre total de morts enregistrées', totalKills === totalDeaths);

const totalAbilitiesInStats = report.playerRows.reduce((s, r) => s + Object.values(r.abilitiesUsed).reduce((a, b) => a + b, 0), 0);
console.log(`  Activations de capacités : comptées dans les stats=${totalAbilitiesInStats}, comptées indépendamment (eventBus.on direct)=${independentAbilityActivationCount}`);
check("Le total de capacités utilisées dans les stats correspond au nombre réel d'activations (compté indépendamment)", totalAbilitiesInStats === independentAbilityActivationCount);

check('Le rapport contient bien une ligne de stats pour les 10 joueurs', report.playerRows.length === 10);
check('Un MVP est bien désigné', report.mvp !== null);
console.log();

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
