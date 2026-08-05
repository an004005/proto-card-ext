import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import {
  createStageState, getCurrentStep, advanceStage, isStageComplete, resolveUnknownRoomOutcome,
  pickUnknownRoomMonster,
} from '../src/engine/stageEngine.js';
import { STAGE_STEPS } from '../src/data/stageLayout.js';

test('stage has exactly 13 combats and a boss as the final step (§13/§14)', () => {
  const combats = STAGE_STEPS.filter((s) => s.type === 'combat');
  assert.equal(combats.length, 13);
  assert.equal(STAGE_STEPS[STAGE_STEPS.length - 1].tier, 'boss');
});

test('unknown rooms sit at floors 3, 6, 8 (§13.1)', () => {
  const rooms = STAGE_STEPS.filter((s) => s.type === 'unknown_room').map((s) => s.floor);
  assert.deepEqual(rooms, [3, 6, 8]);
});

test('advanceStage walks through every step and eventually completes', () => {
  let stage = createStageState();
  let guard = 0;
  while (!isStageComplete(stage) && guard < 100) {
    assert.ok(getCurrentStep(stage));
    stage = advanceStage(stage);
    guard += 1;
  }
  assert.equal(isStageComplete(stage), true);
  assert.equal(stage.stepIndex, STAGE_STEPS.length);
  assert.equal(getCurrentStep(stage), null);
});

test('resolveUnknownRoomOutcome only ever returns the three documented outcomes', () => {
  let rng = createRngState(1);
  for (let i = 0; i < 50; i++) {
    const roll = resolveUnknownRoomOutcome(rng);
    assert.ok(['combat', 'rest', 'empty'].includes(roll.value));
    rng = roll.state;
  }
});

test('pickUnknownRoomMonster only picks from that floor\'s normal-tier monster pool', () => {
  const roll = pickUnknownRoomMonster(3, createRngState(1));
  assert.equal(roll.monsterId, 'raider'); // floor 3's only normal combat is Raider
});
