// MapScreen이 실제로 그려지는지 — 상태가 비어 있을 때와 차 있을 때 모두.
//
// 이 화면은 조우·예약 작업·전투 교전 같은 선택적 필드를 잔뜩 읽는다. 그 중 하나가 null일 때
// 터지면 플레이어는 빈 화면을 보게 되므로, 초기 상태와 "전부 채워진" 상태 두 번을 모두 그려 본다.
//
// 컴포넌트는 'preact' 베어 스펙파이어를 index.html의 import map으로 푸므로, Node에서는 로더
// 훅으로 vendor/에 연결한 뒤에야 불러올 수 있다(test/helpers/preactResolve.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import { RUN_COLLAPSE_TIME, BASIC_RECON_TIME } from '../src/data/facilityLayout.js';
import { finishTaskSnapshot } from './helpers/finishTask.js';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { installMiniDom, makeRoot, findByText, queryAll, fire } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { snapshotSignal, historySignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory } = await import(projectUrl('../src/engine/historyEngine.js'));
const { MapScreen } = await import(projectUrl('../src/components/MapScreen.js'));
const { resetMapView } = await import(projectUrl('../src/state/mapViewState.js'));

function snapshotOf(run, loadoutOverride = null) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    activeCombatState: null,
    combatContext: null,
    pendingReward: null,
    combatSummary: null,
    offeredContracts: null,
    activeContract: null,
    playerState: {
      hp: 50, maxHp: 50, overloadActive: false, loadout: { consumableSlots: [], weapons: [], modules: [], implants: [], ...(loadoutOverride || {}) },
      inventory: { items: [], ammo: 0, capacity: 12 }, warehouse: { items: [], ammo: 0, capacity: 99 },
    },
  };
}

/** 화면을 그리고 트리를 돌려준다 — 글자만이 아니라 버튼을 실제로 눌러 볼 수 있어야 한다.
 * dispatch는 historySignal에서 현재 스냅샷을 읽으므로 둘을 함께 세운다. */
function mountMap(run, loadoutOverride = null) {
  const snapshot = snapshotOf(run, loadoutOverride);
  snapshotSignal.value = snapshot;
  historySignal.value = createHistory(snapshot);
  const root = makeRoot();
  render(html`<${MapScreen} />`, root);
  return root;
}

function renderMap(run) {
  return mountMap(run).textContent;
}

test('초기 상태(pendingTask·lastTaskOutcome·engagedThreatId가 전부 null)에서 지도 화면이 그려진다', () => {
  const { graph } = generateFacilityGraph(11);
  const run = createRunState(graph, 11);
  assert.equal(run.pendingTask, null);
  assert.equal(run.lastTaskOutcome, null);

  const text = renderMap(run);
  assert.ok(text.includes('붕괴까지'), '상단 카운터가 보여야 한다');
  assert.ok(text.includes('출구 A 폐쇄'), '가장 이른 마감이 굵게 한 번 보여야 한다');
  assert.ok(text.includes(`시각 ${run.time} / ${RUN_COLLAPSE_TIME}`), 'HUD에 현재 시각이 상시 보여야 한다');
  assert.ok(!text.includes('가장 이른 마감'), '접두어 없이 마감 자체를 적는다');
  assert.ok(!text.includes('폐쇄까지'), '가장 이른 마감으로 적은 출구를 뒤에서 또 세면 안 된다');
  assert.ok(text.includes('앞으로 15칸'), '타임라인 블록이 보여야 한다');
  assert.ok(text.includes(`기본 정찰 · ${BASIC_RECON_TIME}칸`), '예고가 붙은 행동 버튼이 보여야 한다');
});

/** 현재 노드 패널의 접이식 묶음 머리를 눌러 연다/닫는다 — 기본 접힘인 묶음의 내용을 보려면 필요하다. */
function panelGroupHeader(root, title) {
  return queryAll(root, (node) => node.getAttribute && node.getAttribute('role') === 'button' && node.textContent.includes(title))[0] || null;
}

