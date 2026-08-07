import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRngState } from '../src/engine/rng.js';
import { rollRewardSlots } from '../src/engine/rewardEngine.js';
import { REWARD_OPTIONS_PER_SLOT } from '../src/data/rewardTables.js';

const ALL_EQUIPMENT_IDS = ['katana', 'rifle', 'dagger', 'pistol', 'top1', 'bottom1', 'module1', 'implant1'];

test('rollRewardSlots is deterministic for the same seed', () => {
  const a = rollRewardSlots('normal', [], ALL_EQUIPMENT_IDS, createRngState(5));
  const b = rollRewardSlots('normal', [], ALL_EQUIPMENT_IDS, createRngState(5));
  assert.deepEqual(a.slots, b.slots);
});

test('the equipment slot is always first and excludes already-owned gear', () => {
  const { slots } = rollRewardSlots('normal', ['katana', 'rifle'], ALL_EQUIPMENT_IDS, createRngState(1));
  assert.equal(slots[0].category, 'equipment');
  for (const opt of slots[0].options) {
    assert.ok(!['katana', 'rifle'].includes(opt.equipmentId));
  }
  assert.ok(slots[0].options.length <= REWARD_OPTIONS_PER_SLOT);
});

test('boss tier always grants the 2 gated bonus slots (100% gate chance)', () => {
  for (let seed = 0; seed < 15; seed++) {
    const { slots } = rollRewardSlots('boss', [], ALL_EQUIPMENT_IDS, createRngState(seed));
    assert.equal(slots.length, 3); // equipment + 2 guaranteed bonus slots
  }
});

test('normal tier sometimes skips a bonus slot (60% gate chance is not 100%)', () => {
  let sawFewerThanThree = false;
  for (let seed = 0; seed < 40; seed++) {
    const { slots } = rollRewardSlots('normal', [], ALL_EQUIPMENT_IDS, createRngState(seed));
    if (slots.length < 3) sawFewerThanThree = true;
  }
  assert.ok(sawFewerThanThree);
});

test('currency/junk slot options can include an ammo roll in the 3-7 range', () => {
  let sawAmmo = false;
  let rng = createRngState(2);
  for (let i = 0; i < 40 && !sawAmmo; i++) {
    const rolled = rollRewardSlots('boss', [], ALL_EQUIPMENT_IDS, rng);
    rng = rolled.rngState;
    for (const slot of rolled.slots) {
      if (slot.category !== 'currency' && slot.category !== 'junk') continue;
      for (const opt of slot.options) {
        if (opt.kind === 'ammo') {
          sawAmmo = true;
          assert.ok(opt.amount >= 3 && opt.amount <= 7);
        }
      }
    }
  }
  assert.ok(sawAmmo, 'expected to see at least one ammo option across many rolls');
});

test('every non-equipment slot offers exactly REWARD_OPTIONS_PER_SLOT options', () => {
  const { slots } = rollRewardSlots('boss', [], ALL_EQUIPMENT_IDS, createRngState(9));
  for (const slot of slots) {
    if (slot.category === 'equipment') continue;
    assert.equal(slot.options.length, REWARD_OPTIONS_PER_SLOT);
  }
});
