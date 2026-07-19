# Moteur de simulation de matchs

Socle générique pour simuler des matchs esport tick par tick : boucle de tick,
entités, événements, format de carte, mapping visuel, pathfinding/IA basique,
règles de gunplay/économie/round/charge, les capacités d'agent (10 agents
implémentés en 2 vagues), l'orchestration d'un match complet (série de
rounds, mi-temps, overtime) au-dessus d'un round isolé, l'agrégation de
statistiques par joueur sur un match complet (kills/deaths/assists, clutchs,
MVP...) en observateur pur du bus d'événements, l'enregistrement/rejeu visuel
d'un match complet (`replayRecorder.ts` + `replay-viewer/`), et maintenant un
rééquilibrage diagnostiqué de l'IA basique (timing des décisions d'agent,
assignation de destinations, ordre de résolution des tirs).

## Architecture

```
engine/
  core/           boucle de tick, gestion d'entités, bus d'événements, runSimulation
  map/            format de carte (types) + loader/validateur JSON
  map-editor/     outil visuel autonome (Vite/React) pour créer des MapData
  replay-viewer/  outil visuel autonome (Vite/React) pour rejouer un MatchReplay
  ai/             navGrid, pathfinding A*, ligne de vue, state machine des bots
  games/
    vshooters/    gunplay, économie, round, charge, capacités (abilities/), match, stats, replay
  types/          types partagés entre tous les modules ci-dessus
```

### Principe central : découplage par événements

