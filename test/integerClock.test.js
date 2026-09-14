// 맵 정수 시계(ADR-0075)의 계약 검증. 여기서 보는 것은 "값이 얼마인가"가 아니라 "시간이
// 정수 칸으로만 존재하고, 1칸씩 진행하는 순서가 쪼개도 같은가"라는 성질이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, adjacentSectorIds } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, requestExtraction, basicRecon, reportNoise, reportSighting,
  moveToAdjacentNode, useFieldEquipment, destroyContractTarget, moveTimeCost, openSpecialEdge,
} from '../src/engine/runEngine.js';
import { resolveCapabilityCost } from '../src/engine/capabilityCosts.js';
import { cleanTraces, broadcastFalseTarget } from '../src/engine/recovery.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import {
  RUN_COLLAPSE_TIME, THREAT_MOVE_INTERVAL,
  REINFORCEMENT_INTERVAL, REINFORCEMENT_LOCKDOWN_INTERVAL,
  EXIT_A_DISABLED_AT, EXIT_OPEN_WINDOW, BASIC_RECON_TIME, FORCE_TIER1_TIME,
  APPROACH_TIME_DELTA, TRACE_CLEANUP_TIME_BY_PERCEPTION, FALSE_BROADCAST_TIME,
  FALSE_BROADCAST_DURATION_BY_STEP,
} from '../src/data/facilityLayout.js';
import { buildAdjacency } from '../src/engine/graphUtils.js';
import { finishTask } from './helpers/finishTask.js';

/** 시작 노드에 잠긴 특수 엣지가 붙은 첫 시드의 런. @returns {{run: any, blocked: any}} */
function runWithBlockedEdgeAtStart() {
  for (let seed = 0; seed < 200; seed++) {
    const run = makeRun(seed);
    const blocked = run.graph.edges.find((e) => e.features.includes('blocked')
      && (e.from === run.playerNodeId || e.to === run.playerNodeId));
    if (blocked) return { run, blocked };
  }
  throw new Error('no seed puts a blocked special edge on the start node');
}

function makeRun(seed = 1, runConfig) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed, runConfig);
}

/**
 * 런 상태 안의 모든 시각·예약 필드를 재귀로 모은다. 그래프(기하 좌표)와 rng 내부 상태는 시간이
 * 아니므로 건너뛴다. fieldCooldowns는 키가 장비 인스턴스 id라 이름으로 걸러낼 수 없어 경로로 잡는다.
 */
function collectTimeFields(value, path, out) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectTimeFields(item, `${path}[${i}]`, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'graph' || key === 'rngState') continue;
    const childPath = `${path}.${key}`;
    const isTimeField = typeof child === 'number'
      && (key === 'time' || /At$/.test(key) || path.endsWith('.fieldCooldowns'));
    if (isTimeField) out.push([childPath, child]);
    else collectTimeFields(child, childPath, out);
  }
}

test('every time field in a live run state is an integer number of 칸', () => {
  let state = makeRun(21);
  // 시간을 쓰는 경로를 골고루 밟는다 — 이동(Mobility 배율), 정찰, 탈출 요청(개방 예약),
  // 소음(지속), 장비(지속+쿨다운), 그리고 여러 칸의 월드 진행.
  const neighbor = [...buildAdjacency(state.graph.edges).get(state.playerNodeId)][0];
  state = moveToAdjacentNode(state, neighbor, 3, -2);
  state = finishTask(basicRecon(state));
  state = reportNoise(state, state.playerNodeId, 2);
  state = finishTask(requestExtraction(state, 'A', 1));
  const barrier = MAP_EQUIPMENT_CAPABILITIES.module_forcefield.fieldAction;
  const someEdge = state.graph.edges.find((e) => e.from === state.playerNodeId || e.to === state.playerNodeId);
  state = finishTask(useFieldEquipment(state, 'ff1', barrier, someEdge.id));
  state = advanceTime(state, state.time + 37);

  const fields = [];
  collectTimeFields(state, 'run', fields);
  assert.ok(fields.length > 20, `시간 필드를 찾지 못했다 (${fields.length})`);
  for (const [path, value] of fields) {
    assert.ok(Number.isInteger(value), `${path} = ${value} 는 정수 칸이 아니다`);
  }
});

