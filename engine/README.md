# Moteur de simulation de matchs

Socle générique pour simuler des matchs esport tick par tick : boucle de tick,
entités, événements, format de carte, mapping visuel, pathfinding/IA basique.
Il n'y a **aucune règle de jeu Valorant** dans ce socle (armes, dégâts,
économie, rounds) — ça arrive à l'étape suivante, branché par-dessus sans
toucher au cœur.

## Architecture

```
engine/
  core/        boucle de tick, gestion d'entités, bus d'événements, runSimulation
  map/         format de carte (types) + loader/validateur JSON
  map-editor/  outil visuel autonome (Vite/React) pour créer des MapData
  ai/          navGrid, pathfinding A*, ligne de vue, state machine des bots
  games/
    valorant/  vide — règles Valorant (étape 4)
  types/       types partagés entre tous les modules ci-dessus
```

### Principe central : découplage par événements

`core/` ne connaît ni Valorant, ni IA. Il expose :

- **`EventBus`** (`core/eventBus.ts`) : `on(type, handler)` / `emit(type, payload)`,
  plus `onAny(handler)` pour s'abonner à tout, quel que soit le type. N'importe
  quel module peut émettre/écouter des événements (`entity:added`, `bot:*`, ...)
  sans dépendre du module qui les émet.
- **`EntityManager`** (`core/entityManager.ts`) : ajout/suppression/update
  d'`EntityState`, émet un événement sur le bus à chaque mutation.
- **`TickLoop`** (`core/tickLoop.ts`) : boucle de tick configurable
  (`tickRate`, ex: 30/s). `runFixedTicks` avance N ticks immédiatement
  (utilisé pour les tests/replays), `start`/`stop` fait tourner la boucle en
  temps réel via `setInterval` (pour une future exécution live).
- **`runSimulation(mapData, initialEntities, config)`** (`core/simulation.ts`) :
  assemble les trois briques ci-dessus, fait tourner `config.totalTicks`
  ticks, et retourne un tableau de `SimulationTick` (timestamp + tous les
  événements émis pendant le tick, via `onAny` + snapshot de toutes les
  entités). Le champ `config.onTick` est le point d'extension : c'est là que
  les futurs modules IA/règles de jeu viennent agir sur les entités à chaque
  tick, sans que `core/` ait besoin de les connaître — voir `ai/createBotOnTick`
  pour un exemple concret.

### Types partagés (`types/`)

- `MapData` : carte (zones nommées avec leur type, murs infranchissables,
  caisses small/medium/large avec leurs règles de blocage déplacement/tir,
  `navGrid` en placeholder pour le futur pathfinding).
- `EntityState` : état d'une entité (position, rotation, vie, statut,
  action courante).
- `SimulationEvent` / `SimulationTick` : événement générique et snapshot de
  tick, sans vocabulaire spécifique à un jeu.

### Carte (`map/`)

`mapLoader.ts` charge un `MapData` depuis un fichier JSON ou un objet déjà
parsé, en le passant par `mapValidator.ts` qui vérifie que les champs requis
sont présents (pas de validation géométrique à ce stade). L'éditeur visuel qui
produit ces fichiers vit dans `map-editor/` (voir son propre README).

### IA (`ai/`)

Voir `ai/README.md` pour le détail. En bref : `buildNavGrid` découpe la carte
en grille (murs + caisses, toutes tailles confondues, bloquent le
déplacement) ; `findPath` fait de l'A* dessus ; `hasLineOfSight` calcule la
visibilité directe entre deux points (murs et caisses medium/large bloquent,
small non) ; `updateBot` pilote une state machine par bot
(idle/movingTo/engaging) et `createBotOnTick` la branche sur le point
d'extension `onTick` de `runSimulation`, sans modifier `core/`.

## Tester

```bash
npm install
npm run engine:test      # étape 1 : boucle de tick / entités / événements
npm run engine:ai-test   # étape 3 : navGrid / pathfinding / ligne de vue / bots
```

`engine:test` charge `map/example-map.json`, crée 3 entités factices, fait
tourner `runSimulation` sur 5 ticks, et affiche en console le détail de chaque
tick pour vérifier que la boucle, le gestionnaire d'entités et le bus
d'événements s'articulent correctement.

`engine:ai-test` charge une carte de test dédiée (`ai/test-map.json`, un mur
qui sépare deux zones + une caisse de chaque taille), vérifie les règles de
ligne de vue (small visible, medium/large bloquées) et de navGrid (toutes les
tailles de caisse + le mur bloquent le déplacement), puis fait tourner une
simulation où un attaquant doit contourner le mur pour rejoindre un
défenseur — en loggant le chemin A* calculé, les changements d'état de la
state machine et le moment où la ligne de vue s'ouvre.

## Roadmap

1. **Fondations du moteur** — boucle de tick, entités, bus d'événements,
   format de carte, loader basique. ✅
2. **Mapping** (cette étape) — éditeur visuel de carte (`map-editor/`) pour
   dessiner zones/murs/caisses et exporter des `MapData` valides. La
   génération de la `navGrid` reste un placeholder (`null`), elle viendra
   avec l'IA/pathfinding. ✅
3. **IA** (cette étape) — `ai/` génère la `navGrid` (murs + caisses, quelle
   que soit leur taille, bloquent le déplacement), fait du pathfinding A*
   dessus, calcule la ligne de vue (murs et caisses medium/large bloquent,
   small non), et pilote une state machine basique par bot
   (idle/movingTo/engaging) branchée sur `onTick` sans modifier `core/`
   (seul `core/eventBus.ts` a gagné une souscription générique `onAny`,
   nécessaire pour que le journal de tick capture aussi les événements des
   futurs modules, pas seulement ceux d'`entity:*`). ✅
4. **Règles Valorant** (`games/valorant/`) — round, économie, sites de bombe,
   capacités, résolution des duels/tirs, conditions de victoire. Vient se
   greffer sur `core/` via le bus d'événements et `onTick`, sans le modifier.
5. **Intégration** — branchement au backend Node.js/MySQL (persistance des
   résultats de match) et à l'UI React/Tailwind (visualisation/replay des
   `SimulationTick`).
