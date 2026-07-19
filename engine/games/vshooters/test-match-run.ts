import path from 'node:path';
import { setBotDestination } from '../../ai';
import { EntityManager, EventBus, TickContext } from '../../core';
import { loadMapFromFile } from '../../map';
import { EntityState, Point } from '../../types';
import { AEGIS, AGENT_REGISTRY, ARCHITECT, BRAMBLE, EMBER, GALE, HAVOC, SCOUT, VANGUARD, VESPER, WARP } from './abilities/agents';
import { createAbilityLoadout } from './abilities/integration';
import { ARMOR_ITEMS, WEAPONS } from './weapons';
import { buyItem, canAfford, STARTING_MONEY } from './economy';
import { DeviceState, interruptDefuse, plantDevice, startDefuse } from './device';
import { MatchStateBox } from './roundManager';
import {
  AdvanceMatchContext,
  DEFAULT_MATCH_FORMAT,
  FullMatchState,
  advanceMatch,
  createFullMatchState,
  runFullMatch,
} from './matchManager';

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
// PARTIE A — advanceMatch en isolation (résultats de round FABRIQUÉS, sans
// simulation ni RNG) : c'est le "scénario forcé" qui garantit de déclencher
// et de résoudre l'overtime, sans dépendre du hasard d'un vrai match 5v5.
// ============================================================================
console.log('=== A. advanceMatch en isolation (score/mi-temps/overtime déterministes) ===\n');

console.log('-- Format par défaut et format personnalisé --');
check('Format par défaut : 13 rounds pour gagner, mi-temps après le round 12', DEFAULT_MATCH_FORMAT.roundsToWinRegulation === 13 && DEFAULT_MATCH_FORMAT.halftimeAfterRound === 12);
check("Format par défaut : overtime 'premier à mener de 2', mini-manches de 3, échange de camp chaque round", DEFAULT_MATCH_FORMAT.overtime.winMargin === 2 && DEFAULT_MATCH_FORMAT.overtime.roundsPerMiniMatch === 3 && DEFAULT_MATCH_FORMAT.overtime.sideSwitchEveryRounds === 1);

const customFormatState = createFullMatchState({
  matchId: 'unit-custom-format',
  mapId: 'test',
  teamA: { name: 'Alpha', entityIds: ['a1'] },
  teamB: { name: 'Bravo', entityIds: ['b1'] },
  format: { roundsToWinRegulation: 6, halftimeAfterRound: 5, overtime: { winMargin: 3 } },
});
check(
  'Un format personnalisé (bo11, mi-temps après 5, écart OT=3) écrase les défauts un par un, le reste hérite',
  customFormatState.format.roundsToWinRegulation === 6 &&
    customFormatState.format.halftimeAfterRound === 5 &&
    customFormatState.format.overtime.winMargin === 3 &&
    customFormatState.format.overtime.roundsPerMiniMatch === 3, // hérité du défaut, non précisé dans l'override
);
console.log();

console.log('-- Séquence complète : temps réglementaire -> mi-temps -> égalité -> overtime -> fin --\n');

const unitEventBus = new EventBus();
const unitEntityManager = new EntityManager(unitEventBus);
unitEntityManager.addEntity(makeEntity({ id: 'a1', team: 'Alpha', money: 1000 }));
unitEntityManager.addEntity(makeEntity({ id: 'b1', team: 'Bravo', money: 1000 }));

const emittedEvents: { type: string; data: unknown }[] = [];
unitEventBus.onAny((type, data) => {
  if (type.startsWith('match:')) emittedEvents.push({ type, data });
});

function playRound(matchState: FullMatchState, winner: string, tick: number): FullMatchState {
  const context: AdvanceMatchContext = {
    tick,
    roundResult: { winner, reason: 'elimination' },
    roundDurationTicks: 100,
    killCount: 2,
    entityManager: unitEntityManager,
    eventBus: unitEventBus,
  };
  return advanceMatch(matchState, context);
}