test('유료 버튼은 이름·칸·소음을 같은 순서로 적는다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  // 흔적이 있으면 수습 블록이 열리고, 그 안의 버튼이 같은 라벨 규칙을 따르는지 볼 수 있다.
  const run = {
    ...base,
    evidence: [{ id: 'e1', nodeId: base.playerNodeId, tier: 2, createdBySectorId: base.playerNodeId.split('_')[0] }],
  };
  const root = mountMap(run);
  // 수습은 기본으로 접힌 묶음(수습·장비)에 산다 — 머리를 눌러 펼친 뒤에 라벨을 본다.
  fire(panelGroupHeader(root, '수습·장비'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const text = root.textContent;
  assert.ok(text.includes('흔적 정리(1개) · '), '라벨 규칙이 깨졌다');
  assert.ok(!text.includes('흔적 정리 1개 '), '괄호 없는 옛 라벨이 남아 있다');
});

test('층계가 모자란 통로도 눌리고, 클릭이 엔진까지 간다', () => {
  // 버튼은 "대가를 치르고 열 수 있다"고 예고하는데 클릭 핸들러만 요구치로 거절하면, 화면이
  // 약속한 것을 화면이 스스로 거부한다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const run = {
    ...base,
    graph: {
      ...base.graph,
      edges: base.graph.edges.map((e) => (e.id === edge.id
        ? { ...e, features: ['blocked'], requiredCapability: 2 }
        : e)),
    },
    threats: {},
  };

  const root = mountMap(run);
  const button = findByText(root, 'button', '통로 개방');
  assert.ok(button, '특수 엣지 개방 버튼이 있어야 한다');
  assert.ok(!button.textContent.includes('불가'), 'Force 0 대 요구치 2는 위태(가능)이지 불가가 아니다');
  assert.equal(button.getAttribute('disabled'), null, '위태 단계 버튼이 잠겨 있다');

  assert.equal(fire(button, 'click'), 1, '클릭 핸들러가 붙어 있어야 한다');
  assert.ok(snapshotSignal.value.facilityRunState.time > run.time, '클릭이 엔진까지 가지 않았다');
  // 가동은 1칸이고 나머지는 게이지다(ADR-0084) — 문이 열리는 것은 그 게이지를 다 채운 뒤다.
  assert.equal(snapshotSignal.value.facilityRunState.pendingTask?.kind, 'openEdge', '클릭이 작업을 가동했다');
  const finished = finishTaskSnapshot(snapshotSignal.value);
  assert.ok(finished.facilityRunState.openedEdgeIds.includes(edge.id));
});

test('조우가 막는 동안에는 정찰·대기만이 아니라 이동 버튼도 함께 잠긴다', async () => {
  // 이동만 열려 있으면 플레이어는 "왜 이건 되지?"를 시험해 보게 되고, 실제로는 눌러도 아무
  // 일이 없어 화면이 고장난 것처럼 보인다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const threat = Object.values(base.threats)[0];
  const run = {
    ...base,
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId: base.playerNodeId } },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'even', graceUsed: false },
  };

  const root = mountMap(run);
  assert.ok(root.textContent.includes('조우 중'), '조우 차단 사유가 화면에 있어야 한다');
  assert.equal(findByText(root, 'button', '기본 정찰').getAttribute('disabled'), 'true', '조우 중에는 정찰이 잠겨야 한다');

  // 인접 노드를 눌러 고르면 그 자리에 이동 버튼이 나온다 — 그 버튼도 같이 잠겨 있어야 한다.
  const hits = queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('tabindex') === '-1');
  let moveButton = null;
  for (const hit of hits) {
    fire(hit, 'click');
    await new Promise((resolve) => { setTimeout(resolve, 0); }); // preact의 재렌더는 마이크로태스크 뒤에 온다
    moveButton = findByText(root, 'button', '이 노드로 이동');
    if (moveButton) break;
  }
  assert.ok(moveButton, '인접 노드를 고르면 이동 버튼이 나와야 한다');
  assert.equal(moveButton.getAttribute('disabled'), 'true', '조우 중인데 이동 버튼이 열려 있다');
});

test('열세 조우 패널은 지금 되는 것과 막힌 것을 나란히 적는다', () => {
  // 열세는 버튼이 하나도 없는 안내문이라, 무엇이 아직 되는지를 말해 주지 않으면 플레이어는
  // 아무것도 못 하는 상태로 오해한다. 판정 규칙은 facilityReducer.isBlockedByEncounter다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const threat = Object.values(base.threats)[0];
  const run = {
    ...base,
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId: base.playerNodeId } },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'disadvantage', graceUsed: false },
  };

  const text = renderMap(run);
  assert.ok(text.includes('지금 할 수 있는 것'), '허용·막힘 목록의 제목이 있어야 한다');
  assert.ok(text.includes('유료 행동 1회'), '열세에서 남은 행동권이 적혀 있어야 한다');
  assert.ok(text.includes('허용') && text.includes('막힘'), '두 칸의 라벨이 모두 있어야 한다');
});

