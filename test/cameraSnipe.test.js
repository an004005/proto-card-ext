// 카메라 저격 — 저격총의 현장 행동. 원거리·비해킹 빌드에게 카메라를 끄는 수단을 준다.
//
// 여기서 보는 것은 이 행동이 다른 어떤 행동과도 다른 두 가지다: 소음이 나는 자리(쏜 자리)와
// 증거가 남는 자리(카메라 자리)가 갈린다는 것, 그리고 사거리가 "신호가 닿는 거리"가 아니라
// "총알이 지나갈 수 있는 길"이라는 것 — 잠긴 통로 너머는 보이지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, useFieldEquipment } from '../src/engine/runEngine.js';
import { RuleViolation } from '../src/engine/errors.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import { bfsHopDistancesOverArcs, isEdgeUnlocked } from '../src/engine/graphUtils.js';
import {
  CAMERA_SNIPE_TIME, CAMERA_SNIPE_NOISE, CAMERA_SNIPE_RANGE, CAMERA_SNIPE_AMMO_COST,
  CAPABILITY_STEP_TIME_DELTA,
} from '../src/data/facilityLayout.js';
import { finishTask } from './helpers/finishTask.js';

const SNIPER = MAP_EQUIPMENT_CAPABILITIES.sniper_rifle.fieldAction;
const INSTANCE = 'wpn-1';

/** 엔진의 시야 판정과 같은 기준 — 잠긴 통로는 끊고 일방통행은 생성 방향만. */
function sightHops(run, fromNodeId) {
  const arcs = [];
  for (const edge of run.graph.edges) {
    if (!isEdgeUnlocked(edge, run.openedEdgeIds)) continue;
    arcs.push({ from: edge.from, to: edge.to });
    if (!edge.features.includes('oneWay')) arcs.push({ from: edge.to, to: edge.from });
  }
  return bfsHopDistancesOverArcs(arcs, fromNodeId);
}

/**
 * 사거리 안에 카메라가 있는 자리에 플레이어를 세운다 — 그런 시드를 찾아 돌려준다.
 * @returns {{run: import('../src/engine/types.js').FacilityRunState, camera: {id: string, nodeId: string}}}
 */
function runWithCameraInSight() {
  for (let seed = 1; seed <= 40; seed++) {
    const { graph } = generateFacilityGraph(seed);
    const base = createRunState(graph, seed);
    for (const camera of graph.cameras) {
      const hops = sightHops(base, camera.nodeId);
      // 카메라 자리 자신은 제외한다 — "원거리"가 아니면 이 행동의 값이 없다.
      const from = [...hops.entries()].find(([nodeId, h]) => h > 0 && h <= CAMERA_SNIPE_RANGE && nodeId !== camera.nodeId);
      if (from) return { run: { ...base, playerNodeId: from[0] }, camera };
    }
  }
  throw new Error('사거리 안에 카메라가 있는 시드를 찾지 못했다');
}

test('사거리 안의 카메라는 작업이 끝나면 영구히 부서지고, 소음은 쏜 자리에 흔적은 카메라 자리에 남는다', () => {
  const { run, camera } = runWithCameraInSight();
  const playerNodeId = run.playerNodeId;
  const after = finishTask(useFieldEquipment(run, INSTANCE, SNIPER, camera.id, { effectivePerception: 2, usableAmmo: 10 }));

  // 작업은 완료까지 진행된다(scheduleTask가 완료 시각까지 1칸씩 돈다).
  assert.equal(after.time, run.time + CAMERA_SNIPE_TIME, '표준 층계에서는 기본 시간 그대로다');
  assert.ok((after.disabledCameraIds || []).includes(camera.id), '카메라가 영구 파괴 목록에 들어간다');

  // 총성은 내 자리에서 난다 — 위협이 조사하러 오는 곳은 카메라가 아니라 쏜 자리다.
  const noise = after.noiseEvents.filter((e) => e.createdAt === after.time);
  assert.equal(noise.length, 1, '총성은 한 번 난다');
  assert.equal(noise[0].sourceNodeId, playerNodeId, '소음은 카메라 노드가 아니라 플레이어 노드에서 난다');
  assert.equal(noise[0].intensity, CAMERA_SNIPE_NOISE);

  // 파편(강한 흔적)은 카메라 자리에 남는다.
  const fresh = after.evidence.filter((e) => !run.evidence.some((old) => old.id === e.id));
  assert.equal(fresh.length, 1, '흔적은 하나만 남는다');
  assert.equal(fresh[0].nodeId, camera.nodeId, '흔적은 카메라 자리에 남는다');
  assert.equal(fresh[0].tier, 2, '파편은 강한 흔적이다');
  assert.ok(!after.evidence.some((e) => e.nodeId === playerNodeId && !run.evidence.some((old) => old.id === e.id)), '쏜 자리에는 흔적이 남지 않는다');

  // 탄약은 커맨드 래퍼가 정산하도록 청구서로 쌓인다.
  assert.equal(after.pendingAmmoSpend, CAMERA_SNIPE_AMMO_COST);
  assert.equal(after.fieldCooldowns[INSTANCE], after.time + SNIPER.cooldown, '쿨다운은 완료 시각부터 센다');
});

