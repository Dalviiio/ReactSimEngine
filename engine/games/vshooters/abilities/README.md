# games/vshooters/abilities

Architecture générique des capacités d'agent, plus 10 agents implémentés en
deux vagues — (Vanguard, Scout, Gale, Aegis, Architect) puis (Ember, Warp,
Bramble, Havoc, Vesper) — couvrant les grands archétypes de mécaniques du
jeu. Pensée pour accueillir n'importe quel agent futur (duelliste,
contrôleur, initiateur, sentinelle, ...) sans refonte de
`types.ts`/`integration.ts`.

## Architecture (`types.ts`)

- **`AbilityDefinition`** : id, nom, agent, slot (`C`/`Q`/`E`/`X`), coût,
  charges/points requis, type de ciblage, et une fonction **`execute`** —
  c'est le SEUL endroit où la mécanique propre à une capacité est branchée
  sur le système générique. `activateAbility` ne connaît aucun agent.
- **`AbilityEffect`** : représentation générique d'un effet actif dans le
  monde (fumée, mur, tourelle, zone de dégâts...). Forme unique : position +
  rayon (cercle) — simple et suffisant pour toutes les capacités
  implémentées ; une capacité qui a besoin de PLUSIEURS effets (ex: un mur
  qui bloque déplacement ET vision) en retourne simplement plusieurs dans le
  même tableau, pas besoin d'un type composite.
- **10 types d'effet fixes** : `blocksVision`, `blocksMovement`,
  `damageOverTime`, `heal`, `blind`, `reveal`, `slow`, `reconPing`,
  `statModifier` (buff/debuff temporaire de statistique — cadence de tir,
  vitesse de déplacement, précision, ou les dégâts infligés/subis, via un
  multiplicateur, cf. plus bas), et `stealth` (10e, ajouté pour Vesper) :
  une entité sous cet effet est ignorée comme CIBLE par
  `hasLineOfSightWithAbilities` — sauf si elle est simultanément sous un
  effet `reveal` actif, qui a priorité (voir plus bas).
- **`activateAbility(worldState, entity, definition, target, context)`** :
  valide charges/points d'ultimate (comparé au **coût**, pas juste "≥ 1" —
  permet une capacité à coût 0, voir le tir automatique de la tourelle de
  l'Architect), appelle `execute`, déduit le coût, ajoute les effets au monde
  (et retire ceux listés dans `effectIdsToRemove`, si fourni — voir
  "Vague 2" plus bas), fusionne `instanceCustomState` dans l'instance qui
  active, émet `"ability:activated"`. Fonction pure : ne touche à aucun
  EntityManager, l'appelant applique les changements retournés.
- **`updateActiveEffects(worldState, tick, entityManager, eventBus)`** :
  expire les effets, applique dégâts/soin par tick. Respecte
  `activeFromTick` (délai d'armement générique, réutilisé par Orbital
  Strike, Nanoswarm, Lockdown).

## Branchement sur l'existant (`integration.ts`)

- **`hasLineOfSightWithAbilities`** : wrapper de `hasLineOfSight` + fumées
  (`blocksVision`) actives. Ne modifie pas `hasLineOfSight`.
- **`applyEffectsToNavGrid`** : patch une NavGrid avec les effets
  `blocksMovement` actifs, sans muter l'originale.
- **Flash/fumée sur `botController`** : plutôt que de modifier
  `botController.ts` (qui ignore les capacités par design — pas de
  dépendance `ai/` → `games/vshooters/`), `applyVisionOverrides` s'exécute
  APRÈS lui chaque tick et invalide sa décision "engaging" si l'entité est
  aveuglée ou si une fumée coupe désormais la ligne de vue vers sa cible
  (réutilise `getEngagingTarget`, ne recalcule rien).
- **`createMatchOnTick`** (roundManager.ts) accepte maintenant aussi un
  `() => NavGrid` (petit ajout rétrocompatible) pour recevoir une grille
  patchée dynamiquement à chaque tick sans dupliquer cette fonction.
- **Points d'ultimate** : accumulation passive (~1 point/45s) + bonus par
  kill, gérés dans `createAgentAbilitiesOnTick`. `getUltimatePoints` les
  arrondit à l'entier inférieur pour la vérification de seuil.
- **`createAgentAbilitiesOnTick`** : compose tout — réutilise
  `createMatchOnTick` tel quel, puis expire/applique les effets, corrige
  vision/slow, accumule les points, et fait décider chaque bot avec un
  agent assigné via `agent.decide(...)`.