test('작업 중단·조우·교전 상태가 모두 채워져 있어도 지도 화면이 그려진다', () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const threat = Object.values(base.threats)[0];
  const run = {
    ...base,
    time: 40,
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId: base.playerNodeId, nextMoveAt: 43 } },
    pendingTask: {
      kind: 'cleanTraces', nodeId: base.playerNodeId, cost: null, params: {},
      startedAt: 36, completesAt: 48, ignoredThreatIds: [],
    },
    lastTaskOutcome: { kind: 'cleanTraces', status: 'interrupted', reason: 'threatContact', startedAt: 36, completedAt: 40 },
    lastWaitBatch: { requested: 5, elapsed: 2, reason: 'encounter', completedAt: 40 },
    engagedThreatId: threat.id,
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier: 'even', graceUsed: false },
    lastCameraDetection: { cameraId: graph.cameras[0].id, nodeId: base.playerNodeId, detectedAt: 34 },
    hackedCameras: [{ cameraId: graph.cameras[0].id, expiresAt: 46 }],
    corpses: [{ id: 'c1', nodeId: base.playerNodeId, sectorId: base.playerNodeId.split('_')[0] }],
    evidence: [{ id: 'e1', nodeId: base.playerNodeId, tier: 2, createdBySectorId: base.playerNodeId.split('_')[0] }],
    // "다음 이동까지 N칸"은 Perception 2의 깊이로 본 노드에서만 읽힌다(정보 깊이 표).
    observations: { ...base.observations, [base.playerNodeId]: { observedAt: 40, hasThreat: true, detailLevel: 3 } },
  };

  const text = renderMap(run);
  assert.ok(text.includes('중단'), '중단 배너가 보여야 한다');
  assert.ok(text.includes('6칸 전'), '카메라 발각 표기는 칸 단위여야 한다');
  assert.ok(text.includes('다음 이동까지 3칸'), '관측 중인 위협의 다음 이동이 보여야 한다');
  assert.ok(!/[a-z]+_[0-9a-z]{2,}/.test(text.replace(/[A-Za-z]+_[0-9a-z]*칸/g, '')), '노드 id가 화면에 그대로 노출됐다');
});

test('고지대 통로는 잠긴 길이 아니라 "부족분만큼 HP"로 예고된다', async () => {
  // 예전에는 "Mobility 3 필요"만 적혀 있어서 2인 빌드에게는 없는 길로 보였다. 층계 이후로는
  // 넘을 수 있고, 그 값이 누르기 전에 보여야 선택이 된다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const neighbor = edge.from === base.playerNodeId ? edge.to : edge.from;
  const run = {
    ...base,
    graph: { ...base.graph, edges: base.graph.edges.map((e) => (e.id === edge.id ? { ...e, features: ['highGround'] } : e)) },
    threats: {},
  };

  /** 그 이웃 노드를 골라 선택 패널을 연다 — 이동 예고는 거기에 적힌다. */
  async function selectNeighbor(root) {
    for (const hit of queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('tabindex') === '-1')) {
      fire(hit, 'click');
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      if (findByText(root, 'button', '이 노드로 이동')) return true;
    }
    return false;
  }

  // 기본 로드아웃은 Mobility 0이라 불가다 — 그 사실을 "필요"가 아니라 기준·현재 값으로 적는다.
  const bare = mountMap(run);
  assert.ok(await selectNeighbor(bare), `이웃 ${neighbor}을 고를 수 있어야 한다`);
  assert.ok(bare.textContent.includes('고지대 — Mobility 3 기준'), '고지대 기준이 선택 패널에 적혀야 한다');
  assert.ok(bare.textContent.includes('통과 불가'), 'Mobility 0은 불가 구간이다');
  assert.ok(!bare.textContent.includes('Mobility 3 필요'), '이분 게이트 시절의 문구가 남아 있다');
  assert.equal(findByText(bare, 'button', '이 노드로 이동').getAttribute('disabled'), 'true', '불가 구간에서는 이동이 잠긴다');

  // Mobility 2(무리)면 부족분 1만큼 HP를 치르고 넘는다는 예고가 그 자리에 나오고, 버튼이 열린다.
  const strained = mountMap(run, { modules: [{ id: 'm1', equipmentId: 'module_sandevistan' }] });
  assert.ok(await selectNeighbor(strained));
  assert.ok(strained.textContent.includes('현재 부족분 1: HP −3'), '부족분과 HP 대가가 보여야 한다');
  assert.ok(!strained.textContent.includes('통과 불가'), '넘을 수 있는데 불가라고 적혀 있다');
  assert.equal(findByText(strained, 'button', '이 노드로 이동').getAttribute('disabled'), null, '무리 단계 이동이 잠겨 있다');
});