test('통로에는 고유한 시간 비용이 없고, 거리는 정수 홉수다(ADR-0084)', () => {
  for (const seed of [1, 2, 3, 7, 13, 21, 42]) {
    const { graph } = generateFacilityGraph(seed);
    for (const edge of graph.edges) {
      assert.equal(edge.timeCost, undefined, `seed ${seed} ${edge.id}: 통로는 시간을 들고 있지 않다`);
    }
    const distance = graph.exitPlacement.exitAWalkDistance;
    assert.ok(Number.isInteger(distance) && distance > 0, `seed ${seed}: 시작점-출구 A 거리도 정수 홉이다`);
  }
});

// 플레이어가 1칸씩 쪼개 행동해도 월드 사건이 늦춰지거나 뭉치지 않는다.
test('advancing 5 칸 at once equals five single-칸 advances when the player does nothing', () => {
  const base = makeRun(9);
  const bulk = advanceTime(base, base.time + 5);
  let stepwise = base;
  for (let i = 0; i < 5; i++) stepwise = advanceTime(stepwise, stepwise.time + 1);
  assert.deepEqual(stepwise, bulk);
});

test('arriving exactly at RUN_COLLAPSE_TIME is too late; finishing one 칸 earlier still counts', () => {
  // 붕괴 직전으로 시계를 옮겨 놓고 마지막 몇 칸만 실제로 굴린다.
  const base = { ...makeRun(9), time: RUN_COLLAPSE_TIME - 4 };
  const justBefore = advanceTime(base, RUN_COLLAPSE_TIME - 1);
  assert.equal(justBefore.phase, 'active');
  assert.equal(justBefore.time, RUN_COLLAPSE_TIME - 1);

  // 마감과 같은 시각에 끝나는 작업은 붕괴에 진다.
  const onTheLine = advanceTime(justBefore, RUN_COLLAPSE_TIME);
  assert.equal(onTheLine.phase, 'collapsed');
  assert.equal(onTheLine.time, RUN_COLLAPSE_TIME);
});

test('a threat that speeds up pulls its reservation in with min(); one that slows down keeps the reservation it already made', () => {
  const base = makeRun(3);
  const [threatId, threat] = Object.entries(base.threats)[0];
  // 위협 하나만 남겨 다른 마커의 rng/경계도 간섭을 없앤다.
  const solo = { ...base, playerNodeId: 'nowhere', threats: { [threatId]: threat } };
  assert.equal(solo.threats[threatId].nextMoveAt, THREAT_MOVE_INTERVAL.patrol);

  // 빨라질 때: 순찰(5칸) 예약을 들고 있다가 t=1에 추적(3칸)이 되면 min(5, 1+3)=4로 당겨진다.
  const spotted = reportSighting(solo, threatId, solo.graph.startNodeId);
  const sped = advanceTime(spotted, 1);
  assert.equal(sped.threats[threatId].mode, 'pursuit');
  assert.equal(sped.threats[threatId].nextMoveAt, 1 + THREAT_MOVE_INTERVAL.pursuit);

  // 느려질 때: 추적 간격(3칸)으로 잡아둔 예약은 순찰로 돌아가도 그대로 지킨다.
  const pursuing = {
    ...solo,
    threats: { [threatId]: { ...threat, mode: 'pursuit', alert: 0, pursuitStrength: 0, lastKnownPlayerNodeId: null, nextMoveAt: THREAT_MOVE_INTERVAL.pursuit } },
  };
  const slowed = advanceTime(pursuing, 1);
  assert.equal(slowed.threats[threatId].mode, 'patrol');
  assert.equal(slowed.threats[threatId].nextMoveAt, THREAT_MOVE_INTERVAL.pursuit, '이미 예약한 한 번은 유지한다');
});

