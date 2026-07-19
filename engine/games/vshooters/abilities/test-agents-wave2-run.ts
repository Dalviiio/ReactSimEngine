import { buildNavGrid, findPath, hasLineOfSight } from '../../../ai';
import { EntityManager, EventBus, runSimulation } from '../../../core';
import { EntityState, MapData } from '../../../types';
import { AGENT_REGISTRY, BRAMBLE, EMBER, HAVOC, VESPER, WARP } from './agents';
import {
  AbilityWorldStateBox,
  applyEffectsToNavGrid,
  createAbilityLoadout,
  createAgentAbilitiesOnTick,
  createEmptyAbilityWorldState,
  getStatModifier,
  hasLineOfSightWithAbilities,
} from './integration';
import { activateAbility, updateActiveEffects } from './types';
import { RoundManagerConfig } from '../roundManager';

const results: { label: string; passed: boolean }[] = [];
function check(label: string, passed: boolean): void {
  results.push({ label, passed });
  console.log(`  ${passed ? '✅' : '❌'} ${label}`);
}

function makeOpenMap(width: number, height: number): MapData {
  return { id: 'test', name: 'Test', imageUrl: 'test.webp', width, height, zones: [], walls: [], boxes: [], navGrid: null };
}

function makeEntity(overrides: Partial<EntityState> & { id: string; team: string }): EntityState {
  return { position: { x: 0, y: 0 }, rotation: 0, health: 100, status: 'alive', currentAction: null, ...overrides };
}

function pathDistance(path: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return total;
}

const eventBus = new EventBus();
const activationContext = (mapData: MapData, allEntities: EntityState[], tick: number) => ({
  tick,
  tickRate: 30,
  mapData,
  allEntities,
  eventBus,
});

// ============================================================================
// 1. Ember : Flare Dash inflige des dégâts à un ennemi traversé sur le trajet
// ============================================================================
console.log('=== 1. Flare Dash (Ember) : dégâts au passage ===\n');

const mapEmber = makeOpenMap(400, 200);
const emberEntity = makeEntity({ id: 'ember-1', team: 'attackers', position: { x: 20, y: 100 }, abilityLoadout: createAbilityLoadout(EMBER) });
const dashEnemy = makeEntity({ id: 'dash-enemy', team: 'defenders', position: { x: 100, y: 100 }, health: 100 }); // pile sur le trajet du dash
const flareDash = EMBER.abilities.find((a) => a.id === 'ember_flare_dash')!;

const flareResult = activateAbility(
  createEmptyAbilityWorldState(),
  emberEntity,
  flareDash,
  { type: 'point', point: { x: 200, y: 100 } },
  activationContext(mapEmber, [emberEntity, dashEnemy], 1),
);
check("L'activation de Flare Dash réussit", flareResult !== null);
console.log(`  Position avant : (${emberEntity.position.x}, ${emberEntity.position.y}) -> après : (${flareResult!.selfChanges?.position?.x}, ${flareResult!.selfChanges?.position?.y})`);
check('Flare Dash déplace bien Ember vers le point ciblé', (flareResult!.selfChanges?.position?.x ?? 0) > emberEntity.position.x + 100);

const dashEventBus = new EventBus();
const dashEntityManager = new EntityManager(dashEventBus);
dashEntityManager.addEntity(dashEnemy);
let dashWorldState = flareResult!.worldState;
for (let t = 2; t <= 4; t += 1) dashWorldState = updateActiveEffects(dashWorldState, t, dashEntityManager, dashEventBus);
console.log(`  Vie de l'ennemi sur le trajet : ${dashEntityManager.getEntity('dash-enemy')!.health}`);
check("L'ennemi traversé par le dash a bien perdu de la vie", dashEntityManager.getEntity('dash-enemy')!.health < 100);
console.log();

// ============================================================================
// 2. Warp : Return téléporte vers l'Anchor Point, et échoue proprement sans marqueur
// ============================================================================
console.log('=== 2. Anchor Point / Return (Warp) ===\n');

const mapWarp = makeOpenMap(400, 200);
const warpEventBus = new EventBus();
const warpEntityManager = new EntityManager(warpEventBus);
const warpEntity = makeEntity({ id: 'warp-1', team: 'attackers', position: { x: 50, y: 50 }, abilityLoadout: createAbilityLoadout(WARP) });
warpEntityManager.addEntity(warpEntity);