test('그려진 화면에는 포인트 시절의 세 자리 시간 숫자가 없다', () => {
  // Tooltip이 문자열 설명을 감춘 사본으로도 항상 그리므로, 이 검사는 툴팁 본문까지 훑는다.
  const { graph } = generateFacilityGraph(11);
  const text = renderMap(createRunState(graph, 11));
  assert.ok(text.includes('완료까지'), '툴팁 본문이 검사 범위에 들어와야 한다');
  for (const forbidden of ['시간 100', '시간 120', '시간 130', '시간 150', '시간 180', '시간 200', '300시간', '시간 +40', '시간 -40', '포인트']) {
    assert.ok(!text.includes(forbidden), `옛 단위가 남아 있다: ${forbidden}`);
  }
});

test('인접한 노드를 더블클릭하면 그 자리에서 이동한다', async () => {
  // 선택 → 패널에서 이동 버튼 찾기는 인접 한 칸을 옮기는 데 두 걸음이다. 지도 위에서 바로
  // 끝낼 수 있어야 한다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const run = { ...base, threats: {} };
  const root = mountMap(run);

  const hitOf = (nodeId) => queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('data-node-id') === nodeId)[0];
  const neighbors = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from));

  let moved = null;
  for (const nodeId of neighbors) {
    if (!hitOf(nodeId)) continue;
    fire(hitOf(nodeId), 'click'); // 실제 브라우저처럼 단일 클릭이 먼저 온다(선택)
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    if (fire(hitOf(nodeId), 'dblclick') === 0) continue;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    if (snapshotSignal.value.facilityRunState.playerNodeId === nodeId) { moved = nodeId; break; }
  }
  assert.ok(moved, '지날 수 있는 인접 노드를 더블클릭하면 그리로 옮겨 가야 한다');
  resetMapView();
});

test('지날 수 있는 인접 노드의 호버 카드는 더블클릭 이동을 안내한다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const root = mountMap({ ...base, threats: {} });
  const run = snapshotSignal.value.facilityRunState;
  const neighbor = run.graph.edges
    .filter((e) => e.from === run.playerNodeId || e.to === run.playerNodeId)
    .map((e) => (e.from === run.playerNodeId ? e.to : e.from))
    .find((id) => queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('data-node-id') === id)[0]);
  const hit = queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('data-node-id') === neighbor)[0];

  fire(hit, 'mouseenter', { clientX: 10, clientY: 10 });
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  assert.ok(root.textContent.includes('더블클릭해 이동'), '인접·통과 가능한 노드에는 더블클릭 안내가 붙어야 한다');
  resetMapView();
});

test('추적 중인 위협은 지도 표식에 !가 붙는다', () => {
  // ▲2만으로는 "저기 둘이 있다"까지만 안다. 그 둘이 나를 쫓는 중인지 순찰 중인지가 이동
  // 결정을 바꾸므로 표식이 그것을 말해야 한다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const neighbor = edge.from === base.playerNodeId ? edge.to : edge.from;
  const threat = Object.values(base.threats)[0];

  const patrolling = renderMap({ ...base, threats: { [threat.id]: { ...threat, nodeId: neighbor, mode: 'patrol' } } });
  assert.ok(patrolling.includes('▲1'), '실시간으로 본 인접 노드에는 그룹 수가 붙는다');
  assert.ok(!patrolling.includes('▲1!'), '순찰 중인데 추적 표식이 붙었다');

  const pursuing = renderMap({ ...base, threats: { [threat.id]: { ...threat, nodeId: neighbor, mode: 'pursuit' } } });
  assert.ok(pursuing.includes('▲1!'), '추적 중인 위협은 !로 구분되어야 한다');
});

test('노드 카드는 유형·현장 기회·장치를 각각 한 줄로 적는다', () => {
  // 카드는 문자열 사본을 감춰 두므로(NodeTooltipCard), 호버 없이도 본문을 검사할 수 있다.
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const camera = graph.cameras[0];
  const node = graph.nodes.find((n) => n.id === camera.nodeId);
  const run = {
    ...base,
    threats: {},
    playerNodeId: camera.nodeId,
    visitedNodeIds: [...base.visitedNodeIds, camera.nodeId],
    graph: {
      ...graph,
      opportunities: [
        ...graph.opportunities.filter((o) => o.nodeId !== camera.nodeId),
        { id: 'opp_render_supply', nodeId: camera.nodeId, grade: 'supply', tier: 'normal', axis: null, usesRemaining: 2 },
      ],
    },
  };

  const text = renderMap(run);
  const typeLabels = {
    corridor: '복도', office: '사무·작업실', hall: '대공간', vault: '봉인 격실',
    utility: '설비실', watch: '감시 지점', refuge: '은신처', crawlway: '비인가 통로',
  };
  assert.ok(text.includes(typeLabels[node.type]), '카드 머리에 노드 유형이 있어야 한다');
  assert.ok(text.includes('보급품'), '현장 기회 행이 있어야 한다');
  assert.ok(text.includes('2회 남음'), '남은 횟수가 보여야 한다');
  assert.ok(text.includes('카메라 작동 중'), '장치 칩이 있어야 한다');
});

