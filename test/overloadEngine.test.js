import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStage, isLethalOverload, gainOverload, reduceOverload, applyStageScale } from '../src/engine/overloadEngine.js';

test('getStage buckets match §4.1 exactly', () => {
  assert.equal(getStage(0), 0);
  assert.equal(getStage(24), 0);
  assert.equal(getStage(25), 1);
  assert.equal(getStage(49), 1);
  assert.equal(getStage(50), 2);
  assert.equal(getStage(74), 2);
  assert.equal(getStage(75), 3);
  assert.equal(getStage(99), 3);
  assert.equal(getStage(100), 4);
  assert.equal(getStage(130), 4);
});

test('isLethalOverload is true at and only at >= 100', () => {
  assert.equal(isLethalOverload(99), false);
  assert.equal(isLethalOverload(100), true);
  assert.equal(isLethalOverload(150), true);
});

test('gainOverload adds and respects implant⑤ multiplier', () => {
  assert.equal(gainOverload(10, 5), 15);
  assert.equal(gainOverload(10, 10, 0.5), 15);
});

test('reduceOverload never drops below the equipped floor', () => {
  assert.equal(reduceOverload(50, 20, 25), 30);
  assert.equal(reduceOverload(30, 20, 25), 25); // would go to 10, clamped to floor
});

test('applyStageScale: +25% rounded at stage 1-2, raw value at stage 0 and 3 (§4.2)', () => {
  assert.equal(applyStageScale(6, 0, true), 6);
  assert.equal(applyStageScale(6, 1, true), 8); // 7.5 -> round -> 8
  assert.equal(applyStageScale(6, 2, true), 8);
  assert.equal(applyStageScale(6, 3, true), 6);
  assert.equal(applyStageScale(9, 1, true), 11); // 11.25 -> round -> 11
  assert.equal(applyStageScale(10, 1, true), 13); // 12.5 -> round-half-up -> 13
});

test('applyStageScale leaves non-scaling values untouched regardless of stage', () => {
  assert.equal(applyStageScale(0, 1, false), 0);
  assert.equal(applyStageScale(5, 2, false), 5);
});