let ms = createFullMatchState({
  matchId: 'unit-full-sequence',
  mapId: 'test',
  teamA: { name: 'Alpha', entityIds: ['a1'] },
  teamB: { name: 'Bravo', entityIds: ['b1'] },
  startingAttacker: 'Alpha',
});

const attackerBeforeHalftime = ms.attackingTeam;

// Rounds 1-7 : Alpha. Rounds 8-12 : Bravo. -> 7-5 à la mi-temps (round 12).
for (let r = 1; r <= 7; r += 1) ms = playRound(ms, 'Alpha', r * 100);
for (let r = 8; r <= 12; r += 1) ms = playRound(ms, 'Bravo', r * 100);

console.log(`  Après round 12 : score=${JSON.stringify({ Alpha: ms.teamA.roundsWon, Bravo: ms.teamB.roundsWon })}, phase=${ms.currentPhase}, attaquant=${ms.attackingTeam}`);
check('La mi-temps est bien déclenchée après le round 12 (currentPhase="halftime" à cet instant précis)', ms.currentPhase === 'halftime');
check("Le camp attaquant/défenseur a bien été échangé à la mi-temps", ms.attackingTeam !== attackerBeforeHalftime && ms.attackingTeam === 'Bravo');
check("Un événement 'match:halftime' a bien été émis", emittedEvents.some((e) => e.type === 'match:halftime'));

// Rounds 13-19 : Bravo (7 de plus, total 12). Rounds 20-24 : Alpha (5 de plus, total 12) -> égalité 12-12.
for (let r = 13; r <= 19; r += 1) ms = playRound(ms, 'Bravo', r * 100);
for (let r = 20; r <= 24; r += 1) ms = playRound(ms, 'Alpha', r * 100);

console.log(`  Après round 24 : score=${JSON.stringify({ Alpha: ms.teamA.roundsWon, Bravo: ms.teamB.roundsWon })}, phase=${ms.currentPhase}`);
check('Égalité 12-12 en fin de temps réglementaire : overtime déclenché', ms.currentPhase === 'overtime' && ms.teamA.roundsWon === 12 && ms.teamB.roundsWon === 12);
check("Un événement 'match:overtime-started' a bien été émis", emittedEvents.some((e) => e.type === 'match:overtime-started'));

// OT : Alpha, Bravo, Alpha, Alpha -> Alpha mène 3-1 (écart 2) au 4e round d'OT -> match terminé.
const attackerEnteringOt = ms.attackingTeam;
ms = playRound(ms, 'Alpha', 2500);
check("En overtime, le camp bascule à CHAQUE round (sideSwitchEveryRounds=1)", ms.attackingTeam !== attackerEnteringOt);
ms = playRound(ms, 'Bravo', 2600);
ms = playRound(ms, 'Alpha', 2700);
check('Le match continue tant que l\'écart de victoires OT est < 2 (ici 1-1 puis 2-1)', ms.currentPhase === 'overtime');
ms = playRound(ms, 'Alpha', 2800);

console.log(`  Score final : ${JSON.stringify({ Alpha: ms.teamA.roundsWon, Bravo: ms.teamB.roundsWon })}, vainqueur=${ms.winner}, phase=${ms.currentPhase}`);
check("Le match se termine dès qu'une équipe mène l'overtime de 2 rounds (Alpha 15-13)", ms.currentPhase === 'finished' && ms.winner === 'Alpha' && ms.teamA.roundsWon === 15 && ms.teamB.roundsWon === 13);
check("Un événement 'match:finished' a bien été émis avec le bon vainqueur", emittedEvents.some((e) => e.type === 'match:finished' && (e.data as { winner: string }).winner === 'Alpha'));
check('roundHistory contient exactement un enregistrement par round joué (28 rounds : 24 réglementaires + 4 OT)', ms.roundHistory.length === 28);
check("Chaque enregistrement de roundHistory porte un gagnant, une raison, et le score cumulé APRÈS le round", ms.roundHistory.every((h) => !!h.winner && !!h.reason && typeof h.scoreAfter[h.winner] === 'number'));
check("advanceMatch appelé APRÈS la fin du match ne fait rien (no-op, protège contre un appel tardif)", advanceMatch(ms, { tick: 9999, roundResult: { winner: 'Alpha', reason: 'elimination' }, roundDurationTicks: 1, killCount: 0, entityManager: unitEntityManager, eventBus: unitEventBus }) === ms);
console.log();

