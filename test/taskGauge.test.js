// 가동 → 대기로 게이지 채우기(ADR-0084). 맵의 모든 행동은 1칸에 **가동**되고, 그보다 긴 작업은
// 그 노드에 걸린 게이지로 남아 플레이어가 대기로 채운다. 여기서 보는 것은 그 뼈대다:
// 시작은 언제나 1칸, 효과는 게이지가 찰 때 한 번, 자리를 뜨면 포기, 두 작업은 동시에 못 건다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, basicRecon, useOpportunity, requestExtraction, waitOneTick,
  moveToAdjacentNode, useFieldEquipment, isAtOpenExit,
} from '../src/engine/runEngine.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { RuleViolation } from '../src/engine/errors.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import {
  BASIC_RECON_TIME, PRIZE_FARM_TIME, EXIT_ACTIVATE_TIME_BY_HACKING, EXIT_OPEN_WINDOW,
  WAIT_BATCH_MAX_TICKS, THREAT_MOVE_INTERVAL, LOCKDOWN_THREAT_MOVE_INTERVAL,
  SECTOR_ALERT_MOVE_INTERVAL, SECTOR_ALERT_FAST_MOVE_LEVEL,
} from '../src/data/facilityLayout.js';
import { finishTask } from './helpers/finishTask.js';

/** 위협도 증원도 없는 런 — 게이지 자체를 보는 테스트에 끼어들 것이 없게 한다. */
function quietRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

function neighborsOf(run, nodeId) {
  const out = [];
  for (const e of run.graph.edges) {
    if (e.features?.includes('blocked') || e.features?.includes('highGround')) continue;
    if (e.features?.includes('oneWay') && e.to === nodeId) continue;
    if (e.from === nodeId) out.push(e.to);
    else if (e.to === nodeId) out.push(e.from);
  }
  return out;
}

function snapshotOf(run) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, loadout: { consumableSlots: [] },
      inventory: { items: [], ammo: 0, capacity: 12 }, warehouse: { items: [], ammo: 0, capacity: 99 },
    },
  };
}

// ---- 1. 가동은 1칸, 나머지는 게이지 ----

test('가동에 드는 것은 언제나 1칸이고, 완료 시각은 옛 비용 그대로다', () => {
  const run = quietRun(3);
  const started = basicRecon(run);

  assert.equal(started.time, run.time + 1, '가동은 1칸이다');
  assert.ok(started.pendingTask, '남은 칸은 게이지로 남는다');
  assert.equal(started.pendingTask.kind, 'recon');
  assert.equal(started.pendingTask.startedAt, run.time);
  assert.equal(started.pendingTask.completesAt, run.time + BASIC_RECON_TIME, '총 경과는 예전 비용과 같다');
  assert.equal(started.activeRecon, null, '가동만으로는 아무 효과도 없다');
});

test('1칸짜리 작업은 가동하는 그 칸에 끝난다 — 게이지가 남지 않는다', () => {
  const run = quietRun(3);
  const waited = waitOneTick(run);
  assert.equal(waited.time, run.time + 1);
  assert.equal(waited.pendingTask, null);
  assert.equal(waited.lastTaskOutcome.status, 'completed');
});

test('대기가 게이지를 채우고, 효과는 다 찬 그 칸에 딱 한 번 적용된다', () => {
  const run = quietRun(3);
  let state = basicRecon(run);
  for (let i = run.time + 1; i < run.time + BASIC_RECON_TIME; i++) {
    assert.ok(state.pendingTask, `t=${state.time}: 아직 진행 중이어야 한다`);
    assert.equal(state.activeRecon, null, `t=${state.time}: 채우는 동안에는 효과가 없다`);
    state = waitOneTick(state);
  }
  assert.equal(state.time, run.time + BASIC_RECON_TIME);
  assert.equal(state.pendingTask, null);
  assert.equal(state.lastTaskOutcome.status, 'completed');
  assert.ok(state.activeRecon, '게이지가 차는 칸에 효과가 선다');
  assert.equal(state.activeRecon.sourceNodeId, run.playerNodeId);

  // 한 번뿐이다 — 더 기다려도 같은 작업이 다시 완료되지 않는다.
  const later = waitOneTick(state);
  assert.equal(later.lastTaskOutcome.kind, 'wait', '다음 대기는 자기 작업으로 끝난다');
});

// ---- 2. 자리를 뜨면 포기 ----

