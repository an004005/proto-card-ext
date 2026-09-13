// 현장 작업의 예약 → 칸별 진행 → 완료 적용, 적 접촉에 의한 중단, 대기와 조우 회피
// (docs/extraction-map-implementation-spec.md「시간과 위협」·「이동과 현장 행동」).
//
// 여기서 보는 것은 수치가 아니라 성질이다: 완료 전에는 아무 효과도 없고, 중단되면 경과한 칸만
// 청구되며, 완료한 것은 그 시각 C부터 산다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFacilityGraph, adjacentSectorIds } from '../src/engine/facilityGraph.js';
import {
  createRunState, advanceTime, basicRecon, useOpportunity, requestExtraction, waitOneTick, evadeThreat,
  openSpecialEdge,
} from '../src/engine/runEngine.js';
import { cutPower, broadcastFalseTarget } from '../src/engine/recovery.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import {
  PRIZE_FARM_TIME, PRIZE_FARM_NOISE, BASIC_RECON_TIME, POWER_CUT_TIME, EXIT_REQUEST_TIME,
  WAIT_BATCH_MAX_TICKS, ENCOUNTER_EVADE_TIME, FALSE_BROADCAST_DURATION_BY_STEP, FALSE_BROADCAST_TIME,
  THREAT_MOVE_INTERVAL, COMBAT_ENEMY_AMBUSH_TIME_COST,
} from '../src/data/facilityLayout.js';

/** 위협이 하나도 없는 조용한 런 — 중단 규칙을 보는 테스트만 위협을 직접 심는다. */
function quietRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

function neighborsOf(run, nodeId) {
  const out = [];
  for (const e of run.graph.edges) {
    if (e.features?.includes('blocked')) continue;
    if (e.from === nodeId) out.push(e.to);
    else if (e.to === nodeId) out.push(e.from);
  }
  return out;
}

/**
 * 플레이어 노드 옆에서 `arrivesAt` 칸에 걸어 들어오는 추적 위협 하나만 남긴다.
 * 추적 목표가 곧 플레이어 노드이므로 한 걸음이면 도착한다.
 */
function withIncomingThreat(run, arrivesAt) {
  const template = Object.values(createRunState(run.graph, 1).threats)[0];
  const approachNodeId = neighborsOf(run, run.playerNodeId)[0];
  return {
    ...run,
    threats: {
      [template.id]: {
        ...template,
        nodeId: approachNodeId,
        mode: 'pursuit',
        alert: 3,
        pursuitStrength: 3,
        lastKnownPlayerNodeId: run.playerNodeId,
        target: { kind: 'player', nodeId: run.playerNodeId },
        nextMoveAt: arrivesAt,
      },
    },
  };
}

function snapshotOf(run, playerState = {}) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, loadout: { consumableSlots: [] },
      inventory: { items: [], ammo: 0, capacity: 12 }, warehouse: { items: [], ammo: 0, capacity: 99 },
      ...playerState,
    },
  };
}

// ---- 1. 중단: 경과한 칸만 소모하고 예약은 해제된다 ----

test('적이 3칸째에 도착하면 10칸 파밍은 거기서 끝난다 — 시간만 3칸 나가고 보상·기회·소음은 남지 않는다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const opportunity = { id: 'p1', nodeId, keyEligible: true, usesRemaining: 1, grade: 'prize', tier: 'normal', axis: 'resource' };
  const run = withIncomingThreat({
    ...base,
    graph: { ...base.graph, opportunities: [opportunity] },
  }, 3);
  assert.equal(PRIZE_FARM_TIME.normal, 10, '이 검증은 10칸짜리 작업을 전제한다');

  const { state: after, keyGranted } = useOpportunity(run, 'p1', 'normal');

  assert.equal(after.time - run.time, 3, '경과한 칸만 소모한다');
  assert.equal(after.lastTaskOutcome.status, 'interrupted');
  assert.equal(after.pendingTask, null, '예약은 해제된다');
  assert.equal(after.graph.opportunities[0].usesRemaining, 1, '기회는 소모되지 않는다');
  assert.equal(after.pendingFarmChoice, null, '후보도 서지 않는다');
  assert.equal(after.keyDiscovered, false);
  assert.equal(keyGranted, false);
  assert.equal(after.noiseEvents.length, run.noiseEvents.length, '완료하지 않은 작업은 소리도 내지 않는다');
});

