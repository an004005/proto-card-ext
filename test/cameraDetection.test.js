// ADR-0091 — 카메라 발각은 진입이 아니라 **행동 뒤 판정**과 **소음 즉시**다.
//
// 카메라는 문턱이 아니라 지켜보는 눈이다. 지나가는 것만으로는 걸리지 않고, 그 방에서 무언가를
// 마치거나 그 방을 떠날 때 렌즈가 나를 읽는다. 소리를 내면 은신과 무관하게 즉시 읽힌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, moveToAdjacentNode, checkCameraDetection, reportNoise,
  explainEffectiveStealth, hackCamera, cameraSeesStealth, hasLiveCameraAt,
} from '../src/engine/runEngine.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { useMapConsumableCommand } from '../src/engine/facilityReducer.js';
import { effectiveCapabilities } from '../src/engine/capabilityEngine.js';
import { CAMERA_PERCEPTION, CAMERA_HACK_DURATION } from '../src/data/facilityLayout.js';
import { finishTask } from './helpers/finishTask.js';

const EMPTY_LOADOUT = { weapons: [], top: null, bottom: null, modules: [], implantIds: [], consumableSlots: [] };

/** 현재 노드에 카메라 하나만 세워 둔 런. 다른 카메라는 판정에 끼지 못하게 치운다. */
function runWithCameraHere(seed = 21) {
  const { graph } = generateFacilityGraph(seed);
  const run = createRunState(graph, seed);
  return {
    ...run,
    graph: { ...run.graph, cameras: [{ id: 'camera_test', nodeId: run.playerNodeId }] },
    threats: {},
  };
}

/** 현재 노드에서 나가는 평범한 통로와 그 끝. */
function plainExitEdge(run) {
  const edge = run.graph.edges
    .filter((e) => e.features.length === 0 && (e.from === run.playerNodeId || e.to === run.playerNodeId))[0];
  assert.ok(edge, '시작 노드에서 나가는 평범한 통로가 있어야 한다');
  return { edge, destination: edge.from === run.playerNodeId ? edge.to : edge.from };
}

/** 빈 로드아웃(모든 Capability 0)으로 시설맵에 선 스냅샷. */
function mapSnapshot(run) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, overrideChips: 0,
      loadout: { ...EMPTY_LOADOUT },
      inventory: { items: [], ammo: 0, capacity: 12 },
    },
  };
}

test('카메라의 지각은 상수 하나이고, 화면과 엔진이 같은 판정을 읽는다', () => {
  assert.equal(CAMERA_PERCEPTION, 2);
  assert.equal(cameraSeesStealth(CAMERA_PERCEPTION - 1), true);
  assert.equal(cameraSeesStealth(CAMERA_PERCEPTION), false);
  const run = runWithCameraHere();
  assert.equal(hasLiveCameraAt(run, run.playerNodeId), true);
});

test('카메라 노드에 들어가는 것만으로는 발각되지 않는다', () => {
  const { graph } = generateFacilityGraph(21);
  const base = createRunState(graph, 21);
  const { destination } = plainExitEdge(base);
  const run = {
    ...base,
    graph: { ...base.graph, cameras: [{ id: 'camera_test', nodeId: destination }] },
    threats: {},
  };
  // Stealth 1 — 이동 소음이 나지 않는 가장 낮은 값이다(소음이 나면 그건 소음 규칙이 잡는다).
  // 도착한 자리의 실효 은신은 카메라 −1이 붙어 0이지만, 진입 자체는 판정하지 않는다.
  const moved = moveToAdjacentNode(run, destination, 0, 1);
  assert.equal(moved.lastCameraDetection, null, '진입만으로 발각됐다');
  assert.equal(moved.noiseEvents.length, 0, 'Stealth 1의 이동은 소음을 내지 않는다');
});

test('소리를 내며 카메라 방에 들어서면 그 소음이 즉시 잡는다', () => {
  const { graph } = generateFacilityGraph(21);
  const base = createRunState(graph, 21);
  const { destination } = plainExitEdge(base);
  const run = {
    ...base,
    graph: { ...base.graph, cameras: [{ id: 'camera_test', nodeId: destination }] },
    threats: {},
  };
  const moved = moveToAdjacentNode(run, destination, 0, 0);
  assert.ok(moved.noiseEvents.length > 0);
  assert.equal(moved.lastCameraDetection?.nodeId, destination);
});