test('DEBUG 전체보기는 아직 관측하지 않은 노드의 내용물까지 카드에 낸다', async () => {
  const { graph } = generateFacilityGraph(11);
  const run = { ...createRunState(graph, 11), threats: {} };
  const root = mountMap(run);
  assert.ok(!root.textContent.includes('실제 지식: 미확인'), '디버그를 켜기 전에는 안개 밖 노드의 내용이 없어야 한다');

  fire(findByText(root, 'button', 'DEBUG 전체보기'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  // 미확인 노드를 하나 골라 "선택 노드" 카드를 띄운다 — 디버그는 안개와 무관하게 전부 말한다.
  const hits = queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('tabindex') != null);
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    fire(hit, 'click');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    if (root.textContent.includes('실제 지식: 미확인') && /보급품 — \d+회 남음/.test(root.textContent)) break;
  }
  assert.ok(root.textContent.includes('실제 지식: 미확인'), '디버그 카드는 실제 안개 상태를 함께 적어야 한다');
  assert.ok(/보급품 — \d+회 남음/.test(root.textContent), '한 번도 관측하지 않은 노드의 보급품과 남은 횟수까지 나와야 한다');

  // 시그널은 화면 밖에 살아 있으므로 다음 검사로 새지 않도록 되돌린다.
  resetMapView();
});

test('지도 헤더의 과부화 토글은 현재 상태를 적고, 누르면 켜진다', () => {
  const { graph } = generateFacilityGraph(11);
  const root = mountMap(createRunState(graph, 11));
  assert.ok(root.textContent.includes('과부화 OFF'), '꺼진 상태가 헤더에 보여야 한다');

  const toggle = findByText(root, 'button', '과부화 OFF');
  assert.ok(toggle, '토글 버튼이 있어야 한다');
  fire(toggle, 'click');
  assert.equal(snapshotSignal.value.playerState.overloadActive, true);
  assert.equal(snapshotSignal.value.facilityRunState.time, 0, '토글은 시계를 흘리지 않는다');
});

test('노드를 클릭하면 그곳까지의 최단 경로가 지도 위에 그려지고 칸 수가 적힌다', async () => {
  // 출발지에서 2홉 이상 떨어진, 지도에 그려진 노드를 골라 클릭한다. 경로 표시는 지날 수 있는
  // 통로만 세므로 실제로 도달 가능한 노드를 고른다.
  const { graph } = generateFacilityGraph(11);
  const run = createRunState(graph, 11);
  const root = mountMap(run);
  // 2홉 떨어진 노드 중 화면에 히트 영역이 있는 것을 하나 찾아 클릭한다. 클릭마다 재렌더가
  // 일어나 tabindex가 옮겨 다니므로, 붙잡아 둔 요소가 아니라 매번 다시 조회한다.
  const hitOf = (nodeId) => queryAll(root, (node) => node.localName === 'circle' && node.getAttribute('tabindex') != null && node.getAttribute('data-node-id') === nodeId)[0];
  let shown = false;
  for (const node of graph.nodes) {
    const hit = hitOf(node.id);
    if (!hit) continue; // 아직 지도에 없는 노드(비인가 통로)
    fire(hit, 'click');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const summary = queryAll(root, (node) => node.getAttribute && node.getAttribute('class') === 'map-route-summary')[0];
    if (!summary) continue;
    const match = summary.textContent.match(/최단 경로: (\d+)칸/);
    if (!match || Number(match[1]) < 2) continue;
    const routeEdges = queryAll(root, (node) => node.localName === 'path' && node.getAttribute('class') === 'map-route-edge');
    assert.equal(routeEdges.length, Number(match[1]), '경로 칸 수만큼 통로가 강조되어야 한다');
    shown = true;
    break;
  }
  assert.ok(shown, '2칸 이상 떨어진 노드를 골랐을 때 경로 요약과 강조 통로가 있어야 한다');
});

/** 지도 위 통로의 히트 영역(투명한 굵은 path). 통로 카드는 여기에 호버해야 뜬다. */
function edgeHit(root, edgeId) {
  return queryAll(root, (node) => node.localName === 'path' && node.getAttribute('data-edge-id') === edgeId)[0] || null;
}

/** 그 통로 하나만 특별하게 만든 run — 나머지는 전부 평범한 통로로 둔다. */
function withEdge(base, edgeId, patch) {
  return {
    ...base,
    threats: {},
    graph: { ...base.graph, edges: base.graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) },
  };
}

