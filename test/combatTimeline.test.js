import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombatState, beginPlayerFirst, advanceTurn, advanceTurnWithSteps } from '../src/engine/combatEngine.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { buildCombatTimeline } from '../src/state/combatTimeline.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';

function combat(monsterIds = ['nibbit', 'nibbit']) {
  return beginPlayerFirst(createCombatState({
    deckEntries: Array.from({ length: 10 }, (_, i) => ({ defId: 'katana_slash', instanceId: `card-${i}` })),
    monsterIds, playerHp: 70, playerMaxHp: 70, ammo: 8, overload: 0, overloadFloor: 0,
    overloadGainMultiplier: 1, extraDrawPerTurn: 0, turnStartAoeDamage: 0,
    inventoryItemIdsInOrder: [], inventoryCapacity: 30, rngState: { seed: 1 },
  }));
}

test('advanceTurnWithSteps preserves advanceTurn result and exposes one enemy beat per actor', () => {
  const state = combat();
  const replay = advanceTurnWithSteps(state);
  assert.deepEqual(replay.state, advanceTurn(state));
  assert.equal(replay.steps[0].label, '턴 종료');
  assert.equal(replay.steps.at(-1).label, '새 턴');
  assert.equal(replay.steps.filter((step) => step.actor === 'enemy').length, 2);
});

test('advanceTurnWithSteps matches the synchronous resolver for every monster roster entry', () => {
  for (const monsterId of Object.keys(MONSTER_DEFINITIONS)) {
    const replayed = advanceTurnWithSteps(combat([monsterId])).state;
    const synchronous = advanceTurn(combat([monsterId]));
    // Card instance ids are process-global test fixtures, not game-state semantics.
    const normalize = (value) => JSON.stringify(value).replace(/card-\d+/g, 'card');
    assert.equal(normalize(replayed), normalize(synchronous), monsterId);
  }
});

test('combat timeline keeps intermediate combat snapshots and ends at the reducer snapshot', () => {
  const snapshot = { currentScreen: 'combat', activeCombatState: combat(), playerState: { loadout: { consumableSlots: [] } } };
  const command = { type: 'END_TURN' };
  const timeline = buildCombatTimeline(snapshot, command);
  assert.ok(timeline.length >= 4);
  assert.equal(timeline[0].animation.label, '턴 종료');
  assert.deepEqual(timeline.at(-1).after, gameReducer(snapshot, command));
});