// 무시 목록은 영구 면제가 아니다 — 작업 시작 시 같은 노드에 서 있던 위협이라도, 자리를
// 떴다가 되돌아오면 그것은 새 접촉이다. 그러지 않으면 위협이 왕복하는 동안 긴 작업이
// 무한히 안전해진다.
test('작업 시작 때 같은 노드에 있던 위협도 떠났다 돌아오면 작업을 중단시킨다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const away = neighborsOf(base, nodeId)[0];
  const template = Object.values(createRunState(base.graph, 1).threats)[0];
  const opportunity = { id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'resource' };

  // 순찰 경로 [옆 노드, 현재 노드] — 6칸째에 옆으로 나갔다가 순찰 주기(5칸) 뒤인 11칸째에
  // 돌아온다. 작업은 13칸짜리라 완료 전에 재접촉이 일어난다.
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [opportunity] },
    threats: {
      [template.id]: {
        ...template,
        nodeId,
        mode: 'patrol',
        alert: 0,
        pursuitStrength: 0,
        lastKnownPlayerNodeId: null,
        target: null,
        patrolRoute: [away, nodeId],
        patrolIndex: 0,
        nextMoveAt: base.time + 1,
      },
    },
  };
  assert.equal(PRIZE_FARM_TIME.elite, 13, '이 검증은 13칸짜리 작업을 전제한다');
  assert.equal(THREAT_MOVE_INTERVAL.patrol, 5, '이 검증은 순찰 주기 5칸을 전제한다');

  const { state: after } = useOpportunity(run, 'p1', 'normal');
  assert.equal(after.lastTaskOutcome.status, 'interrupted', '되돌아온 위협은 새 접촉이다');
  assert.equal(after.lastTaskOutcome.reason, 'threatContact');
  assert.equal(after.time - run.time, 11, '되돌아온 칸까지만 소모한다');
  assert.equal(after.graph.opportunities[0].usesRemaining, 1, '기회는 소모되지 않는다');
});

test('중단된 작업은 경계도·쿨다운·개방을 하나도 남기지 않는다', () => {
  // 구역 추첨(ADR-0081)으로 어느 시드가 시작 노드에 전자식 차단 엣지를 두는지가 달라지므로,
  // 고정 시드 대신 그런 시드를 찾아 쓴다.
  let base = null;
  let blocked = null;
  for (let seed = 0; seed < 200 && !blocked; seed++) {
    const candidate = quietRun(seed);
    const edge = candidate.graph.edges.find((e) => e.features.includes('blocked') && e.features.includes('electronic')
      && (e.from === candidate.playerNodeId || e.to === candidate.playerNodeId));
    if (edge) { base = candidate; blocked = edge; }
  }
  assert.ok(blocked, '시작 노드에 전자식 차단 엣지를 두는 시드가 있어야 한다');
  const run = withIncomingThreat(base, 1);

  const after = openSpecialEdge(run, blocked.id, 'hacking', 0, 'normal');
  assert.equal(after.lastTaskOutcome.status, 'interrupted');
  assert.equal(after.openedEdgeIds.length, 0, '문은 열리지 않는다');
  assert.deepEqual(after.sectorAlerts, run.sectorAlerts, '경계도 대가도 청구되지 않는다');
  assert.equal(after.pendingHpLoss || 0, 0);
});

test('탈출 요청이 중단되면 신호와 요청이 함께 취소된다', () => {
  const base = quietRun(9);
  const run = withIncomingThreat(base, 1);
  const after = requestExtraction(run, 'A', 0);
  assert.equal(after.lastTaskOutcome.status, 'interrupted');
  assert.equal(after.exits.A.status, 'closed');
  assert.equal(after.exits.A.signalStartedAt, null);
  assert.equal(after.exits.A.requestId, null);
});

// ---- 2. 완료 시각 C부터 사는 효과와 쿨다운 ----

