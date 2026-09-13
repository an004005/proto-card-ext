// ADR-0079: 조우의 상황 보정과 위협 경계 감쇠.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, explainEffectiveStealth, effectiveStealthWithConcealment,
  computeEncounterTier, computeThreatPerception, describeThreatDecay,
} from '../src/engine/runEngine.js';
import {
  STEALTH_CONTEXT_CAMERA, STEALTH_CONTEXT_POWER_CUT, STEALTH_CONTEXT_LOCKDOWN,
  PURSUIT_DECAY_TICKS, INVESTIGATE_DECAY_TICKS, POWER_CUT_DURATION,
} from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/** 카메라가 살아 있는 노드 하나와, 카메라가 없는 노드 하나. */
function cameraNode(run) {
  const camera = run.graph.cameras[0];
  assert.ok(camera, '픽스처 시드에는 카메라가 있어야 한다');
  return camera;
}

function plainNodeId(run) {
  const cameraNodeIds = new Set(run.graph.cameras.map((c) => c.nodeId));
  const node = run.graph.nodes.find((n) => n.type !== 'hall' && !cameraNodeIds.has(n.id));
  assert.ok(node, '카메라도 대공간도 아닌 노드가 있어야 한다');
  return node.id;
}

test('상황 보정의 분해 합계가 조우 판정에 실제로 쓰이는 실효 Stealth와 같다', () => {
  const run = makeRun(1);
  const camera = cameraNode(run);
  const sectorId = camera.nodeId.split('_')[0];
  const state = {
    ...run,
    playerNodeId: camera.nodeId,
    activeConcealment: { nodeId: camera.nodeId, bonus: 2 },
    powerCuts: [{ sectorId, expiresAt: run.time + POWER_CUT_DURATION }],
    lockdown: { startedAt: run.time },
  };
  const explained = explainEffectiveStealth(1, state);
  const sum = explained.parts.reduce((acc, part) => acc + part.delta, explained.base);
  assert.equal(explained.total, sum, '분해의 합이 곧 합계다');
  assert.equal(effectiveStealthWithConcealment(1, state), explained.total, '판정이 쓰는 값과 같다');

  const labels = explained.parts.map((p) => p.label);
  assert.deepEqual(labels, ['은엄폐', '카메라', '전원 차단', '봉쇄']);
  assert.equal(explained.total, 1 + 2 + STEALTH_CONTEXT_CAMERA + STEALTH_CONTEXT_POWER_CUT + STEALTH_CONTEXT_LOCKDOWN);
});

test('카메라가 없는 노드에는 카메라 보정이 붙지 않는다', () => {
  const run = makeRun(1);
  const state = { ...run, playerNodeId: plainNodeId(run) };
  const explained = explainEffectiveStealth(1, state);
  assert.equal(explained.total, 1);
  assert.deepEqual(explained.parts, []);
});

test('해킹된 카메라는 상황 보정을 만들지 않는다 — 무력화한 렌즈는 나를 보지 못한다', () => {
  const run = makeRun(1);
  const camera = cameraNode(run);
  const live = { ...run, playerNodeId: camera.nodeId };
  assert.equal(explainEffectiveStealth(1, live).total, 1 + STEALTH_CONTEXT_CAMERA);

  const destroyed = { ...live, disabledCameraIds: [camera.id] };
  assert.equal(explainEffectiveStealth(1, destroyed).total, 1);

  const hacked = { ...live, hackedCameras: [{ cameraId: camera.id, expiresAt: run.time + 10 }] };
  assert.equal(explainEffectiveStealth(1, hacked).total, 1);
});

test('카메라 노드에서는 Stealth 1이 순찰 위협에 우위가 아니라 동률이 된다', () => {
  const run = makeRun(1);
  const camera = cameraNode(run);
  const threat = Object.values(run.threats)[0];
  // 지각 0짜리 순찰 마커(엘리트 구성, 경계 0). 카메라 −1이 우위를 동률로 한 단계 끌어내린다.
  const patrolling = { ...threat, mode: 'patrol', alert: 0, monsterIds: ['bygone_effigy'] };
  const perception = computeThreatPerception(patrolling);
  assert.equal(perception, 0);

  const onCamera = explainEffectiveStealth(1, { ...run, playerNodeId: camera.nodeId }).total;
  const onPlain = explainEffectiveStealth(1, { ...run, playerNodeId: plainNodeId(run) }).total;
  assert.equal(computeEncounterTier(onCamera, perception), 'even');
  assert.equal(computeEncounterTier(onPlain, perception), 'advantage');
});

// ---- 위협 경계 감쇠 ----

