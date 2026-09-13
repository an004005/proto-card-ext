import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStage, applyStageScale } from '../src/engine/overloadEngine.js';

test('getStage is the toggle itself — ON is 단계 1, OFF is 단계 0 (ADR-0080)', () => {
  assert.equal(getStage(false), 0);
  assert.equal(getStage(true), 1);
});

test('applyStageScale: +25% rounded at stage 1, raw value at stage 0 (§4.2)', () => {
  assert.equal(applyStageScale(6, 0, true), 6);
  assert.equal(applyStageScale(6, 1, true), 8); // 7.5 -> round -> 8
  assert.equal(applyStageScale(9, 1, true), 11); // 11.25 -> round -> 11
  assert.equal(applyStageScale(10, 1, true), 13); // 12.5 -> round-half-up -> 13
});

test('applyStageScale leaves non-scaling values untouched regardless of stage', () => {
  assert.equal(applyStageScale(0, 1, false), 0);
  assert.equal(applyStageScale(5, 1, false), 5);
});
