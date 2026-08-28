import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import {
  createCombatState, beginPlayerFirst, beginEnemyFirst, playCard, advanceTurn, endPlayerTurn, isCardPlayable,
} from '../src/engine/combatEngine.js';

function entries(defIds) {
  return defIds.map((defId) => ({ defId }));
}

function makeCombat({ deck, monsterIds, overload = 0, overloadFloor = 0, playerHp = 70, ammo = 8, maxLoad = 999, seed = 1, hpMultiplier }) {
  const state = createCombatState({
    deckEntries: entries(deck), monsterIds, hpMultiplier,
    playerHp, playerMaxHp: 70, usableAmmo: ammo, maxLoad,
    overload, overloadFloor, overloadGainMultiplier: 1, extraDrawPerTurn: 0, turnStartAoeDamage: 0,
    inventoryItemIdsInOrder: [], inventoryCapacity: 30,
    rngState: createRngState(seed),
  });
  return beginPlayerFirst(state);
}

function findCard(state, defId) {
  const card = state.piles.hand.find((c) => c.defId === defId);
  assert.ok(card, `expected "${defId}" in hand`);
  return card;
}

test('베기 deals 6 base damage at stage 0 and costs 1 energy', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'] });
  const before = state.enemies[0].hp;
  const card = findCard(state, 'katana_slash');
  state = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(state.player.energy, 2);
  assert.equal(state.enemies[0].hp, before - 6);
});

test('stage 1 scales 베기 damage to 8 (6 * 1.25, rounded) via §4.2', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'], overload: 30 });
  const before = state.enemies[0].hp;
  const card = findCard(state, 'katana_slash');
  state = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(state.enemies[0].hp, before - 8);
});

test('vulnerable multiplies damage taken by 1.5, floored', () => {
  let state = makeCombat({ deck: [...Array(5).fill('katana_slash'), 'dagger_stab'], monsterIds: ['nibbit'] });
  const enemyId = state.enemies[0].id;
  // dagger_stab has no vulnerable effect on the target — apply vulnerable manually via a helper attack.
  state = { ...state, enemies: state.enemies.map((e) => ({ ...e, statuses: { vulnerable: 1 } })) };
  const before = state.enemies[0].hp;
  const card = findCard(state, 'katana_slash');
  state = playCard(state, card.instanceId, enemyId);
  assert.equal(state.enemies[0].hp, before - 9); // floor(6*1.5)=9
});

test('ammo-gated cards are unplayable without enough ammo, but stay in hand', () => {
  let state = makeCombat({ deck: Array(10).fill('rifle_aim'), monsterIds: ['nibbit'], ammo: 0 });
  const card = findCard(state, 'rifle_aim');
  assert.equal(isCardPlayable(state, card.instanceId), false);
  const after = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(after, state); // no-op
});

test('revolver 마지막 한 발 is unavailable above one loaded round and pierces block when enabled', () => {
  let state = makeCombat({ deck: Array(10).fill('revolver_last_round'), monsterIds: ['nibbit'], ammo: 2, maxLoad: 6 });
  const card = findCard(state, 'revolver_last_round');
  assert.equal(isCardPlayable(state, card.instanceId), false);

  state = makeCombat({ deck: Array(10).fill('revolver_last_round'), monsterIds: ['nibbit'], ammo: 1, maxLoad: 6 });
  const lastRound = findCard(state, 'revolver_last_round');
  state = { ...state, enemies: state.enemies.map((enemy) => ({ ...enemy, block: 99 })) };
  const before = state.enemies[0].hp;
  state = playCard(state, lastRound.instanceId, state.enemies[0].id);
  assert.equal(state.enemies[0].hp, before - 20);
});