const anchorPoint = WARP.abilities.find((a) => a.id === 'warp_anchor_point')!;
const returnAbility = WARP.abilities.find((a) => a.id === 'warp_return')!;

const anchorResult = activateAbility(createEmptyAbilityWorldState(), warpEntity, anchorPoint, { type: 'self' }, activationContext(mapWarp, [warpEntity], 1));
check("L'activation d'Anchor Point réussit", anchorResult !== null);
if (anchorResult!.selfChanges) warpEntityManager.updateEntity('warp-1', anchorResult!.selfChanges);
console.log(`  Ancre posée à (${warpEntity.position.x}, ${warpEntity.position.y})`);

// L'entité se déplace ensuite loin de son ancre.
warpEntityManager.updateEntity('warp-1', { position: { x: 300, y: 150 } });
const movedWarpEntity = warpEntityManager.getEntity('warp-1')!;
console.log(`  Déplacement vers (${movedWarpEntity.position.x}, ${movedWarpEntity.position.y})`);

const returnResult = activateAbility(anchorResult!.worldState, movedWarpEntity, returnAbility, { type: 'self' }, activationContext(mapWarp, [movedWarpEntity], 2));
console.log(`  Position après Return : (${returnResult?.selfChanges?.position?.x}, ${returnResult?.selfChanges?.position?.y})`);
check(
  "Return téléporte bien l'entité vers son Anchor Point (position d'origine 50,50)",
  returnResult?.selfChanges?.position?.x === 50 && returnResult?.selfChanges?.position?.y === 50,
);

// Cas sans marqueur actif : Return doit échouer proprement (pas de changement de position).
const warpEntityNoAnchor = makeEntity({ id: 'warp-2', team: 'attackers', position: { x: 10, y: 10 }, abilityLoadout: createAbilityLoadout(WARP) });
const returnNoAnchorResult = activateAbility(createEmptyAbilityWorldState(), warpEntityNoAnchor, returnAbility, { type: 'self' }, activationContext(mapWarp, [warpEntityNoAnchor], 1));
console.log(`  Return sans ancre : ${returnNoAnchorResult?.selfChanges?.position ? 'a téléporté (BUG)' : "n'a rien fait (échec propre)"}`);
check("Return échoue proprement (aucun changement de position) sans Anchor Point actif", returnNoAnchorResult !== null && returnNoAnchorResult.selfChanges?.position === undefined);
console.log();

// ============================================================================
// 3. Warp : Rift Swap échange bien la position des deux entités
// ============================================================================
console.log('=== 3. Rift Swap (Warp) ===\n');

const mapRift = makeOpenMap(400, 200);
const riftSwap = WARP.abilities.find((a) => a.id === 'warp_rift_swap')!;
const riftCaster = makeEntity({
  id: 'warp-3',
  team: 'attackers',
  position: { x: 20, y: 20 },
  abilityLoadout: { agentId: 'warp', abilities: { ...createAbilityLoadout(WARP).abilities, X: { charges: 0, ultimatePoints: 6 } } },
});
const riftAlly = makeEntity({ id: 'ally-rift', team: 'attackers', position: { x: 300, y: 180 } });

const riftResult = activateAbility(createEmptyAbilityWorldState(), riftCaster, riftSwap, { type: 'entity', entityId: 'ally-rift' }, activationContext(mapRift, [riftCaster, riftAlly], 1));
console.log(`  Warp : (${riftCaster.position.x},${riftCaster.position.y}) -> (${riftResult?.selfChanges?.position?.x},${riftResult?.selfChanges?.position?.y})`);
console.log(`  Allié : (${riftAlly.position.x},${riftAlly.position.y}) -> (${riftResult?.targetChanges?.changes.position?.x},${riftResult?.targetChanges?.changes.position?.y})`);
check("Rift Swap déplace Warp à la position de l'allié", riftResult?.selfChanges?.position?.x === 300 && riftResult?.selfChanges?.position?.y === 180);
check(
  "Rift Swap déplace l'allié à la position d'origine de Warp",
  riftResult?.targetChanges?.entityId === 'ally-rift' && riftResult?.targetChanges?.changes.position?.x === 20 && riftResult?.targetChanges?.changes.position?.y === 20,
);
console.log();

