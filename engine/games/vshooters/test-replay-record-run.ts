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
import { MatchStateBox } from './roundManager';
import { exportReplayToFile, recordFullMatch } from './replayRecorder';

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

console.log('=== Enregistrement d\'un match complet (5v5, 10 agents) pour le replay-viewer ===\n');

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

function onMatchTick(context: TickContext, roundStateBox: MatchStateBox, fullMatchState: { attackingTeam: string; defendingTeam: string; teamA: { name: string }; teamB: { name: string } }): void {
  const { entityManager, eventBus, tick } = context;
  const roundState = roundStateBox.current;

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
const replay = recordFullMatch(
  mapData,
  { name: 'Titans', entities: teamAEntities },
  { name: 'Wardens', entities: teamBEntities },
  {
    matchId: 'replay-sample-1',
    tickRate: 30,
    buyPhaseSeconds: 6,
    roundTimeSeconds: 35,
    format: { roundsToWinRegulation: 6, halftimeAfterRound: 5 },
    startingAttacker: 'Titans',
    attackerSpawnPoints: ATTACKER_SPAWNS,
    defenderSpawnPoints: DEFENDER_SPAWNS,
    agentRegistry: AGENT_REGISTRY,
    onTick: onMatchTick,
  },
  { replayId: 'sample-replay' },
);
console.log(`  Match simulé et enregistré en ${Date.now() - startTime}ms.\n`);

const outputPath = path.join(__dirname, 'sample-replay.json');
const { bytesWritten } = exportReplayToFile(replay, outputPath);

console.log('--- Résumé du replay ---');
console.log(`  Fichier : ${outputPath}`);
console.log(`  Taille  : ${(bytesWritten / 1024).toFixed(1)} Ko (${bytesWritten.toLocaleString('fr-FR')} octets)`);
console.log(`  Carte   : ${replay.mapData.name} (${replay.mapData.width}x${replay.mapData.height}), image embarquée=${replay.mapImageDataUrl ? 'oui' : 'non (voir gap documenté : pas de fichier .webp réel pour cette carte de test)'}`);
console.log(`  Score final : ${JSON.stringify({ [replay.matchState.teamA.name]: replay.matchState.teamA.roundsWon, [replay.matchState.teamB.name]: replay.matchState.teamB.roundsWon })} — vainqueur ${replay.matchState.winner}`);
console.log(`  Rounds enregistrés : ${replay.roundIndex.length}`);
console.log(`  Ticks enregistrés : ${replay.tickDeltas.length} (dont ${replay.keyframes.length} keyframes complets, tous les ${replay.keyframeIntervalTicks} ticks)`);
console.log(`  Effets de capacités observés : ${replay.abilityEffects.length}`);
console.log(`  Joueurs suivis : ${Object.keys(replay.playerStats).length}`);
console.log();

console.log('--- Rounds ---');
replay.roundIndex.forEach((r) => {
  console.log(`  Round ${r.roundNumber} [${r.history?.segment ?? '?'}] tick ${r.startTick}->${r.endTick} : ${r.history ? `${r.history.winner} gagne (${r.history.reason})` : '(pas de résultat enregistré)'}`);
});
console.log();

// ============================================================================
// Vérifications
// ============================================================================
console.log('--- Vérifications ---');

check('Le replay contient au moins un round', replay.roundIndex.length > 0);
check('Le replay contient au moins un tick', replay.tickDeltas.length > 0);
check('Le replay contient un keyframe au tout premier tick', replay.keyframes[0]?.tick === replay.tickDeltas[0]?.tick);
check('Le match final est bien "finished" avec un vainqueur désigné', replay.matchState.currentPhase === 'finished' && !!replay.matchState.winner);

// Les ticks doivent être strictement croissants et sans trou (numérotation continue à travers tout le match).
const ticksAreSequential = replay.tickDeltas.every((d, i) => i === 0 || d.tick === replay.tickDeltas[i - 1].tick + 1);
check('Les ticks du replay sont numérotés de façon continue, sans trou, à travers tout le match', ticksAreSequential);

// Chaque round de roundIndex doit avoir une fenêtre de ticks cohérente avec les tickDeltas qui lui sont associés.
const roundWindowsCoherent = replay.roundIndex.every((r) => {
  const ticksOfRound = replay.tickDeltas.filter((d) => d.roundNumber === r.roundNumber);
  return ticksOfRound.length > 0 && ticksOfRound[0].tick === r.startTick && ticksOfRound[ticksOfRound.length - 1].tick === r.endTick;
});
check('La fenêtre de ticks de chaque round (roundIndex) correspond bien aux tickDeltas qui lui sont associés', roundWindowsCoherent);

// Chaque AbilityEffect enregistré doit porter une fenêtre de validité exploitable (creation/expiration).
const effectsHaveValidWindow = replay.abilityEffects.every((e) => typeof e.createdAtTick === 'number' && typeof e.expiresAtTick === 'number' && e.expiresAtTick > e.createdAtTick);
check('Chaque AbilityEffect enregistré porte une fenêtre de ticks de validité exploitable (création < expiration)', effectsHaveValidWindow);

// Reconstruction : depuis le dernier keyframe avant un tick choisi au hasard vers la fin du match, l'application des
// deltas doit produire un état cohérent (positions numériques valides, tous les ids connus).
const midIndex = Math.floor(replay.tickDeltas.length / 2);
const targetTick = replay.tickDeltas[midIndex].tick;
const priorKeyframe = [...replay.keyframes].reverse().find((k) => k.tick <= targetTick)!;
const reconstructed = new Map(priorKeyframe.snapshot.map((e) => [e.id, { ...e }]));
replay.tickDeltas
  .filter((d) => d.tick > priorKeyframe.tick && d.tick <= targetTick)
  .forEach((d) => d.changedEntities.forEach((changes) => reconstructed.set(changes.id, { ...reconstructed.get(changes.id)!, ...changes })));
const allEntityIds = new Set(Object.keys(replay.playerStats));
check(
  `La reconstruction par keyframe+deltas au tick ${targetTick} produit un état complet et cohérent pour les ${allEntityIds.size} joueurs`,
  reconstructed.size === allEntityIds.size && [...reconstructed.values()].every((e) => Number.isFinite(e.position.x) && Number.isFinite(e.position.y)),
);

console.log();
const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