test('다른 노드로 이동하면 진행 중인 작업을 포기한다 — 효과도 쿨다운도 남지 않는다', () => {
  const base = quietRun(5);
  const nodeId = base.playerNodeId;
  const scan = MAP_EQUIPMENT_CAPABILITIES.module_spatial.fieldAction;
  const started = useFieldEquipment(base, 'inst1', scan);
  assert.ok(started.pendingTask, '집중 투시는 5칸짜리라 게이지로 남는다');
  assert.deepEqual(started.fieldCooldowns, {}, '쿨다운은 완료 시각에 걸린다');

  const destination = neighborsOf(base, nodeId)[0];
  const moved = moveToAdjacentNode(started, destination);

  assert.equal(moved.pendingTask, null, '떠나면 게이지도 사라진다');
  assert.equal(moved.lastTaskOutcome.status, 'interrupted');
  assert.equal(moved.lastTaskOutcome.reason, 'abandoned');
  assert.deepEqual(moved.fieldCooldowns, {}, '쿨다운은 소모되지 않는다 — 다시 쓸 수 있다');
  assert.equal(moved.playerNodeId, destination);

  // 실제로 다시 쓸 수 있다.
  const retried = useFieldEquipment(moved, 'inst1', scan);
  assert.ok(retried.pendingTask, '포기한 장비는 그대로 남는다');
});

test('탈출구 가동을 두고 자리를 뜨면 신호와 가동이 함께 취소된다', () => {
  const base = quietRun(9);
  const atExit = { ...base, playerNodeId: base.exits.A.nodeId };
  const started = requestExtraction(atExit, 'A', 0);
  assert.equal(started.exits.A.status, 'requesting');

  const destination = neighborsOf(atExit, atExit.playerNodeId)[0];
  const moved = moveToAdjacentNode(started, destination);
  assert.equal(moved.exits.A.status, 'closed');
  assert.equal(moved.exits.A.signalStartedAt, null);
  assert.equal(moved.lastTaskOutcome.reason, 'abandoned');
});

// ---- 3. 한 번에 하나 ----

test('진행 중인 작업을 둔 채 다른 작업을 걸면 규칙 위반이다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 2, grade: 'prize', tier: 'normal', axis: 'resource' }] },
  };
  const started = useOpportunity(run, 'p1', 'normal').state;
  assert.ok(started.pendingTask);

  assert.throws(() => basicRecon(started), RuleViolation);
  assert.throws(() => useOpportunity(started, 'p1', 'normal'), RuleViolation);
  // 대기만은 언제나 가능하다 — 그것이 게이지를 채우는 유일한 수단이다.
  const waited = waitOneTick(started);
  assert.equal(waited.time, started.time + 1);
  assert.equal(waited.pendingTask.kind, 'farm', '대기가 진행 중인 작업을 밀어내지 않는다');
});

// ---- 4. 이동은 언제나 1칸 ----

test('이동은 어느 통로든, 어느 Mobility든 1칸이다', () => {
  const base = quietRun(7);
  for (const mobility of [-2, 0, 2, 4]) {
    const destinations = neighborsOf(base, base.playerNodeId);
    for (const destination of destinations.slice(0, 3)) {
      const moved = moveToAdjacentNode(base, destination, mobility, 4);
      assert.equal(moved.time - base.time, 1, `Mobility ${mobility} → ${destination}`);
    }
  }
});

// ---- 5. 탈출구 가동의 전 과정 ----

test('탈출구 가동 → 대기 → 개방 → 추출', () => {
  const hacking = 3;
  const gauge = EXIT_ACTIVATE_TIME_BY_HACKING[hacking + 2];
  const base = quietRun(9);
  const atExit = { ...base, playerNodeId: base.exits.A.nodeId };

  let state = requestExtraction(atExit, 'A', hacking);
  assert.equal(state.time, 1, '가동은 1칸이다');
  assert.equal(state.pendingTask.kind, 'exitActivate');
  assert.equal(state.pendingTask.completesAt, gauge);
  assert.equal(isAtOpenExit(state), false, '가동만으로는 나갈 수 없다');

  state = finishTask(state);
  assert.equal(state.time, gauge);
  assert.equal(state.exits.A.status, 'open', '게이지가 차는 칸에 문이 열린다');
  assert.equal(state.exits.A.openEndsAt, gauge + EXIT_OPEN_WINDOW);
  assert.equal(isAtOpenExit(state), true);

  // 개방 창은 유한하다 — 그 안에 나가지 않으면 다시 닫힌다.
  const missed = advanceTime(state, gauge + EXIT_OPEN_WINDOW);
  assert.equal(missed.exits.A.status, 'closed');
});

test('열린 출구 위에서 게이지가 차면 그 칸에 추출된다', () => {
  const base = quietRun(9);
  const atExit = { ...base, playerNodeId: base.exits.A.nodeId };
  const snapshot = snapshotOf(atExit);
  let s = gameReducer(snapshot, { type: 'REQUEST_EXTRACTION', exitId: 'A' });
  assert.equal(s.currentScreen, 'map');
  assert.ok(s.facilityRunState.pendingTask, '가동해 두고 대기로 채운다');

  for (let i = 0; i < 40 && s.currentScreen === 'map'; i++) s = gameReducer(s, { type: 'WAIT' });
  assert.equal(s.currentScreen, 'extractionComplete', '게이지가 차고 문이 열리는 그 칸에 나간다');
});

