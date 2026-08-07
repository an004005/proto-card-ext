import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialAiState, currentMove, advanceAiState } from '../src/engine/monsterAI.js';
import { createRngState } from '../src/engine/rng.js';

test('니빗 쌍: staggered starting index makes them act out of phase', () => {
  const a = createInitialAiState('nibbit', 0, createRngState(1));
  const b = createInitialAiState('nibbit', 1, createRngState(1));
  assert.equal(currentMove('nibbit', a.aiState).id, 'headbutt');
  assert.equal(currentMove('nibbit', b.aiState).id, 'slice');
});

test('니빗은 시퀀스가 끝나면 처음으로 순환한다', () => {
  let created = createInitialAiState('nibbit', 0, createRngState(1));
  let aiState = created.aiState;
  let rng = created.rngState;
  ({ aiState, rngState: rng } = advanceAiState('nibbit', aiState, 1, rng)); // slice
  ({ aiState, rngState: rng } = advanceAiState('nibbit', aiState, 1, rng)); // hiss
  ({ aiState, rngState: rng } = advanceAiState('nibbit', aiState, 1, rng)); // wraps to headbutt
  assert.equal(currentMove('nibbit', aiState).id, 'headbutt');
});

test('잉클릿의 확률 분기: 같은 시드로 굴린 의도가 실행 시점에도 그대로 유지된다', () => {
  const created = createInitialAiState('inklet', 0, createRngState(7));
  // jab은 고정(0번 인덱스) — 아직 random 분기(1번 인덱스)에 도달하지 않았으므로 resolvedMove 없음.
  assert.equal(currentMove('inklet', created.aiState).id, 'jab');
  const advanced = advanceAiState('inklet', created.aiState, 1, created.rngState);
  const intent = currentMove('inklet', advanced.aiState);
  assert.ok(['snipe', 'whirl'].includes(intent.id));
  // 같은 aiState로 다시 조회해도(=실행 시점) 동일한 move가 나와야 한다 — 의도와 실행 일치.
  assert.equal(currentMove('inklet', advanced.aiState).id, intent.id);
});

test('의식의 짐승: phase 1과 phase 2 시퀀스가 다르다', () => {
  const created = createInitialAiState('ceremonial_beast', 0, createRngState(1));
  assert.equal(currentMove('ceremonial_beast', created.aiState, 1).id, 'stomp_charge');
  assert.equal(currentMove('ceremonial_beast', created.aiState, 2).id, 'stun_self');
});
