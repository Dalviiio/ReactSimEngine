# games/vshooters

Gunplay + économie + déroulé de round + charge (dispositif à poser/désamorcer),
`abilities/` (architecture générique de capacités d'agent, 10 agents
implémentés en 2 vagues — voir `abilities/README.md`), `matchManager.ts`
qui orchestre une SÉRIE de rounds en un match complet (score, mi-temps,
overtime) au-dessus de `roundManager.ts`, qui ne gère qu'un round isolé, et
`statsTracker.ts` qui agrège des statistiques par joueur sur un match complet
en observant passivement le bus d'événements (aucune règle dupliquée, aucun
comportement de simulation modifié), et `replayRecorder.ts` qui enregistre un
match complet (positions/santé/événements/capacités tick par tick) dans un
fichier `MatchReplay` JSON, rejouable visuellement par l'outil autonome
`engine/replay-viewer/`.

Se branche sur le moteur générique uniquement via le bus d'événements et le
point d'extension `onTick` de `runSimulation` — `engine/core/` n'est pas
modifié par ce module.

## Fichiers

- **`weapons.ts`** — catalogue des armes (prix, dégâts tête/corps/jambes avec
  paliers de distance, cadence de tir, chargeur, pénétration de mur) et des
  armures (Light/Heavy Shield). Valeurs plausibles, pas garanties
  pixel-perfect.
- **`damage.ts`** — `calculateDamage(weapon, hitZone, distance, targetArmor, isBackstab?)` :
  applique le palier de distance de l'arme puis la réduction d'armure (quasi
  nulle sur la tête). `isBehindTarget` détecte une attaque dans le dos (bonus
  lame). `applyDamage(entity, damage, context, eventBus)` met à jour
  santé/statut et émet `player:killed`.
- **`economy.ts`** — argent de départ (800$), plafond (9000$), récompense de
  kill (200$), gain de manche (3000$), loss bonus progressif
  (1900/2400/2900/3400, plafonné), bonus de charge. `canAfford`/`buyItem`.
- **`device.ts`** — state machine `carried -> planted -> defusing -> defused`
  ou `-> detonated` (fonctions pures : `plantDevice`, `startDefuse`,
  `interruptDefuse`, `completeDefuse`, `detonateDevice`, `updateDeviceTimers`).
  `plantDevice` vérifie que l'entité est dans une `Zone` de type `"site"`.
- **`roundManager.ts`** — phases `buy -> active -> ended`
  (`createMatchState`, `startNewRound`, `advanceRound`), conditions de
  victoire (élimination, charge désamorcée/explosée, temps écoulé),
  distribution de l'argent de fin de round (`applyRoundEndEconomy`), et
  surtout **`createMatchOnTick(navGrid, matchStateBox, config)`** : compose
  tout ça avec `ai/createBotOnTick` (réutilisé tel quel, aucune duplication)
  pour produire le `onTick` complet à passer à `runSimulation`.
- **`matchManager.ts`** — orchestre une SÉRIE de rounds en un match complet
  (`FullMatchState` : score par équipe, camp attaquant/défenseur courant,
  `roundHistory`, phase `round`/`halftime`/`overtime`/`finished`).
  **`advanceMatch(matchState, context)`** fait avancer l'état d'UN round déjà
  conclu (score, mi-temps à `halftimeAfterRound`, overtime à l'égalité,
  fin de match) et émet `match:round-ended`/`match:halftime`/
  `match:overtime-started`/`match:finished`. **`runFullMatch(mapData, teamA,
  teamB, config)`** enchaîne tous les rounds automatiquement (une seule
  simulation continue) en rappelant `roundManager.ts`/`economy.ts`/
  `device.ts` au bon moment, sans aucune règle dupliquée — voir
  `abilities/README.md`-style le détail des extensions/choix documentés dans
  l'en-tête du fichier (nommage `FullMatchState` pour éviter la collision
  avec le `MatchState` de round de `roundManager.ts`, format configurable,
  argent NON remis à zéro à la mi-temps, etc.).
