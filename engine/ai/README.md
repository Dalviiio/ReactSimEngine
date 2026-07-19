# ai

Pathfinding et IA basique des bots. Aucune règle de jeu ici (pas d'armes, pas
de dégâts, pas d'économie) — juste déplacement, détection de visibilité, et
une state machine générique. Les règles de combat viennent à l'étape 4
(`games/vshooters/`).

## Fichiers

- **`geometry.ts`** — utilitaires géométriques internes (intersection
  segment/segment, segment/rectangle, distance, `moveToward`). Non exporté
  par `index.ts`, considéré comme un détail d'implémentation des autres
  fichiers du module.
- **`navGrid.ts`** — `buildNavGrid(mapData, cellSize)` découpe la carte en
  grille et marque une cellule bloquée (`1`) si elle chevauche un `Wall` ou
  une `Box` — **toutes tailles de caisse confondues**, y compris "small" :
  small bloque le déplacement même s'il ne bloque pas le tir/la vision.
- **`pathfinding.ts`** — `findPath(navGrid, start, end)` : A* classique à 8
  directions (coût 1 orthogonal, √2 diagonal, coupe de coin interdite),
  retourne les points du chemin ou `null` si aucun chemin n'existe.
- **`lineOfSight.ts`** — `hasLineOfSight(mapData, from, to)` : trace le
  segment direct entre deux points, bloqué par un `Wall` ou une `Box`
  "medium"/"large", **ignore les "small"** (cf. règles dans
  `engine/types/map.ts`).
- **`botController.ts`** — `updateBot(entity, mapData, allEntities, navGrid, eventBus)` :
  state machine à 3 états (`idle` / `movingTo` / `engaging`) qui décide de
  l'action d'un bot à chaque tick et retourne les changements à appliquer à
  son `EntityState`. `setBotDestination(id, point)` assigne une destination à
  un bot ; `createBotOnTick(navGrid)` construit le callback à passer en
  `onTick` à `runSimulation` (voir plus bas) sans jamais modifier
  `engine/core/`.
- **`test-map.json`** / **`test-ai-run.ts`** — carte de test dédiée (mur +
  caisses small/medium/large positionnées pour tester séparément le blocage
  de déplacement et de vision) et script qui prouve que le pathfinding évite
  les obstacles et que la ligne de vue respecte les règles small/medium/large.

## Branchement sur le moteur

`core/` reste inchangé : l'IA se branche uniquement via le point d'extension
`onTick` déjà prévu dans `runSimulation` (voir `engine/core/simulation.ts`) :

```ts
const navGrid = buildNavGrid(mapData, 10);
mapData.navGrid = navGrid;

runSimulation(mapData, entities, {
  totalTicks: 100,
  onTick: createBotOnTick(navGrid),
});
```

`createBotOnTick` fait, pour chaque entité `alive`, exactement ce que
`updateBot` décide, puis applique le résultat via `entityManager.updateEntity`.

## Événements émis

Sur l'`EventBus` fourni par le tick courant (donc visibles dans
`SimulationTick.events`) :

- `bot:state-changed` — à chaque changement d'état de la state machine (`{ botId, from, to }`).
- `bot:path-computed` — à chaque (re)calcul de chemin A* (`{ botId, path, found }`).
- `bot:enemy-spotted` — quand un ennemi devient visible (transition ou changement de cible, `{ botId, targetId }`).
- `bot:engaging` — à l'entrée en état `engaging` (`{ botId, targetId }`).

## Tester

```bash
npm run engine:ai-test
```
