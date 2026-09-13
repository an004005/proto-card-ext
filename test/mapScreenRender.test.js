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
      hp: 50, maxHp: 50, overload: 0, loadout: { consumableSlots: [], weapons: [], modules: [], implants: [], ...(loadoutOverride || {}) },
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
  assert.ok(text.includes('폐쇄까지') || text.includes('폐쇄됨'), '출구 폐쇄 카운터가 보여야 한다');
  assert.ok(text.includes(`시각 ${run.time} / 700`), 'HUD에 현재 시각이 상시 보여야 한다');
  assert.ok(text.includes('가장 이른 마감'), '가장 가까운 마감이 줄 맨 앞에 한 번 더 보여야 한다');
  assert.ok(text.includes('앞으로 15칸'), '타임라인 블록이 보여야 한다');
  assert.ok(text.includes('기본 정찰 · 4칸'), '예고가 붙은 행동 버튼이 보여야 한다');
});

test('유료 버튼은 이름·칸·소음·과부화를 같은 순서로 적는다', () => {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  // 흔적이 있으면 수습 블록이 열리고, 그 안의 버튼이 같은 라벨 규칙을 따르는지 볼 수 있다.
  const run = {
    ...base,
    evidence: [{ id: 'e1', nodeId: base.playerNodeId, tier: 2, createdBySectorId: base.playerNodeId.split('_')[0] }],
  };
  const text = renderMap(run);
  assert.ok(text.includes('흔적 정리(1개) · '), `라벨 규칙이 깨졌다: ${text.slice(0, 0)}`);
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
  assert.ok(snapshotSignal.value.facilityRunState.openedEdgeIds.includes(edge.id));
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