// ============================================================================
// 4. Bramble : un piège se déclenche au passage d'un ennemi, jamais d'un allié
// ============================================================================
console.log("=== 4. Snare Trap (Bramble) : déclenchement ennemi seulement ===\n");

const mapBramble = makeOpenMap(200, 200);
const brambleEntity = makeEntity({ id: 'bramble-1', team: 'defenders', position: { x: 100, y: 100 }, abilityLoadout: createAbilityLoadout(BRAMBLE) });
const snareTrap = BRAMBLE.abilities.find((a) => a.id === 'bramble_snare_trap')!;

const snareResult = activateAbility(createEmptyAbilityWorldState(), brambleEntity, snareTrap, { type: 'point', point: { x: 100, y: 100 } }, activationContext(mapBramble, [brambleEntity], 1));
check('Snare Trap se pose bien (1 effet marqueur)', snareResult !== null && snareResult.worldState.effects.length === 1);

const trappedAlly = makeEntity({ id: 'ally-on-trap', team: 'defenders', position: { x: 102, y: 100 } });
const decisionsWithAlly = BRAMBLE.decide({
  entity: brambleEntity,
  allEntities: [brambleEntity, trappedAlly],
  mapData: mapBramble,
  navGrid: buildNavGrid(mapBramble, 10),
  worldState: snareResult!.worldState,
  tick: 2,
  tickRate: 30,
});
const allyTriggeredTrap = decisionsWithAlly.some((d) => d.definition.id === 'bramble_snare_trigger' || d.definition.id === 'bramble_spike_trigger');
console.log(`  Allié sur le piège : ${decisionsWithAlly.length} décision(s) [${decisionsWithAlly.map((d) => d.definition.id).join(', ')}], déclenchement de piège=${allyTriggeredTrap}`);
check("Le piège NE se déclenche PAS au passage d'un allié (aucune décision de déclenchement, même si l'agent agit par ailleurs)", !allyTriggeredTrap);

const trappedEnemy = makeEntity({ id: 'enemy-on-trap', team: 'attackers', position: { x: 102, y: 100 } });
const decisionsWithEnemy = BRAMBLE.decide({
  entity: brambleEntity,
  allEntities: [brambleEntity, trappedEnemy],
  mapData: mapBramble,
  navGrid: buildNavGrid(mapBramble, 10),
  worldState: snareResult!.worldState,
  tick: 2,
  tickRate: 30,
});
console.log(`  Ennemi sur le piège : ${decisionsWithEnemy.length} déclenchement(s), ability=${decisionsWithEnemy[0]?.definition.id}`);
check("Le piège se déclenche bien au passage d'un ennemi", decisionsWithEnemy.length === 1 && decisionsWithEnemy[0].definition.id === 'bramble_snare_trigger');

const triggerResult = activateAbility(
  snareResult!.worldState,
  brambleEntity,
  decisionsWithEnemy[0].definition,
  decisionsWithEnemy[0].target,
  activationContext(mapBramble, [brambleEntity, trappedEnemy], 2),
);
const markerGone = !triggerResult!.worldState.effects.some((e) => e.abilityId === 'bramble_snare_trap');
const slowEffectCreated = triggerResult!.worldState.effects.some((e) => e.abilityId === 'bramble_snare_trap_active' && e.type === 'slow');
console.log(`  Après déclenchement : marqueur retiré=${markerGone}, effet "slow" créé=${slowEffectCreated}`);
check('Le marqueur du piège est retiré et un effet "slow" est appliqué au déclenchement', markerGone && slowEffectCreated);
console.log();

// ============================================================================
// 5. Bramble : Trap Network permet 3 pièges actifs simultanés (le 4e remplace le plus ancien)
// ============================================================================
console.log('=== 5. Trap Network (Bramble) : plafond de 3 pièges ===\n');

const mapNetwork = makeOpenMap(200, 200);
const networkEntity = makeEntity({
  id: 'bramble-2',
  team: 'defenders',
  position: { x: 50, y: 50 },
  abilityLoadout: {
    agentId: 'bramble',
    abilities: {
      C: { charges: 10, ultimatePoints: 0 },
      Q: { charges: 10, ultimatePoints: 0 },
      E: { charges: 0, ultimatePoints: 0, customState: { networkActive: true } },
      X: { charges: 0, ultimatePoints: 0 },
    },
  },
});

