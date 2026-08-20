import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import {
  computeRoundNoiseEnvelope, applyCombatRoundToRunState,
  beginDisengage, cancelDisengage, addDisengageProgress, canDisengage, resolveDisengage,
  DISENGAGE_REQUIRED_PROGRESS,
  scheduleReinforcement, advanceReinforcements,
  REINFORCEMENT_FIRST_DELAY, REINFORCEMENT_SUBSEQUENT_DELAY, REINFORCEMENT_MAX_PER_GROUP,
} from '../src/engine/combatMapIntegration.js';

test('computeRoundNoiseEnvelope is the max of the round, not the sum', () => {
  assert.equal(computeRoundNoiseEnvelope([1, 2, 0, 1]), 2);
  assert.equal(computeRoundNoiseEnvelope([]), 0);
  assert.equal(computeRoundNoiseEnvelope([3]), 3);
});

test('applyCombatRoundToRunState creates exactly one noise event at the combat node and advances 60', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const before = runState.time;
  const next = applyCombatRoundToRunState(runState, runState.playerNodeId, [1, 3, 2]);
  assert.equal(next.noiseEvents.length, 1);
  assert.equal(next.noiseEvents[0].intensity, 3);
  assert.equal(next.noiseEvents[0].sourceNodeId, runState.playerNodeId);
  assert.equal(next.time, before + 60);
});

test('a silent round (all noise 0) advances time but creates no noise event', () => {
  const { graph } = generateFacilityGraph(2);
  const runState = createRunState(graph, 2);
  const next = applyCombatRoundToRunState(runState, runState.playerNodeId, [0, 0]);
  assert.equal(next.noiseEvents.length, 0);
  assert.equal(next.time, runState.time + 60);
});

test('beginDisengage grants a one-time Mobility>=2 bonus, not on repeated calls', () => {
  let d = { escapeIntent: false, disengageProgress: 0 };
  d = beginDisengage(d, 2);
  assert.equal(d.escapeIntent, true);
  assert.equal(d.disengageProgress, 1);
  const again = beginDisengage(d, 2);
  assert.equal(again, d, 'begin while already intending should be a no-op');

  let noBonus = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 1);
  assert.equal(noBonus.disengageProgress, 0);
});

test('addDisengageProgress only accumulates while escapeIntent is on', () => {
  let d = { escapeIntent: false, disengageProgress: 0 };
  d = addDisengageProgress(d, 1);
  assert.equal(d.disengageProgress, 0, 'progress must not accumulate without intent');

  d = beginDisengage(d, 0);
  d = addDisengageProgress(d, 1);
  assert.equal(d.disengageProgress, 1);
  assert.equal(canDisengage(d), false);
  d = addDisengageProgress(d, 1);
  assert.equal(d.disengageProgress, DISENGAGE_REQUIRED_PROGRESS);
  assert.equal(canDisengage(d), true);
});

test('cancelDisengage and resolveDisengage both reset intent and progress to 0', () => {
  let d = beginDisengage({ escapeIntent: false, disengageProgress: 0 }, 3);
  d = addDisengageProgress(d, 5);
  const cancelled = cancelDisengage(d);
  assert.deepEqual(cancelled, { escapeIntent: false, disengageProgress: 0 });
  const resolved = resolveDisengage();
  assert.deepEqual(resolved, { escapeIntent: false, disengageProgress: 0 });
});

test('reinforcements arrive at 120 then 120+60, capped at REINFORCEMENT_MAX_PER_GROUP', () => {
  let queue = [scheduleReinforcement('threat1', REINFORCEMENT_FIRST_DELAY)];

  let result = advanceReinforcements(queue, REINFORCEMENT_FIRST_DELAY - 1);
  assert.equal(result.arrivals.length, 0, 'must not arrive before eligibleAt');

  result = advanceReinforcements(queue, REINFORCEMENT_FIRST_DELAY);
  assert.deepEqual(result.arrivals, [{ threatId: 'threat1', count: 1 }]);
  queue = result.queue;
  assert.equal(queue[0].addedCount, 1);

  result = advanceReinforcements(queue, REINFORCEMENT_FIRST_DELAY + REINFORCEMENT_SUBSEQUENT_DELAY - 1);
  assert.equal(result.arrivals.length, 0, 'second member must wait the full subsequent delay');
  queue = result.queue;

  result = advanceReinforcements(queue, REINFORCEMENT_FIRST_DELAY + REINFORCEMENT_SUBSEQUENT_DELAY);
  assert.deepEqual(result.arrivals, [{ threatId: 'threat1', count: 1 }]);
  queue = result.queue;
  assert.equal(queue[0].addedCount, REINFORCEMENT_MAX_PER_GROUP);

  result = advanceReinforcements(queue, REINFORCEMENT_FIRST_DELAY + REINFORCEMENT_SUBSEQUENT_DELAY * 10);
  assert.equal(result.arrivals.length, 0, 'no third member ever joins from one group');
});