test('퀵드로우 refills one round after firing, and mantis blades create a vanishing free slash each later turn', () => {
  let state = makeCombat({ deck: Array(10).fill('revolver_quickdraw'), monsterIds: ['nibbit'], ammo: 7, maxLoad: 5 });
  const quickdraw = findCard(state, 'revolver_quickdraw');
  state = playCard(state, quickdraw.instanceId, state.enemies[0].id);
  assert.equal(state.player.loaded, 5, 'fires one then reloads exactly one');

  state = makeCombat({ deck: Array(10).fill('mantis_blades_deploy'), monsterIds: ['nibbit'] });
  const deploy = findCard(state, 'mantis_blades_deploy');
  state = playCard(state, deploy.instanceId, null);
  state = advanceTurn(state);
  assert.ok(state.piles.hand.some((card) => card.defId === 'mantis_blade_slash'));
  const slash = findCard(state, 'mantis_blade_slash');
  state = playCard(state, slash.instanceId, state.enemies[0].id);
  assert.ok(state.piles.exhaustPile.some((card) => card.defId === 'mantis_blade_slash'));
});

test('playing an ammo card consumes ammo 1:1 with its ammoCost', () => {
  let state = makeCombat({ deck: Array(10).fill('rifle_suppress'), monsterIds: ['nibbit'], ammo: 5 });
  const card = findCard(state, 'rifle_suppress');
  state = playCard(state, card.instanceId, null);
  assert.equal(state.player.loaded, 2); // 5 - 3
});

test('reload effect refills loaded from reserve up to maxLoad (§신규 재장전)', () => {
  let state = makeCombat({ deck: Array(10).fill('reload'), monsterIds: ['nibbit'], ammo: 8, maxLoad: 3 });
  assert.equal(state.player.loaded, 3); // combat start: min(maxLoad, usableAmmo)
  assert.equal(state.player.reserve, 5);
  state = { ...state, player: { ...state.player, loaded: 0 } }; // simulate having spent it all
  const card = findCard(state, 'reload');
  state = playCard(state, card.instanceId, null);
  assert.equal(state.player.loaded, 3); // refilled to maxLoad
  assert.equal(state.player.reserve, 2); // 5 - 3

  // reserve-limited case: less left in reserve than maxLoad allows
  state = { ...state, player: { ...state.player, loaded: 0, reserve: 1 } };
  const card2 = findCard(state, 'reload');
  state = playCard(state, card2.instanceId, null);
  assert.equal(state.player.loaded, 1);
  assert.equal(state.player.reserve, 0);
});

test('playing a card tagged with equipmentInstanceId can accumulate a 1% durability decay roll (§신규 내구도)', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'], seed: 3 });
  let sawDecay = false;
  for (let i = 0; i < 400 && !sawDecay; i++) {
    const card = { instanceId: `probe-${i}`, defId: 'katana_slash', equipmentInstanceId: 'w1' };
    state = {
      ...state,
      player: { ...state.player, energy: 99 },
      enemies: state.enemies.map((e) => ({ ...e, hp: e.maxHp })),
      piles: { ...state.piles, hand: [card] },
    };
    state = playCard(state, card.instanceId, state.enemies[0].id);
    if (state.player.durabilityDecayInstanceIds.length > 0) sawDecay = true;
  }
  assert.ok(sawDecay, 'expected at least one 1% decay roll to hit across 400 plays');
  assert.ok(state.player.durabilityDecayInstanceIds.every((id) => id === 'w1'));
});

test('역장 방어 locks its armor gain at the stage it was cast, and grants that much armor immediately — no lingering "power" state', () => {
  let state = makeCombat({ deck: ['module_forcefield_defense', ...Array(5).fill('katana_slash')], monsterIds: ['nibbit'], overload: 30 });
  const card = findCard(state, 'module_forcefield_defense');
  state = playCard(state, card.instanceId, null);
  assert.equal(state.player.statuses.armor, 6); // stage1 row, granted once, immediately, on cast
  assert.equal(state.player.powers.forcefieldDefense, undefined); // only the armor status is left behind
  state = endPlayerTurn(state); // armor converts to block right before the enemy's attack, same turn
  assert.ok(state.player.block >= 6);
});

test('역장 방어 only grants armor once — later turn ends just decay the leftover stack, no re-grant', () => {
  let state = makeCombat({ deck: ['module_forcefield_defense', ...Array(5).fill('katana_slash')], monsterIds: ['nibbit'], overload: 30 });
  const card = findCard(state, 'module_forcefield_defense');
  state = playCard(state, card.instanceId, null);
  state = advanceTurn(state); // turn 1 end converts the 6 armor to block (decrementing it to 5); enemy attacks; turn 2 starts
  state = endPlayerTurn(state); // turn 2 end: no recast, so only the leftover 5 stacks convert
  assert.equal(state.player.block, 5);
});

