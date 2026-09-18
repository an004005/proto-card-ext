// 맵 UI의 시간 표시 계약(docs/extraction-map-implementation-spec.md「시간과 위협」의 UI 표시 규칙).
//
// 여기서 보는 것은 픽셀이 아니라 두 가지다:
//   1. 예고 = 청구 — 버튼이 보여주는 칸과 엔진이 실제로 흘린 칸이 모든 유료 행동에서 같은가.
//   2. 화면이 옛 단위(포인트 시절의 세 자리 숫자)로 거짓말하지 않고, 상태가 비어 있든 차 있든
//      throw 없이 그려지는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import {
  createRunState, basicRecon, waitOneTick, evadeThreat, useConcealment, disposeCorpse,
  requestExtraction, openSpecialEdge, hackAccessInterface, hackCamera, destroyCamera,
  disableGenerator, hackControlRoom, acquireContractGoods, destroyContractTarget, detonateContractCharge,
  acquireContractIntel, transmitContractIntel, useOpportunity, useFieldEquipment,
  moveToAdjacentNode, scheduleTask,
} from '../src/engine/runEngine.js';
import { cleanTraces, cutPower, broadcastFalseTarget } from '../src/engine/recovery.js';
import { forecastAction, describeForecast, actionTimeCost, forecastUnknownPrizeFarm } from '../src/engine/actionCosts.js';
import {
  runCountdowns, upcomingEvents, timersEndingBefore, interruptionNotice, waitBatchNotice,
  observableThreatMoves, staleThreatSightings, threatMovesDuring, describeNodeLocation,
  TIMELINE_HORIZON,
} from '../src/engine/mapTimeline.js';
import { MAP_EQUIPMENT_CAPABILITIES } from '../src/data/facilityEquipmentCapabilities.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { RUN_COLLAPSE_TIME, CONTRACT_DETONATE_MIN_HOPS, BASIC_RECON_TIME } from '../src/data/facilityLayout.js';
import { adjacentSectorIds } from '../src/engine/facilityGraph.js';
import { bfsHopDistances } from '../src/engine/graphUtils.js';
import { finishTask } from './helpers/finishTask.js';

/** 목표부에서 그 노드까지의 홉수 — 기폭 지점 고르기용. */
function detonationHops(run, contractDef, nodeId) {
  const objective = run.graph.landmarks.find((l) => l.sectorId === contractDef.sectorId);
  return bfsHopDistances(run.graph.edges, objective.nodeId).get(nodeId);
}

/** 위협이 없는 런 — 중단 없이 "청구된 칸"만 재려면 아무도 걸어 들어오지 않아야 한다. */
function quietRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return { ...createRunState(graph, seed), threats: {} };
}

const charged = (before, after) => after.time - before.time;

// ---- 1. 예고 = 청구 ----