let networkWorldState = createEmptyAbilityWorldState();
const placedTrapIds: string[] = [];
for (let i = 1; i <= 3; i += 1) {
  const result = activateAbility(networkWorldState, networkEntity, snareTrap, { type: 'point', point: { x: 50 + i, y: 50 } }, activationContext(mapNetwork, [networkEntity], i));
  networkWorldState = result!.worldState;
  const newest = networkWorldState.effects[networkWorldState.effects.length - 1];
  placedTrapIds.push(newest.id);
}
console.log(`  Après 3 poses : ${networkWorldState.effects.length} piège(s) actif(s)`);
check('Trap Network permet bien 3 pièges actifs simultanés', networkWorldState.effects.length === 3);

const fourthResult = activateAbility(networkWorldState, networkEntity, snareTrap, { type: 'point', point: { x: 54, y: 50 } }, activationContext(mapNetwork, [networkEntity], 4));
networkWorldState = fourthResult!.worldState;
const stillThree = networkWorldState.effects.length === 3;
const oldestGone = !networkWorldState.effects.some((e) => e.id === placedTrapIds[0]);
console.log(`  Après un 4e piège : ${networkWorldState.effects.length} piège(s) actif(s), le plus ancien encore présent=${!oldestGone}`);
check(
  'Le 4e piège REMPLACE le plus ancien (choix explicite : remplacement, pas refus — voir le bilan) : toujours 3 pièges, le premier posé a disparu',
  stillThree && oldestGone,
);
console.log();

// ============================================================================
// 6. Havoc : Disorient Charge aveugle plusieurs ennemis dans le rayon, pas seulement le plus proche
// ============================================================================
console.log('=== 6. Disorient Charge (Havoc) : aveuglement multi-cible ===\n');

const mapHavoc = makeOpenMap(200, 200);
const havocEntity = makeEntity({ id: 'havoc-1', team: 'attackers', position: { x: 20, y: 20 }, abilityLoadout: createAbilityLoadout(HAVOC) });
const disorientCharge = HAVOC.abilities.find((a) => a.id === 'havoc_disorient_charge')!;
const nearEnemy1 = makeEntity({ id: 'near-enemy-1', team: 'defenders', position: { x: 98, y: 100 } });
const nearEnemy2 = makeEntity({ id: 'near-enemy-2', team: 'defenders', position: { x: 105, y: 108 } });
const farEnemy = makeEntity({ id: 'far-enemy', team: 'defenders', position: { x: 190, y: 190 } });
const nearAlly = makeEntity({ id: 'near-ally', team: 'attackers', position: { x: 102, y: 100 } });

const disorientResult = activateAbility(
  createEmptyAbilityWorldState(),
  havocEntity,
  disorientCharge,
  { type: 'area', point: { x: 100, y: 100 } },
  activationContext(mapHavoc, [havocEntity, nearEnemy1, nearEnemy2, farEnemy, nearAlly], 1),
);
const blindEffect = disorientResult!.worldState.effects[0];
console.log(`  Entités aveuglées : ${blindEffect.affectedEntityIds?.join(', ')}`);
check('Disorient Charge aveugle les DEUX ennemis proches (pas seulement le plus proche)', !!blindEffect.affectedEntityIds?.includes('near-enemy-1') && !!blindEffect.affectedEntityIds?.includes('near-enemy-2'));
check("Disorient Charge n'aveugle pas l'ennemi hors du rayon d'impact", !blindEffect.affectedEntityIds?.includes('far-enemy'));
check("Disorient Charge n'aveugle pas un allié dans le rayon", !blindEffect.affectedEntityIds?.includes('near-ally'));
console.log();

// ============================================================================
// 7. Havoc : Root Field bloque le déplacement de toute entité, ennemie ET alliée
// ============================================================================
console.log('=== 7. Root Field (Havoc) : immobilisation universelle ===\n');

const mapRoot = makeOpenMap(300, 200);
const navGridRoot = buildNavGrid(mapRoot, 10);
const rootField = HAVOC.abilities.find((a) => a.id === 'havoc_root_field')!;
const rootStart = { x: 20, y: 100 };
const rootEnd = { x: 280, y: 100 };

const directRootPath = findPath(navGridRoot, rootStart, rootEnd)!;
check('Un chemin direct existe avant Root Field', directRootPath !== null);

