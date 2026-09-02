import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import {
  addCombatNoiseGauge, nextNoiseIntensity, applyCombatCardNoise, applyCombatRoundTimeToRunState,
  NOISE_GAUGE_CAPACITY,
  beginDisengage, cancelDisengage, addDisengageProgress, canDisengage, resolveDisengage,
  DISENGAGE_REQUIRED_PROGRESS,
} from '../src/engine/combatMapIntegration.js';

test('addCombatNoiseGauge accumulates and fires only once capacity is reached, then resets to 0', () => {
  let r = addCombatNoiseGauge(0, 3);
  assert.deepEqual(r, { gauge: 3, fired: false });
  r = addCombatNoiseGauge(r.gauge, 3);
  assert.deepEqual(r, { gauge: 6, fired: false });
  r = addCombatNoiseGauge(r.gauge, 3);
  assert.deepEqual(r, { gauge: 9, fired: false });
  r = addCombatNoiseGauge(r.gauge, 3);
  assert.equal(r.fired, true);
  assert.equal(r.gauge, 0);
});

test('addCombatNoiseGauge fires exactly at capacity (10)', () => {
  const r = addCombatNoiseGauge(7, 3);
  assert.deepEqual(r, { gauge: 0, fired: true });
});

test('nextNoiseIntensity climbs 1 -> 2 -> 3 then holds at 3', () => {
  assert.equal(nextNoiseIntensity(0), 1);
  assert.equal(nextNoiseIntensity(1), 2);
  assert.equal(nextNoiseIntensity(2), 3);
  assert.equal(nextNoiseIntensity(3), 3);
});

test('applyCombatCardNoise reports a noise event only when the gauge fires, at the escalating intensity', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const nodeId = runState.playerNodeId;

  let result = applyCombatCardNoise(runState, nodeId, 8, 0, 1);
  assert.equal(result.gauge, 9);
  assert.equal(result.intensity, 0);
  assert.equal(result.runState.noiseEvents.length, 0);

  result = applyCombatCardNoise(result.runState, nodeId, result.gauge, result.intensity, 2);
  assert.equal(result.gauge, 0);
  assert.equal(result.intensity, 1);
  assert.equal(result.runState.noiseEvents.length, 1);
  assert.equal(result.runState.noiseEvents[0].intensity, 1);
  assert.equal(result.runState.noiseEvents[0].sourceNodeId, nodeId);

  // fire again — intensity escalates to 2
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 2);
  assert.equal(result.runState.noiseEvents.length, 2);

  // a third fire caps at 3 and holds there on a fourth
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 3);
  result = applyCombatCardNoise(result.runState, nodeId, NOISE_GAUGE_CAPACITY, result.intensity, 0);
  assert.equal(result.intensity, 3);
});

test('applyCombatRoundTimeToRunState advances time by the round cost with no noise side effect', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const before = runState.time;
  const next = applyCombatRoundTimeToRunState(runState, 60);
  assert.equal(next.time, before + 60);
  assert.equal(next.noiseEvents.length, 0);
});

test('beginDisengage grants a one-time Mobility>=2 bonus, not on repeated calls', () => {
  let d = { escapeIntent: false, disengageProgress: 0 };
  d = beginDisengage(d, 2);
  assert.equal(d.escapeIntent, true);
  assert.equal(d.disengageProgress, 1);
  const again = beginDisengage(d, 2);
  assert.equal(again, d, 'begin while already intending should be a no-op');
});

test('cancelDisengage and resolveDisengage both reset intent and progress to 0', () => {
  let d = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 3);
  d = addDisengageProgress(d, 5);
  const cancelled = cancelDisengage(d);
  assert.deepEqual(cancelled, { escapeIntent: false, disengageProgress: 0 });
  const resolved = resolveDisengage();
  assert.deepEqual(resolved, { escapeIntent: false, disengageProgress: 0 });
});

test('canDisengage requires both escapeIntent and enough progress', () => {
  let d = { escapeIntent: false, disengageProgress: DISENGAGE_REQUIRED_PROGRESS };
  assert.equal(canDisengage(d), false);
  d = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 0);
  d = addDisengageProgress(d, DISENGAGE_REQUIRED_PROGRESS);
  assert.equal(canDisengage(d), true);
});
