# games/valorant

Gunplay + économie + déroulé de round + spike (bombe). **Aucune capacité
d'agent** (Sova, Jett, Sage, ...) — ça viendra à l'étape 4b avec une
architecture dédiée. Le combat ici est du gunplay pur : arme équipée,
distance, précision, armure.

Se branche sur le moteur générique uniquement via le bus d'événements et le
point d'extension `onTick` de `runSimulation` — `engine/core/` n'est pas
modifié par ce module.

## Fichiers

- **`weapons.ts`** — catalogue des armes (prix, dégâts tête/corps/jambes avec
  paliers de distance, cadence de tir, chargeur, pénétration de mur) et des
  armures (Light/Heavy Shield). Valeurs calquées au mieux sur le vrai jeu,
  pas garanties pixel-perfect.
- **`damage.ts`** — `calculateDamage(weapon, hitZone, distance, targetArmor, isBackstab?)` :
  applique le palier de distance de l'arme puis la réduction d'armure (quasi
  nulle sur la tête). `isBehindTarget` détecte une attaque dans le dos (bonus
  couteau). `applyDamage(entity, damage, context, eventBus)` met à jour
  santé/statut et émet `player:killed`.
- **`economy.ts`** — argent de départ (800$), plafond (9000$), récompense de
  kill (200$), gain de manche (3000$), loss bonus progressif
  (1900/2400/2900/3400, plafonné), bonus spike. `canAfford`/`buyItem`.
- **`spike.ts`** — state machine `carried -> planted -> defusing -> defused`
  ou `-> detonated` (fonctions pures : `plantSpike`, `startDefuse`,
  `interruptDefuse`, `completeDefuse`, `detonateSpike`, `updateSpikeTimers`).
  `plantSpike` vérifie que l'entité est dans une `Zone` de type `"site"`.
- **`roundManager.ts`** — phases `buy -> active -> ended`
  (`createMatchState`, `startNewRound`, `advanceRound`), conditions de
  victoire (élimination, spike désamorcée/explosée, temps écoulé),
  distribution de l'argent de fin de round (`applyRoundEndEconomy`), et
  surtout **`createValorantOnTick(navGrid, matchStateBox, config)`** : compose
  tout ça avec `ai/createBotOnTick` (réutilisé tel quel, aucune duplication)
  pour produire le `onTick` complet à passer à `runSimulation`.
- **`test-map.json`** / **`test-round-run.ts`** — carte de test (site B +
  mur forçant un détour) et script de vérification (voir plus bas).

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
`weapons` (ids), `equippedWeaponId`, `currentAmmo`. Optionnels et génériques
(juste des ids/strings) pour qu'un jeu sans économie puisse les ignorer —
le catalogue réel (`Weapon`, `ArmorItem`) reste dans `weapons.ts`, pas dans
`types/`.

## Tester

```bash
npm run engine:valorant-test
```

Le script a deux parties :

1. **Vérifications unitaires déterministes** (sans simulation, sans aléatoire) :
   réduction d'armure, dropoff Phantom vs dégâts constants Vandal, bonus
   couteau dans le dos, plafond d'argent, achat refusé/accepté selon les
   fonds, progression du loss bonus, cycle complet de la spike (y compris le
   rejet d'une pose hors site et la détonation si non désamorcée à temps).
2. **Simulation intégrée** d'un round complet (achat de Vandal/Heavy Shield,
   Phantom/Light Shield, etc., combat réel avec `createValorantOnTick`,
   résultat du round, distribution d'argent). Le combat étant partiellement
   aléatoire (précision), le round peut se terminer par élimination avant
   qu'un attaquant n'atteigne le site — le cycle de la spike est de toute
   façon déjà prouvé de façon déterministe dans la partie 1.