test('모든 유료 행동에서 UI 예고 칸과 엔진이 실제로 청구한 칸이 같다', () => {
  const base = quietRun(7);
  const nodeId = base.playerNodeId;
  const sectorId = nodeId.split('_')[0];

  /** @type {{name: string, actionId: string, opts?: object, run?: object, act: (run: any) => any}[]} */
  const cases = [];

  // 이동 — 접근 모드가 없는 대신 Mobility 전용 가감이 붙는 유일한 행동.
  for (const mobility of [-2, 0, 2, 4]) {
    const neighborEdge = base.graph.edges.find((e) => e.from === nodeId || e.to === nodeId);
    const destination = neighborEdge.from === nodeId ? neighborEdge.to : neighborEdge.from;
    cases.push({
      name: `이동 M=${mobility}`,
      actionId: 'move',
      opts: { edge: neighborEdge, value: mobility },
      act: (run) => moveToAdjacentNode(run, destination, mobility, 4),
    });
  }

  // 고정 비용 행동.
  cases.push({ name: '기본 정찰', actionId: 'recon', act: (run) => finishTask(basicRecon(run)) });
  cases.push({ name: '대기', actionId: 'wait', act: (run) => waitOneTick(run) });
  cases.push({
    name: '조우 회피',
    actionId: 'evade',
    run: { ...base, threats: createRunState(base.graph, 7).threats },
    act: (run) => evadeThreat(run, Object.keys(run.threats)[0]),
  });
  cases.push({
    name: '은엄폐',
    actionId: 'concealment',
    run: { ...base, graph: { ...base.graph, concealmentByNodeId: { ...base.graph.concealmentByNodeId, [nodeId]: 2 } } },
    act: (run) => finishTask(useConcealment(run)),
  });
  cases.push({
    name: '시체 처리',
    actionId: 'corpse',
    run: { ...base, corpses: [{ id: 'c1', nodeId, sectorId }] },
    act: (run) => finishTask(disposeCorpse(run)),
  });
  cases.push({ name: '탈출구 가동', actionId: 'exitActivate', opts: { value: 1 }, act: (run) => finishTask(requestExtraction(run, 'A', 1)) });
  cases.push({ name: '장비 교체', actionId: 'equipSwap', act: (run) => finishTask(scheduleTask(run, { kind: 'equipSwap', timeCost: actionTimeCost('equipSwap') })) });
  cases.push({ name: '소모품 사용', actionId: 'mapConsumable', act: (run) => finishTask(scheduleTask(run, { kind: 'mapConsumable', timeCost: actionTimeCost('mapConsumable') })) });

  // 파밍 — 등급 × 접근 3모드.
  for (const [isPrize, tier] of [[false, 'normal'], [true, 'normal'], [true, 'elite']]) {
    for (const mode of ['safe', 'normal', 'rush']) {
      cases.push({
        name: `파밍 ${isPrize ? tier : '보급품'}/${mode}`,
        actionId: 'farm',
        opts: { isPrize, tier, mode },
        run: {
          ...base,
          graph: { ...base.graph, opportunities: [{ id: 'o1', nodeId, keyEligible: false, usesRemaining: 2, grade: isPrize ? 'prize' : 'supply', tier, axis: 'resource' }] },
        },
        act: (run) => finishTask(useOpportunity(run, 'o1', mode).state),
      });
    }
  }

  // 현장 장비.
  const barrier = MAP_EQUIPMENT_CAPABILITIES.module_forcefield.fieldAction;
  const someEdge = base.graph.edges.find((e) => e.from === nodeId || e.to === nodeId);
  cases.push({
    name: '현장 장비',
    actionId: 'fieldEquipment',
    opts: { contract: barrier },
    act: (run) => finishTask(useFieldEquipment(run, 'ff1', barrier, someEdge.id)),
  });

  // 특수 엣지 — 층계 × 접근이 함께 걸리는 유일한 자리. 구역 추첨(ADR-0081) 때문에 어느
  // 시드가 시작 노드에 잠긴 엣지를 두는지는 고정이 아니라, 찾아서 쓴다.
  let edgeRun = null;
  let blocked = null;
  for (let seed = 0; seed < 200 && !blocked; seed++) {
    const candidate = quietRun(seed);
    const edge = candidate.graph.edges.find((e) => e.features.includes('blocked')
      && (e.from === candidate.playerNodeId || e.to === candidate.playerNodeId));
    if (edge) { edgeRun = candidate; blocked = edge; }
  }
  assert.ok(blocked, '층계 × 접근을 볼 특수 엣지가 있는 시드여야 한다');
  for (const mode of ['safe', 'normal', 'rush']) {
    for (const force of [-1, 0, 1, 3]) {
      cases.push({
        name: `특수 엣지 ${mode}/F=${force}`,
        actionId: 'openEdge',
        opts: { value: force, capabilityKind: 'force', edge: blocked, mode },
        run: edgeRun,
        act: (run) => finishTask(openSpecialEdge(run, blocked.id, 'force', force, mode)),
      });
    }
  }

  // 해킹·파괴 계열 — 층계 네 단계를 전부 밟는다.
  const interfaceEntry = base.graph.accessInterfaces[0];
  const atInterface = { ...base, playerNodeId: interfaceEntry.nodeId };
  const camera = base.graph.cameras[0];
  const atCamera = { ...base, playerNodeId: camera.nodeId };
  const generator = (base.graph.generators || [])[0];
  const landmark = base.graph.landmarks[0];
  const atLandmark = { ...base, playerNodeId: landmark.nodeId };
  for (const value of [0, 1, 2, 4]) {
    cases.push({ name: `인터페이스 해킹 H=${value}`, actionId: 'hackInterface', opts: { value }, run: atInterface, act: (run) => finishTask(hackAccessInterface(run, interfaceEntry.id, value)) });
    cases.push({ name: `카메라 해킹 H=${value}`, actionId: 'hackCamera', opts: { value }, run: atCamera, act: (run) => finishTask(hackCamera(run, camera.id, value)) });
    cases.push({ name: `카메라 파괴 F=${value}`, actionId: 'destroyCamera', opts: { value }, run: atCamera, act: (run) => finishTask(destroyCamera(run, camera.id, value)) });
    cases.push({ name: `통제실 H=${value}`, actionId: 'controlRoom', opts: { value }, run: atLandmark, act: (run) => finishTask(hackControlRoom(run, value)) });
    if (generator) {
      const atGenerator = { ...base, playerNodeId: generator.nodeId };
      cases.push({ name: `발전기 해킹 H=${value}`, actionId: 'disableGeneratorHack', opts: { value }, run: atGenerator, act: (run) => finishTask(disableGenerator(run, generator.id, 'hacking', value)) });
      cases.push({ name: `발전기 파괴 F=${value}`, actionId: 'disableGeneratorForce', opts: { value }, run: atGenerator, act: (run) => finishTask(disableGenerator(run, generator.id, 'force', value)) });
    }
    // 수습 수단.
    cases.push({
      name: `흔적 정리 P=${value}`,
      actionId: 'cleanTraces',
      opts: { value },
      run: { ...base, evidence: [{ id: 'e1', nodeId, tier: 1, createdBySectorId: sectorId }] },
      act: (run) => finishTask(cleanTraces(run, value)),
    });
    cases.push({ name: `전원 차단 F=${value}`, actionId: 'cutPower', opts: { value }, run: atInterface, act: (run) => finishTask(cutPower(run, value)) });
    const interfaceSectorId = interfaceEntry.nodeId.split('_')[0];
    const targetSectorId = adjacentSectorIds(atInterface.graph, interfaceSectorId)[0];
    cases.push({
      name: `가짜 목표 D=${value}`,
      actionId: 'falseBroadcast',
      opts: { value },
      run: {
        ...atInterface,
        sectorAlerts: {
          ...atInterface.sectorAlerts,
          [interfaceSectorId]: { ...atInterface.sectorAlerts[interfaceSectorId], level: 2 },
          [targetSectorId]: { ...atInterface.sectorAlerts[targetSectorId], level: 0 },
        },
      },
      act: (run) => finishTask(broadcastFalseTarget(run, value, targetSectorId)),
    });
  }

  // 계약 — 세 종류 모두, 층계 여러 수치로.
  for (const value of [0, 1, 3]) {
    // 구역이 런마다 뽑히므로(ADR-0081) 이 런에 목표부 구역이 있는 계약만 고를 수 있다.
    const inRun = (type) => CONTRACT_DEFS.find((c) => c.type === type && base.graph.sectorIds.includes(c.sectorId));
    const retrieval = inRun('retrieval');
    const destroy = inRun('destroy');
    const intel = inRun('intel');
    assert.ok(retrieval && destroy && intel, '픽스처 시드는 세 유형의 계약을 다 담는 구역 조합이어야 한다');
    const contractRun = (def) => {
      const objective = base.graph.landmarks.find((l) => l.sectorId === def.sectorId);
      return { ...base, playerNodeId: objective.nodeId, contract: { ...def, status: 'accepted' } };
    };
    cases.push({ name: `회수 확보 S/M=${value}`, actionId: 'contractRetrieve', opts: { value, capabilityKind: 'stealth' }, run: contractRun(retrieval), act: (run) => finishTask(acquireContractGoods(run, value, value - 1)) });
    cases.push({ name: `파괴 F=${value}`, actionId: 'contractDestroy', opts: { value }, run: contractRun(destroy), act: (run) => finishTask(destroyContractTarget(run, value)) });
    cases.push({ name: `정보 확보 H=${value}`, actionId: 'contractIntel', opts: { value }, run: contractRun(intel), act: (run) => finishTask(acquireContractIntel(run, value)) });
    // C5: 송출은 목표부가 아닌 **다른 구역** 랜드마크에서만 된다.
    const acquired = contractRun(intel);
    // 송출은 목표부 구역의 **링 이웃** 랜드마크에서만 된다(C5).
    const transmitSectorIds = adjacentSectorIds(base.graph, intel.sectorId);
    const otherLandmark = base.graph.landmarks.find((l) => transmitSectorIds.includes(l.sectorId));
    cases.push({
      name: `정보 송출 H=${value}`,
      actionId: 'contractTransmit',
      opts: { value },
      run: { ...acquired, playerNodeId: otherLandmark.nodeId, contract: { ...acquired.contract, status: 'acquired' } },
      act: (run) => finishTask(transmitContractIntel(run, value)),
    });
    // C5: 파괴 계약의 기폭 — 설치한 뒤 목표부에서 2홉 이상 떨어진 자리에서.
    const planted = contractRun(destroy);
    const farNode = base.graph.nodes.find((n) => {
      const hops = detonationHops(base, destroy, n.id);
      return hops !== undefined && hops >= CONTRACT_DETONATE_MIN_HOPS;
    });
    cases.push({
      name: '파괴 기폭',
      actionId: 'contractDetonate',
      opts: {},
      run: { ...planted, playerNodeId: farNode.id, contract: { ...planted.contract, status: 'acquired' } },
      act: (run) => finishTask(detonateContractCharge(run)),
    });
  }

  let checked = 0;
  for (const testCase of cases) {
    const run = testCase.run || base;
    const forecast = forecastAction(testCase.actionId, testCase.opts || {});
    if (forecast.blocked) {
      // 불가 예고는 "시도조차 안 된다"는 뜻이고, 엔진도 같은 판정으로 던져야 한다.
      assert.throws(() => testCase.act(run), undefined, `${testCase.name}: 불가 예고인데 엔진이 받아들였다`);
      checked += 1;
      continue;
    }
    const after = testCase.act(run);
    assert.equal(charged(run, after), forecast.timeCost, `${testCase.name}: 예고 ${forecast.timeCost}칸 ≠ 청구 ${charged(run, after)}칸`);
    checked += 1;
  }
  assert.ok(checked > 60, `검사한 행동이 너무 적다 (${checked})`);
});

