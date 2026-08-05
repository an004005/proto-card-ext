import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState, nextFloat, nextInt, shuffle, weightedPick } from '../src/engine/rng.js';

test('nextFloat is deterministic for the same state', () => {
  const state = createRngState(42);
  const a = nextFloat(state);
  const b = nextFloat(state);
  assert.equal(a.value, b.value);
  assert.equal(a.state, b.state);
});

test('nextFloat produces values in [0, 1)', () => {
  let state = createRngState(1);
  for (let i = 0; i < 100; i++) {
    const roll = nextFloat(state);
    assert.ok(roll.value >= 0 && roll.value < 1);
    state = roll.state;
  }
});

test('nextInt stays within bounds', () => {
  let state = createRngState(7);
  for (let i = 0; i < 200; i++) {
    const roll = nextInt(state, 5);
    assert.ok(roll.value >= 0 && roll.value < 5);
    state = roll.state;
  }
});

test('shuffle is a permutation and reproducible from the same seed', () => {
  const arr = [1, 2, 3, 4, 5];
  const a = shuffle(createRngState(99), arr);
  const b = shuffle(createRngState(99), arr);
  assert.deepEqual(a.value, b.value);
  assert.deepEqual([...a.value].sort(), arr);
});

test('weightedPick respects zero-weight exclusion', () => {
  const items = [{ value: 'never', weight: 0 }, { value: 'always', weight: 1 }];
  let state = createRngState(3);
  for (let i = 0; i < 20; i++) {
    const roll = weightedPick(state, items);
    assert.equal(roll.value, 'always');
    state = roll.state;
  }
});
