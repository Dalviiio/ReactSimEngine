import path from 'node:path';
import { runSimulation } from '../core';
import { loadMapFromFile } from '../map';
import { EntityState } from '../types';
import { boxToRect } from './geometry';
import { createBotOnTick, resetBotMemories, setBotDestination } from './botController';
import { hasLineOfSight } from './lineOfSight';
import { buildNavGrid, cellIndexAt, isWalkable } from './navGrid';

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

resetBotMemories();

const mapData = loadMapFromFile(path.join(__dirname, 'test-map.json'));
const navGrid = buildNavGrid(mapData, 10);
mapData.navGrid = navGrid;

console.log(`Carte "${mapData.name}" chargée (${mapData.width}x${mapData.height}).`);
console.log(`NavGrid généré : ${navGrid.cols}x${navGrid.rows} cellules de ${navGrid.cellSize}px.\n`);

// --- 1. hasLineOfSight : règles small / medium / large ---
console.log('=== Ligne de vue : règles small / medium / large ===');
check(
  'Vision à travers une caisse "small" : visible (non bloquée)',
  hasLineOfSight(mapData, { x: 20, y: 170 }, { x: 60, y: 170 }) === true,
);
check(
  'Vision à travers une caisse "medium" : bloquée',
  hasLineOfSight(mapData, { x: 80, y: 170 }, { x: 120, y: 170 }) === false,
);
check(
  'Vision à travers une caisse "large" : bloquée',
  hasLineOfSight(mapData, { x: 140, y: 170 }, { x: 180, y: 170 }) === false,
);
console.log();

// --- 2. NavGrid : TOUTES les tailles de caisse + le mur bloquent le déplacement ---
console.log('=== NavGrid : cellules bloquées ===');
const wallCell = cellIndexAt(navGrid, { x: 105, y: 60 });
const smallCell = cellIndexAt(navGrid, { x: 40, y: 170 });
const mediumCell = cellIndexAt(navGrid, { x: 100, y: 170 });
const largeCell = cellIndexAt(navGrid, { x: 160, y: 170 });
const openCell = cellIndexAt(navGrid, { x: 20, y: 20 });
check('Cellule sous le mur : non-walkable', !isWalkable(navGrid, wallCell.col, wallCell.row));
check(
  'Cellule sous la caisse "small" : non-walkable (bloque le déplacement)',
  !isWalkable(navGrid, smallCell.col, smallCell.row),
);
check('Cellule sous la caisse "medium" : non-walkable', !isWalkable(navGrid, mediumCell.col, mediumCell.row));
check('Cellule sous la caisse "large" : non-walkable', !isWalkable(navGrid, largeCell.col, largeCell.row));
check('Cellule en zone ouverte : walkable', isWalkable(navGrid, openCell.col, openCell.row));
console.log();

// --- 3. Simulation : l'attaquant doit contourner le mur pour rejoindre le défenseur ---
const attacker: EntityState = {
  id: 'atk-1',
  team: 'attackers',
  position: { x: 20, y: 20 },
  rotation: 0,
  health: 100,
  status: 'alive',
  currentAction: null,
};
const defender: EntityState = {
  id: 'def-1',
  team: 'defenders',
  position: { x: 180, y: 20 },
  rotation: 180,
  health: 100,
  status: 'alive',
  currentAction: null,
};

setBotDestination('atk-1', { x: 180, y: 20 });

const TOTAL_TICKS = 90;
const ticks = runSimulation(mapData, [attacker, defender], {
  tickRate: 30,
  totalTicks: TOTAL_TICKS,
  onTick: createBotOnTick(navGrid),
});

console.log(`=== Simulation : ${ticks.length} ticks ===\n`);

const pathComputed = ticks
  .flatMap((t) => t.events.filter((e) => e.type === 'bot:path-computed'))
  .map((e) => e.data as { botId: string; path: { x: number; y: number }[] | null; found: boolean });