test('사거리 밖과 잠긴 통로 너머의 카메라는 쏠 수 없다', () => {
  const { run, camera } = runWithCameraInSight();

  // 사거리 밖 — 시야 홉수가 사거리를 넘는 카메라.
  const hops = sightHops(run, run.playerNodeId);
  const farCamera = run.graph.cameras.find((c) => {
    const h = hops.get(c.nodeId);
    return h === undefined || h > CAMERA_SNIPE_RANGE;
  });
  assert.ok(farCamera, '사거리 밖 카메라가 있는 시드여야 한다');
  assert.throws(
    () => finishTask(useFieldEquipment(run, INSTANCE, SNIPER, farCamera.id, { effectivePerception: 2, usableAmmo: 10 })),
    RuleViolation,
  );

  // 잠긴 통로가 시야를 끊는다 — 카메라로 가는 길을 전부 잠그면 사거리 안이던 카메라도 불가가 된다.
  const sealed = {
    ...run,
    graph: {
      ...run.graph,
      edges: run.graph.edges.map((e) => (
        e.from === camera.nodeId || e.to === camera.nodeId
          ? { ...e, features: [...new Set([...e.features, 'blocked'])] }
          : e
      )),
    },
    openedEdgeIds: [],
  };
  assert.throws(
    () => finishTask(useFieldEquipment(sealed, INSTANCE, SNIPER, camera.id, { effectivePerception: 2, usableAmmo: 10 })),
    RuleViolation,
    '잠긴 통로 너머는 시야가 없다',
  );
});

test('Perception 층계는 시간으로만 받는다 — 1은 무리(+2), -1은 불가', () => {
  const { run, camera } = runWithCameraInSight();

  // 요구치 2. Perception 1은 한 칸 모자라 무리(strained) — 시간 +2.
  const strained = finishTask(useFieldEquipment(run, INSTANCE, SNIPER, camera.id, { effectivePerception: 1, usableAmmo: 10 }));
  assert.equal(strained.time, run.time + CAMERA_SNIPE_TIME + CAPABILITY_STEP_TIME_DELTA.strained);
  assert.equal(strained.time, run.time + 6);
  assert.ok((strained.disabledCameraIds || []).includes(camera.id), '무리해도 카메라는 부서진다');

  // Perception 0은 두 칸 모자라 위태(severe) — 시간 +4.
  const severe = finishTask(useFieldEquipment(run, INSTANCE, SNIPER, camera.id, { effectivePerception: 0, usableAmmo: 10 }));
  assert.equal(severe.time, run.time + CAMERA_SNIPE_TIME + CAPABILITY_STEP_TIME_DELTA.severe);

  // Perception -1부터는 아예 겨눌 수 없다.
  assert.throws(
    () => finishTask(useFieldEquipment(run, INSTANCE, SNIPER, camera.id, { effectivePerception: -1, usableAmmo: 10 })),
    RuleViolation,
  );
});

test('탄이 없으면 쏠 수 없고, 이미 부순 카메라는 다시 쏠 수 없다', () => {
  const { run, camera } = runWithCameraInSight();
  assert.throws(
    () => finishTask(useFieldEquipment(run, INSTANCE, SNIPER, camera.id, { effectivePerception: 2, usableAmmo: 0 })),
    RuleViolation,
  );

  const destroyed = { ...run, disabledCameraIds: [camera.id] };
  assert.throws(
    () => finishTask(useFieldEquipment(destroyed, INSTANCE, SNIPER, camera.id, { effectivePerception: 2, usableAmmo: 10 })),
    RuleViolation,
  );
});
