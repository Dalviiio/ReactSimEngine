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
import { trackMatchStats } from './statsTracker';

/**
 * Vérifie que l'IA basique du moteur produit des matchs raisonnablement
 * équilibrés — pas de joueur totalement absent du combat (0 kill sur
 * l'ensemble d'une série de matchs), pas d'écart disproportionné entre le
 * meilleur et le pire profil. Fait tourner MATCH_COUNT matchs 5v5 complets
 * (mêmes 10 agents, même scénario que test-match-run.ts/test-stats-run.ts)
 * et agrège les kills PAR SLOT DE JOUEUR (même agent, même position de
 * spawn à chaque match) sur l'ensemble de la série.
 *
 * Seuils retenus (documentés, ajustables) :
 * - **Zéro kill sur l'ensemble de la série** : avec MATCH_COUNT=10 matchs
 *   d'environ 9-14 rounds chacun (~100-140 rounds cumulés), un agent qui
 *   participe normalement au combat devrait marquer AU MOINS un kill sur un
 *   échantillon aussi large. Rester à 0 sur toute la série indique un bug de
 *   comportement (agent qui ne s'engage jamais, reste bloqué, etc.), pas de
 *   la malchance — exactement le symptôme diagnostiqué et corrigé dans cette
 *   étape (voir le bilan). Seuil : kills cumulés > 0 pour CHAQUE slot.
 * - **Écart de performance disproportionné** : on borne le coefficient de
 *   variation (écart-type / moyenne) des kills cumulés par slot. Un moteur
 *   avec 10 agents aux kits très différents (duellistes agressifs vs
 *   sentinelles de soutien) aura TOUJOURS une vraie variance de performance
 *   — ce n'est pas un bug en soi. Le seuil choisi (CV <= 1.0, c'est-à-dire
 *   écart-type au plus égal à la moyenne) tolère cette variance normale tout
 *   en excluant le cas pathologique observé AVANT correctif (un joueur à 21
 *   kills, un autre à 0 sur un seul match, un écart largement plus disproportionné
 *   qu'un CV de 1.0 une fois agrégé sur 10 matchs).
 */

const MATCH_COUNT = 10;

const mapData = loadMapFromFile(path.join(__dirname, 'test-map.json'));
const siteZone = mapData.zones.find((z) => z.type === 'site')!;

const TEAM_A_AGENTS = [VANGUARD, SCOUT, GALE, EMBER, WARP];
const TEAM_B_AGENTS = [AEGIS, ARCHITECT, BRAMBLE, HAVOC, VESPER];

function makeEntity(overrides: Partial<EntityState> & { id: string; team: string }): EntityState {
  return { position: { x: 0, y: 0 }, rotation: 0, health: 100, status: 'alive', currentAction: null, ...overrides };
}

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

const ATTACKER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 20, y }));
const DEFENDER_SPAWNS: Point[] = [20, 50, 80, 110, 140].map((y) => ({ x: 270, y }));
const SITE_TARGETS: Point[] = [30, 45, 60, 75, 90].map((y) => ({ x: 255, y }));

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

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

