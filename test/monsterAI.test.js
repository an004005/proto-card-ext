import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialAiState, currentMove, advanceAiState } from '../src/engine/monsterAI.js';

test('니빗 쌍: staggered starting index makes them act out of phase', () => {
  const a = createInitialAiState('nibbit', 0);
  const b = createInitialAiState('nibbit', 1);
  assert.equal(currentMove('nibbit', a).id, 'bite');
  assert.equal(currentMove('nibbit', b).id, 'curl');
});

test('자폭충 parks on explode instead of looping back to puff', () => {
  let ai = createInitialAiState('shrinker_beetle', 0);
  assert.equal(currentMove('shrinker_beetle', ai).id, 'puff');
  ai = advanceAiState('shrinker_beetle', ai);
  assert.equal(currentMove('shrinker_beetle', ai).id, 'inflate');
  ai = advanceAiState('shrinker_beetle', ai);
  assert.equal(currentMove('shrinker_beetle', ai).id, 'explode');
  ai = advanceAiState('shrinker_beetle', ai); // should NOT loop back to puff
  assert.equal(currentMove('shrinker_beetle', ai).id, 'explode');
});

test('일반 몬스터(니빗)는 시퀀스가 끝나면 처음으로 순환한다', () => {
  let ai = createInitialAiState('nibbit', 0);
  ai = advanceAiState('nibbit', ai); // curl
  ai = advanceAiState('nibbit', ai); // wraps to bite
  assert.equal(currentMove('nibbit', ai).id, 'bite');
});

test('의식의 짐승: phase 1과 phase 2 시퀀스가 다르다', () => {
  const ai = createInitialAiState('ceremonial_beast', 0);
  assert.equal(currentMove('ceremonial_beast', ai, 1).id, 'smash');
  assert.equal(currentMove('ceremonial_beast', ai, 2).id, 'smash2');
});