test('카메라 노드 위에서 대기 1칸이 끝나면 은신이 모자란 만큼 발각된다', () => {
  const run = runWithCameraHere();
  const after = gameReducer(mapSnapshot(run), { type: 'WAIT' }).facilityRunState;
  // 빈 로드아웃의 실효 Stealth는 0에 살아 있는 카메라 −1이 붙어 −1이다.
  assert.equal(explainEffectiveStealth(0, run).total, -1);
  assert.equal(after.lastCameraDetection?.cameraId, 'camera_test', '대기 한 칸 뒤에도 걸리지 않았다');
  assert.equal(after.lastCameraDetection.nodeId, run.playerNodeId);
});

test('실효 Stealth가 카메라의 지각에 닿으면 행동을 마쳐도 발각되지 않는다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);

  const caught = checkCameraDetection(run, nodeId, CAMERA_PERCEPTION - 1);
  assert.equal(caught.lastCameraDetection?.cameraId, 'camera_test');

  const hidden = checkCameraDetection(run, nodeId, CAMERA_PERCEPTION);
  assert.equal(hidden.lastCameraDetection, null, '지각과 같은 값에서 걸렸다');
});

test('은엄폐로 실효 Stealth를 지각까지 올리면 카메라 앞에서도 행동을 마칠 수 있다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);
  // 장비 합 0 · 은엄폐 +3 · 살아 있는 카메라 −1 = 실효 2.
  const concealed = { ...run, activeConcealment: { nodeId, bonus: 3 } };
  const explained = explainEffectiveStealth(0, concealed);
  assert.equal(explained.total, CAMERA_PERCEPTION);

  const after = checkCameraDetection(concealed, nodeId, explained.total);
  assert.equal(after.lastCameraDetection, null, '은엄폐로 메운 은신이 판정에 들어가지 않았다');
});

test('카메라 노드를 떠날 때 출발 판정을 한다 — 자리를 뜨는 순간 렌즈 앞을 지난다', () => {
  const run = runWithCameraHere();
  const { destination } = plainExitEdge(run);

  // 장비 합 2 — 카메라 −1이 붙어 실효 1이라 출발에 걸린다.
  const caught = moveToAdjacentNode(run, destination, 0, 2);
  assert.equal(caught.lastCameraDetection?.cameraId, 'camera_test', '출발 판정이 없다');
  assert.equal(caught.lastCameraDetection.nodeId, run.playerNodeId, '판정 자리는 떠나는 쪽이어야 한다');

  // 장비 합 3 — 실효 2라 걸리지 않는다. Stealth 3은 이동 소음도 내지 않는다.
  const clean = moveToAdjacentNode(run, destination, 0, 3);
  assert.equal(clean.lastCameraDetection, null);
});

test('카메라 노드에서 소음이 나면 은신과 무관하게 즉시 발각된다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);
  // Stealth 4로도 소용없다 — 판정 자체를 하지 않는다.
  assert.equal(checkCameraDetection(run, nodeId, 4).lastCameraDetection, null);
  const noisy = reportNoise(run, nodeId, 1);
  assert.equal(noisy.lastCameraDetection?.cameraId, 'camera_test', '소음을 냈는데도 걸리지 않았다');
});

test('멀리 심은 소음은 내 발각이 아니다 — 판정은 내가 선 자리의 소음만 본다', () => {
  const run = runWithCameraHere();
  const { destination } = plainExitEdge(run);
  const elsewhere = {
    ...run,
    graph: { ...run.graph, cameras: [{ id: 'camera_test', nodeId: destination }] },
  };
  assert.equal(reportNoise(elsewhere, destination, 2).lastCameraDetection, null);
});