test('가짜 목표의 부족 단계(지속 8칸)는 완료 시각 C부터 8칸을 산다', () => {
  const base = quietRun(7);
  const entry = base.graph.accessInterfaces[0];
  const sectorId = entry.nodeId.split('_')[0];
  const targetSectorId = adjacentSectorIds(base.graph, sectorId)[0];
  const raised = {
    ...base,
    playerNodeId: entry.nodeId,
    sectorAlerts: {
      ...base.sectorAlerts,
      [sectorId]: { level: 2, resolvedEventIds: [] },
      [targetSectorId]: { level: 0, resolvedEventIds: [] },
    },
  };

  const duration = FALSE_BROADCAST_DURATION_BY_STEP.strained;
  assert.equal(duration, 8);
  const after = broadcastFalseTarget(raised, 0, targetSectorId); // Deception 0 = 무리(strained)
  const completedAt = after.time;
  assert.equal(completedAt, raised.time + FALSE_BROADCAST_TIME + 2, '무리 단계는 시간 +2칸이다');

  const planted = after.falseTargets.at(-1);
  assert.equal(planted.createdAt, completedAt, '미끼는 완료 시각에 심긴다');
  assert.equal(planted.expiresAt, completedAt + duration);
  assert.ok(advanceTime(after, completedAt + duration - 1).falseTargets.length > 0, 'C+D-1까지는 유효하다');
  assert.equal(advanceTime(after, completedAt + duration).falseTargets.length, 0, 'C+D에는 이미 만료다');
});

// ---- 3. 시작 효과와 완료 효과의 구분 ----

test('작업 소음은 완료 시각에 나고, 탈출 요청 신호는 시작 시각에 난다', () => {
  const base = quietRun(7);
  const entry = base.graph.accessInterfaces[0];
  const atInterface = { ...base, playerNodeId: entry.nodeId };

  const cut = cutPower(atInterface, 1);
  assert.equal(cut.time, atInterface.time + POWER_CUT_TIME);
  const noise = cut.noiseEvents.at(-1);
  assert.equal(noise.createdAt, cut.time, '소음은 시작이 아니라 완료 시각에 난다');

  const requested = requestExtraction(quietRun(9), 'A', 0);
  assert.equal(requested.exits.A.signalStartedAt, 0, '요청 신호는 시작 효과다');
  assert.equal(requested.time, EXIT_REQUEST_TIME);
});

// ---- 4. 정찰은 완료 시점의 상태를 본다 ----

test('기본 정찰은 완료 시점의 적 위치를 관측한다 — 시작 때의 위치를 완료 정보로 위장하지 않는다', () => {
  const base = quietRun(11);
  const playerNodeId = base.playerNodeId;
  const watched = neighborsOf(base, playerNodeId)[0];
  const away = neighborsOf(base, watched).find((n) => n !== playerNodeId && !neighborsOf(base, playerNodeId).includes(n));
  assert.ok(away, '정찰 범위 밖으로 걸어 나갈 자리가 필요하다');

  const template = Object.values(createRunState(base.graph, 11).threats)[0];
  const run = {
    ...base,
    threats: {
      [template.id]: {
        ...template,
        nodeId: watched,
        mode: 'patrol',
        alert: 0,
        pursuitStrength: 0,
        lastKnownPlayerNodeId: null,
        patrolRoute: [watched, away],
        patrolIndex: 0,
        nextMoveAt: 2,
      },
    },
  };
  assert.ok(BASIC_RECON_TIME > 2, '정찰이 끝나기 전에 위협이 한 번 움직여야 한다');

  const after = basicRecon(run);
  assert.equal(after.time, run.time + BASIC_RECON_TIME);
  assert.equal(after.threats[template.id].nodeId, away, '정찰 도중 옆방을 떠났다');
  assert.equal(after.observations[watched].observedAt, after.time);
  assert.equal(after.observations[watched].hasThreat, false, '완료 시점에는 비어 있다');
});

// ---- 5. 대기 ----