test('entering lockdown pulls every sector reinforcement clock to min(existing, now + lockdown interval)', () => {
  const { graph } = generateFacilityGraph(1);
  // 구역이 런마다 뽑히므로(ADR-0081) 이 런에 목표부 구역이 있는 파괴 계약을 고른다.
  const contract = CONTRACT_DEFS.find((c) => c.type === 'destroy' && graph.sectorIds.includes(c.sectorId));
  assert.ok(contract, '픽스처 시드는 파괴 계약이 있는 구역을 뽑아야 한다');
  const base = createRunState(graph, 1, { contract });
  const landmark = graph.landmarks.find((l) => l.sectorId === contract.sectorId);

  // 한 구역은 이미 봉쇄 간격보다 가까운 예약을 들고 있게 해 둔다 — 그 구역은 당겨지지 않아야 한다.
  const nearSector = Object.keys(base.reinforcements).find((id) => id !== contract.sectorId);
  const at = {
    ...base,
    playerNodeId: landmark.nodeId,
    // 이 테스트가 보는 것은 봉쇄가 교대 시계를 당기는 규칙이다 — 작업 중단(적 접촉)이 끼어들지
    // 않도록 위협을 비운다.
    threats: {},
    reinforcements: { ...base.reinforcements, [nearSector]: { ...base.reinforcements[nearSector], nextAt: 30 } },
  };
  assert.equal(at.reinforcements[contract.sectorId].nextAt, REINFORCEMENT_INTERVAL);

  const locked = finishTask(destroyContractTarget(at, 1));
  assert.ok(locked.lockdown);
  const startedAt = locked.lockdown.startedAt;
  for (const [sectorId, clock] of Object.entries(locked.reinforcements)) {
    const before = at.reinforcements[sectorId].nextAt;
    assert.ok(clock.nextAt <= Math.min(before, startedAt + REINFORCEMENT_LOCKDOWN_INTERVAL), `${sectorId}: ${clock.nextAt}`);
  }
  assert.equal(locked.reinforcements[nearSector].nextAt, 30, '이미 더 가까운 예약은 봉쇄가 늦추지 않는다');
});

test('a 10-칸 effect starts at its completion time C and is already gone at C+10', () => {
  const base = makeRun(5);
  const contract = MAP_EQUIPMENT_CAPABILITIES.module_forcefield.fieldAction;
  assert.equal(contract.duration, 10);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);

  const used = finishTask(useFieldEquipment(base, 'ff1', contract, edge.id));
  const completedAt = base.time + contract.timeCost;
  assert.equal(used.time, completedAt, '작업 시간만큼 흐른 뒤 완료된다');
  const barrier = used.activeBarriers.find((b) => b.edgeId === edge.id);
  assert.ok(barrier, '완료 시각 C에 효과가 생긴다');
  assert.equal(barrier.expiresAt, completedAt + contract.duration);

  const lastActive = advanceTime(used, completedAt + contract.duration - 1);
  assert.ok(lastActive.activeBarriers.some((b) => b.edgeId === edge.id), 'C+D-1 칸까지는 유효하다');

  const expired = advanceTime(used, completedAt + contract.duration);
  assert.ok(!expired.activeBarriers.some((b) => b.edgeId === edge.id), 'C+D 칸에는 이미 만료다');

  // 쿨다운도 완료 시각 C부터 센다.
  assert.equal(used.fieldCooldowns.ff1, completedAt + contract.cooldown);
});

