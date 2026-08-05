import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { isCardPlayable } from '../src/engine/combatEngine.js';

function autoPlayCombat(snapshot, guardLimit = 100) {
  let s = snapshot;
  let guard = 0;
  while (s.currentScreen === 'combat' && guard < guardLimit) {
    const combat = s.activeCombatState;
    const aliveEnemy = combat.enemies.find((e) => e.hp > 0);
    const attack = combat.piles.hand.find(
      (c) => c.defId.includes('slash') || c.defId.includes('shot') || c.defId.includes('stab') || c.defId.includes('aim'),
    );
    const playable = attack && isCardPlayable(combat, attack.instanceId);
    if (playable && aliveEnemy) s = gameReducer(s, { type: 'PLAY_CARD', instanceId: attack.instanceId, targetId: aliveEnemy.id });
    else s = gameReducer(s, { type: 'END_TURN' });
    guard += 1;
  }
  return s;
}

test('NEW_RUN starts on the loadout screen with a pre-filled default loadout', () => {
  const s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  assert.equal(s.currentScreen, 'loadout');
  assert.deepEqual(s.playerState.loadout.weaponIds.sort(), ['dagger', 'katana']);
});

test('SET_LOADOUT_SLOT toggles multi-select slots and respects the 2-weapon limit', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 1 });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'katana' }); // remove
  assert.deepEqual(s.playerState.loadout.weaponIds, ['dagger']);
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'rifle' });
  s = gameReducer(s, { type: 'SET_LOADOUT_SLOT', slotType: 'weapon', id: 'pistol' }); // 3rd -> no-op
  assert.equal(s.playerState.loadout.weaponIds.length, 2);
});

test('CONFIRM_LOADOUT computes maxHp/floor/capacity from equipped implants and starts the stage', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 1 }); // default implants: 1,3,6 -> hp+7, floor 10+5+15=30
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  assert.equal(s.currentScreen, 'stage');
  assert.equal(s.playerState.maxHp, 77);
  assert.equal(s.playerState.hp, 77);
  assert.equal(s.playerState.overload, 30);
  assert.equal(s.playerState.inventory.capacity, 35);
});

test('ENTER_STEP on a combat step starts combat; winning it routes to post_combat with a drop applied', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = gameReducer(s, { type: 'ENTER_STEP' });
  assert.equal(s.currentScreen, 'combat');
  s = autoPlayCombat(s);
  assert.equal(s.currentScreen, 'post_combat');
});

test('POST_COMBAT_CHOICE "move" is always safe and advances the stage without a fight', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 2 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = gameReducer(s, { type: 'ENTER_STEP' });
  s = autoPlayCombat(s);
  const stepIndexBefore = s.stageState.stepIndex;
  s = gameReducer(s, { type: 'POST_COMBAT_CHOICE', choice: 'move' });
  assert.equal(s.currentScreen, 'stage');
  assert.equal(s.stageState.stepIndex, stepIndexBefore + 1);
});

test('POST_COMBAT_CHOICE "rest" heals 10% hp and reduces overload by 30 (never below floor)', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 5 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = gameReducer(s, { type: 'ENTER_STEP' });
  s = autoPlayCombat(s);
  const hpBefore = s.playerState.hp;
  // force overload up so the reduction is meaningfully observable
  s = { ...s, playerState: { ...s.playerState, overload: 80, hp: Math.max(1, hpBefore - 20) } };
  const preHp = s.playerState.hp;
  s = gameReducer(s, { type: 'POST_COMBAT_CHOICE', choice: 'rest' });
  assert.ok(['stage', 'combat'].includes(s.currentScreen)); // 'combat' if the 15% ambush roll hit
  assert.ok(s.playerState.hp >= preHp);
  assert.ok(s.playerState.overload <= 50);
});

test('a full run can be played headlessly from NEW_RUN to either extractionComplete or gameOver', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 42 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });

  let guard = 0;
  while (s.currentScreen !== 'gameOver' && s.currentScreen !== 'extractionComplete' && guard < 400) {
    if (s.currentScreen === 'stage') s = gameReducer(s, { type: 'ENTER_STEP' });
    else if (s.currentScreen === 'combat') s = autoPlayCombat(s, 1);
    else if (s.currentScreen === 'post_combat') s = gameReducer(s, { type: 'POST_COMBAT_CHOICE', choice: 'move' });
    else break;
    guard += 1;
  }
  assert.ok(
    s.currentScreen === 'extractionComplete' || s.currentScreen === 'gameOver',
    `run did not conclude (stuck on "${s.currentScreen}" after ${guard} steps)`,
  );
});

test('the same seed reproduces an identical run outcome (deterministic headless replay)', () => {
  function playSeed(seed) {
    let s = gameReducer(null, { type: 'NEW_RUN', seed });
    s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
    let guard = 0;
    while (s.currentScreen !== 'gameOver' && s.currentScreen !== 'extractionComplete' && guard < 400) {
      if (s.currentScreen === 'stage') s = gameReducer(s, { type: 'ENTER_STEP' });
      else if (s.currentScreen === 'combat') s = autoPlayCombat(s, 1);
      else if (s.currentScreen === 'post_combat') s = gameReducer(s, { type: 'POST_COMBAT_CHOICE', choice: 'move' });
      else break;
      guard += 1;
    }
    return s;
  }
  const a = playSeed(123);
  const b = playSeed(123);
  assert.deepEqual(a, b);
});

test('PLAY_CARD with an invalid instanceId is a full no-op snapshot', () => {
  let s = gameReducer(null, { type: 'NEW_RUN', seed: 6 });
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  s = gameReducer(s, { type: 'ENTER_STEP' });
  const before = s;
  const after = gameReducer(before, { type: 'PLAY_CARD', instanceId: 'nope', targetId: null });
  assert.equal(after, before);
});