test('대기 5칸은 아무 일도 없으면 5칸을 흘리고, 새 조우가 나면 그 자리에서 멈춘다', () => {
  const quiet = gameReducer(snapshotOf(quietRun(4)), { type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS });
  assert.equal(quiet.facilityRunState.time, WAIT_BATCH_MAX_TICKS);
  assert.equal(quiet.playerState.hp, 50, '대기는 HP를 회복시키지 않는다');

  const interrupted = gameReducer(snapshotOf(withIncomingThreat(quietRun(4), 2)), { type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS });
  assert.equal(interrupted.facilityRunState.time, 2, '새 조우가 열린 칸에서 멈춘다');
  assert.ok(interrupted.facilityRunState.encounter);

  // 1칸 대기는 항상 딱 1칸이다.
  assert.equal(gameReducer(snapshotOf(quietRun(4)), { type: 'WAIT' }).facilityRunState.time, 1);
});

test('대기 5칸은 출구가 열리거나 닫히면 그 칸에서 멈춘다', () => {
  const base = quietRun(4);
  const run = {
    ...base,
    exits: { ...base.exits, A: { ...base.exits.A, status: 'opening', interactionEndsAt: 0, opensAt: 2, requestId: 'r', signalStartedAt: 0 } },
  };
  const after = gameReducer(snapshotOf(run), { type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS });
  assert.equal(after.facilityRunState.time, 2);
  assert.equal(after.facilityRunState.exits.A.status, 'open');
});

test('waitOneTick 다섯 번은 한 번의 5칸 대기와 같다', () => {
  const base = quietRun(6);
  let stepwise = base;
  for (let i = 0; i < 5; i++) stepwise = waitOneTick(stepwise);
  assert.equal(stepwise.time, 5);
  assert.deepEqual(advanceTime(base, 5).threats, stepwise.threats);
});

// ---- 6. 조우 회피 ----

test('조우 회피는 1칸을 쓰고 추적을 끊으며, 같은 위협의 재판정은 다음 유료 행동 끝으로 미룬다', () => {
  const base = quietRun(4);
  const template = Object.values(createRunState(base.graph, 4).threats)[0];
  const threat = {
    ...template,
    nodeId: base.playerNodeId,
    mode: 'pursuit',
    alert: 3,
    pursuitStrength: 3,
    lastKnownPlayerNodeId: base.playerNodeId,
    target: { kind: 'player', nodeId: base.playerNodeId },
    nextMoveAt: 500,
  };
  const run = {
    ...base,
    threats: { [threat.id]: threat },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'even', graceUsed: false },
  };

  const evaded = evadeThreat(run, threat.id);
  assert.equal(evaded.time - run.time, ENCOUNTER_EVADE_TIME);
  assert.equal(evaded.threats[threat.id].mode, 'patrol');
  assert.equal(evaded.threats[threat.id].pursuitStrength, 0);
  assert.equal(evaded.encounter, null);
  assert.equal(evaded.combatTrigger, null, '회피 처리 자체로 같은 위협의 조우를 다시 열지 않는다');

  // 다음 유료 행동이 끝날 때 비로소 다시 판정된다 — 위협은 여전히 그 노드에 서 있다.
  const afterRecon = gameReducer(snapshotOf(evaded), { type: 'BASIC_RECON' });
  assert.ok(afterRecon.facilityRunState.encounter, '다음 유료 행동 종료 때 재판정한다');
  assert.equal(afterRecon.facilityRunState.encounter.threatId, threat.id);
});

// ---- 7. 무료 조작 ----

test('무료 조작은 0칸이다 — 인벤토리 정리·아이템 버리기·조우 무시', () => {
  const base = quietRun(4);
  const template = Object.values(createRunState(base.graph, 4).threats)[0];
  const items = [{ id: 'junk-1', kind: 'junk', value: 3 }];
  const s = snapshotOf(base, { inventory: { items, ammo: 0, capacity: 12 } });

  const discarded = gameReducer(s, { type: 'DISCARD_ITEM', itemId: 'junk-1' });
  assert.equal(discarded.playerState.inventory.items.length, 0);
  assert.equal(discarded.facilityRunState.time, base.time, '버리기는 0칸이다');

  const encountered = snapshotOf({
    ...base,
    threats: { [template.id]: { ...template, nodeId: base.playerNodeId, nextMoveAt: 500 } },
    encounter: { threatId: template.id, nodeId: base.playerNodeId, tier: 'advantage', graceUsed: false },
  });
  const ignored = gameReducer(encountered, { type: 'ENCOUNTER_IGNORE' });
  assert.equal(ignored.facilityRunState.time, base.time, '조우 무시도 0칸이다');
  assert.equal(ignored.facilityRunState.encounter, null);
});