test('등급을 모르는 확보 대상만 범위로 예고하고, 실제 청구는 그 범위 안의 정확한 값이다', () => {
  // 예고 = 청구의 유일한 완화 지점이다. 확보 대상 파밍 비용은 등급이 가르는데 등급은 정찰해야
  // 보이므로, 정찰 전에는 하나의 값을 약속할 수 없다. 대신 두 등급을 모두 감싸는 범위를 적고,
  // 실제 청구는 언제나 그 안에 있다. 다른 행동은 그대로 정확 예고다.
  const base = quietRun(7);
  const nodeId = base.playerNodeId;
  for (const mode of ['safe', 'normal', 'rush']) {
    const range = forecastUnknownPrizeFarm(mode);
    assert.ok(range.minTime <= range.maxTime);
    for (const tier of ['normal', 'elite']) {
      const run = {
        ...base,
        graph: { ...base.graph, opportunities: [{ id: 'o1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier, axis: 'resource' }] },
      };
      const after = finishTask(useOpportunity(run, 'o1', mode).state);
      const actual = charged(run, after);
      assert.equal(actual, forecastAction('farm', { isPrize: true, tier, mode }).timeCost, `${mode}/${tier}: 등급을 알면 예고는 정확해야 한다`);
      assert.ok(actual >= range.minTime && actual <= range.maxTime, `${mode}/${tier}: 청구 ${actual}칸이 범위 예고 ${range.timeText} 밖이다`);
    }
  }
  // 보급품은 등급이 없으므로 범위가 생기지 않는다 — 늘 정확 예고다.
  assert.equal(forecastAction('farm', { isPrize: false, mode: 'normal' }).timeCost, actionTimeCost('farm', { isPrize: false, mode: 'normal' }));
});

test('예고 문장은 최종 칸과 그 분해를 함께 말한다', () => {
  // 분해가 최종값과 어긋나면 플레이어는 둘 중 무엇을 믿어야 할지 알 수 없다.
  assert.equal(describeForecast(forecastAction('recon'), '정찰'), `정찰 ${BASIC_RECON_TIME}칸`);
  const surplus = forecastAction('openEdge', { value: 2, capabilityKind: 'hacking', edge: { requiredCapability: 1 }, mode: 'normal' });
  assert.equal(describeForecast(surplus, '문 해킹'), `문 해킹 ${surplus.timeCost}칸 = 기본 ${surplus.baseTime} − 능력 1`);
  // 이동은 가감이 없으므로 분해가 붙지 않는다 — 언제나 1칸이다(ADR-0084).
  for (const mobility of [-2, 1, 4]) {
    assert.equal(describeForecast(forecastAction('move', { edge: {}, value: mobility }), '이동'), '이동 1칸');
  }
});

test('하한에 잘린 예고는 그 행동의 실제 하한을 말한다', () => {
  // "(최소 1칸)"을 하드코딩하면 행동마다 다른 하한에서 화면이 거짓말을 한다.
  const move = forecastAction('move', { edge: {}, value: 4 });
  assert.equal(move.floor, 1);
  assert.equal(describeForecast(move, '이동'), '이동 1칸');

  const capability = forecastAction('openEdge', { value: 4, capabilityKind: 'hacking', edge: { requiredCapability: 1 }, mode: 'rush' });
  assert.equal(capability.floor, 1);
});

// ---- 2. 타임라인과 카운터 ----

test('상단 카운터는 붕괴와 출구 폐쇄까지 남은 칸을 세고, 폐쇄된 출구는 폐쇄됨으로 말한다', () => {
  const run = quietRun(3);
  const countdowns = runCountdowns(run);
  assert.equal(countdowns.collapseIn, RUN_COLLAPSE_TIME - run.time);
  assert.deepEqual(countdowns.exits.map((e) => e.exitId), ['A']);
  assert.ok(countdowns.exits.every((e) => !e.closed));
  assert.equal(countdowns.exits[0].text, `폐쇄까지 ${countdowns.exits[0].inTicks}칸`);

  // 아직 요청도 안 한 채 폐쇄 시각을 넘겼으면 그 출구는 정말 끝났다.
  const late = { ...run, time: run.exits.A.disabledAt };
  assert.equal(runCountdowns(late).exits[0].closed, true);
  assert.equal(runCountdowns(late).exits[0].inTicks, 0);
  assert.equal(runCountdowns(late).exits[0].text, '폐쇄됨');
});

test('폐쇄 시각을 넘겨도 이미 열린 출구는 폐쇄됨이 아니라 남은 창을 말한다', () => {
  // ADR-0054: 폐쇄 뒤에 금지되는 것은 **새 요청**뿐이다. 진행 중인 대기와 열린 창은 끝까지 간다.
  // 그걸 "폐쇄됨"으로 적으면 아직 4칸을 걸어가면 되는 출구를 플레이어가 포기한다.
  const base = quietRun(3);
  const run = {
    ...base,
    time: 431,
    exits: { ...base.exits, A: { ...base.exits.A, status: 'open', disabledAt: 430, openEndsAt: 435 } },
  };
  const exitA = runCountdowns(run).exits[0];
  assert.equal(exitA.closed, false);
  assert.equal(exitA.text, '열림 4칸 남음');

  const opening = { ...run, exits: { ...run.exits, A: { ...run.exits.A, status: 'opening', openEndsAt: null, opensAt: 437 } } };
  assert.equal(runCountdowns(opening).exits[0].text, '개방까지 6칸');
});

test('타임라인의 영구 폐쇄 줄은 아직 요청 전인 출구만 낸다', () => {
  // 예고 툴팁의 "작업 중 종료"가 이 줄을 읽는다 — 이미 열린 출구에까지 붙이면 아무 일도
  // 일어나지 않는 시각을 마감으로 알리게 된다.
  const base = quietRun(3);
  const closed = { ...base, time: base.exits.A.disabledAt - 5 };
  assert.ok(upcomingEvents(closed).some((e) => e.kind === 'closure' && e.text.includes('출구 A')));

  const opened = {
    ...closed,
    exits: { ...closed.exits, A: { ...closed.exits.A, status: 'open', openEndsAt: closed.time + 4 } },
  };
  const events = upcomingEvents(opened);
  assert.ok(!events.some((e) => e.kind === 'closure' && e.text.includes('출구 A')), '열린 출구에 영구 폐쇄 예고가 붙었다');
  assert.ok(events.some((e) => e.text.includes('출구 A 개방 창 종료')));
});

test('타임라인은 도달할 수 없는 진행 중 작업 줄을 만들지 않는다', () => {
  // 커맨드 사이에는 pendingTask가 항상 null이다(작업은 같은 커맨드 안에서 예약되고 해소된다).
  const base = quietRun(3);
  const run = { ...base, pendingTask: { kind: 'cleanTraces', nodeId: base.playerNodeId, cost: null, params: {}, startedAt: base.time, completesAt: base.time + 5, ignoredThreatIds: [] } };
  assert.ok(!upcomingEvents(run).some((e) => e.text.includes('진행 중인 작업')));
});

test('타임라인은 15칸 밖의 사건을 담지 않고, 알 수 없는 위협을 공개하지 않는다', () => {
  const base = quietRun(3);
  const nodeId = base.playerNodeId;
  const farNodeId = base.graph.nodes.find((n) => n.id !== nodeId
    && !base.graph.edges.some((e) => (e.from === nodeId && e.to === n.id) || (e.to === nodeId && e.from === n.id))).id;
  const template = Object.values(createRunState(base.graph, 3).threats)[0];
  const run = {
    ...base,
    hackedCameras: [{ cameraId: 'cam1', expiresAt: base.time + 5 }],
    powerCuts: [{ sectorId: nodeId.split('_')[0], expiresAt: base.time + TIMELINE_HORIZON + 30 }],
    threats: { [template.id]: { ...template, nodeId: farNodeId, nextMoveAt: base.time + 2 } },
  };
  const events = upcomingEvents(run);
  assert.ok(events.every((e) => e.inTicks > 0 && e.inTicks <= TIMELINE_HORIZON), '15칸 밖 사건이 들어왔다');
  assert.ok(events.some((e) => e.text.includes('카메라 해킹 종료')));
  assert.ok(!events.some((e) => e.text.includes('전원 복구')), '15칸 밖 만료가 들어왔다');
  assert.ok(!events.some((e) => e.kind === 'threat'), '관측하지 못한 위협의 이동이 공개됐다');

  // 같은 위협이 인접 노드에 있으면 관측 대상이 되어 다음 이동이 보인다.
  const adjacentId = base.graph.edges.find((e) => e.from === nodeId || e.to === nodeId);
  const seenNodeId = adjacentId.from === nodeId ? adjacentId.to : adjacentId.from;
  // "다음 이동까지 몇 칸"은 Perception 2 이상의 깊이로 본 노드에서만 읽힌다(정보 깊이 표).
  const watched = {
    ...run,
    threats: { [template.id]: { ...template, nodeId: seenNodeId, nextMoveAt: base.time + 2 } },
    observations: { ...run.observations, [seenNodeId]: { observedAt: base.time, hasThreat: true, detailLevel: 3 } },
  };
  assert.ok(upcomingEvents(watched).some((e) => e.kind === 'threat'));
  assert.deepEqual(observableThreatMoves(watched).map((t) => t.ticksUntilMove), [2]);

  const shallow = { ...watched, observations: { ...run.observations, [seenNodeId]: { observedAt: base.time, hasThreat: true, detailLevel: 1 } } };
  assert.deepEqual(observableThreatMoves(shallow).map((t) => t.ticksUntilMove), [null], '얕게 본 위협의 다음 이동은 알 수 없다');
});

test('작업 중 위협이 몇 번 움직이는지를 예고가 셀 수 있다', () => {
  const base = quietRun(3);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const seenNodeId = edge.from === base.playerNodeId ? edge.to : edge.from;
  const template = Object.values(createRunState(base.graph, 3).threats)[0];
  const run = {
    ...base,
    threats: { [template.id]: { ...template, nodeId: seenNodeId, mode: 'patrol', nextMoveAt: base.time + 3 } },
    // 이동 횟수 예고는 Perception 2의 깊이로 본 위협에만 붙는다(정보 깊이 표).
    observations: { ...base.observations, [seenNodeId]: { observedAt: base.time, hasThreat: true, detailLevel: 3 } },
  };
  // 순찰 간격 5칸, 다음 이동까지 3칸 -> 12칸짜리 작업 중에는 +3·+8칸 두 번.
  const moves = threatMovesDuring(run, 12);
  assert.deepEqual(moves.map((m) => m.offsets), [[3, 8]]);
  assert.equal(moves[0].count, 2);
  assert.deepEqual(threatMovesDuring(run, 2), [], '작업이 다음 이동보다 짧으면 셀 것이 없다');
  assert.deepEqual(threatMovesDuring(base, 20), [], '관측하지 못한 위협은 세지 않는다');
});

test('노드는 id가 아니라 구역과 홉수로 말한다', () => {
  const base = quietRun(3);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const neighbor = edge.from === base.playerNodeId ? edge.to : edge.from;
  assert.ok(describeNodeLocation(base, base.playerNodeId).endsWith('현재 위치'));
  assert.ok(describeNodeLocation(base, neighbor).endsWith('인접 1홉'), describeNodeLocation(base, neighbor));
  assert.ok(!describeNodeLocation(base, neighbor).includes(neighbor), '내부 id가 그대로 노출됐다');
});

test('작업 완료 시각 전에 끝나는 타이머는 예고 툴팁이 집어낸다', () => {
  const base = quietRun(3);
  const run = { ...base, hackedCameras: [{ cameraId: 'cam1', expiresAt: base.time + 3 }] };
  const ending = timersEndingBefore(run, base.time + 8);
  assert.ok(ending.some((e) => e.text.includes('카메라 해킹 종료')));
  assert.equal(timersEndingBefore(run, base.time).length, 0, '완료 시각이 지금이면 볼 것이 없다');
});

test('시야 밖 목격은 N칸 전 관측으로 남는다', () => {
  const base = quietRun(3);
  const farNodeId = base.graph.nodes.find((n) => n.id !== base.playerNodeId
    && !base.graph.edges.some((e) => (e.from === base.playerNodeId && e.to === n.id) || (e.to === base.playerNodeId && e.from === n.id))).id;
  const run = { ...base, time: 40, observations: { [farNodeId]: { observedAt: 31, hasThreat: true } } };
  assert.deepEqual(staleThreatSightings(run), [{ nodeId: farNodeId, ticksAgo: 9 }]);
});

// ---- 3. 중단·대기 안내 ----

test('중단된 작업은 무엇이 몇 칸 만에 왜 끊겼는지 한 줄로 알리고, 파밍은 자기 배너에 맡긴다', () => {
  const base = quietRun(3);
  assert.equal(interruptionNotice(base), null, '중단이 없으면 아무 말도 하지 않는다');
  assert.equal(interruptionNotice(null), null);

  const interrupted = { ...base, time: 13, lastTaskOutcome: { kind: 'cleanTraces', status: 'interrupted', reason: 'threatContact', startedAt: 10, completedAt: 13 } };
  const notice = interruptionNotice(interrupted);
  assert.ok(notice.text.includes('흔적 정리'));
  assert.ok(notice.text.includes('3칸'));
  assert.ok(notice.text.includes('적 접촉'));

  // 배너는 그 칸에만 — 무료 조작을 할 때마다 몇 칸 전의 중단이 다시 읽히면 방금 또 끊긴 것처럼 보인다.
  assert.equal(interruptionNotice({ ...interrupted, time: 14 }), null, '지난 중단의 기록이 다시 읽혔다');

  const collapsed = { ...base, lastTaskOutcome: { kind: 'farm', status: 'interrupted', reason: 'collapsed', startedAt: 10, completedAt: 12 } };
  assert.equal(interruptionNotice(collapsed), null, '파밍은 자기 배너가 이미 있다 — 두 번 말하지 않는다');

  const completed = { ...base, lastTaskOutcome: { kind: 'recon', status: 'completed', reason: null, startedAt: 10, completedAt: 14 } };
  assert.equal(interruptionNotice(completed), null);
});

test('묶음 대기는 모자라게 끝난 그 칸에만 사유를 말한다', () => {
  const base = quietRun(3);
  assert.equal(waitBatchNotice(base), null);
  const stopped = { ...base, time: 12, lastWaitBatch: { requested: 5, elapsed: 2, reason: 'encounter', completedAt: 12 } };
  assert.equal(waitBatchNotice(stopped).text, '2칸 후 중단: 새 조우');
  const full = { ...base, time: 12, lastWaitBatch: { requested: 5, elapsed: 5, reason: null, completedAt: 12 } };
  assert.equal(waitBatchNotice(full), null, '다 흘렀으면 말할 것이 없다');
  const old = { ...base, time: 20, lastWaitBatch: { requested: 5, elapsed: 2, reason: 'encounter', completedAt: 12 } };
  assert.equal(waitBatchNotice(old), null, '지난 대기의 기록은 다시 읽히지 않는다');
});

// ---- 4. 화면에 남은 옛 단위 ----

test('src/components 어디에도 포인트 시절의 시간 문자열이 남아 있지 않다', () => {
  // "시간 100"·"300시간"·"포인트"는 칸으로 옮기기 전의 단위다. 하나라도 남아 있으면 화면이
  // 엔진과 다른 숫자를 말한다.
  const dir = new URL('../src/components/', import.meta.url);
  const offenders = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const [lineNo, line] of source.split('\n').entries()) {
      if (/포인트/.test(line)) offenders.push(`${name}:${lineNo + 1} 포인트`);
      // "시간 120", "시간 +40", "300시간" 같은 표기. 칸 단위 표기(`N칸`)는 걸리지 않는다.
      if (/시간\s*[+-]?\d+(?!\s*칸)/.test(line) || /\d\s*시간/.test(line)) offenders.push(`${name}:${lineNo + 1} ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