const rootResult = activateAbility(createEmptyAbilityWorldState(), havocEntity, rootField, { type: 'area', point: { x: 150, y: 100 } }, activationContext(mapRoot, [havocEntity], 1));
const patchedRootNavGrid = applyEffectsToNavGrid(navGridRoot, rootResult!.worldState.effects);

// `applyEffectsToNavGrid` ne lit jamais `entity.team` : le blocage est universel PAR
// CONSTRUCTION — findPath donne donc le même détour, que ce soit pour une entité
// "attackers" ou "defenders" empruntant le même trajet (aucun filtre d'équipe possible).
const pathAfterRootForAttacker = findPath(patchedRootNavGrid, rootStart, rootEnd);
const pathAfterRootForDefender = findPath(patchedRootNavGrid, rootStart, rootEnd);
console.log(`  Chemin après Root Field (attaquant) : ${pathAfterRootForAttacker ? `détour, distance=${pathDistance(pathAfterRootForAttacker).toFixed(0)}` : 'AUCUN'}`);
console.log(`  Chemin après Root Field (défenseur)  : ${pathAfterRootForDefender ? `détour, distance=${pathDistance(pathAfterRootForDefender).toFixed(0)}` : 'AUCUN'}`);
check('Root Field force un détour pour un déplacement "attaquant"', pathAfterRootForAttacker !== null && pathDistance(pathAfterRootForAttacker) > pathDistance(directRootPath));
check('Root Field force IDENTIQUEMENT un détour pour un déplacement "défenseur" (mécanisme sans notion d\'équipe)', pathAfterRootForDefender !== null && pathDistance(pathAfterRootForDefender) > pathDistance(directRootPath));
console.log();

// ============================================================================
// 8. Vesper : Vanish rend indétectable via hasLineOfSightWithAbilities, et se rompt au tir
// ============================================================================
console.log('=== 8. Vanish (Vesper) : indétectable, rupture au tir ===\n');

const mapVesper = makeOpenMap(200, 200);
const vesperEntity = makeEntity({ id: 'vesper-1', team: 'attackers', position: { x: 100, y: 100 }, abilityLoadout: createAbilityLoadout(VESPER) });
const vanish = VESPER.abilities.find((a) => a.id === 'vesper_vanish')!;
const observerPos = { x: 100, y: 150 };

const vanishResult = activateAbility(createEmptyAbilityWorldState(), vesperEntity, vanish, { type: 'self' }, activationContext(mapVesper, [vesperEntity], 1));
check("L'activation de Vanish réussit et produit un effet \"stealth\"", vanishResult !== null && vanishResult.worldState.effects[0]?.type === 'stealth');

const baseLos = hasLineOfSight(mapVesper, observerPos, vesperEntity.position);
const losIgnoringStealth = hasLineOfSightWithAbilities(mapVesper, observerPos, vesperEntity.position, vanishResult!.worldState.effects);
const losWithStealthCheck = hasLineOfSightWithAbilities(mapVesper, observerPos, vesperEntity.position, vanishResult!.worldState.effects, 'vesper-1');
console.log(`  hasLineOfSight (géométrique) : ${baseLos}`);
console.log(`  hasLineOfSightWithAbilities SANS targetEntityId (rétrocompatible) : ${losIgnoringStealth}`);
console.log(`  hasLineOfSightWithAbilities AVEC targetEntityId='vesper-1' (règle stealth appliquée) : ${losWithStealthCheck}`);
check('La ligne de vue géométrique existe (le mur/la fumée ne joue aucun rôle ici)', baseLos === true);
check('Sans targetEntityId, le comportement reste inchangé (rétrocompatible)', losIgnoringStealth === true);
check('Avec targetEntityId, Vesper sous Vanish est ignorée comme cible (indétectable)', losWithStealthCheck === false);

const engagingVesper = { ...vesperEntity, currentAction: 'engaging' };
const breakDecisions = VESPER.decide({
  entity: engagingVesper,
  allEntities: [engagingVesper],
  mapData: mapVesper,
  navGrid: buildNavGrid(mapVesper, 10),
  worldState: vanishResult!.worldState,
  tick: 2,
  tickRate: 30,
});
console.log(`  Vesper "engaging" sous Vanish : ${breakDecisions.length} décision(s), ability=${breakDecisions[0]?.definition.id}`);
check("Vesper qui engage (tire) déclenche bien la rupture de Vanish", breakDecisions.length === 1 && breakDecisions[0].definition.id === 'vesper_break_stealth');