if (pathComputed[0]?.path) {
  console.log(`Chemin A* calculé pour ${pathComputed[0].botId} (${pathComputed[0].path.length} points) :`);
  console.log(pathComputed[0].path.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' -> '));
} else {
  console.log('Aucun chemin trouvé pour atk-1 !');
}
console.log();

console.log("--- Changements d'état (bot:state-changed) ---");
ticks.forEach((t) => {
  t.events
    .filter((e) => e.type === 'bot:state-changed')
    .forEach((e) => {
      const d = e.data as { botId: string; from: string; to: string };
      console.log(`  tick ${t.tick}: ${d.botId} ${d.from} -> ${d.to}`);
    });
});
console.log();

console.log('--- Ennemi repéré (bot:enemy-spotted) ---');
ticks.forEach((t) => {
  t.events
    .filter((e) => e.type === 'bot:enemy-spotted')
    .forEach((e) => {
      const d = e.data as { botId: string; targetId: string };
      console.log(`  tick ${t.tick}: ${d.botId} repère ${d.targetId}`);
    });
});
console.log();

console.log('--- Positions (toutes les 10 ticks) ---');
ticks.forEach((t) => {
  if (t.tick % 10 !== 0 && t.tick !== ticks.length) return;
  const atk = t.snapshot.find((e) => e.id === 'atk-1')!;
  const def = t.snapshot.find((e) => e.id === 'def-1')!;
  console.log(
    `  tick ${t.tick}: atk-1=(${Math.round(atk.position.x)},${Math.round(atk.position.y)})[${atk.currentAction}]` +
      `  def-1=(${Math.round(def.position.x)},${Math.round(def.position.y)})[${def.currentAction}]`,
  );
});
console.log();

// --- 4. Vérifications explicites sur la simulation complète ---
console.log('=== Vérifications ===');

const largeRect = boxToRect(mapData.boxes.find((b) => b.id === 'box_large_test')!);
let everInsideBlockedCell = false;
let everInsideLargeBox = false;
ticks.forEach((t) => {
  const atk = t.snapshot.find((e) => e.id === 'atk-1')!;
  const cell = cellIndexAt(navGrid, atk.position);
  if (!isWalkable(navGrid, cell.col, cell.row)) everInsideBlockedCell = true;
  if (
    atk.position.x >= largeRect.x &&
    atk.position.x <= largeRect.x + largeRect.width &&
    atk.position.y >= largeRect.y &&
    atk.position.y <= largeRect.y + largeRect.height
  ) {
    everInsideLargeBox = true;
  }
});
check("L'attaquant ne traverse jamais une cellule bloquée (mur/caisse)", !everInsideBlockedCell);
check('L\'attaquant ne traverse jamais la caisse "large" de test', !everInsideLargeBox);

let losTransitionTick: number | null = null;
let previousLos = hasLineOfSight(mapData, attacker.position, defender.position);
for (const t of ticks) {
  const atk = t.snapshot.find((e) => e.id === 'atk-1')!;
  const def = t.snapshot.find((e) => e.id === 'def-1')!;
  const currentLos = hasLineOfSight(mapData, atk.position, def.position);
  if (!previousLos && currentLos) {
    losTransitionTick = t.tick;
    break;
  }
  previousLos = currentLos;
}
check(
  losTransitionTick !== null
    ? `La ligne de vue attaquant<->défenseur passe de false à true au tick ${losTransitionTick}`
    : "La ligne de vue attaquant<->défenseur ne s'est jamais ouverte (échec)",
  losTransitionTick !== null,
);

const lastTick = ticks[ticks.length - 1];
const finalAtk = lastTick.snapshot.find((e) => e.id === 'atk-1')!;
const finalDef = lastTick.snapshot.find((e) => e.id === 'def-1')!;
check(
  'Les deux bots finissent en état "engaging" (vision mutuelle)',
  finalAtk.currentAction === 'engaging' && finalDef.currentAction === 'engaging',
);

console.log();
const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