/** Rejoue un match complet 5v5 (même scénario que test-match-run.ts/test-stats-run.ts) et retourne les stats par joueur + le nombre de rounds joués. */
function runOneMatch(matchIndex: number): { kills: Record<string, number>; shotsFired: Record<string, number>; roundsPlayed: number } {
  const teamAEntities = makeTeamEntities('Titans', 'titan', TEAM_A_AGENTS);
  const teamBEntities = makeTeamEntities('Wardens', 'warden', TEAM_B_AGENTS);

  let lastHandledRoundNumber = 0;

  function onMatchTick(context: TickContext, roundStateBox: MatchStateBox, fullMatchState: { attackingTeam: string; defendingTeam: string; teamA: { name: string }; teamB: { name: string } }): void {
    const { entityManager, eventBus, tick } = context;
    const roundState = roundStateBox.current;

    if (roundState.phase === 'buy' && roundState.roundNumber !== lastHandledRoundNumber) {
      lastHandledRoundNumber = roundState.roundNumber;
      entityManager.getAllEntities().forEach((e) => autoBuy(e.id, entityManager));

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

  const { matchState, playerStats } = trackMatchStats(mapData, { name: 'Titans', entities: teamAEntities }, { name: 'Wardens', entities: teamBEntities }, {
    matchId: `balance-check-${matchIndex}`,
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

  const kills: Record<string, number> = {};
  const shotsFired: Record<string, number> = {};
  playerStats.forEach((stats, id) => {
    kills[id] = stats.kills;
    shotsFired[id] = stats.shotsFired;
  });
  return { kills, shotsFired, roundsPlayed: matchState.roundHistory.length };
}

console.log(`=== Vérification de l'équilibre de l'IA basique (${MATCH_COUNT} matchs 5v5) ===\n`);

const PLAYER_SLOTS = [...TEAM_A_AGENTS.map((a, i) => `titan-${i + 1} (${a.name})`), ...TEAM_B_AGENTS.map((a, i) => `warden-${i + 1} (${a.name})`)];
const aggregateKills: Record<string, number> = {};
const aggregateShots: Record<string, number> = {};
PLAYER_SLOTS.forEach((slot) => {
  aggregateKills[slot] = 0;
  aggregateShots[slot] = 0;
});
function slotLabel(id: string): string {
  return PLAYER_SLOTS.find((s) => s.startsWith(id + ' '))!;
}

let totalRoundsPlayed = 0;
const startTime = Date.now();
for (let m = 1; m <= MATCH_COUNT; m += 1) {
  const { kills, shotsFired, roundsPlayed } = runOneMatch(m);
  totalRoundsPlayed += roundsPlayed;
  Object.entries(kills).forEach(([id, k]) => {
    aggregateKills[slotLabel(id)] += k;
  });
  Object.entries(shotsFired).forEach(([id, s]) => {
    aggregateShots[slotLabel(id)] += s;
  });
  console.log(`  Match ${m}/${MATCH_COUNT} : ${roundsPlayed} rounds joués — ${Object.entries(kills).map(([id, k]) => `${id}=${k}`).join(', ')}`);
}
console.log(`\n(${MATCH_COUNT} matchs simulés en ${Date.now() - startTime}ms, ${totalRoundsPlayed} rounds cumulés)\n`);

console.log('--- Kills cumulés par slot de joueur (sur la série complète) ---');
const sortedSlots = [...PLAYER_SLOTS].sort((a, b) => aggregateKills[b] - aggregateKills[a]);
sortedSlots.forEach((slot) => console.log(`  ${slot.padEnd(24)} kills=${aggregateKills[slot]} tirs=${aggregateShots[slot]}`));

const killValues = PLAYER_SLOTS.map((s) => aggregateKills[s]);
const mean = killValues.reduce((a, b) => a + b, 0) / killValues.length;
const variance = killValues.reduce((a, b) => a + (b - mean) ** 2, 0) / killValues.length;
const stddev = Math.sqrt(variance);
const coefficientOfVariation = mean > 0 ? stddev / mean : Infinity;

console.log(`\n  Moyenne=${mean.toFixed(1)}  Écart-type=${stddev.toFixed(1)}  Coefficient de variation=${coefficientOfVariation.toFixed(2)}`);

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

console.log();
console.log('--- Vérifications ---');
check(`Chaque match dure suffisamment (au moins 5 rounds en moyenne) pour que l'échantillon soit significatif`, totalRoundsPlayed / MATCH_COUNT >= 5);

const zeroKillSlots = PLAYER_SLOTS.filter((s) => aggregateKills[s] === 0);
check(
  `Aucun slot de joueur à 0 kill sur l'ensemble des ${MATCH_COUNT} matchs (${totalRoundsPlayed} rounds cumulés)${zeroKillSlots.length > 0 ? ` — en échec pour : ${zeroKillSlots.join(', ')}` : ''}`,
  zeroKillSlots.length === 0,
);

check(`Le coefficient de variation des kills cumulés par slot reste raisonnable (<= 1.0, seuil documenté en tête de fichier)`, coefficientOfVariation <= 1.0);

const zeroShotSlots = PLAYER_SLOTS.filter((s) => aggregateShots[s] === 0);
check(
  `Aucun slot de joueur n'a tiré 0 fois sur l'ensemble de la série${zeroShotSlots.length > 0 ? ` — en échec pour : ${zeroShotSlots.join(', ')}` : ''}`,
  zeroShotSlots.length === 0,
);

console.log();
const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