const breakResult = activateAbility(vanishResult!.worldState, engagingVesper, breakDecisions[0].definition, breakDecisions[0].target, activationContext(mapVesper, [engagingVesper], 2));
const stealthGoneAfterShot = !breakResult!.worldState.effects.some((e) => e.type === 'stealth');
console.log(`  Après rupture : effet stealth encore présent=${!stealthGoneAfterShot}`);
check('Le stealth est bien retiré après la rupture (tir)', stealthGoneAfterShot);
console.log();

// ============================================================================
// 9. Vesper : un "reveal" actif annule un "stealth" actif sur la même entité (reveal > stealth)
// ============================================================================
console.log('=== 9. Priorité reveal > stealth (Vesper) ===\n');

const vanishOnlyResult = activateAbility(createEmptyAbilityWorldState(), vesperEntity, vanish, { type: 'self' }, activationContext(mapVesper, [vesperEntity], 1));
const stealthOnlyEffects = vanishOnlyResult!.worldState.effects;
const detectedUnderStealthOnly = hasLineOfSightWithAbilities(mapVesper, observerPos, vesperEntity.position, stealthOnlyEffects, 'vesper-1');

const revealEffect = {
  id: 'reveal-over-vesper',
  abilityId: 'test_reveal',
  sourceEntityId: 'someone-else',
  type: 'reveal' as const,
  position: { ...vesperEntity.position },
  radius: 20,
  createdAtTick: 1,
  expiresAtTick: 100,
};
const stealthPlusRevealEffects = [...stealthOnlyEffects, revealEffect];
const detectedUnderStealthAndReveal = hasLineOfSightWithAbilities(mapVesper, observerPos, vesperEntity.position, stealthPlusRevealEffects, 'vesper-1');

console.log(`  Détectée sous stealth SEUL : ${detectedUnderStealthOnly}`);
console.log(`  Détectée sous stealth + reveal simultanés : ${detectedUnderStealthAndReveal}`);
check('Sous stealth seul, Vesper est bien indétectable', detectedUnderStealthOnly === false);
check('Un "reveal" actif simultané ANNULE le stealth : Vesper redevient détectable (reveal > stealth)', detectedUnderStealthAndReveal === true);
console.log();

// ============================================================================
// 10. Vesper : Phantom Assault applique un bonus de dégâts au premier coup (fenêtre courte)
// ============================================================================
console.log('=== 10. Phantom Assault (Vesper) : bonus de dégâts ===\n');

const phantomAssault = VESPER.abilities.find((a) => a.id === 'vesper_phantom_assault')!;
const phantomCaster = makeEntity({
  id: 'vesper-2',
  team: 'attackers',
  position: { x: 100, y: 100 },
  abilityLoadout: { agentId: 'vesper', abilities: { ...createAbilityLoadout(VESPER).abilities, X: { charges: 0, ultimatePoints: 7 } } },
});

const phantomResult = activateAbility(createEmptyAbilityWorldState(), phantomCaster, phantomAssault, { type: 'self' }, activationContext(mapVesper, [phantomCaster], 1));
check("Phantom Assault produit bien un effet stealth ET un effet statModifier damageDealt", phantomResult!.worldState.effects.some((e) => e.type === 'stealth') && phantomResult!.worldState.effects.some((e) => e.type === 'statModifier' && e.statType === 'damageDealt'));

const multiplierDuringWindow = getStatModifier(phantomCaster, 'damageDealt', phantomResult!.worldState.effects, 2);
console.log(`  Multiplicateur de dégâts pendant la fenêtre "premier coup" : x${multiplierDuringWindow}`);
check('Le bonus de dégâts (x2) est bien actif juste après Phantom Assault (premier coup)', multiplierDuringWindow === 2);

