# Moteur de simulation de matchs

Socle générique pour simuler des matchs esport tick par tick. Cette étape pose
les fondations : boucle de tick, entités, événements, format de carte. Il n'y
a **aucune règle de jeu Valorant, aucune IA, aucun pathfinding, aucune UI**
dans ce socle — tout ça arrive dans les étapes suivantes, branché par-dessus
sans toucher au cœur.

## Architecture

```
engine/
  core/     boucle de tick, gestion d'entités, bus d'événements, runSimulation
  map/      format de carte (types) + loader/validateur JSON
  ai/       vide — décisions des bots, pathfinding (étape 3)
  games/
    valorant/  vide — règles Valorant (étape 4)
  types/    types partagés entre tous les modules ci-dessus
```

### Principe central : découplage par événements

`core/` ne connaît ni Valorant, ni IA. Il expose :

- **`EventBus`** (`core/eventBus.ts`) : `on(type, handler)` / `emit(type, payload)`.
  N'importe quel module peut s'abonner à des événements (`entity:added`,
  `entity:updated`, ...) sans dépendre du module qui les émet.
- **`EntityManager`** (`core/entityManager.ts`) : ajout/suppression/update
  d'`EntityState`, émet un événement sur le bus à chaque mutation.
- **`TickLoop`** (`core/tickLoop.ts`) : boucle de tick configurable
  (`tickRate`, ex: 30/s). `runFixedTicks` avance N ticks immédiatement
  (utilisé pour les tests/replays), `start`/`stop` fait tourner la boucle en
  temps réel via `setInterval` (pour une future exécution live).
- **`runSimulation(mapData, initialEntities, config)`** (`core/simulation.ts`) :
  assemble les trois briques ci-dessus, fait tourner `config.totalTicks`
  ticks, et retourne un tableau de `SimulationTick` (timestamp + événements du
  tick + snapshot de toutes les entités). Le champ `config.onTick` est le
  point d'extension : c'est là que les futurs modules IA/règles de jeu
  viendront agir sur les entités à chaque tick, sans que `core/` ait besoin de
  les connaître.

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
sont présents (pas de validation géométrique à ce stade). Pas encore d'éditeur
visuel — ça viendra à l'étape mapping.

## Tester

```bash
npm install
npm run engine:test
```

Charge `map/example-map.json` (3 zones, 1 mur, 1 caisse de chaque taille),
crée 3 entités factices, fait tourner `runSimulation` sur 5 ticks, et affiche
en console le détail de chaque tick (événements + snapshot des entités) pour
vérifier que la boucle, le gestionnaire d'entités et le bus d'événements
s'articulent correctement.

## Roadmap

1. **Fondations du moteur** (cette étape) — boucle de tick, entités, bus
   d'événements, format de carte, loader basique. ✅
2. **Mapping** — éditeur visuel de carte (zones, murs, caisses), génération de
   la `navGrid`.
3. **IA** — décisions des bots (`ai/`), pathfinding sur la `navGrid`, réactions
   aux événements de simulation.
4. **Règles Valorant** (`games/valorant/`) — round, économie, sites de bombe,
   capacités, résolution des duels/tirs, conditions de victoire. Vient se
   greffer sur `core/` via le bus d'événements et `onTick`, sans le modifier.
5. **Intégration** — branchement au backend Node.js/MySQL (persistance des
   résultats de match) et à l'UI React/Tailwind (visualisation/replay des
   `SimulationTick`).