/** 플레이어에게서 멀리 떨어진(관측 불가) 자리에서 추적을 시작한 마커를 만든다. */
function pursuingRun(seed = 3) {
  const run = makeRun(seed);
  const playerNodeId = run.playerNodeId;
  const adjacent = new Set([playerNodeId]);
  for (const edge of run.graph.edges) {
    if (edge.from === playerNodeId) adjacent.add(edge.to);
    if (edge.to === playerNodeId) adjacent.add(edge.from);
  }
  const threat = Object.values(run.threats)[0];
  // 순찰 경로 전체가 플레이어에게서 떨어져 있어야 감쇠 도중에 다시 관측되지 않는다.
  const far = run.graph.nodes.find((n) => !adjacent.has(n.id) && n.sectorId === threat.sectorId);
  assert.ok(far, '떨어진 노드가 있어야 한다');
  return {
    ...run,
    threats: {
      ...run.threats,
      [threat.id]: {
        ...threat,
        nodeId: far.id,
        patrolRoute: [far.id],
        patrolIndex: 0,
        mode: 'pursuit',
        alert: 3,
        pursuitStrength: 3,
        lastKnownPlayerNodeId: far.id,
        lastObservedPlayerAt: run.time,
        target: null,
      },
    },
    threatId: threat.id,
  };
}

test('추적하던 위협은 플레이어를 관측하지 못한 채 6칸이 지나면 조사로 내려온다', () => {
  const run = pursuingRun();
  const id = run.threatId;
  assert.equal(run.threats[id].mode, 'pursuit');

  const before = advanceTime(run, run.time + PURSUIT_DECAY_TICKS - 1);
  assert.equal(before.threats[id].mode, 'pursuit', '6칸 전에는 아직 추적이다');

  const after = advanceTime(run, run.time + PURSUIT_DECAY_TICKS);
  assert.equal(after.threats[id].mode, 'investigate');
  assert.ok(after.threats[id].alert < 3, '경계 수치도 모드를 따라 내려간다');
  assert.equal(after.threats[id].lastKnownPlayerNodeId, null, '마지막 확인 위치도 버린다');
});

test('조사로 내려온 위협은 추적 시작 기준 14칸이면 순찰로 돌아간다', () => {
  const run = pursuingRun();
  const id = run.threatId;
  const total = PURSUIT_DECAY_TICKS + INVESTIGATE_DECAY_TICKS;

  const mid = advanceTime(run, run.time + total - 1);
  assert.equal(mid.threats[id].mode, 'investigate');

  const done = advanceTime(run, run.time + total);
  assert.equal(done.threats[id].mode, 'patrol');
  assert.equal(done.threats[id].lastObservedPlayerAt, null, '타이머도 함께 비워진다');
});

test('같은 노드에서 관측하면 감쇠 타이머가 리셋된다 — 추적이 풀리지 않는다', () => {
  const run = pursuingRun();
  const id = run.threatId;
  // 위협을 플레이어 노드에 세운다: 매 칸 관측이 성립해 타이머가 계속 밀린다.
  const onPlayer = {
    ...run,
    threats: { ...run.threats, [id]: { ...run.threats[id], nodeId: run.playerNodeId, patrolRoute: [run.playerNodeId] } },
  };
  const later = advanceTime(onPlayer, onPlayer.time + PURSUIT_DECAY_TICKS * 3);
  assert.equal(later.threats[id].mode, 'pursuit');
  assert.equal(later.threats[id].lastObservedPlayerAt, later.time);
});

test('describeThreatDecay가 남은 칸과 다음 모드를 예고하고, 관측 중에는 예고하지 않는다', () => {
  const run = pursuingRun();
  const id = run.threatId;
  assert.deepEqual(describeThreatDecay(run, run.threats[id]), { nextMode: 'investigate', ticksLeft: PURSUIT_DECAY_TICKS });

  const after = advanceTime(run, run.time + PURSUIT_DECAY_TICKS);
  assert.equal(describeThreatDecay(after, after.threats[id]).nextMode, 'patrol');

  const patrolling = { ...run.threats[id], mode: 'patrol' };
  assert.equal(describeThreatDecay(run, patrolling), null, '순찰 마커는 감쇠 대상이 아니다');
});

test('소음을 조사하러 가는 마커는 감쇠 대상이 아니다 — 플레이어를 본 적이 없다', () => {
  const run = makeRun(1);
  const threat = Object.values(run.threats)[0];
  const investigating = { ...threat, mode: 'investigate', alert: 1, lastObservedPlayerAt: null };
  assert.equal(describeThreatDecay(run, investigating), null);
});