test('해킹 중인 카메라는 아무 판정도 하지 않는다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);
  const hacked = finishTask(hackCamera(run, 'camera_test', 4));
  assert.ok(hacked.hackedCameras.some((c) => c.cameraId === 'camera_test'));
  assert.ok(hacked.time < CAMERA_HACK_DURATION, '해킹이 아직 살아 있어야 한다');

  assert.equal(checkCameraDetection(hacked, nodeId, -2).lastCameraDetection, null, '해킹 중인 카메라가 판정했다');
  assert.equal(reportNoise(hacked, nodeId, 3).lastCameraDetection, null, '해킹 중인 카메라가 소음에 반응했다');

  const destroyed = { ...run, disabledCameraIds: ['camera_test'] };
  assert.equal(checkCameraDetection(destroyed, nodeId, -2).lastCameraDetection, null, '파괴된 카메라가 판정했다');
});

test('같은 카메라에 같은 칸에서 두 번 걸리지 않는다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);
  const once = reportNoise(run, nodeId, 2);
  const detection = once.lastCameraDetection;
  assert.ok(detection);
  // 같은 칸의 행동 끝 판정은 그대로 넘어간다 — 같은 사건을 두 번 세지 않는다.
  const twice = checkCameraDetection(once, nodeId, -2);
  assert.deepEqual(twice.lastCameraDetection, detection);
  assert.deepEqual(twice.sectorAlerts, once.sectorAlerts, '경계도 압력이 두 번 올랐다');
});

test('행동 뒤 판정은 행동 **뒤**의 Capability로 잰다 — 붕대로 부상이 풀리면 그 칸에 걸리지 않는다', () => {
  const run = runWithCameraHere();
  const nodeId = /** @type {string} */ (run.playerNodeId);
  // 은엄폐 +3 · 살아 있는 카메라 −1. 장비 합 Stealth 0이므로 성한 몸이면 실효 2(= 지각)라 안전하고,
  // 부상 −1(ADR-0093)이 걸리면 실효 1이라 걸린다.
  const concealed = { ...run, activeConcealment: { nodeId, bonus: 3 } };
  const snapshot = {
    ...mapSnapshot(concealed),
    playerState: {
      hp: 20, maxHp: 40, overloadActive: false, overrideChips: 0,
      loadout: { ...EMPTY_LOADOUT, consumableSlots: [{ id: 'bandage-1', kind: 'consumable', defId: 'bandage' }] },
      inventory: { items: [], ammo: 0, capacity: 12 },
    },
  };
  assert.equal(effectiveCapabilities(snapshot).stealth, -1, 'HP 절반이면 부상 −1이 걸려 있어야 한다');
  assert.equal(explainEffectiveStealth(-1, concealed).total, CAMERA_PERCEPTION - 1, '다친 채로는 지각에 못 미친다');

  const after = useMapConsumableCommand(snapshot, 'bandage-1');
  assert.equal(after.facilityRunState.pendingTask, null, '붕대는 1칸에 끝난다');
  assert.ok(after.playerState.hp > 20, '붕대가 적용되지 않았다');
  assert.equal(effectiveCapabilities(after).stealth, 0, '회복했으면 부상 페널티가 풀린다');
  assert.equal(after.facilityRunState.lastCameraDetection, null, '행동 앞의 옛 Capability로 판정했다');
});

test('발각되면 반경 안의 위협이 추적으로 바뀌고 구역 경계 압력이 오른다', () => {
  const { graph } = generateFacilityGraph(21);
  const base = createRunState(graph, 21);
  const threatId = Object.keys(base.threats)[0];
  const run = {
    ...base,
    graph: { ...base.graph, cameras: [{ id: 'camera_test', nodeId: base.playerNodeId }] },
    threats: { [threatId]: { ...base.threats[threatId], nodeId: base.playerNodeId, nextMoveAt: 99999 } },
  };
  const sectorId = /** @type {string} */ (run.playerNodeId).split('_')[0];
  const after = checkCameraDetection(run, /** @type {string} */ (run.playerNodeId), 0);
  assert.equal(after.threats[threatId].mode, 'pursuit');
  assert.equal(after.threats[threatId].lastKnownPlayerNodeId, run.playerNodeId);
  assert.ok(after.sectorAlerts[sectorId].pressure > run.sectorAlerts[sectorId].pressure
    || after.sectorAlerts[sectorId].level > run.sectorAlerts[sectorId].level);
});
