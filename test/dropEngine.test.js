import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import { rollBasicDrop, rollFarmLoot } from '../src/engine/dropEngine.js';

test('boss basic drop always gives exactly 3 currency items worth 40 each and 1 equipment', () => {
  const { result } = rollBasicDrop('boss', [], ['katana', 'dagger', 'rifle'], createRngState(1));
  assert.equal(result.currencyValues.length, 3);
  assert.ok(result.currencyValues.every((v) => v === 40));
  assert.ok(result.equipmentId);
});

test('equipment drop pool excludes already-owned equipment', () => {
  let rng = createRngState(2);
  let sawOnlyDagger = true;
  for (let i = 0; i < 20; i++) {
    const roll = rollBasicDrop('boss', ['katana'], ['katana', 'dagger'], rng);
    rng = roll.rngState;
    if (roll.result.equipmentId && roll.result.equipmentId !== 'dagger') sawOnlyDagger = false;
  }
  assert.equal(sawOnlyDagger, true);
});

test('normal tier ammo always rolls within [2,4]', () => {
  let rng = createRngState(3);
  for (let i = 0; i < 30; i++) {
    const roll = rollBasicDrop('normal', [], ['katana'], rng);
    rng = roll.rngState;
    assert.ok(roll.result.ammo >= 2 && roll.result.ammo <= 4);
  }
});

test('rollFarmLoot returns 2 or 3 items, each a documented kind', () => {
  const { items } = rollFarmLoot(createRngState(4));
  assert.ok(items.length === 2 || items.length === 3);
  for (const item of items) assert.ok(['junk', 'currency', 'ammo', 'consumable'].includes(item.kind));
});

test('drop rolls are deterministic for the same rngState', () => {
  const a = rollBasicDrop('elite', [], ['katana', 'rifle'], createRngState(9));
  const b = rollBasicDrop('elite', [], ['katana', 'rifle'], createRngState(9));
  assert.deepEqual(a.result, b.result);
});
