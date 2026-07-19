import path from 'node:path';
import { loadMapFromFile } from '../map';
import { EntityState } from '../types';
import { runSimulation } from './simulation';

const mapPath = path.join(__dirname, '..', 'map', 'example-map.json');
const mapData = loadMapFromFile(mapPath);

console.log(`Carte chargée : "${mapData.name}" (${mapData.width}x${mapData.height})`);
console.log(
  `  zones=${mapData.zones.length} walls=${mapData.walls.length} boxes=${mapData.boxes.length} navGrid=${mapData.navGrid}`,
);

const initialEntities: EntityState[] = [
  { id: 'atk-1', team: 'attackers', position: { x: 50, y: 900 }, rotation: 0, health: 100, status: 'alive', currentAction: null },
  { id: 'atk-2', team: 'attackers', position: { x: 80, y: 900 }, rotation: 0, health: 100, status: 'alive', currentAction: null },
  { id: 'def-1', team: 'defenders', position: { x: 500, y: 100 }, rotation: 180, health: 100, status: 'alive', currentAction: null },
];

const ticks = runSimulation(mapData, initialEntities, {
  tickRate: 30,
  totalTicks: 5,
  onTick: ({ tick, entityManager }) => {
    // Démo uniquement : prouver que le point d'extension onTick peut modifier
    // l'état des entités et que ça se reflète dans le snapshot du tick suivant.
    // Aucune règle de jeu réelle ici.
    if (tick === 3) {
      entityManager.updateEntity('atk-1', { position: { x: 60, y: 850 }, currentAction: 'moving' });
    }
    if (tick === 5) {
      entityManager.updateEntity('def-1', { health: 80, currentAction: 'defending' });
    }
  },
});

console.log(`\n${ticks.length} ticks simulés :\n`);

ticks.forEach((t) => {
  console.log(`--- Tick ${t.tick} (t=${t.timestamp.toFixed(1)}ms) ---`);
  console.log(`  événements: ${t.events.length ? JSON.stringify(t.events) : 'aucun'}`);
  t.snapshot.forEach((e) => {
    console.log(
      `  [${e.team}] ${e.id} pos=(${e.position.x},${e.position.y}) hp=${e.health} status=${e.status} action=${e.currentAction ?? '-'}`,
    );
  });
});