// 「무료 조작」 목록에 '전투 진입 선택'이 들어 있었지만 사실이 아니다 — 우위 조우의 기습
// 진입만 0칸이고, 열세에서 밀려난 강제 전투 진입은 적 선공 구간을 칸으로 청구한다.
test('강제 전투 진입은 무료가 아니다 — 적 선공 구간 3칸을 청구한다', () => {
  const base = quietRun(4);
  const template = Object.values(createRunState(base.graph, 4).threats)[0];
  const threat = { ...template, nodeId: base.playerNodeId, nextMoveAt: 10000 };

  const forced = snapshotOf({
    ...base,
    threats: { [threat.id]: threat },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'forced', graceUsed: true },
  });
  const fought = gameReducer(forced, { type: 'ENCOUNTER_FIGHT' });
  assert.equal(fought.currentScreen, 'combat');
  assert.equal(
    fought.facilityRunState.time, base.time + COMBAT_ENEMY_AMBUSH_TIME_COST,
    '강제 전투 진입은 적 선공 구간 3칸을 청구한다',
  );

  // 대조군: 우위 조우의 기습 진입은 진짜 0칸이다(스턴은 시간을 줄이지도 늘리지도 않는다).
  const advantage = snapshotOf({
    ...base,
    threats: { [threat.id]: threat },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'advantage', graceUsed: false },
  });
  const ambushed = gameReducer(advantage, { type: 'ENCOUNTER_AMBUSH' });
  assert.equal(ambushed.currentScreen, 'combat');
  assert.equal(ambushed.facilityRunState.time, base.time, '우위 기습 진입은 0칸이다');
});

test('시간이 드는 교체는 무료 조작으로 우회할 수 없다 — 버리기는 장착 슬롯에 닿지 못한다', () => {
  const base = quietRun(4);
  const equipped = { id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 10 };
  const s = snapshotOf(base, { loadout: { consumableSlots: [], weapons: [equipped] } });
  const after = gameReducer(s, { type: 'DISCARD_ITEM', itemId: 'w1' });
  assert.equal(after, s, '장착 중인 장비는 버리기로 빠지지 않는다 — 해제(3칸)를 거쳐야 한다');
});

// ---- 예고 = 청구 (중단이 없을 때) ----

test('중단이 없으면 파밍이 실제로 청구한 칸과 낸 소음은 표의 값 그대로다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 2, grade: 'prize', tier: 'elite', axis: 'combat' }] },
  };
  const { state: after } = useOpportunity(run, 'p1', 'normal');
  assert.equal(after.time - run.time, PRIZE_FARM_TIME.elite);
  assert.equal(after.noiseEvents.at(-1).intensity, PRIZE_FARM_NOISE.elite);
  assert.equal(after.graph.opportunities[0].usesRemaining, 1);
  assert.ok(after.pendingFarmChoice);
  assert.equal(THREAT_MOVE_INTERVAL.patrol > 0, true);
});

// ---- 같은 칸에 겹친 완료·도착·탈출 ----

test('열린 출구 위에서는 같은 칸에 적이 도착해도 탈출이 먼저 성립한다', () => {
  const base = quietRun(7); // 위협이 플레이어와 같은 칸에 도착하는 시드.
  const nodeId = base.playerNodeId;
  const exitNodeId = neighborsOf(base, nodeId)[0];
  const run = {
    ...withIncomingThreat(base, 1),
    exits: { ...base.exits, A: { ...base.exits.A, nodeId: exitNodeId, status: 'open', openEndsAt: 1000 } },
  };
  // 위협은 이동 목표가 플레이어라 플레이어를 따라 출구 노드로 들어온다.
  const after = gameReducer(snapshotOf(run), { type: 'MOVE_TO_NODE', nodeId: exitNodeId });
  assert.ok(after.facilityRunState.combatTrigger || after.facilityRunState.threats[Object.keys(run.threats)[0]].nodeId === exitNodeId,
    '같은 칸에 적이 도착한 상황이어야 이 검증이 의미를 갖는다');
  assert.equal(after.currentScreen, 'extractionComplete', '문턱을 넘은 뒤에 붙잡히지는 않는다');
});