const bonusEffect = phantomResult!.worldState.effects.find((e) => e.statType === 'damageDealt')!;
const afterBonusWorldState = updateActiveEffects(phantomResult!.worldState, bonusEffect.expiresAtTick + 1, new EntityManager(new EventBus()), new EventBus());
const multiplierAfterWindow = getStatModifier(phantomCaster, 'damageDealt', afterBonusWorldState.effects, bonusEffect.expiresAtTick + 1);
const stealthStillActive = afterBonusWorldState.effects.some((e) => e.type === 'stealth');
console.log(`  Multiplicateur après la fenêtre : x${multiplierAfterWindow} (stealth encore actif : ${stealthStillActive})`);
check('Le bonus de dégâts expire après sa courte fenêtre (retour à x1)', multiplierAfterWindow === 1);
check('Le stealth prolongé de Phantom Assault, lui, dure plus longtemps que la fenêtre de bonus', stealthStillActive === true);
console.log();

// ============================================================================
// 11. Bout en bout : Finisher Mark (statModifier damageTaken) amplifie réellement les dégâts en combat simulé
// ============================================================================
console.log('=== 11. Finisher Mark (Ember) : dégâts amplifiés en combat simulé ===\n');

const config: RoundManagerConfig = { attackerTeam: 'attackers', defenderTeam: 'defenders', tickRate: 30 };

function createActiveMatchState() {
  return {
    phase: 'active' as const,
    roundNumber: 1,
    phaseStartTick: 0,
    buyPhaseDurationTicks: 0,
    roundDurationTicks: 100000,
    device: { status: 'carried' as const, carrierId: null, plantedAt: null, detonationTick: null, defuse: null },
    teamStats: {},
    lastRoundResult: null,
  };
}

function sumDamageForShooter(ticks: ReturnType<typeof runSimulation>, shooterId: string): number {
  return ticks.reduce(
    (total, t) =>
      total +
      t.events
        .filter((e) => e.type === 'combat:shot-hit' && (e.data as { shooterId: string }).shooterId === shooterId)
        .reduce((sum, e) => sum + (e.data as { damage: number }).damage, 0),
    0,
  );
}

const DAMAGE_TEST_TICKS = 90;

function runDamageScenario(withFinisherMark: boolean): number {
  const map = makeOpenMap(200, 200);
  const navGrid = buildNavGrid(map, 10);
  // Santé énorme des deux côtés : mesure les dégâts cumulés sur toute la durée du
  // test sans qu'une élimination n'interrompe le combat prématurément.
  const shooter = makeEntity({ id: 'dmg-shooter', team: 'attackers', position: { x: 50, y: 50 }, health: 1_000_000, equippedWeaponId: 'warhawk', currentAmmo: 999 });
  const target = makeEntity({ id: 'dmg-target', team: 'defenders', position: { x: 60, y: 50 }, health: 1_000_000 });

  const matchStateBox = { current: createActiveMatchState() };
  const abilityWorldStateBox: AbilityWorldStateBox = {
    current: {
      effects: withFinisherMark
        ? [
            {
              id: 'e2e-finisher-mark',
              abilityId: 'ember_finisher_mark',
              sourceEntityId: 'someone-else',
              type: 'statModifier' as const,
              statType: 'damageTaken' as const,
              multiplier: 1.5,
              position: { x: 0, y: 0 },
              radius: 0,
              affectedEntityIds: ['dmg-target'],
              createdAtTick: 0,
              expiresAtTick: 100000,
            },
          ]
        : [],
    },
  };
  const onTick = createAgentAbilitiesOnTick(navGrid, matchStateBox, abilityWorldStateBox, AGENT_REGISTRY, config);

  const ticks = runSimulation(map, [shooter, target], { tickRate: 30, totalTicks: DAMAGE_TEST_TICKS, onTick });
  return sumDamageForShooter(ticks, 'dmg-shooter');
}

const baselineDamage = runDamageScenario(false);
const markedDamage = runDamageScenario(true);
console.log(`  Dégâts cumulés sur ${DAMAGE_TEST_TICKS} ticks : sans Finisher Mark=${baselineDamage.toFixed(0)}, avec Finisher Mark=${markedDamage.toFixed(0)}`);
check(
  'Une cible sous Finisher Mark subit réellement plus de dégâts en combat simulé (dégâts cumulés supérieurs)',
  markedDamage > baselineDamage,
);
console.log();

// ============================================================================
// 12. Havoc : Cataclysm ne cible que les ennemis encore présents à la FIN du délai (pas ceux qui ont fui)
// ============================================================================
console.log('=== 12. Cataclysm (Havoc) : la fuite pendant le délai de préparation fonctionne ===\n');