- **`statsTracker.ts`** — agrège des statistiques par joueur (`PlayerMatchStats` :
  kills/deaths/assists, headshots, précision, dégâts infligés/subis, kills
  par round, clutchs, first bloods, capacités utilisées, poses/désamorçages,
  argent dépensé) sur un match complet, en observateur PUR : écoute
  `eventBus.onAny` pendant tout le match, n'émet jamais rien, ne modifie
  aucune logique existante. **`createStatsAccumulator(entities, tickRate)`**
  est le cœur testable en isolation (piloté par des événements fabriqués à la
  main) ; **`trackMatchStats(mapData, teamA, teamB, config)`** l'enveloppe
  autour de `runFullMatch` (réutilisé tel quel) en conditions réelles.
  **`calculateMVP`**/**`formatMatchReport`** produisent respectivement l'id du
  meilleur joueur (formule pondérée documentée, `MVP_WEIGHTS`) et un rapport
  structuré (score, MVP, top fragger, meilleur clutcher, classement par
  joueur). Voir "Gaps documentés" ci-dessous pour ce qui n'est PAS observable
  avec les événements existants.
- **`replayRecorder.ts`** — enveloppe `trackMatchStats` (donc `runFullMatch`)
  en observateur PUR, comme `statsTracker.ts` : **`recordFullMatch(mapData,
  teamA, teamB, config)`** produit un `MatchReplay` autosuffisant (carte +
  image si trouvée sur disque, tous les ticks du match sous forme de
  keyframes périodiques + deltas compressés — voir le commentaire de tête de
  fichier pour le format et le pourquoi —, tous les `AbilityEffect` observés
  avec leur fenêtre de validité, l'état de match final, les stats par
  joueur). **`exportReplayToFile(replay, filepath)`** sérialise en JSON.
  Nécessite une petite extension rétrocompatible du hook `onTick` de
  `matchManager.ts` (4e paramètre optionnel `abilityWorldStateBox`, ajouté
  en plus des 3 existants — tout callback à 3 paramètres reste valide) pour
  lire les `AbilityEffect` actifs sans dupliquer leur capture.
- **`test-map.json`** / **`test-round-run.ts`** — carte de test (site B +
  mur forçant un détour) et script de vérification d'UN round (voir plus bas).
- **`test-match-run.ts`** — vérifie `matchManager.ts` (voir plus bas).
- **`test-stats-run.ts`** — vérifie `statsTracker.ts` (voir plus bas).
- **`test-replay-record-run.ts`** — vérifie `replayRecorder.ts` et exporte
  `sample-replay.json` (voir plus bas).
- **`test-ai-balance-run.ts`** — vérifie que l'IA basique produit des matchs
  raisonnablement équilibrés sur une série de matchs (voir "Rééquilibrage de
  l'IA basique" et "Tester" ci-dessous).
- **`abilities/`** — capacités d'agent (architecture générique + 10 agents en
  2 vagues). Voir `abilities/README.md`.

Voir aussi **`engine/replay-viewer/`** (dossier séparé, outil autonome
Vite+React+Tailwind) : lecteur visuel du fichier `MatchReplay` produit par
`replayRecorder.ts` — vue du dessus, contrôles de lecture, sélecteur de
round. Son propre README détaille l'installation et les gaps documentés.

## Rééquilibrage de l'IA basique

Diagnostiqué via un replay (`sample-replay-before-fix.json`, comparable à
`sample-replay-after-fix.json` — même scénario 5v5, avant/après — dans
`engine/replay-viewer/`) montrant un match 6-4 où un joueur (Ember) finissait
à **0 kill / 0 tir tiré sur tout le match**, un autre (Aegis) à 1 kill/7 tirs,
pendant qu'un troisième cumulait 16 kills. Deux causes distinctes, confirmées
en traçant position/action/`player:killed` tick par tick dans le replay :

1. **Les capacités s'activaient pendant la phase d'achat.** `agent.decide()`
   (dans `abilities/integration.ts#createAgentAbilitiesOnTick`) n'était
   jamais filtré par phase de round, contrairement au gunplay
   (`resolveShot`, déjà gardé par `phase === 'active'`). Résultat observé :
   Ember utilisait son dash offensif (Flare Dash) dès qu'un ennemi était
   visible, **y compris avant d'avoir acheté une arme**, atterrissant désarmé
   en plein milieu de la carte et mourant avant le début du round actif, à
   chaque round. **Correctif** : la boucle de décision des agents est
   maintenant gardée par `matchStateBox.current.phase === 'active'`, exactement
   comme `resolveShot`.
2. **Les défenseurs ne recevaient jamais de destination.** Les scripts
   (`test-match-run.ts`, `test-stats-run.ts`, `test-replay-record-run.ts`,
   `test-ai-balance-run.ts`) n'appelaient `setBotDestination` que pour
   l'équipe ATTAQUANTE du round. Combiné à une carte dont le mur ne bloque la
   ligne de vue que pour `y < 120` (un corridor sud entièrement dégagé au-delà),
   un défenseur figé à son spawn se retrouvait soit en visibilité immédiate
   sur toute la largeur de la carte (spawn dans le corridor), soit quasiment
   aveugle toute la partie (spawn derrière le mur) — une pure loterie de
   position, pas un mérite de jeu. **Correctif** : les DEUX camps reçoivent
   désormais une destination vers le site en début de round dans ces 4 scripts.
3. **Biais d'ordre de traitement (secondaire, vérifié).** `createMatchOnTick`
   résolvait les tirs dans l'ordre d'insertion de `EntityManager.getAllEntities()`
   (équipe A toujours avant équipe B) — un avantage structurel minime dans les
   échanges mutuellement fatals au même tick. **Correctif** : l'ordre des
   tireurs "engaging" est mélangé (Fisher-Yates) à chaque tick avant résolution.
4. **Bug additionnel trouvé en vérifiant le correctif n°1** : le dernier
   cercle de dégâts du sentier de Flare Dash tombait exactement sur la
   position d'arrivée du lanceur (auto-infligé au tick suivant). **Correctif**
   dans `abilities/agents/ember.ts` : les cercles qui engloberaient la
   position d'arrivée sont désormais exclus.

Aucune règle de combat n'a changé (`resolveShot`/`calculateDamage` intacts) —
uniquement le TIMING des décisions d'IA, l'assignation de destinations, et
l'ordre de traitement. Voir `test-ai-balance-run.ts` pour la vérification
statistique sur 10 matchs (seuils documentés en tête de ce fichier).

## Gaps documentés (`statsTracker.ts`)

Le principe du module est de n'observer QUE ce que les événements existants
exposent déjà, sans jamais inventer une approximation trompeuse pour combler
un trou :

- **Dégâts d'ability non comptés** : `damageDealt`/`damageTaken` ne
  reflètent que le gunplay (`combat:shot-hit`, qui porte un montant de
  dégâts). Les dégâts au tick des capacités (`damageOverTime`, appliqués par
  `abilities/types.ts#applyPerTickEffect`) ne sont journalisés par AUCUN
  événement — même la mort qui en résulte (`player:killed`) ne porte pas de
  montant de dégâts. Une entité tuée uniquement par une capacité a donc des
  `damageDealt` sous-évalués pour son tueur.
- **Assists limités au gunplay**, pour la même raison (le journal de dégâts
  récents par victime n'est alimenté que par `combat:shot-hit`).
- **Argent dépensé inféré, pas observé directement** : `economy.ts#buyItem`
  est une fonction pure, sans événement d'achat. `moneySpent` est déduit des
  BAISSES de `money` vues sur `"entity:updated"` (émis par `EntityManager` à
  chaque mutation) — sûr dans ce moteur car SEUL un achat fait baisser
  l'argent (kills/victoires/loss bonus ne font que l'augmenter).
- **Désamorçage attribué par inférence** : `"device:defused"` ne porte pas
  l'id du joueur (voir `device.ts#completeDefuse`). On attribue le
  désamorçage au DERNIER `"device:defusing"` observé — valide car
  `device.ts` garantit qu'un désamorçage complété succède toujours, sans
  interruption, au démarrage le plus récent (une interruption, elle,
  n'émet aucun événement et repasse l'état à `"planted"`, ce qui empêche
  toute complétion tant qu'un nouveau démarrage n'a pas eu lieu).
- **Précision de tir** : PAS un gap — `combat:shot-hit`/`combat:shot-missed`
  couvrent déjà tous les tirs résolus, `shotsHit`/`shotsFired` sont donc
  exacts (pour le gunplay ; les capacités n'ont pas de notion de précision).

## Simplifications volontaires (documentées dans le code)

- Fusils à pompe : un seul "dégât effectif par tir" agrégé, pas de simulation
  projectile par projectile.
- Armure : réduction de dégâts fixe tant qu'elle est équipée (25 -> ~17%,
  50 -> ~33% sur corps/jambes, ~5% sur la tête) ; elle ne se dégrade pas coup
  par coup comme dans le vrai jeu, et se réinitialise à 0 chaque round (doit
  être rachetée), contrairement aux armes qui persistent.
  Précision de tir : jet simple basé sur la distance (pas de bloom/recul).
- Désamorçage : une seule durée de 7s, pas de mécanique de demi-désamorçage.
- Pas de rechargement modélisé : un chargeur vide arrête juste les tirs.

## Comment `EntityState` est étendu

`engine/types/entity.ts` gagne des champs optionnels : `money`, `armor`,
`weapons` (ids), `equippedWeaponId`, `currentAmmo`, et `abilityLoadout`
(agentId + charges/points d'ultimate par slot C/Q/E/X). Optionnels et
génériques (juste des ids/nombres) pour qu'un jeu sans économie/capacités
puisse les ignorer — les catalogues réels (`Weapon`, `ArmorItem`,
`AbilityDefinition`) restent dans `weapons.ts`/`abilities/`, pas dans
`types/`.

## Tester

```bash
npm run engine:vshooters-test       # gunplay / économie / round / charge
npm run engine:abilities-test       # capacités d'agent vague 1 (abilities/README.md)
npm run engine:abilities-wave2-test # capacités d'agent vague 2 (abilities/README.md)
npm run engine:match-test           # orchestration de match complet (matchManager.ts)
npm run engine:stats-test           # statistiques par joueur (statsTracker.ts)
npm run engine:replay-record-test   # enregistrement de replay (replayRecorder.ts), écrit sample-replay.json
npm run engine:ai-balance-test      # équilibre de l'IA basique sur 10 matchs (voir "Rééquilibrage de l'IA basique")
```

`test-round-run.ts` a deux parties :

1. **Vérifications unitaires déterministes** (sans simulation, sans aléatoire) :
   réduction d'armure, dropoff Reaper vs dégâts constants Warhawk, bonus
   de lame dans le dos, plafond d'argent, achat refusé/accepté selon les
   fonds, progression du loss bonus, cycle complet de la charge (y compris le
   rejet d'une pose hors site et la détonation si non désamorcée à temps).
2. **Simulation intégrée** d'un round complet (achat de Warhawk/Heavy Shield,
   Reaper/Light Shield, etc., combat réel avec `createMatchOnTick`,
   résultat du round, distribution d'argent). Le combat étant partiellement
   aléatoire (précision), le round peut se terminer par élimination avant
   qu'un attaquant n'atteigne le site — le cycle de la charge est de toute
   façon déjà prouvé de façon déterministe dans la partie 1.

`test-match-run.ts` a deux parties :

1. **`advanceMatch` en isolation**, avec des résultats de round FABRIQUÉS
   (aucune simulation, aucun aléatoire) : format par défaut (13/12) et format
   personnalisé, puis une séquence complète de 28 rounds vérifiant la
   mi-temps (échange de camp après le round 12), l'égalité 12-12 déclenchant
   l'overtime, la bascule de camp à chaque round d'OT, la fin de match dès un
   écart de 2 victoires d'OT, et la cohérence de `roundHistory`. C'est le
   "scénario forcé" qui garantit de vérifier l'overtime sans dépendre du
   hasard d'un vrai match.
2. **Match complet intégré** (5v5, un format bo11 réduit pour rester rapide à
   simuler, un agent différent par joueur parmi les 10 disponibles, achat
   automatique et pose/désamorçage scriptés comme dans `test-round-run.ts`) :
   vérifie le changement de camp après le round de mi-temps configuré,
   l'argent non remis à zéro (comparé à l'argent de départ), la fin de match
   au score requis (ou via overtime si le match y arrive naturellement), et
   la cohérence de `roundHistory`.

`test-stats-run.ts` a deux parties :

1. **`createStatsAccumulator` en isolation**, avec des événements FABRIQUÉS
   (ticks choisis à la main, aucune simulation) : assist crédité dans la
   fenêtre de temps, assist refusé sous le seuil de dégâts, assist refusé
   hors fenêtre, first blood identifié comme le premier kill du round (pas
   le 2e ni le 3e), un clutch gagné (dernier survivant, équipe qui gagne
   quand même) crédité via le passage normal au round suivant, un clutch
   perdu (équipe du survivant battue) NON crédité, un 2e clutch finalisé via
   `finalizeLastRound` (fin de match, pas de round suivant), comptage de
   capacités par capacité, attribution du désamorçage au dernier joueur
   l'ayant démarré, argent dépensé déduit des baisses de `money`, et la
   formule de MVP appliquée exactement telle que documentée. C'est le
   "scénario forcé" qui garantit de vérifier assist/first blood/clutch sans
   dépendre du hasard d'un vrai match.
2. **Match complet intégré** (5v5, même scénario que `test-match-run.ts`, via
   `trackMatchStats`) : affiche le rapport complet (classement par kills,
   MVP avec le détail des chiffres qui ont compté), et vérifie que la somme
   des kills correspond au nombre total de morts enregistrées, et que le
   total de capacités comptées dans les stats correspond au nombre réel
   d'activations (compté indépendamment via un second abonnement direct sur
   `eventBus`).

`test-replay-record-run.ts` enregistre le même scénario 5v5 via
`recordFullMatch`, écrit `sample-replay.json` (chargeable dans
`engine/replay-viewer/`), affiche sa taille et un résumé (rounds, ticks,
keyframes, effets, joueurs), et vérifie explicitement : au moins un round et
un tick enregistrés, un keyframe au tout premier tick, le match bien
`"finished"`, une numérotation de ticks continue sans trou sur tout le match,
la fenêtre de ticks de chaque round cohérente avec `roundIndex`, chaque
`AbilityEffect` enregistré avec une fenêtre de validité exploitable, et
qu'une reconstruction keyframe+deltas à un tick choisi au hasard produit un
état complet et cohérent pour les 10 joueurs.

`test-ai-balance-run.ts` fait tourner 10 matchs 5v5 complets (même scénario,
via `trackMatchStats`) et agrège les kills PAR SLOT DE JOUEUR (même agent,
même position de spawn à chaque match) sur toute la série. Vérifie
explicitement (seuils documentés en tête de fichier) : chaque match dure au
moins 5 rounds en moyenne (échantillon significatif), aucun slot à 0 kill ni
0 tir cumulé sur les ~90-140 rounds de la série (le symptôme diagnostiqué et
corrigé — voir "Rééquilibrage de l'IA basique"), et un coefficient de
variation des kills cumulés par slot ≤ 1.0 (tolère la vraie variance de
puissance entre archétypes d'agents très différents, sans laisser passer un
déséquilibre pathologique).