test('ADR-0054: 폐쇄 시각 뒤 새 가동은 막히지만 이미 시작된 가동 게이지와 개방 창은 끝까지 진행된다', () => {
  // 가동은 중단되면 취소되므로(TASK_ABORTS.exitActivate), 여기서는 위협 없는 런으로 본다 —
  // 보려는 것은 폐쇄 시각이 이미 시작된 가동을 끊지 않는다는 것뿐이다.
  let state = { ...makeRun(9), threats: {} };
  // 폐쇄 2칸 전에 가동 → Hacking 4의 게이지 8칸이 폐쇄 시각을 넘긴다(개방 창까지 붕괴 전에 닫힌다).
  state = advanceTime(state, EXIT_A_DISABLED_AT - 2);
  state = requestExtraction(state, 'A', 4);
  const opensAt = state.exits.A.opensAt;
  assert.ok(opensAt > EXIT_A_DISABLED_AT);

  state = advanceTime(state, EXIT_A_DISABLED_AT);
  assert.notEqual(state.exits.A.status, 'disabled');

  state = advanceTime(state, opensAt);
  assert.equal(state.exits.A.status, 'open');
  assert.equal(state.exits.A.openEndsAt, opensAt + EXIT_OPEN_WINDOW);

  state = advanceTime(state, opensAt + EXIT_OPEN_WINDOW);
  assert.equal(state.exits.A.status, 'disabled');
  assert.throws(() => requestExtraction(state, 'A', 4));
});

// ---- 3단계: 런타임 배율을 정수 가감·고정표로 교체(ADR-0075) ----

test('이동은 통로와 Mobility에 관계없이 언제나 1칸이다(ADR-0084)', () => {
  // 시간은 이동이 아니라 작업에서 나간다. 통로마다 다른 비용도, Mobility 가감도 없다 —
  // 그래서 "여기서 저기까지 몇 칸"이 홉수 세기 하나로 끝난다.
  const mobilities = [-2, -1, 0, 1, 2, 3, 4];
  for (const m of mobilities) {
    assert.equal(moveTimeCost({ features: [] }, m), 1, `Mobility ${m}`);
    // 범위 밖 수치도 같다(장비 보정이 상한을 넘겨도 마찬가지다).
    assert.equal(moveTimeCost({ features: [] }, m * 10), 1);
  }
  assert.equal(moveTimeCost(), 1, '통로를 넘기지 않아도 답은 같다');
});