/** 통로 하나에 호버해 카드를 띄운다 — 카드는 문자열 사본을 감춰 두므로 textContent로 읽힌다. */
async function hoverEdge(root, edgeId) {
  const hit = edgeHit(root, edgeId);
  assert.ok(hit, `통로 ${edgeId}의 히트 영역이 있어야 한다`);
  fire(hit, 'mouseenter', { clientX: 100, clientY: 100 });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  return root.textContent;
}

test('평범한 인접 통로에 호버하면 이동 1칸과 양 끝 노드 유형이 카드로 나온다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => (e.from === base.playerNodeId || e.to === base.playerNodeId)
    && e.features.length === 0 && e.bidirectional !== false);
  assert.ok(edge, '평범한 인접 통로가 하나는 있어야 한다');
  const run = { ...base, threats: {} };
  const typeLabels = {
    corridor: '복도', office: '사무·작업실', hall: '대공간', vault: '봉인 격실',
    utility: '설비실', watch: '감시 지점', refuge: '은신처', crawlway: '비인가 통로',
  };
  const root = mountMap(run);
  const text = await hoverEdge(root, edge.id);

  assert.ok(text.includes('이동 1칸'), '인접 통로에는 이동 행이 있어야 한다');
  assert.ok(text.includes('도착 예상'), '도착 위험 예보가 붙어야 한다');
  assert.ok(text.includes('현재 위치'), '내가 선 끝은 구역이 아니라 현재 위치로 적힌다');
  for (const nodeId of [edge.from, edge.to]) {
    const node = run.graph.nodes.find((n) => n.id === nodeId);
    assert.ok(text.includes(typeLabels[node.type]), `끝 노드 유형(${node.type})이 카드에 있어야 한다`);
  }
  assert.ok(text.includes('노드를 더블클릭해 이동'), '지날 수 있는 통로에는 조작 힌트가 붙는다');

  // 통로 카드도 커서가 아니라 통로 가운데에 붙는다 — clientX 100이면 커서 추종은 114px이다.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const card = queryAll(root, (el) => el.style && el.style.position === 'fixed'
    && typeof el.style.left === 'string' && el.style.left.endsWith('px'))[0];
  assert.ok(card, '통로 카드가 화면에 있어야 한다');
  assert.notEqual(card.style.left, '114px', '통로 카드가 커서를 따라가고 있다');
  assert.ok(!card.style.left.startsWith('-9999'), '통로 자리에서 계산한 위치가 아직 반영되지 않았다');
});

test('전자 잠금 통로에 호버하면 종류·요구 Capability·개방 힌트가 카드로 나온다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  // 전자 자물쇠는 언제나 'blocked' 위에 덧붙는다(facilityLayout.js) — 실제 생성과 같은 모양으로 둔다.
  const run = withEdge(base, edge.id, { features: ['blocked', 'electronic'], requiredCapability: 2 });

  const root = mountMap(run);
  const text = await hoverEdge(root, edge.id);

  assert.ok(text.includes('전자 잠금 통로'), '머리에 통로 종류가 있어야 한다');
  assert.ok(text.includes('잠김 · 열 수 있음'), '인접해 있으면 열 수 있다는 배지가 붙는다');
  assert.ok(text.includes('Hacking 2 표준 · 현재 0'), '요구치와 현재 값을 함께 적어야 한다');
  assert.ok(text.includes('클릭해 개방'), '열 수 있는 통로에는 개방 힌트가 붙는다');
  assert.ok(!text.includes('electronic'), '코드 키가 그대로 새어 나왔다');
});

test('일방통행 통로를 역방향 끝에서 보면 역방향·불가로 적힌다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  // 반대편에서 현재 위치로만 열린 통로를 만든다 — 즉 내가 선 쪽이 `to`가 되게 방향을 잡는다.
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const oriented = edge.to === base.playerNodeId ? {} : { from: edge.to, to: edge.from };
  const run = withEdge(base, edge.id, { bidirectional: false, ...oriented });

  const root = mountMap(run);
  const text = await hoverEdge(root, edge.id);

  assert.ok(text.includes('일방통행 통로'), '머리에 일방통행이 있어야 한다');
  assert.ok(text.includes('역방향 · 불가'), '역방향 끝에서는 불가 배지가 붙는다');
  assert.ok(text.includes('여기서는 들어갈 수 없다'), '왜 안 되는지 한 줄로 말해야 한다');
  assert.ok(text.includes('다른 길로 돌아가야 한다'), '꼬리에 규칙 한 줄이 있어야 한다');
});

