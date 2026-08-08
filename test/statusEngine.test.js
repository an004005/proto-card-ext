import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatus, decayStatusesAtTurnEnd, applyArmorAtTurnStart, computeDamage, computeBlock, applyDamage,
} from '../src/engine/statusEngine.js';

test('computeDamage: stage-scale -> +flatBonus -> weak(x0.75) -> vulnerable(x1.5), each floored', () => {
  // base 6, stage1 scale ->8, +2 flat ->10, weak -> floor(7.5)=7, vulnerable -> floor(10.5)=10
  const dmg = computeDamage(6, { stage: 1, scalesWithStage: true, flatBonus: 2, weak: true, vulnerable: true });
  assert.equal(dmg, 10);
});

test('computeDamage with no modifiers just applies the stage scale', () => {
  assert.equal(computeDamage(8, { stage: 0, scalesWithStage: true }), 8);
});

test('computeBlock adds flat module bonus after stage scaling', () => {
  assert.equal(computeBlock(6, { stage: 1, scalesWithStage: true, flatBonus: 2 }), 10); // 6->8 +2
});

test('손상(fragile) reduces block gained by 0.75x, same as weak does for damage', () => {
  assert.equal(computeBlock(8, { stage: 0, scalesWithStage: false, fragile: true }), 6); // floor(8*0.75)
  assert.equal(computeBlock(8, { stage: 0, scalesWithStage: false, fragile: false }), 8);
});

test('applyDamage absorbs with block first; ignoresBlock bypasses it entirely (§9 투시 1단계)', () => {
  const target = { hp: 20, block: 5 };
  assert.deepEqual(applyDamage(target, 3, false), { hp: 20, block: 2 });
  assert.deepEqual(applyDamage(target, 8, false), { hp: 17, block: 0 });
  assert.deepEqual(applyDamage(target, 8, true), { hp: 12, block: 5 }); // block untouched, full hp loss
});

test('weak/vulnerable decay by 1 at turn end; armor does not decay this way', () => {
  let statuses = { weak: 1, vulnerable: 2, armor: 4 };
  statuses = decayStatusesAtTurnEnd(statuses);
  assert.equal(statuses.weak, undefined);
  assert.equal(statuses.vulnerable, 1);
  assert.equal(statuses.armor, 4);
});

test('applyArmorAtTurnStart converts the full stack to block, then decrements by 1 (§7.1)', () => {
  const combatant = { block: 2, statuses: { armor: 4 } };
  const result = applyArmorAtTurnStart(combatant);
  assert.equal(result.block, 6); // 2 + 4
  assert.equal(result.statuses.armor, 3);
});

test('applyArmorAtTurnStart removes the armor key once it decays to 0', () => {
  const combatant = { block: 0, statuses: { armor: 1 } };
  const result = applyArmorAtTurnStart(combatant);
  assert.equal(result.block, 1);
  assert.equal(result.statuses.armor, undefined);
});

test('applyStatus can reduce a permanent stack (e.g. atkBonus) back to zero without going negative-key artifacts', () => {
  let statuses = applyStatus({}, 'atkBonus', 2);
  assert.equal(statuses.atkBonus, 2);
  statuses = applyStatus(statuses, 'atkBonus', -2);
  assert.equal(statuses.atkBonus, undefined);
});

test('인공물(artifact) consumes a stack to negate a debuff instead of applying it', () => {
  let statuses = { artifact: 1 };
  statuses = applyStatus(statuses, 'weak', 2);
  assert.equal(statuses.weak, undefined); // blocked entirely, not even partially applied
  assert.equal(statuses.artifact, undefined); // consumed down to 0 -> deleted

  // once artifact is gone, debuffs apply normally
  statuses = applyStatus(statuses, 'vulnerable', 1);
  assert.equal(statuses.vulnerable, 1);
});

test('인공물(artifact) only blocks debuffs, not buffs like atkBonus/armor', () => {
  let statuses = { artifact: 1 };
  statuses = applyStatus(statuses, 'atkBonus', 3);
  assert.equal(statuses.atkBonus, 3);
  assert.equal(statuses.artifact, 1); // untouched — atkBonus isn't a debuff

  statuses = applyStatus(statuses, 'armor', 2);
  assert.equal(statuses.armor, 2);
  assert.equal(statuses.artifact, 1);
});

test('인공물(artifact) blocks one debuff per stack, then lets the rest through', () => {
  let statuses = { artifact: 2 };
  statuses = applyStatus(statuses, 'weak', 1);
  assert.equal(statuses.weak, undefined);
  assert.equal(statuses.artifact, 1);
  statuses = applyStatus(statuses, 'fragile', 1);
  assert.equal(statuses.fragile, undefined);
  assert.equal(statuses.artifact, undefined);
  statuses = applyStatus(statuses, 'entangled', 1);
  assert.equal(statuses.entangled, 1); // no artifact left, applies normally
});