// ============================================================================
// PARTIE B — Match complet intégré (5v5, agents variés, via runFullMatch)
// ============================================================================
console.log('=== B. Match complet intégré (5v5, 10 agents différents, runFullMatch) ===\n');

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

console.log(`  Titans  (${TEAM_A_AGENTS.map((a) => a.name).join(', ')})`);
console.log(`  Wardens (${TEAM_B_AGENTS.map((a) => a.name).join(', ')})\n`);

const ATTACKER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 20, y }));
const DEFENDER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 270, y }));
const SITE_TARGETS: Point[] = [30, 45, 60, 75, 90].map((y) => ({ x: 255, y }));

/** Achète l'arme la plus chère abordable (si meilleure que l'équipement actuel) puis l'armure la plus chère abordable. Réutilise economy.ts tel quel — matchManager n'impose aucune stratégie d'achat. */
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

function onMatchTick(context: TickContext, roundStateBox: MatchStateBox, fullMatchState: FullMatchState): void {
  const { entityManager, eventBus, tick } = context;
  const roundState = roundStateBox.current;

  if (roundState.phase === 'buy' && roundState.roundNumber !== lastHandledRoundNumber) {
    lastHandledRoundNumber = roundState.roundNumber;
    entityManager.getAllEntities().forEach((e) => autoBuy(e.id, entityManager));

    // Les DEUX camps reçoivent une destination vers le site — pas seulement l'attaquant.
    // Sans ça, l'équipe qui défend ce round reste figée à son spawn tout le round (jamais
    // "movingTo"), ce qui la rend totalement dépendante de la géométrie de ligne de vue
    // de sa position de spawn (loterie de position, cause confirmée du déséquilibre de kills
    // observé — voir le bilan de l'étape "rééquilibrage IA").
    const attackerTeam = fullMatchState.attackingTeam === fullMatchState.teamA.name ? fullMatchState.teamA : fullMatchState.teamB;
    const defenderTeam = attackerTeam === fullMatchState.teamA ? fullMatchState.teamB : fullMatchState.teamA;
    attackerTeam.entityIds.forEach((id, i) => setBotDestination(id, SITE_TARGETS[i % SITE_TARGETS.length]));
    defenderTeam.entityIds.forEach((id, i) => setBotDestination(id, SITE_TARGETS[i % SITE_TARGETS.length]));
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
const outcome = runFullMatch(mapData, { name: 'Titans', entities: teamAEntities }, { name: 'Wardens', entities: teamBEntities }, {
  matchId: 'integration-match-1',
  tickRate: 30,
  buyPhaseSeconds: 6,
  roundTimeSeconds: 35,
  format: { roundsToWinRegulation: 6, halftimeAfterRound: 5 }, // bo11 réduit : match rapide à simuler, overtime/mi-temps testés sur un format plus court que le défaut (13/12), déjà couvert en isolation ci-dessus.
  startingAttacker: 'Titans',
  attackerSpawnPoints: ATTACKER_SPAWNS,
  defenderSpawnPoints: DEFENDER_SPAWNS,
  agentRegistry: AGENT_REGISTRY,
  onTick: onMatchTick,
});
console.log(`  (simulé en ${Date.now() - startTime}ms, ${outcome.ticks.length} ticks)\n`);

const finalState = outcome.matchState;

console.log('--- Score round par round ---');
finalState.roundHistory.forEach((h) => {
  const segment = h.segment === 'overtime' ? ' [OT]' : '';
  console.log(
    `  Round ${h.roundNumber}${segment} : ${h.winner} gagne (${h.reason}, ${h.killCount} élimination(s)) — score ${JSON.stringify(h.scoreAfter)} — attaquant=${h.attackerTeam}`,
  );
});
console.log();

const halftimeIndex = finalState.roundHistory.findIndex((h) => h.roundNumber === 5);
console.log('--- Mi-temps ---');
if (halftimeIndex >= 0 && finalState.roundHistory[halftimeIndex + 1]) {
  const before = finalState.roundHistory[halftimeIndex];
  const after = finalState.roundHistory[halftimeIndex + 1];
  console.log(`  Argent après le round 5 (dernier avant la mi-temps, càd juste ce que chaque équipe emporte AVEC ELLE en changeant de camp) : attaquant=${before.attackerTeam}, argent=${JSON.stringify(before.moneyAfter)}`);
  console.log(`  Argent après le round 6 (1er joué après la mi-temps, achats + gains de ce round inclus)                                  : attaquant=${after.attackerTeam}, argent=${JSON.stringify(after.moneyAfter)}`);
  check('Le changement de camp a bien lieu après le round 5 (halftimeAfterRound=5 pour ce format bo11)', after.attackerTeam !== before.attackerTeam);

  const startingMoneyTotal = 5 * STARTING_MONEY;
  console.log(`  Argent total de départ par équipe (référence, pour comparaison) : ${startingMoneyTotal}$`);
  check(
    "L'argent déjà accumulé avant la mi-temps (round 5) dépasse largement l'argent de départ (accumulation réelle sur les 5 premiers rounds)",
    before.moneyAfter['Titans'] > startingMoneyTotal && before.moneyAfter['Wardens'] > startingMoneyTotal,
  );
  check(
    "L'argent n'est PAS remis à l'argent de départ à la mi-temps (conservé, comme dans le jeu réel — voir startNewRound qui ne touche jamais money/weapons)",
    after.moneyAfter['Titans'] > startingMoneyTotal && after.moneyAfter['Wardens'] > startingMoneyTotal,
  );
} else {
  console.log('  (le match ne compte pas au moins 6 rounds — la mi-temps ne peut pas être vérifiée sur ce run)');
  check('Le changement de camp a bien lieu après le round 5', false);
  check("L'argent n'est pas remis à zéro à la mi-temps", false);
}
console.log();

console.log('--- Overtime ---');
const otEntries = finalState.roundHistory.filter((h) => h.segment === 'overtime');
if (otEntries.length > 0) {
  console.log(`  Le match est naturellement allé en overtime (${otEntries.length} round(s) d'OT joué(s)).`);
} else {
  console.log("  Pas d'overtime dans ce run (pas d'égalité naturelle à 5-5) — le mécanisme est déjà vérifié explicitement en PARTIE A (scénario forcé, déterministe).");
}
console.log();

console.log('--- Résultat final ---');
console.log(`  Vainqueur : ${finalState.winner} — score final ${JSON.stringify({ [finalState.teamA.name]: finalState.teamA.roundsWon, [finalState.teamB.name]: finalState.teamB.roundsWon })} — phase=${finalState.currentPhase}`);
check('Le match se termine bien (currentPhase="finished") avec un vainqueur désigné', finalState.currentPhase === 'finished' && !!finalState.winner);
check(
  "Le vainqueur a bien atteint le score requis (6 en temps réglementaire) OU a gagné via l'overtime",
  (finalState.winner === finalState.teamA.name ? finalState.teamA.roundsWon : finalState.teamB.roundsWon) >= 6 || otEntries.length > 0,
);
check(
  'roundHistory contient un enregistrement cohérent pour CHAQUE round joué (numéros consécutifs, score cumulé croissant pour le gagnant)',
  finalState.roundHistory.every((h, i) => h.roundNumber === i + 1) &&
    finalState.roundHistory.every((h) => h.scoreAfter[h.winner] > 0),
);
console.log();

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