test('임시 장벽이 쳐진 통로는 남은 칸과 함께 장벽 행을 낸다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const edge = base.graph.edges.find((e) => e.from === base.playerNodeId || e.to === base.playerNodeId);
  const run = { ...base, threats: {}, activeBarriers: [{ edgeId: edge.id, expiresAt: base.time + 12 }] };

  const root = mountMap(run);
  const text = await hoverEdge(root, edge.id);

  assert.ok(text.includes('임시 장벽 · 적 이동 차단'), '장벽 행이 있어야 한다');
  assert.ok(text.includes('장벽 · 12칸 남음'), '배지에 남은 칸이 적혀야 한다');
  assert.ok(text.includes('나는 지날 수 있다'), '장벽이 막는 것이 누구인지 말해야 한다');
});

/** 지도 히트 영역(노드 원) 하나를 id로 찾는다 — 클릭마다 재렌더되므로 매번 다시 조회해야 한다. */
const hitFor = (root, queryAllFn, nodeId) => queryAllFn(root, (node) => node.localName === 'circle'
  && node.getAttribute('tabindex') != null && node.getAttribute('data-node-id') === nodeId)[0];

/** 현재 위치에서 멀리 떨어진, 지도에 그려진 노드를 골라 선택한다. 최소 홉 수를 만족할 때까지 훑는다. */
async function selectFarNode(root, run, minHops) {
  for (const node of run.graph.nodes) {
    const hit = hitFor(root, queryAll, node.id);
    if (!hit) continue;
    fire(hit, 'click');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const summary = queryAll(root, (el) => el.getAttribute && el.getAttribute('class') === 'map-route-summary')[0];
    const match = summary?.textContent.match(/최단 경로: (\d+)칸/);
    if (match && Number(match[1]) >= minHops) return { nodeId: node.id, hops: Number(match[1]) };
  }
  return null;
}