- **`getStatModifier(entity, statType, effects, tick)`** : multiplicateur
  combiné (produit) de tous les effets `statModifier` actifs du type demandé
  qui affectent l'entité (par zone comme `slow`, ou par liste fixe comme
  `heal`/`blind`). Retourne `1` si aucun effet ne s'applique. Fonction pure,
  câblée dans la résolution de tir réelle via `createMatchOnTick`'s
  `getFireRateMultiplier` (paramètre optionnel générique — même principe que
  le `NavGrid` dynamique — qui laisse `roundManager.ts` ignorer les capacités
  tout en les respectant) : cadence effective =
  `weapon.fireRatePerSecond * getStatModifier(entity, 'fireRate', effects, tick)`.
  Le ralentissement (`slow`) affecte déjà le déplacement réel via
  `applySlowOverrides` (même principe : vitesse effective = vitesse de base *
  facteur, appliqué par mise à l'échelle du déplacement du tick).

## Agents (`agents/*.ts`)

| Agent | Archétype | C | Q | E | X |
|---|---|---|---|---|---|
| Vanguard | Contrôleur à zones ciblables | Incendiary (DoT) | Overdrive Beacon (statModifier) | Sky Smoke (blocksVision) | Orbital Strike (DoT différé) |
| Scout | Initiateur à l'information | Owl Drone (reveal) | Shock Bolt (DoT instantané) | Recon Bolt (reveal) | Hunter's Fury (ligne de DoT) |
| Gale | Duelliste mobile | Cloudburst (blocksVision) | Updraft (téléportation) | Tailwind (dash) | Blade Storm (équipement) |
| Aegis | Sentinelle support | Barrier Orb (mur : 2 effets) | Slow Orb (slow) | Healing Orb (heal ciblé) | Resurrection (targetChanges) |
| Architect | Sentinelle à gadgets | Alarmbot (slow+reveal) | Turret (reveal + tir auto coût 0) | Nanoswarm (DoT différé) | Lockdown (blocksMovement+reveal différé) |
| Ember | Duelliste pur dégâts | Flare Dash (dash + DoT en ligne) | Scorch Trail (DoT déposé au déplacement) | Finisher Mark (statModifier ciblé) | Wildfire (DoT concentrique différé) |
| Warp | Contrôleur de téléportation | Anchor Point (marqueur, `instanceCustomState`) | Return (téléportation vers l'ancre) | Displacement Field (téléportation aléatoire) | Rift Swap (échange de position) |
| Bramble | Sentinelle à pièges | Snare Trap (piège slow) | Spike Trap (piège dégâts) | Trap Network (plafond 1→3, `instanceCustomState`) | Kill Zone (DoT+reveal en zone) |
| Havoc | Initiateur de zone | Sonic Pulse (reveal sans LOS) | Disorient Charge (blind multi-cible) | Root Field (blocksMovement universel) | Cataclysm (blind+blocksMovement différé) |
| Vesper | Duelliste furtif | Vanish (stealth, rupture au tir/dégâts) | Decoy (non implémenté, voir plus bas) | Shadow Step (dash + stealth) | Phantom Assault (stealth + statModifier `damageDealt`) |

Chaque agent expose `decide(context)` : une IA **volontairement simple**
(l'IA stratégique fine viendra plus tard) — ex: l'Aegis soigne l'allié le
plus bas en vie, l'Architect pose sa tourelle en early game puis la laisse
tirer seule, le Scout scoute s'il ne voit personne, chaque ultime s'active
dès que le seuil est atteint face à un ennemi visible.

## Historique : le cas qui ne rentrait pas dans les 8 premiers archétypes

L'**Overdrive Beacon** du Vanguard (buff de cadence de tir en zone,
anciennement documenté ici comme non implémentable) est maintenant un vrai
effet `statModifier` (`statType: 'fireRate'`, `multiplier: 1.3`, rayon 15,
durée 8s). Le 9e type d'effet a été ajouté précisément pour ce cas — voir
`getStatModifier` ci-dessus. S'il existe un archétype futur (ex: un buff qui
ne se résume pas à un simple multiplicateur borné dans le temps) qui ne
rentre toujours dans aucun des 9 types, ne pas le forcer dedans : le
signaler plutôt que de dégrader la mécanique.

## Vague 2 (Ember, Warp, Bramble, Havoc, Vesper) : extensions et gaps documentés

Trois nouvelles mécaniques ne rentraient pas dans l'architecture existante
telle quelle. Plutôt que de les forcer, l'architecture a reçu 3 petites
extensions **rétrocompatibles**, plus un gap assumé et documenté :

- **`AbilityInstanceState.customState?: Record<string, unknown>`**
  (types/entity.ts) + **`AbilityExecutionResult.instanceCustomState`**
  (types.ts, fusionné par `activateAbility` dans l'instance qui active) :
  état libre persistant propre à UNE capacité qui n'est ni une zone ni une
  liste d'entités affectées. Utilisé par l'**Anchor Point** de Warp (position
  + expiration du marqueur, relu par Return sur le slot C), le drapeau
  d'upgrade de **Trap Network** de Bramble (slot E, relu par les poses de
  pièges), et la baseline de vie de **Vanish** de Vesper (détecter "a pris
  des dégâts").
- **`AbilityExecutionContext.activeEffects`** (types.ts) : donne à
  `execute()` une visibilité en lecture sur les effets déjà dans le monde —
  nécessaire pour que Bramble compte ses propres pièges actifs (plafond de
  Trap Network) et que Vesper retrouve l'id de son propre effet `stealth` à
  retirer.
- **`AbilityExecutionResult.effectIdsToRemove`** (types.ts, appliqué par
  `activateAbility` avant l'ajout des nouveaux effets) : permet de retirer un
  effet existant dans la MÊME activation — consomme le marqueur d'un piège
  de Bramble à son déclenchement, remplace le plus ancien piège quand le
  plafond est atteint, et rompt le `stealth` de Vesper (Vanish) sur
  déclenchement.
  - **Trap Network** : choix explicite pour le 4e piège au-delà du plafond
    — il **remplace le plus ancien** (grâce à `effectIdsToRemove`) plutôt
    que d'être refusé ; voir `test-agents-wave2-run.ts`, section 5.
- **`stealth`** (10e `AbilityEffectType`) + **`hasLineOfSightWithAbilities`**
  étendue avec un 5e paramètre optionnel `targetEntityId` (intégration
  rétrocompatible : les appels existants sans ce paramètre ignorent la règle) :
  une entité CIBLE sous `stealth` est ignorée sauf si elle est
  SIMULTANÉMENT sous un `reveal` actif — **reveal a priorité sur stealth**.
  `applyVisionOverrides` passe désormais l'id de la cible engagée, donc la
  règle s'applique aussi en combat simulé réel, pas seulement en test isolé.

Gap assumé, non forcé :

- **Decoy (Vesper, slot Q)** : un vrai leurre détectable par les autres bots
  nécessiterait une entité fictive réellement enregistrée dans
  l'`EntityManager` (visible via `hasLineOfSight`, ciblable par
  `botController`) — l'architecture pure actuelle ne permet à `execute()` de
  produire que des `AbilityEffect` génériques et des changements à des
  entités EXISTANTES, jamais une nouvelle entité. Extension minimale
  proposée pour une prochaine étape : `AbilityExecutionResult.spawnEntities?:
  EntityState[]`, appliqué par `createAgentAbilitiesOnTick` (seul détenteur
  de l'`EntityManager`) via `entityManager.addEntity(...)`, avec une
  expiration gérée comme les pièges de Bramble (marqueur `AbilityEffect`
  dédié surveillé par `decide()`). Non implémenté ici : Decoy ne fait
  aujourd'hui que consommer sa charge, sans effet gameplay — même statut que
  le Stim Beacon du Vanguard avant son câblage en `statModifier`.
- **`damageDealt`/`damageTaken`** (Finisher Mark de l'Ember, Phantom Assault
  de Vesper) : désormais câblés dans la résolution de dégâts réelle.
  `roundManager.ts` gagne un `DamageMultiplierGetter` optionnel (5e paramètre
  de `resolveShot`/`createMatchOnTick`, même principe que
  `FireRateMultiplierGetter`) : `dégâts effectifs = calculateDamage(...) *
  getDamageMultiplier(shooter, target, tick)`. `createAgentAbilitiesOnTick`
  fournit ce getter en combinant `getStatModifier(shooter, 'damageDealt', ...)
  * getStatModifier(target, 'damageTaken', ...)`. Une cible sous Finisher Mark
  subit donc réellement plus de dégâts en combat simulé (voir
  `test-agents-wave2-run.ts`, section 11 : ~1222 dégâts cumulés sans marque
  contre ~2742 avec, sur 90 ticks).
- **Cataclysm (Havoc, ultime)** : combine Disorient Charge + Root Field avec
  un délai de préparation. La liste des ennemis aveuglés (`affectedEntityIds`)
  N'EST PLUS déterminée à l'activation : le volet "blind" est posé avec un
  `abilityId` `"havoc_cataclysm_pending"` et une liste vide (ignorée tant
  qu'elle est vide) ; `decide()` détecte, au tick exact où `activeFromTick`
  est atteint, ce marqueur en attente et déclenche `CATACLYSM_ARM` (coût 0,
  interne) qui le remplace (`effectIdsToRemove` + nouvel effet à
  `affectedEntityIds` recalculé CE moment-là, `abilityId` final sans
  `"_pending"`). Un ennemi qui fuit la zone pendant le délai n'est donc plus
  aveuglé à l'armement (voir `test-agents-wave2-run.ts`, section 12). Le
  blocage de déplacement, lui, n'a jamais eu ce problème (`activeFromTick` +
  NavGrid recalculée à chaque tick suffisaient déjà).

## Autres simplifications documentées

- Pas de simulation de trajectoire de projectile (flèches du Scout, lames de
  Gale) : le point ciblé est toujours atteint directement, sauf le dash de
  Gale qui vérifie `hasLineOfSight` sur sa propre trajectoire.
- Murs/tourelles/alarmbots non destructibles (durée fixe, pas de points de
  vie propres).
- Resurrection (Aegis) ne vérifie pas le délai depuis la mort (`execute()`
  n'a pas accès à l'historique des `SimulationEvent`).
- Cônes (Recon Bolt) et lignes (Hunter's Fury) approximés par des cercles
  (Hunter's Fury : une chaîne de petits cercles le long de la direction).

## Tester

```bash
npm run engine:abilities-test        # vague 1 (Vanguard, Scout, Gale, Aegis, Architect)
npx tsx engine/games/vshooters/abilities/test-agents-wave2-run.ts   # vague 2
```

`engine:abilities-test` vérifie explicitement (29 checks) : fumée bloque
`hasLineOfSight` sans modifier la fonction de base ; mur de l'Aegis bloque
`findPath` (vrai détour, jamais dans la zone) et la vision ; un flash empêche
`engaging` malgré un ennemi visible ; le soin de l'Aegis augmente la vie sur
plusieurs ticks ; la tourelle de l'Architect inflige des dégâts sans aucune
action du script (mécanisme isolé du gunplay normal pour une preuve propre) ;
les points d'ultimate progressent avec le temps ET les kills, et l'ultime
est refusée sous le seuil ; le dash de Gale déplace instantanément et ne
traverse pas un mur direct ; l'Overdrive Beacon augmente bien la cadence de
tir d'une entité dans sa zone (pas hors zone), et l'effet expire
correctement (retour à la cadence normale) ; et, de bout en bout en combat
simulé via `createAgentAbilitiesOnTick` : une entité sous Overdrive Beacon
tire réellement plus vite (30 tirs sans buff vs 45 avec, sur 90 ticks), et
une entité sous "slow" parcourt réellement moins de distance (195 vs 111
unités sur 40 ticks).

`test-agents-wave2-run.ts` vérifie explicitement (39 checks) : Flare Dash
inflige des dégâts à un ennemi traversé sur son trajet ; Return téléporte
vers l'Anchor Point ET échoue proprement sans marqueur actif ; Rift Swap
échange bien la position des deux entités ; un piège de Bramble se
déclenche au passage d'un ennemi mais jamais d'un allié, et retire son
marqueur en déposant l'effet correspondant ; Trap Network permet 3 pièges
actifs simultanés et le 4e remplace le plus ancien ; Disorient Charge
aveugle plusieurs ennemis dans le rayon d'impact (pas seulement le plus
proche) sans toucher un allié ; Root Field force un détour identique pour un
déplacement "attaquant" et "défenseur" (mécanisme sans notion d'équipe) ;
Vanish rend indétectable via `hasLineOfSightWithAbilities` et se rompt bien
si l'entité engage (tire) ; un `reveal` actif annule un `stealth` actif sur
la même entité (priorité documentée) ; Phantom Assault applique bien son
bonus de dégâts pendant sa fenêtre "premier coup", plus courte que sa durée
de stealth prolongée ; une cible sous Finisher Mark subit réellement plus de
dégâts cumulés en combat simulé (bout en bout, via
`createAgentAbilitiesOnTick`) ; et Cataclysm n'aveugle, à l'armement, que les
ennemis encore présents dans la zone — celui qui a fui pendant le délai de
préparation y échappe.