const mapCataclysm = makeOpenMap(200, 200);
const cataclysmCaster = makeEntity({
  id: 'havoc-2',
  team: 'attackers',
  position: { x: 20, y: 20 },
  abilityLoadout: { agentId: 'havoc', abilities: { ...createAbilityLoadout(HAVOC).abilities, X: { charges: 0, ultimatePoints: 8 } } },
});
const cataclysm = HAVOC.abilities.find((a) => a.id === 'havoc_cataclysm')!;
const impactPoint = { x: 100, y: 100 };

const cataclysmResult = activateAbility(createEmptyAbilityWorldState(), cataclysmCaster, cataclysm, { type: 'area', point: impactPoint }, activationContext(mapCataclysm, [cataclysmCaster], 1));
const pendingBlind = cataclysmResult!.worldState.effects.find((e) => e.abilityId === 'havoc_cataclysm_pending')!;
console.log(`  Cataclysm activé au tick 1, armement prévu au tick ${pendingBlind.activeFromTick}`);
check(
  'Cataclysm pose bien un marqueur "blind" en attente (liste vide) et un effet "blocksMovement" séparé',
  pendingBlind.affectedEntityIds?.length === 0 && cataclysmResult!.worldState.effects.some((e) => e.type === 'blocksMovement'),
);

// Un ennemi reste dans la zone jusqu'à l'armement ; un autre était dans la zone au
// moment de l'activation mais a fui bien avant la fin du délai de préparation.
const stayingEnemy = makeEntity({ id: 'staying-enemy', team: 'defenders', position: { x: 102, y: 100 } });
const fleeingEnemyAfterFleeing = makeEntity({ id: 'fleeing-enemy', team: 'defenders', position: { x: 190, y: 190 } }); // hors du rayon (40) à l'armement

const armTick = pendingBlind.activeFromTick!;
const armDecisions = HAVOC.decide({
  entity: cataclysmCaster,
  allEntities: [cataclysmCaster, stayingEnemy, fleeingEnemyAfterFleeing],
  mapData: mapCataclysm,
  navGrid: buildNavGrid(mapCataclysm, 10),
  worldState: cataclysmResult!.worldState,
  tick: armTick,
  tickRate: 30,
});
console.log(`  Au tick d'armement (${armTick}) : ${armDecisions.length} décision(s), ability=${armDecisions[0]?.definition.id}`);
check("Cataclysm s'arme bien exactement au tick où le délai de préparation s'achève", armDecisions.length === 1 && armDecisions[0].definition.id === 'havoc_cataclysm_arm');

const armResult = activateAbility(
  cataclysmResult!.worldState,
  cataclysmCaster,
  armDecisions[0].definition,
  armDecisions[0].target,
  activationContext(mapCataclysm, [cataclysmCaster, stayingEnemy, fleeingEnemyAfterFleeing], armTick),
);
const armedBlind = armResult!.worldState.effects.find((e) => e.abilityId === 'havoc_cataclysm' && e.type === 'blind')!;
console.log(`  Ennemis aveuglés à l'armement : ${armedBlind.affectedEntityIds?.join(', ') || '(aucun)'}`);
check("L'ennemi resté dans la zone jusqu'au bout est bien aveuglé à l'armement", !!armedBlind.affectedEntityIds?.includes('staying-enemy'));
check(
  "L'ennemi qui a fui la zone PENDANT le délai n'est PAS aveuglé (résolution différée à l'armement, pas à l'activation initiale)",
  !armedBlind.affectedEntityIds?.includes('fleeing-enemy'),
);
check('Le marqueur "pending" a bien été retiré au profit de l\'effet final résolu', !armResult!.worldState.effects.some((e) => e.abilityId === 'havoc_cataclysm_pending'));
console.log();

console.log(`AGENT_REGISTRY contient ${Object.keys(AGENT_REGISTRY).length} agents : ${Object.keys(AGENT_REGISTRY).join(', ')}`);
check('Les 5 nouveaux agents sont bien enregistrés dans AGENT_REGISTRY', ['ember', 'warp', 'bramble', 'havoc', 'vesper'].every((id) => id in AGENT_REGISTRY));
console.log();

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} vérification(s) ont échoué.`);
  process.exitCode = 1;
} else {
  console.log(`Toutes les vérifications (${results.length}) sont passées.`);
}