test('신경 강화 adds a live block bonus that tracks the CURRENT stage, not the cast-time stage', () => {
  let state = makeCombat({ deck: ['module_neural_boost', 'katana_parry', 'katana_parry'], monsterIds: ['nibbit'], overload: 0 });
  const power = findCard(state, 'module_neural_boost');
  state = playCard(state, power.instanceId, null); // active at stage 0 -> +1 block bonus
  const before = state.player.block;
  const parry = findCard(state, 'katana_parry');
  state = playCard(state, parry.instanceId, null); // base 8 block + neuralBoost(stage0)=+1 => +9
  assert.equal(state.player.block - before, 9);
});

test('overload exceeding 100 inserts curse cards instead of causing defeat (§과부화 3단계 개편)', () => {
  let state = makeCombat({ deck: Array(20).fill('rifle_suppress'), monsterIds: ['nibbit'], overload: 95, ammo: 99, playerHp: 70 });
  const card = findCard(state, 'rifle_suppress'); // overloadGain 10 -> 105, 5 excess -> ceil(5/10) = 1 curse
  state = playCard(state, card.instanceId, null);
  assert.equal(state.overload, 105);
  assert.notEqual(state.phase, 'defeat');
  assert.equal(state.player.hp, 70); // no HP loss from overload alone
  assert.equal(state.overloadCurseCount, 1);
  assert.equal(state.piles.discardPile.filter((c) => c.defId === 'overload_curse').length, 1);
});

test('overload curse count only grows within a combat — playing more cards adds more curses as the excess grows further', () => {
  let state = makeCombat({ deck: Array(20).fill('rifle_suppress'), monsterIds: ['nibbit'], overload: 95, ammo: 99, playerHp: 70 });
  const first = findCard(state, 'rifle_suppress');
  state = playCard(state, first.instanceId, null); // 95 -> 105, 1 curse
  assert.equal(state.overloadCurseCount, 1);
  state = { ...state, player: { ...state.player, energy: 99 } }; // stage-2's +1 cost would otherwise starve the second play
  const second = findCard(state, 'rifle_suppress');
  state = playCard(state, second.instanceId, null); // 105 -> 115, excess 15 -> ceil(15/10) = 2 curses
  assert.equal(state.overload, 115);
  assert.equal(state.overloadCurseCount, 2);
  assert.equal(state.piles.discardPile.filter((c) => c.defId === 'overload_curse').length, 2);
});

test('starting a combat with overload already over 100 pre-inserts the matching curse count', () => {
  const state = makeCombat({ deck: Array(5).fill('katana_slash'), monsterIds: ['nibbit'], overload: 123 });
  assert.equal(state.overloadCurseCount, 3); // ceil(23/10)
  const total = state.piles.drawPile.length + state.piles.discardPile.length + state.piles.hand.length;
  assert.equal(state.piles.discardPile.filter((c) => c.defId === 'overload_curse').length, 3);
  assert.ok(total >= 5 + 3);
});

test('stage 2 (70%+ overload) adds +1 to every card cost on top of the existing +25% boost', () => {
  const state = makeCombat({ deck: Array(5).fill('katana_slash'), monsterIds: ['nibbit'], overload: 70, playerHp: 70 });
  const card = findCard(state, 'katana_slash');
  const before = state.player.energy;
  const after = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(before - after.player.energy, 2); // base cost 1 + stage-2 penalty 1
});

test('무게 저주 has no effect and exhausts, but never blocks the turn from continuing', () => {
  let state = makeCombat({ deck: ['heavy_top_curse', ...Array(5).fill('katana_slash')], monsterIds: ['nibbit'] });
  const curse = findCard(state, 'heavy_top_curse');
  const hpBefore = state.enemies[0].hp;
  state = playCard(state, curse.instanceId, null);
  assert.equal(state.enemies[0].hp, hpBefore); // no effect
  assert.equal(state.piles.exhaustPile.length, 1);
});

