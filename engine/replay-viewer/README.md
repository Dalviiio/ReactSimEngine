# Replay Viewer

Outil autonome (Vite + React + Tailwind + TypeScript) pour rejouer visuellement,
vue du dessus, un match complet enregistré au format `MatchReplay` (produit par
`engine/games/vshooters/replayRecorder.ts`). Même principe d'autonomie que
`engine/map-editor/` : distribué séparément, ne dépend d'aucun autre module de
`engine/` à l'exécution, à l'exception des **types** partagés et de quelques
**constantes de règles pures** (`DEVICE_DETONATION_SECONDS`,
`DEVICE_DEFUSE_SECONDS`), importés directement en TypeScript (voir
`src/types.ts`) — aucune logique dupliquée, aucune simulation embarquée.

**Lecteur pur** : ne dépend que du fichier `MatchReplay` JSON chargé par
l'utilisateur. Aucune connexion à une base de données, aucune simulation en
direct — tout ce qui est affiché est reconstruit depuis le fichier.

## Lancer en local

```bash
cd engine/replay-viewer
npm install
npm run dev
```

Puis ouvrir l'URL affichée (`http://localhost:5173` par défaut), cliquer
**"Charger un replay"** et sélectionner un fichier `MatchReplay` JSON.

Autres commandes :

```bash
npm run build      # build statique de production (dossier dist/)
npm run preview    # sert le build de production en local
npm run typecheck  # vérification TypeScript sans build
```

## Tester avec le replay d'exemple

Un `MatchReplay` d'exemple se génère depuis la racine du dépôt (pas depuis ce
dossier) :

```bash
npm run engine:replay-record-test
```

Ceci simule un match 5v5 complet (10 agents différents) et écrit
`engine/games/vshooters/sample-replay.json`. Charge ce fichier via le bouton
"Charger un replay" du viewer pour le tester.

## Fonctionnalités

- **Carte** : image de fond (si embarquée dans le replay — voir "Gaps
  documentés" ci-dessous), zones (site/spawn en surimpression légère), murs
  (ligne rouge), caisses (3 tailles, mêmes couleurs que `map-editor`).
  Zoom (molette, centré sur le curseur) et pan (glisser), même principe que
  `map-editor`.
- **Entités** : position/orientation, couleur par équipe, nom (id + agent),
  barre de vie, mortes = grisées avec une croix (mais restent visibles à leur
  dernière position connue, comme un vrai cadavre).
- **Capacités actives** : chaque `AbilityEffect` actif au tick affiché est
  rendu selon son type (fumée, mur, zone de dégâts/soin/ralentissement,
  détection...), avec un style pointillé/atténué pendant son délai de
  préparation (`activeFromTick` pas encore atteint — ex: Orbital Strike,
  Cataclysm). Les **pièges discrets** (`bramble_snare_trap`/`bramble_spike_trap`)
  ne sont visibles, en vue "par équipe", que pour l'équipe qui les a posés —
  sauf si un effet `reveal` actif couvre leur position (comportement réaliste,
  cohérent avec la règle stealth/reveal du moteur de capacités). Le
  sélecteur "Vue" en bas à droite bascule entre observateur (tout voir) et
  la perspective de chaque équipe.
- **Charge/objectif** : état dérivé des événements `device:*` du round
  affiché (portée/posée/désamorçage en cours/désamorcée/explosée), avec
  minuteur (détonation ou fin de désamorçage) et marqueur sur la carte
  (au centre de la zone de pose).
- **Lecture** : play/pause, vitesse x1/x2/x4, avancer/reculer tick par tick,
  scrubbing sur une timeline globale du match.
- **Panneau latéral** : score, round courant, phase du round (achat/active/
  terminé), segment du match (réglementaire/mi-temps/overtime/terminé), état
  de la charge, flux des événements notables horodatés (kills, capacités,
  charge, transitions de round/match) jusqu'au tick affiché.
- **Sélecteur de round** : liste de tous les rounds (round, segment,
  vainqueur, raison) — cliquer saute au premier tick de ce round.

## Reconstruction de l'état (format `MatchReplay`)

`MatchReplay` ne stocke PAS un snapshot complet à chaque tick (voir le
commentaire de tête de `replayRecorder.ts` pour le détail et le pourquoi) :
- `keyframes` : snapshots complets périodiques.
- `tickDeltas` : un enregistrement par tick, mais `changedEntities` ne
  contient que les entités ayant réellement changé depuis le tick précédent.

Le viewer reconstruit l'état à un tick donné en partant du dernier keyframe
à un tick antérieur ou égal, puis en appliquant les deltas jusqu'au tick visé
(`src/state/useReplayPlayer.ts#buildEntitiesAtTick`) — recalculé à chaque
changement de tick, volontairement simple (pas de cache incrémental) : le
volume de deltas entre deux keyframes reste petit (quelques centaines
d'entrées au pire), donc largement assez rapide pour rester fluide.

## Gaps documentés

- **Image de fond absente** : les cartes de TEST de ce projet n'ont pas de
  fichier `.webp` réel sur disque (`mapData.imageUrl` n'est qu'un nom
  indicatif) — `replayRecorder.ts` ne fabrique jamais d'image de
  substitution, `mapImageDataUrl` est simplement absent du replay dans ce
  cas, et le viewer affiche un fond neutre uni (même comportement que
  `map-editor` sans image chargée). Avec une vraie carte (image `.webp`
  présente à côté du fichier de carte au moment de l'enregistrement), l'image
  s'embarque automatiquement dans le replay et s'affiche normalement.
- **État de la charge dérivé des événements, pas observé directement** :
  `interruptDefuse` (`device.ts`) n'émet aucun événement (voir aussi le gap
  équivalent documenté dans `statsTracker.ts`) — si un désamorçage est
  interrompu sans qu'un nouveau ne démarre avant la fin du round, le viewer
  peut continuer d'afficher "désamorçage en cours" un peu après
  l'interruption réelle. Mineur et sans impact sur le reste du rejeu.
- **Pas de simulation de trajectoire de tir** : comme dans le moteur lui-même,
  aucun rendu de balle/impact — seuls les événements notables (kill,
  capacité, charge) sont journalisés dans le replay (voir
  `replayRecorder.ts#NOTABLE_EVENT_TYPES` : les tirs touchés/manqués et les
  mutations d'entité brutes sont délibérément omis du journal d'événements,
  entièrement redondants avec `changedEntities`/`playerStats`).

## Roadmap du moteur

Cet outil correspond à l'étape 4f de `engine/README.md` (outillage replay).
Voir ce fichier pour la suite (intégration backend/UI React/Tailwind du jeu
de management).