`core/` ne connaît ni les règles de jeu, ni l'IA. Il expose :

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
  action courante), + champs optionnels économie/gunplay (`money`, `armor`,
  `weapons`, `equippedWeaponId`, `currentAmmo`) et capacités (`abilityLoadout` :
  agentId + charges/points d'ultimate par slot C/Q/E/X) — génériques
  (ids/nombres), les catalogues réels restent dans `games/vshooters/`.
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

### Règles de match (`games/vshooters/`)

Voir `games/vshooters/README.md` pour le détail. En bref : `weapons.ts`
(catalogue armes/armures) + `damage.ts` (dégâts, dropoff, armure, backstab)
+ `economy.ts` (argent, loss bonus progressif) + `device.ts` (state machine
carried/planted/defusing/defused/detonated) + `roundManager.ts` (phases
buy/active/ended, conditions de victoire, distribution d'argent, et
`createMatchOnTick` qui compose tout ça avec `ai/createBotOnTick` réutilisé
tel quel) + `matchManager.ts` (orchestration d'une SÉRIE de rounds en un
match complet — score, mi-temps, overtime — au-dessus de `roundManager.ts`,
sans dupliquer ses règles) + `statsTracker.ts` (statistiques par joueur sur
un match complet, en observateur pur du bus d'événements — n'émet rien, ne
modifie rien) + `replayRecorder.ts` (enregistre un match complet dans un
fichier `MatchReplay` JSON rejouable par `engine/replay-viewer/`, même
principe d'observateur pur).

### Capacités d'agent (`games/vshooters/abilities/`)

Voir `games/vshooters/abilities/README.md` pour le détail. Architecture
générique (`AbilityDefinition`/`AbilityEffect`/`activateAbility`/
`updateActiveEffects`) pensée pour tout agent futur sans refonte, + 5 agents
implémentés (Vanguard, Scout, Gale, Aegis, Architect) couvrant les grands
archétypes : zones à distance, information/reveal, mobilité instantanée,
soin/résurrection, dispositifs posés qui agissent seuls. Se branche sur
`hasLineOfSight`/`NavGrid`/`botController`/`roundManager` sans les dupliquer
ni (sauf un petit ajout rétrocompatible à `createMatchOnTick`) les modifier.

## Tester

```bash
npm install
npm run engine:test               # étape 1 : boucle de tick / entités / événements
npm run engine:ai-test             # étape 3 : navGrid / pathfinding / ligne de vue / bots
npm run engine:vshooters-test      # étape 4a : gunplay / économie / round / charge
npm run engine:abilities-test      # étape 4b : capacités d'agent (vague 1)
npm run engine:abilities-wave2-test # étape 4c : capacités d'agent (vague 2)
npm run engine:match-test          # étape 4d : orchestration de match complet
npm run engine:stats-test          # étape 4e : statistiques par joueur
npm run engine:replay-record-test  # étape 4f : enregistrement de replay (écrit sample-replay.json)
npm run engine:ai-balance-test     # étape 4g : équilibre de l'IA basique sur 10 matchs
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
4a. **Règles de match : gunplay/économie/round/charge** (cette étape) —
   `games/vshooters/` implémente les armes/armures, le calcul de dégâts
   (dropoff, armure, backstab), l'économie (kill/round/loss bonus
   progressif/bonus de charge), la state machine de la charge, et le déroulé
   de round (buy/active/ended, conditions de victoire) via `roundManager.ts`.
   Se greffe sur `core/` uniquement via `onTick` (aucune modification de
   `core/`), et réutilise `ai/createBotOnTick` sans le dupliquer. Pas de
   capacités d'agent. ✅
4b. **Règles de match : capacités d'agent** (cette étape) —
   `games/vshooters/abilities/` : architecture générique
   (`AbilityDefinition`/`AbilityEffect`/`activateAbility`/`updateActiveEffects`)
   + 5 agents (Vanguard, Scout, Gale, Aegis, Architect), avec 9 types d'effet
   (le 9e, `statModifier`, ajouté après coup pour le buff de cadence de tir
   de l'Overdrive Beacon du Vanguard — voir `getStatModifier`). Vision/déplacement
   étendus via des wrappers (`hasLineOfSightWithAbilities`,
   `applyEffectsToNavGrid`) sans modifier `ai/`, flash/fumée gérés en
   post-traitement après `botController` (sans le dupliquer), `roundManager`
   réutilisé tel quel via un petit ajout rétrocompatible (`createMatchOnTick`
   accepte aussi un `() => NavGrid`). ✅
4c. **Règles de match : deuxième vague de capacités d'agent** (cette étape) —
   5 agents supplémentaires (Ember, Warp, Bramble, Havoc, Vesper) couvrant
   des mécaniques neuves (dash à dégâts, trainée, marque à statModifier
   ciblé, explosion à falloff radial ; marqueur de téléportation ; pièges à
   déclenchement et plafond ; aveuglement/immobilisation multi-cible et
   universels ; invisibilité). 10e type d'effet (`stealth`), plus 3 petites
   extensions rétrocompatibles à `types.ts` (`instanceCustomState`,
   `effectIdsToRemove`, `activeEffects` en lecture dans `execute()`) pour les
   mécaniques qui ne rentraient pas dans les 9 types existants — voir le
   README du module pour le détail et les gaps documentés (Decoy). ✅
4d. **Règles de match : orchestration d'un match complet** (cette étape) —
   `games/vshooters/matchManager.ts` : `FullMatchState` (score par équipe,
   camp attaquant/défenseur, historique de rounds, phase
   round/halftime/overtime/finished), `advanceMatch` (score/transitions de
   phase à partir du résultat d'UN round déjà conclu par `roundManager.ts`),
   et `runFullMatch` qui enchaîne tous les rounds automatiquement (une seule
   simulation continue, aucune intervention manuelle round par round).
   Format configurable (rounds à gagner, round de mi-temps, règles
   d'overtime — écart de victoires nécessaire, taille de mini-manche,
   fréquence d'échange de camp), valeurs par défaut 13/12/overtime "premier à
   mener de 2". L'argent et l'inventaire ne sont PAS remis à zéro à la
   mi-temps (seuls santé/statut/position/armure le sont, via `startNewRound`
   réutilisé tel quel) — comportement volontaire, documenté. Aucune règle de
   round/économie/charge réimplémentée. ✅
4e. **Règles de match : statistiques par joueur** (cette étape) —
   `games/vshooters/statsTracker.ts` : `PlayerMatchStats` par joueur
   (kills/deaths/assists, headshots, précision, dégâts, clutchs, first
   bloods, capacités utilisées, poses/désamorçages, argent dépensé), agrégés
   en observateur PUR (`eventBus.onAny`, aucun `emit`, aucune règle de
   simulation modifiée) au-dessus de `runFullMatch` réutilisé tel quel.
   `calculateMVP`/`formatMatchReport` produisent un rapport de match
   structuré (formule de MVP pondérée, documentée et ajustable). Gaps
   honnêtement documentés plutôt que forcés : dégâts d'ability non comptés
   (aucun événement ne les porte), argent dépensé INFÉRÉ des baisses de
   `money` sur `"entity:updated"` (aucun événement d'achat n'existe),
   désamorçage attribué au dernier `"device:defusing"` observé (l'événement
   de complétion ne porte pas d'id — inférence justifiée par les invariants
   de `device.ts`). ✅
4f. **Enregistrement et rejeu visuel d'un match complet** (cette étape) —
   `games/vshooters/replayRecorder.ts` : `recordFullMatch` enveloppe
   `trackMatchStats` (donc `runFullMatch`) en observateur pur et produit un
   `MatchReplay` JSON autosuffisant (carte + image si trouvée sur disque,
   tous les ticks du match en keyframes périodiques + deltas compressés,
   tous les `AbilityEffect` avec leur fenêtre de validité, l'état de match
   final, les stats par joueur) ; `exportReplayToFile` le sérialise sur
   disque. Nécessite une petite extension rétrocompatible du hook `onTick`
   de `matchManager.ts` (4e paramètre optionnel, `abilityWorldStateBox`) —
   voir `games/vshooters/README.md`. `engine/replay-viewer/` (outil autonome
   Vite+React+Tailwind, même structure que `map-editor/`) charge ce fichier
   et rejoue le match vue du dessus : entités/capacités/charge en temps
   réel, contrôles de lecture (play/pause/vitesse/scrubbing), sélecteur de
   round, panneau d'événements. Lecteur pur — aucune dépendance à une base
   de données ou à une simulation en direct. ✅
4g. **Rééquilibrage de l'IA basique** (cette étape) — diagnostic via replay
   (`sample-replay-before-fix.json` / `sample-replay-after-fix.json`, même
   scénario 5v5, comparables dans `engine/replay-viewer/`) d'un match où un
   joueur finissait à 0 kill/0 tir sur tout le match. Deux causes racines
   confirmées en traçant le replay tick par tick : les décisions d'agent
   (`abilities/integration.ts#createAgentAbilitiesOnTick`) n'étaient jamais
   filtrées par phase de round, contrairement au gunplay — un dash offensif
   pouvait se déclencher pendant la phase d'achat, désarmé ; et seule
   l'équipe attaquante recevait une destination de déplacement, laissant les
   défenseurs figés à leur spawn (loterie de position selon la géométrie de
   ligne de vue locale). Correctifs : garde de phase sur la boucle de
   décision des agents, destination assignée aux deux camps (4 scripts),
   ordre de résolution des tirs mélangé à chaque tick (biais d'insertion
   secondaire identifié et corrigé), plus un bug d'auto-dégât trouvé en
   vérifiant le premier correctif (Flare Dash d'Ember pouvait toucher sa
   propre position d'arrivée). Aucune règle de combat modifiée. Vérifié
   statistiquement sur 10 matchs par `test-ai-balance-run.ts` (seuils
   documentés : 0 kill/0 tir cumulé interdit sur la série, coefficient de
   variation des kills par slot ≤ 1.0). ✅
5. **Intégration** — branchement au backend Node.js/MySQL (persistance des
   résultats de match) et à l'UI React/Tailwind du jeu de management
   (au-delà du seul outil de rejeu).