test('loot curse cards (잡템/환금템) are unplayable unless their item is currently burden', () => {
  let state = makeCombat({ deck: Array(4).fill('katana_slash'), monsterIds: ['nibbit'] });
  state = {
    ...state,
    player: { ...state.player, inventoryItemIdsInOrder: ['a', 'b'], inventoryCapacity: 1, removedItemIds: [] },
    piles: { ...state.piles, hand: [...state.piles.hand, { instanceId: 'loot-a', defId: 'junk_item', itemId: 'a' }, { instanceId: 'loot-b', defId: 'junk_item', itemId: 'b' }] },
  };
  assert.equal(isCardPlayable(state, 'loot-a'), false); // core slot, not burden
  assert.equal(isCardPlayable(state, 'loot-b'), true); // beyond capacity(1) -> burden
});

test('playing a burdened loot card records the item for removal (synced back to inventory by gameReducer)', () => {
  let state = makeCombat({ deck: Array(4).fill('katana_slash'), monsterIds: ['nibbit'] });
  state = {
    ...state,
    player: { ...state.player, inventoryItemIdsInOrder: ['a'], inventoryCapacity: 0, removedItemIds: [] },
    piles: { ...state.piles, hand: [...state.piles.hand, { instanceId: 'loot-a', defId: 'junk_item', itemId: 'a' }] },
  };
  state = playCard(state, 'loot-a', null);
  assert.deepEqual(state.player.removedItemIds, ['a']);
});

test('니빗 쌍 act out of phase (one headbutts while the other slices)', () => {
  const state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit', 'nibbit'] });
  const kinds = state.enemies.map((e) => e.intent.id);
  assert.deepEqual(kinds.sort(), ['headbutt', 'slice']);
});

test('자폭충 cycles weaken -> bite -> stomp without ever self-destructing', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_parry'), monsterIds: ['shrinker_beetle'], playerHp: 70 });
  assert.equal(state.enemies[0].intent.id, 'weaken');
  state = advanceTurn(state);
  assert.equal(state.enemies[0].intent.id, 'bite');
  state = advanceTurn(state);
  assert.equal(state.enemies[0].intent.id, 'stomp');
  state = advanceTurn(state);
  assert.equal(state.enemies[0].intent.id, 'weaken'); // loops back around
  assert.ok(state.enemies[0].hp > 0);
});

test('의식의 짐승 switches to phase 2 once hp drops to (or below) 150/252', () => {
  let state = makeCombat({ deck: Array(60).fill('katana_slash'), monsterIds: ['ceremonial_beast'], playerHp: 999 });
  let guard = 0;
  while (state.enemies[0].phase === 1 && guard < 60) {
    let card = state.piles.hand.find((c) => c.defId === 'katana_slash' && isCardPlayable(state, c.instanceId));
    state = card ? playCard(state, card.instanceId, state.enemies[0].id) : advanceTurn(state);
    guard += 1;
  }
  assert.equal(state.enemies[0].phase, 2);
  assert.ok(state.enemies[0].hp <= state.enemies[0].maxHp * (150 / 252));
});

test('beginEnemyFirst (ambush, §7.3) resolves the first intent before the player ever acts', () => {
  const setup = createCombatState({
    deckEntries: entries(Array(5).fill('katana_slash')), monsterIds: ['vine_shambler'],
    playerHp: 70, playerMaxHp: 70, usableAmmo: 8, maxLoad: 999, overload: 0, overloadFloor: 0, overloadGainMultiplier: 1,
    extraDrawPerTurn: 0, turnStartAoeDamage: 0, inventoryItemIdsInOrder: [], inventoryCapacity: 30,
    rngState: createRngState(1),
  });
  const opened = beginEnemyFirst(setup);
  assert.equal(opened.phase, 'player_turn'); // already past the enemy's first move
  assert.ok(opened.player.hp <= 70); // wrap wound was already taken
});

test('뒤얽힘(entangled) adds its stack to attack card cost', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'] });
  state = { ...state, player: { ...state.player, statuses: { ...state.player.statuses, entangled: 2 }, energy: 2 } };
  const card = findCard(state, 'katana_slash');
  assert.equal(isCardPlayable(state, card.instanceId), false); // needs 1(base)+2(entangled) = 3, only have 2
  state = { ...state, player: { ...state.player, energy: 3 } };
  assert.equal(isCardPlayable(state, card.instanceId), true);
  const after = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(after.player.energy, 0);
});