test('유료 행동이 실제로 청구한 칸은 UI가 미리 보여주는 예고값과 같다', () => {
  // 예고와 청구가 갈라지면 플레이어가 읽은 마감 계산이 통째로 틀어진다. 그래서 UI가 쓰는 것과
  // 같은 함수(moveTimeCost / resolveCapabilityCost)로 예고를 만들고, 엔진이 흘린 칸과 맞춘다.
  const charged = (before, after) => after.time - before.time;

  // 이동 — MapScreen의 도착 예고가 그대로 쓰는 함수다.
  for (const mobility of [-2, 0, 4]) {
    const run = makeRun(7);
    const neighbor = [...buildAdjacency(run.graph.edges).get(run.playerNodeId)][0];
    const edge = run.graph.edges.find((e) => (e.from === run.playerNodeId && e.to === neighbor) || (e.to === run.playerNodeId && e.from === neighbor));
    const moved = moveToAdjacentNode(run, neighbor, mobility, 3);
    assert.equal(charged(run, moved), moveTimeCost(edge, mobility), `이동 M=${mobility}`);
  }

  // 기본 정찰 — Capability가 걸리지 않은 고정 비용.
  const reconRun = makeRun(7);
  assert.equal(charged(reconRun, finishTask(basicRecon(reconRun))), BASIC_RECON_TIME);

  // 특수 엣지 개방 — 층계 가감과 접근 가감이 함께 걸리는 유일한 자리다. 구역 추첨(ADR-0081)
  // 때문에 어느 시드가 시작 노드에 'blocked' 엣지를 두는지는 고정이 아니라, 찾아서 쓴다.
  const { run: edgeRun, blocked } = runWithBlockedEdgeAtStart();
  for (const mode of ['safe', 'normal', 'rush']) {
    for (const force of [0, 1, 3]) {
      const required = blocked.requiredCapability ?? 1;
      const forecast = resolveCapabilityCost('force', force, required, {
        time: FORCE_TIER1_TIME, timeDelta: APPROACH_TIME_DELTA[mode],
      });
      if (forecast.step === 'impossible') continue;
      const opened = finishTask(openSpecialEdge(edgeRun, blocked.id, 'force', force, mode));
      assert.equal(charged(edgeRun, opened), forecast.timeCost, `개방 ${mode}/F=${force}`);
    }
  }

  // 흔적 정리 — Perception 전용표가 그대로 예고값이다(층계 가감을 얹지 않는다).
  const nodeId = makeRun(7).playerNodeId;
  const traced = { ...makeRun(7), evidence: [{ id: 'e1', nodeId, tier: 1, createdBySectorId: nodeId.split('_')[0] }] };
  for (const perception of [0, 1, 4]) {
    const forecast = resolveCapabilityCost('perception', perception, 1, {
      time: TRACE_CLEANUP_TIME_BY_PERCEPTION[perception + 2], dedicatedTimeRule: true,
    });
    assert.equal(charged(traced, finishTask(cleanTraces(traced, perception))), forecast.timeCost, `흔적 정리 P=${perception}`);
  }

  // 가짜 목표 송출 — 시간은 층계 가감, 지속은 고정표. 둘 다 예고와 같아야 한다.
  const interfaceRun = makeRun(7);
  const entry = interfaceRun.graph.accessInterfaces[0];
  const atInterface = { ...interfaceRun, playerNodeId: entry.nodeId };
  const sectorId = entry.nodeId.split('_')[0];
  const targetSectorId = adjacentSectorIds(interfaceRun.graph, sectorId)[0];
  const raised = {
    ...atInterface,
    sectorAlerts: {
      ...atInterface.sectorAlerts,
      [sectorId]: { ...atInterface.sectorAlerts[sectorId], level: 2 },
      [targetSectorId]: { ...atInterface.sectorAlerts[targetSectorId], level: 0 },
    },
  };
  for (const deception of [0, 1, 3]) {
    const forecast = resolveCapabilityCost('deception', deception, 1, {
      time: FALSE_BROADCAST_TIME, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP,
    });
    const after = finishTask(broadcastFalseTarget(raised, deception, targetSectorId));
    assert.equal(charged(raised, after), forecast.timeCost, `가짜 목표 D=${deception}`);
    // 미끼는 작업 **완료 시각** C에 심기고 거기서부터 고정표의 지속만큼 버틴다 — 시작 시각에
    // 심으면 긴 작업에서 완료 전에 이미 만료돼 버린다.
    const planted = after.falseTargets[after.falseTargets.length - 1];
    assert.equal(planted.createdAt, after.time, `가짜 목표 심는 시각 D=${deception}`);
    assert.equal(planted.expiresAt - planted.createdAt, forecast.duration, `가짜 목표 지속 D=${deception}`);
  }
});

test('가짜 목표는 Deception 층계별 고정 칸만큼만 버틴다', () => {
  // 19/15/8/4는 planned §7의 확정 고정표다. 배율이 아니므로 기본값이 바뀌어도 이 칸 수가 기준이다.
  assert.deepEqual(
    ['surplus', 'standard', 'strained', 'severe'].map((step) => FALSE_BROADCAST_DURATION_BY_STEP[step]),
    [19, 15, 8, 4],
  );
  const base = { time: FALSE_BROADCAST_TIME, durationByStep: FALSE_BROADCAST_DURATION_BY_STEP };
  assert.deepEqual(
    [[2, 1], [1, 1], [0, 1], [0, 2]].map(([a, r]) => resolveCapabilityCost('deception', a, r, base).duration),
    [19, 15, 8, 4],
  );
});