test('멀리 있는 노드를 고르면 경로 목록과 "경로 따라 한 칸 이동"이 나오고, 눌러도 선택이 남는다', async () => {
  const { graph } = generateFacilityGraph(11);
  const run = { ...createRunState(graph, 11), threats: {} };
  const root = mountMap(run);

  const picked = await selectFarNode(root, run, 3);
  assert.ok(picked, '3칸 이상 떨어진 노드를 하나는 고를 수 있어야 한다');

  // 경로 목록 — 플레이어 자리를 뺀 칸 수만큼의 줄이 유형 이름과 함께 나온다.
  const rows = queryAll(root, (el) => el.getAttribute && el.getAttribute('role') === 'button'
    && /^\d+\. /.test(el.textContent));
  assert.equal(rows.length, picked.hops, '경로 칸 수만큼 목록 줄이 있어야 한다');
  const typeLabels = ['복도', '사무·작업실', '대공간', '봉인 격실', '설비실', '감시 지점', '은신처', '비인가 통로'];
  assert.ok(typeLabels.some((label) => rows[0].textContent.includes(label)), '목록 줄에 노드 유형 이름이 있어야 한다');

  const walk = findByText(root, 'button', '경로 따라 한 칸 이동');
  assert.ok(walk, '인접하지 않은 선택에는 경로 따라 이동 버튼이 나와야 한다');
  assert.equal(walk.getAttribute('disabled'), null, '지날 수 있는 첫 칸인데 버튼이 잠겨 있다');

  fire(walk, 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const after = snapshotSignal.value.facilityRunState;
  assert.notEqual(after.playerNodeId, run.playerNodeId, '한 칸 움직여야 한다');

  // 선택이 남아 있어야 같은 버튼을 계속 눌러 걸을 수 있다 — 요약이 한 칸 줄어든 채로 그대로 있다.
  const summary = queryAll(root, (el) => el.getAttribute && el.getAttribute('class') === 'map-route-summary')[0];
  assert.ok(summary, '이동 뒤에도 선택이 남아 경로 요약이 보여야 한다');
  assert.ok(summary.textContent.includes(`최단 경로: ${picked.hops - 1}칸`), `한 칸 줄어든 경로가 적혀야 한다: ${summary.textContent}`);

  resetMapView();
});

test('선택 전에는 호버한 노드까지의 경로가 미리보기로 그려진다', async () => {
  const { graph } = generateFacilityGraph(11);
  const run = { ...createRunState(graph, 11), threats: {} };
  const root = mountMap(run);

  let previewed = 0;
  for (const node of run.graph.nodes) {
    const hit = hitFor(root, queryAll, node.id);
    if (!hit || node.id === run.playerNodeId) continue;
    fire(hit, 'mouseenter', { clientX: 10, clientY: 10 });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    previewed = queryAll(root, (el) => el.localName === 'path' && el.getAttribute('class') === 'map-route-preview').length;
    if (previewed > 0) break;
  }
  assert.ok(previewed > 0, '고르지 않은 먼 노드에 호버하면 경로 미리보기가 그려져야 한다');

  resetMapView();
});

test('노드 카드는 커서가 아니라 그 노드의 자리에 붙는다', async () => {
  // 커서를 따라다니면 한 프레임씩 늦게 따라오고, 지도를 끄는 동안 카드가 노드에서 떨어진다.
  const { graph } = generateFacilityGraph(11);
  const run = { ...createRunState(graph, 11), threats: {} };
  const root = mountMap(run);

  const hit = hitFor(root, queryAll, run.playerNodeId);
  fire(hit, 'mouseenter', { clientX: 999, clientY: 999 });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  const card = queryAll(root, (el) => el.style && typeof el.style.left === 'string' && el.style.left.endsWith('px')
    && el.style.position === 'fixed')[0];
  assert.ok(card, '호버 카드가 화면에 있어야 한다');
  assert.ok(!card.style.left.includes('1013'), `카드 위치가 커서(clientX+14)에서 나왔다: ${card.style.left}`);
  assert.ok(!card.style.top.includes('1013'), `카드 위치가 커서(clientY+14)에서 나왔다: ${card.style.top}`);
  assert.ok(Number.isFinite(Number.parseFloat(card.style.left)), '카드 위치가 숫자여야 한다');
  assert.ok(!card.style.left.startsWith('-9999'), '노드 자리에서 계산한 위치가 아직 반영되지 않았다');

  resetMapView();
});

test('현재 노드 패널은 세 묶음으로 접히고, 수습·장비 머리를 누르면 그 안이 열린다', async () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const run = {
    ...base,
    threats: {},
    corpses: [{ id: 'c1', nodeId: base.playerNodeId, sectorId: base.playerNodeId.split('_')[0] }],
  };
  const root = mountMap(run);

  assert.ok(panelGroupHeader(root, '여기서 할 수 있는 것'), '행동 묶음 머리가 있어야 한다');
  assert.ok(panelGroupHeader(root, '수습·장비'), '수습·장비 묶음 머리가 있어야 한다');
  assert.ok(root.textContent.includes('기본 정찰'), '기본으로 열린 묶음의 내용은 바로 보여야 한다');
  assert.ok(!root.textContent.includes('시체 처리'), '수습·장비는 기본으로 접혀 있어야 한다');

  fire(panelGroupHeader(root, '수습·장비'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.ok(root.textContent.includes('시체 처리'), '머리를 누르면 수습·장비 안이 열려야 한다');

  fire(panelGroupHeader(root, '수습·장비'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.ok(!root.textContent.includes('시체 처리'), '다시 누르면 접혀야 한다');
});

test('추적자는 관측하지 못한 구역에 있어도 지도와 위협 패널에 항상 그려진다 (ADR-0092)', () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  // 플레이어에게서 가장 먼 구역의 랜드마크에 세운다 — 인접 관측도 정찰도 닿지 않는 자리다.
  const farSector = graph.sectorIds.find((id) => id !== base.playerNodeId.split('_')[0]);
  const landmark = graph.landmarks.find((l) => l.sectorId === farSector);
  const run = {
    ...base,
    threats: {
      [`hunter_${farSector}`]: {
        id: `hunter_${farSector}`, kind: 'hunter', alwaysVisible: true,
        sectorId: farSector, size: 1, monsterIds: ['hunter'],
        patrolRoute: [landmark.nodeId], patrolIndex: 0, nodeId: landmark.nodeId,
        mode: 'pursuit', alert: 3, nextMoveAt: base.time + 2,
        lastKnownPlayerNodeId: null, lastObservedPlayerAt: null, pursuitStrength: 3,
        target: null, investigationMemory: null, lostTicks: 4,
      },
    },
    sectorAlerts: { ...base.sectorAlerts, [farSector]: { level: 3, pressure: 0, resolvedEventIds: [] } },
  };

  const text = mountMap(run).textContent;
  assert.ok(text.includes('추적자'), '미관측 구역의 추적자도 지도·패널에 이름이 보여야 한다');
  assert.ok(text.includes('놓치기까지 16칸'), '남은 칸이 위협 패널 첫 줄에 보여야 한다');
});

test('HP가 절반 이하인 런에서는 상단에 부상 배지가 뜬다 (ADR-0093)', () => {
  const { graph } = generateFacilityGraph(11);
  const run = { ...createRunState(graph, 11), threats: {} };
  const snapshot = snapshotOf(run);
  snapshot.playerState = { ...snapshot.playerState, hp: 20, maxHp: 40 };
  snapshotSignal.value = snapshot;
  historySignal.value = createHistory(snapshot);
  const root = makeRoot();
  render(html`<${MapScreen} />`, root);

  assert.ok(root.textContent.includes('부상 −1'), 'HP 50%에서는 −1 배지가 보여야 한다');
});