test('감염(infected_curse) left in hand at turn end deals blockable damage per copy and moves to discard', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'], playerHp: 70 });
  const curseCard = { instanceId: 'test-infected', defId: 'infected_curse' };
  state = { ...state, piles: { ...state.piles, hand: [...state.piles.hand, curseCard] } };
  state = endPlayerTurn(state);
  assert.equal(state.player.hp, 70 - 3);
  assert.ok(state.piles.discardPile.some((c) => c.instanceId === 'test-infected'));
  assert.ok(!state.piles.hand.some((c) => c.instanceId === 'test-infected'));
});

test('감염 damage is absorbed by block like any other damage', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'], playerHp: 70 });
  const curseCard = { instanceId: 'test-infected-2', defId: 'infected_curse' };
  state = { ...state, player: { ...state.player, block: 10 }, piles: { ...state.piles, hand: [...state.piles.hand, curseCard] } };
  state = endPlayerTurn(state);
  assert.equal(state.player.hp, 70); // fully absorbed
  assert.equal(state.player.block, 7);
});

test('어지러움(dizziness_curse, volatile) left in hand at turn end vanishes into the exhaust pile, not discard', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['nibbit'] });
  const curseCard = { instanceId: 'test-dizzy', defId: 'dizziness_curse' };
  state = { ...state, piles: { ...state.piles, hand: [...state.piles.hand, curseCard] } };
  state = endPlayerTurn(state);
  assert.ok(state.piles.exhaustPile.some((c) => c.instanceId === 'test-dizzy'));
  assert.ok(!state.piles.discardPile.some((c) => c.instanceId === 'test-dizzy'));
  assert.ok(!state.piles.hand.some((c) => c.instanceId === 'test-dizzy'));
});

test('조이기(constrict) deals 1 blockable damage at turn end, and clears once its caster dies', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['slithering_strangler'], playerHp: 70 });
  state = {
    ...state,
    player: { ...state.player, statuses: { ...state.player.statuses, constrict: 1 } },
    enemies: state.enemies.map((e) => ({ ...e, hp: 1, isConstrictSource: true })),
  };
  const card = findCard(state, 'katana_slash');
  state = playCard(state, card.instanceId, state.enemies[0].id);
  assert.equal(state.enemies[0].hp, 0);
  assert.equal(state.player.statuses.constrict, undefined); // cleared on the source's death
  state = endPlayerTurn(state);
  assert.equal(state.player.hp, 70); // no more 1-dmg tick since constrict was cleared
});

test('move.summon skips re-summoning while a living 톱니눈 already exists', () => {
  let state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['fogmog'], playerHp: 999 });
  state = advanceTurn(state); // fogmog's turn 1 (spore_summon) fires, spawns one 톱니눈
  const countAfterFirst = state.enemies.filter((e) => e.defId === 'sawtooth_eye').length;
  assert.equal(countAfterFirst, 1);
  // Loop until fogmog's intent is spore_summon again (its sequence wraps every 2 turns).
  let guard = 0;
  while (state.enemies[0].intent.id !== 'spore_summon' && guard < 6) {
    state = advanceTurn(state);
    guard += 1;
  }
  state = advanceTurn(state); // executes spore_summon again — 톱니눈 is still alive, should NOT stack
  const countAfterSecond = state.enemies.filter((e) => e.defId === 'sawtooth_eye').length;
  assert.equal(countAfterSecond, 1);
});

test('move.summon adds a fresh enemy instance mid-combat (포그모그 -> 톱니눈)', () => {
  const state = makeCombat({ deck: Array(10).fill('katana_slash'), monsterIds: ['fogmog'], playerHp: 70 });
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].intent.id, 'spore_summon');
  const after = advanceTurn(state);
  assert.equal(after.enemies.length, 2);
  assert.ok(after.enemies.some((e) => e.defId === 'sawtooth_eye' && e.hp === 6));
});