// ---- 6. 묶음 대기는 완료에서 멈춘다 ----

test('묶음 대기는 게이지가 다 차면 남은 칸을 쓰지 않고 멈춘다', () => {
  const base = quietRun(3);
  // 정찰은 4칸이라 가동 1칸 뒤 남은 게이지가 3칸이다 — 5칸 묶음 대기보다 짧다.
  assert.ok(BASIC_RECON_TIME - 1 < WAIT_BATCH_MAX_TICKS, '이 검증은 게이지가 묶음 한도보다 짧은 경우다');
  const started = basicRecon(base);
  const after = gameReducer(snapshotOf(started), { type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS });
  const run = after.facilityRunState;

  assert.equal(run.time, base.time + BASIC_RECON_TIME, '완료되는 칸에서 멈춘다');
  assert.equal(run.pendingTask, null);
  assert.equal(run.lastWaitBatch.reason, 'taskDone');
  assert.equal(run.lastWaitBatch.elapsed, BASIC_RECON_TIME - 1);
  assert.ok(run.activeRecon, '멈춘 이유가 완료이므로 효과는 서 있다');
});

test('묶음 대기는 게이지가 더 길면 한도까지만 채우고 작업을 남겨 둔다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'resource' }] },
  };
  assert.ok(PRIZE_FARM_TIME.elite - 1 > WAIT_BATCH_MAX_TICKS);
  const started = useOpportunity(run, 'p1', 'normal').state;
  const after = gameReducer(snapshotOf(started), { type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS });

  assert.equal(after.facilityRunState.time, started.time + WAIT_BATCH_MAX_TICKS);
  assert.ok(after.facilityRunState.pendingTask, '아직 채우는 중이다');
});

// ---- 7. 경계도 2 이상인 구역은 모드를 가리지 않고 빨라진다 ----

test('구역 경계도 2 이상이면 순찰도 추적도 빨라지고, 봉쇄와 겹치면 더 작은 값이 이긴다', () => {
  const base = quietRun(3);
  const { graph } = generateFacilityGraph(3);
  const template = Object.values(createRunState(graph, 3).threats)[0];
  const sectorId = template.sectorId;

  // 한 번 움직인 뒤 다음 예약까지의 간격이 곧 그 모드의 이동 간격이다. 목표 선택이 mode를 다시
  // 정할 수 있으므로(소음이 없으면 조사는 순찰로 돌아간다) 판정에 쓸 mode도 함께 읽어 온다.
  const step = (mode, level, lockdown) => {
    const run = {
      ...base,
      lockdown: lockdown ? { startedAt: 0 } : null,
      sectorAlerts: { ...base.sectorAlerts, [sectorId]: { level, pressure: 0, resolvedEventIds: [] } },
      threats: { [template.id]: { ...template, mode, alert: level, nextMoveAt: 1 } },
    };
    const after = advanceTime(run, 1).threats[template.id];
    return { interval: after.nextMoveAt - 1, mode: after.mode };
  };

  assert.equal(SECTOR_ALERT_FAST_MOVE_LEVEL, 2);
  for (const mode of ['patrol', 'investigate', 'alert', 'pursuit', 'exit_guard']) {
    const quiet = step(mode, 0, false);
    assert.equal(quiet.interval, THREAT_MOVE_INTERVAL[quiet.mode], `${mode}: 조용한 구역`);

    const alerted = step(mode, 2, false);
    assert.equal(alerted.interval, SECTOR_ALERT_MOVE_INTERVAL[alerted.mode], `${mode}: 경계도 2`);
    assert.ok(alerted.interval <= THREAT_MOVE_INTERVAL[alerted.mode], `${mode}: 경계도 2는 느려지지 않는다`);

    const locked = step(mode, 0, true);
    assert.equal(locked.interval, LOCKDOWN_THREAT_MOVE_INTERVAL[locked.mode], `${mode}: 봉쇄`);

    const both = step(mode, 3, true);
    assert.equal(
      both.interval,
      Math.min(LOCKDOWN_THREAT_MOVE_INTERVAL[both.mode], SECTOR_ALERT_MOVE_INTERVAL[both.mode]),
      `${mode}: 봉쇄 + 경계도 3은 둘 중 작은 값`,
    );
  }
  // 예전에는 조사·경계만 빨라졌다 — 경계도가 오른 구역의 순찰이 실제로 빨라지는 것이 새 규칙이다.
  assert.ok(SECTOR_ALERT_MOVE_INTERVAL.patrol < THREAT_MOVE_INTERVAL.patrol, '순찰도 실제로 빨라진다');
  assert.ok(SECTOR_ALERT_MOVE_INTERVAL.pursuit < THREAT_MOVE_INTERVAL.pursuit, '추적도 빨라진다');
});
