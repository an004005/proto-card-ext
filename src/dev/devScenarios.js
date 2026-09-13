// 개발자 전용 테스트 시나리오 — 정식 게임 콘텐츠가 아니며 CONTEXT.md의 데이터 권위 규칙과
// 무관하다(수치를 정의하지 않고, 이미 생성된 런 스냅샷을 UI 확인용으로 결정론적으로 뒤튼다).
// `?devScenario=<name>`으로만 진입하며(App.js), 정상 플레이 경로에는 전혀 관여하지 않는다.
// 은엄폐·조우·통제실·지도 화살표처럼 무작위 배치나 여러 스텝의 플레이가 있어야 나오는 상태를
// 브라우저에서 즉시 재현하기 위한 것.
//
// 맵 재설계 1~5단계의 확인 지점을 전부 덮도록 구성했다. DEV_SCENARIO_GROUPS가 그 목록이자
// 화면 우하단 데브맵 선택기(DevScenarioPicker.js)의 소스다.

import { startCombat } from '../engine/combatReducer.js';
import { POWER_CUT_DURATION, LOCKDOWN_EXIT_CLOSE_WINDOW } from '../data/facilityLayout.js';

/**
 * 데브맵 목록. 단계별로 묶어 두어 "이 단계에서 무엇을 봐야 하는가"가 목록 자체에 남게 한다.
 * @type {{stage: string, items: {name: string, label: string, watch: string}[]}[]}
 */
export const DEV_SCENARIO_GROUPS = [
  {
    stage: '1·2단계 — 지형과 정보 공개',
    items: [
      { name: 'fog', label: '안개와 미확인 노드', watch: '전체 도면은 보이되 내용물은 가려져 있는가. 비인가 통로는 밟기 전까지 지도에 없는가.' },
      { name: 'recon', label: '정찰 직후(실시간 관측)', watch: '현재+인접 노드가 실시간으로 표시되고 나머지는 마지막 확인 정보로 남는가.' },
      { name: 'concealment', label: '은엄폐 배치', watch: '정찰한 노드에서만 은엄폐 값이 보이고 사용 버튼이 뜨는가.' },
      { name: 'map-item', label: '지도 임플란트(랜드마크 화살표)', watch: '아직 관측하지 않은 구역 랜드마크 방향으로 화살표가 뜨는가.' },
    ],
  },
  {
    stage: '3단계 — 계약과 봉쇄',
    items: [
      { name: 'landmark', label: '구역 통제실 위', watch: '통제실 해킹 패널과 해킹 수치별 누적 언락 표가 보이는가.' },
      { name: 'contract-objective', label: '계약 목표부 위', watch: '계약 유형에 맞는 확보/파괴/송출 버튼과 완료 조건 설명이 보이는가.' },
      { name: 'lockdown', label: '봉쇄 발동 중', watch: '상단에 봉쇄 표시가 뜨고, 출구 B 조기 폐쇄가 반영되는가.' },
    ],
  },
  {
    stage: '4단계 — 인과 고리(흔적·시체·증원·수습)',
    items: [
      { name: 'recovery', label: '수습 수단 전부 사용 가능', watch: '시체 처리·흔적 정리·전원 차단·가짜 목표가 한 블록에 모이고, 각 버튼에 층계 대가가 붙는가.' },
      { name: 'evidence', label: '흔적과 시체가 널린 구역', watch: '지도에 시체 †와 흔적 ˙N 표식이 뜨는가.' },
      { name: 'alert-high', label: '경계도 최대 + 증원 임박', watch: '경계도 게이지와 다음 증원 시각(통제실 장악 구역만)이 보이는가.' },
      { name: 'power-cut', label: '전원 차단 진행 중', watch: '차단 만료 시각과 "전자 자물쇠 해킹 불가" 안내가 뜨는가.' },
    ],
  },
  {
    stage: '5단계 — 파밍 두 등급과 Capability 층계',
    items: [
      { name: 'prize-node', label: '확보 대상이 모인 노드', watch: '보급품과 확보 대상이 이름·등급·역할축·시간으로 구분되는가.' },
      { name: 'prize-choice', label: '확보 대상 후보 대기 중', watch: '후보 3개가 뜨고, 고르기 전에는 인벤토리가 그대로인가. 소지품 압박이 같이 보이는가.' },
      { name: 'ladder-strained', label: '층계 — 모자란 채로 열기', watch: '장비를 전부 벗긴 기준선(전 Capability 0)이다. 잠기지 않고 "무리 · 시간 +40% · 소음 +1"처럼 대가가 눌리기 전에 보이는가.' },
      { name: 'ladder-blocked', label: '층계 — 불가(요구치 −3)', watch: '요구치 3짜리 승강기 + Capability 0. 이때만 버튼이 잠기고, 얼마가 필요한지 문장으로 말해 주는가.' },
    ],
  },
  {
    stage: '전투 연결',
    items: [
      { name: 'encounter-advantage', label: '조우 — 우위', watch: '기습/무시/회피 셋 다 열리는가.' },
      { name: 'encounter-disadvantage', label: '조우 — 열세', watch: '행동 1회만 허용된다는 것이 읽히는가.' },
      { name: 'combat', label: '전투 진입', watch: '전투 소음 게이지가 카드마다 차오르는가.' },
    ],
  },
];

export const DEV_SCENARIOS = DEV_SCENARIO_GROUPS.flatMap((group) => group.items.map((item) => item.name));

/** @param {string} name @returns {{name: string, label: string, watch: string}|null} */
export function findDevScenario(name) {
  for (const group of DEV_SCENARIO_GROUPS) {
    const found = group.items.find((item) => item.name === name);
    if (found) return found;
  }
  return null;
}

/**
 * @param {import('../engine/types.js').GameSnapshot} snapshot CONFIRM_LOADOUT 직후(currentScreen: 'map') 스냅샷
 * @param {string} name DEV_SCENARIOS 중 하나
 * @returns {import('../engine/types.js').GameSnapshot}
 */
export function applyDevScenario(snapshot, name) {
  const run = snapshot.facilityRunState;
  if (!run || snapshot.currentScreen !== 'map') return snapshot;
  switch (name) {
    case 'fog': return snapshot; // 시작 직후가 곧 안개 상태다 — 손대지 않는 것이 이 시나리오다.
    case 'recon': return withRecon(snapshot, run);
    case 'concealment': return withConcealment(snapshot, run);
    case 'landmark': return withLandmark(snapshot, run);
    case 'contract-objective': return withContractObjective(snapshot, run);
    case 'lockdown': return withLockdown(snapshot, run);
    case 'recovery': return withRecovery(snapshot, run);
    case 'evidence': return withEvidence(snapshot, run);
    case 'alert-high': return withAlertHigh(snapshot, run);
    case 'power-cut': return withPowerCut(snapshot, run);
    case 'prize-node': return withPrizeNode(snapshot, run);
    case 'prize-choice': return withPrizeChoice(snapshot, run);
    case 'ladder-strained': return withLadderEdge(snapshot, run, 'strained');
    case 'ladder-blocked': return withLadderEdge(snapshot, run, 'blocked');
    case 'encounter-advantage': return withEncounter(snapshot, run, 'advantage');
    case 'encounter-disadvantage': return withEncounter(snapshot, run, 'disadvantage');
    case 'map-item': return withMapItem(snapshot);
    case 'combat': return withCombat(snapshot, run);
    default: return snapshot;
  }
}

/** 플레이어를 옮기면서 그 노드를 방문한 것으로 기록한다 — 방문 여부가 장치 표시를 가른다. */
function moveTo(run, nodeId) {
  const visitedNodeIds = run.visitedNodeIds.includes(nodeId) ? run.visitedNodeIds : [...run.visitedNodeIds, nodeId];
  return { ...run, playerNodeId: nodeId, visitedNodeIds };
}

/** @param {import('../engine/types.js').FacilityRunState} run */
function sectorOf(run, nodeId) {
  return run.graph.nodes.find((n) => n.id === nodeId)?.sectorId;
}

/** 즉시 전투로 진입시킨다(소음 게이지 UI 등 전투 화면 자체를 확인할 때 씀). */
function withCombat(snapshot, run) {
  const threatId = Object.keys(run.threats)[0];
  const threat = threatId ? run.threats[threatId] : null;
  return startCombat(snapshot, threat?.monsterIds ?? ['nibbit'], undefined, { nodeId: run.playerNodeId, threatId: threatId ?? undefined });
}

/** 기본 정찰을 마친 직후 상태 — 현재+인접 노드가 실시간 관측 대상이 된다. */
function withRecon(snapshot, run) {
  const targets = new Set([run.playerNodeId]);
  for (const e of run.graph.edges) {
    if (e.from === run.playerNodeId) targets.add(e.to);
    if (e.to === run.playerNodeId) targets.add(e.from);
  }
  const activeRecon = { source: /** @type {const} */ ('basic'), sourceNodeId: run.playerNodeId, targetNodeIds: [...targets], expiresAt: null };
  return { ...snapshot, facilityRunState: { ...run, activeRecon } };
}

/** 현재 노드에 은엄폐(+2)를 강제 배치하고, 정찰한 것처럼 관측 기록도 함께 채운다(버튼이
 * `observations[nodeId]?.concealment != null`을 요구하므로 값만 심어서는 버튼이 안 뜬다). */
function withConcealment(snapshot, run) {
  const nodeId = run.playerNodeId;
  const value = 2;
  const graph = { ...run.graph, concealmentByNodeId: { ...run.graph.concealmentByNodeId, [nodeId]: value } };
  const prevObservation = run.observations[nodeId] || { observedAt: run.time, hasThreat: false };
  const observations = { ...run.observations, [nodeId]: { ...prevObservation, concealment: value } };
  return { ...snapshot, facilityRunState: { ...run, graph, observations } };
}

/** 첫 번째 구역 랜드마크로 순간이동시켜 통제실 해킹 패널을 즉시 띄운다. */
function withLandmark(snapshot, run) {
  const landmark = run.graph.landmarks[0];
  if (!landmark) return snapshot;
  return { ...snapshot, facilityRunState: moveTo(run, landmark.nodeId) };
}

/** 수락한 계약의 목표부로 옮긴다 — 유형에 맞는 확보/파괴 버튼이 그 자리에서만 뜬다. */
function withContractObjective(snapshot, run) {
  const contract = run.contract;
  if (!contract) return snapshot;
  const landmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  if (!landmark) return snapshot;
  return { ...snapshot, facilityRunState: moveTo(run, landmark.nodeId) };
}

/** 계약 목표를 확보한 직후 — 봉쇄가 켜지고 출구 B가 앞당겨진 상태. */
function withLockdown(snapshot, run) {
  const contract = run.contract;
  const withObjective = withContractObjective(snapshot, run).facilityRunState;
  return {
    ...snapshot,
    facilityRunState: {
      ...withObjective,
      contract: contract ? { ...contract, status: 'acquired', acquiredAt: withObjective.time } : contract,
      lockdown: { startedAt: withObjective.time },
      exits: { ...withObjective.exits, B: { ...withObjective.exits.B, disabledAt: withObjective.time + LOCKDOWN_EXIT_CLOSE_WINDOW } },
    },
  };
}

/** 수습 수단 넷이 한 화면에 전부 뜨는 자리 — 접속 인터페이스 위에 시체·흔적·경계도를 함께 둔다. */
function withRecovery(snapshot, run) {
  const entry = run.graph.accessInterfaces[0];
  if (!entry) return snapshot;
  const nodeId = entry.nodeId;
  const sectorId = sectorOf(run, nodeId);
  const moved = moveTo(run, nodeId);
  return {
    ...snapshot,
    facilityRunState: {
      ...moved,
      corpses: [{ id: 'dev_corpse', nodeId, sectorId, createdAt: moved.time }],
      evidence: [
        { id: 'dev_e1', nodeId, tier: 1, createdBySectorId: sectorId },
        { id: 'dev_e2', nodeId, tier: 2, createdBySectorId: sectorId },
      ],
      sectorAlerts: { ...moved.sectorAlerts, [sectorId]: { level: 2, resolvedEventIds: [] } },
    },
  };
}

/** 시체와 흔적을 여러 노드에 흩뿌린다 — 지도 표식(†, ˙N)이 실제로 읽히는지 보는 용도. */
function withEvidence(snapshot, run) {
  const sectorId = sectorOf(run, run.playerNodeId);
  const nearby = run.graph.nodes.filter((n) => n.sectorId === sectorId).slice(0, 6);
  const corpses = nearby.slice(0, 2).map((n, i) => ({ id: `dev_corpse${i}`, nodeId: n.id, sectorId, createdAt: run.time }));
  const evidence = nearby.flatMap((n, i) => (
    Array.from({ length: (i % 3) + 1 }, (_, k) => ({ id: `dev_ev${i}_${k}`, nodeId: n.id, tier: /** @type {1|2} */ (k === 0 ? 2 : 1), createdBySectorId: sectorId }))
  ));
  // 표식은 방문한 노드에서만 의미가 있으므로 그 노드들을 방문 처리한다.
  const visitedNodeIds = [...new Set([...run.visitedNodeIds, ...nearby.map((n) => n.id)])];
  return { ...snapshot, facilityRunState: { ...run, corpses, evidence, visitedNodeIds } };
}

/** 시나리오에서 "곧 온다"로 읽히는 칸 수. */
const DEV_IMMINENT_REINFORCEMENT_TICKS = 3;

/** 이 구역 경계도를 최대로 올리고 다음 증원을 코앞으로 당긴다. 통제실도 장악해 둬야 예정
 * 시각이 화면에 뜬다(장악하지 않은 구역의 증원 시각은 D14에 따라 감춰진다). */
function withAlertHigh(snapshot, run) {
  const sectorId = sectorOf(run, run.playerNodeId);
  return {
    ...snapshot,
    facilityRunState: {
      ...run,
      sectorAlerts: { ...run.sectorAlerts, [sectorId]: { level: 3, resolvedEventIds: ['dev_a', 'dev_b', 'dev_c'] } },
      revealedPatrolRouteSectorIds: [...new Set([...run.revealedPatrolRouteSectorIds, sectorId])],
      // 교대까지 코앞인 상태를 보려는 시나리오다. 맵 시간은 정수 칸이므로(ADR-0075) 간격을
      // 나누지 않고 몇 칸 뒤인지를 그대로 쓴다.
      reinforcements: { ...run.reinforcements, [sectorId]: { nextAt: run.time + DEV_IMMINENT_REINFORCEMENT_TICKS, alertSeen: 3 } },
    },
  };
}

/** 전원 차단이 걸린 구역 한가운데 — 만료 시각 안내와 해킹 차단이 함께 보인다. */
function withPowerCut(snapshot, run) {
  const entry = run.graph.accessInterfaces[0];
  if (!entry) return snapshot;
  const moved = moveTo(run, entry.nodeId);
  const sectorId = sectorOf(run, entry.nodeId);
  return {
    ...snapshot,
    facilityRunState: { ...moved, powerCuts: [{ sectorId, expiresAt: moved.time + POWER_CUT_DURATION }] },
  };
}

/** 현재 노드에 보급품 하나와 확보 대상 둘(일반·상급)을 나란히 둔다 — 등급 구분이 읽히는지 본다. */
function withPrizeNode(snapshot, run) {
  const nodeId = run.playerNodeId;
  const opportunities = [
    { id: 'dev_supply', nodeId, keyEligible: false, usesRemaining: 2, grade: /** @type {const} */ ('supply') },
    { id: 'dev_prize_n', nodeId, keyEligible: false, usesRemaining: 1, grade: /** @type {const} */ ('prize'), tier: /** @type {const} */ ('normal'), axis: /** @type {const} */ ('infiltration') },
    { id: 'dev_prize_e', nodeId, keyEligible: true, usesRemaining: 1, grade: /** @type {const} */ ('prize'), tier: /** @type {const} */ ('elite'), axis: /** @type {const} */ ('combat') },
    ...run.graph.opportunities.filter((o) => o.nodeId !== nodeId),
  ];
  return { ...snapshot, facilityRunState: { ...run, graph: { ...run.graph, opportunities } } };
}

/** 확보 대상을 막 파밍해 후보 셋이 대기 중인 상태. 소지품을 미리 채워 두어 "무엇을 버릴까"가
 * 같은 화면에서 보이는지 확인한다 — 그게 5단계의 검증 질문이다. */
function withPrizeChoice(snapshot, run) {
  const withNode = withPrizeNode(snapshot, run).facilityRunState;
  const ps = snapshot.playerState;
  const filler = Array.from({ length: Math.max(0, ps.inventory.capacity - 2 - ps.inventory.items.length) }, (_, i) => ({
    id: `dev_fill${i}`, kind: /** @type {const} */ ('junk'), value: 20,
  }));
  return {
    ...snapshot,
    playerState: { ...ps, inventory: { ...ps.inventory, items: [...ps.inventory.items, ...filler] } },
    facilityRunState: {
      ...withNode,
      pendingFarmChoice: {
        opportunityId: 'dev_prize_e',
        tier: 'elite',
        axis: 'combat',
        options: [
          { kind: 'equipment', equipmentId: 'revolver' },
          { kind: 'equipment', equipmentId: 'katana' },
          { kind: 'equipment', equipmentId: 'shotgun' },
        ],
      },
      lastActionResult: { kind: 'farm', nodeId: withNode.playerNodeId, opportunityId: 'dev_prize_e', status: 'completed', completedAt: withNode.time },
    },
  };
}

/**
 * 층계를 확인할 특수 엣지 옆에 세운다. 기본 로드아웃은 모든 Capability가 0이므로, 요구치 1인
 * 엣지는 '무리'(대가를 치르고 열림), 요구치 3인 승강기는 '불가'가 된다.
 * @param {'strained'|'blocked'} kind
 */
function withLadderEdge(snapshot, run, kind) {
  const wanted = kind === 'blocked'
    ? (e) => (e.requiredCapability ?? 1) >= 3
    : (e) => (e.requiredCapability ?? 1) === 1 && (e.features.includes('blocked') || e.features.includes('electronic'));
  const edge = run.graph.edges.find((e) => wanted(e) && !run.openedEdgeIds.includes(e.id));
  if (!edge) return snapshot;
  // 장비를 전부 벗긴다. 데브맵은 AUTO_EQUIP_LOADOUT을 거쳐 들어오는데, 그 로드아웃은 Capability를
  // 올려 주므로 요구치 3짜리 엣지도 '무리'로 열려 버린다 — 그러면 이 시나리오가 이름과 다른 것을
  // 보여준다. 기본 로드아웃(전 Capability 0)이 층계를 확인하는 기준선이다.
  const ps = snapshot.playerState;
  const bare = { ...ps.loadout, weapons: [], top: null, bottom: null, modules: [], implantIds: [] };
  return { ...snapshot, playerState: { ...ps, loadout: bare }, facilityRunState: moveTo(run, edge.from) };
}

/** 임의의 기존 위협 마커 하나를 플레이어 노드로 끌어와 조우 상태를 강제로 연다. */
function withEncounter(snapshot, run, tier) {
  const threatId = Object.keys(run.threats)[0];
  if (!threatId) return snapshot;
  const threats = { ...run.threats, [threatId]: { ...run.threats[threatId], nodeId: run.playerNodeId } };
  const encounter = { threatId, nodeId: run.playerNodeId, tier, graceUsed: false };
  return { ...snapshot, facilityRunState: { ...run, threats, encounter } };
}

/** 지도 임플란트(⑦)를 강제 장착시켜 구역 랜드마크 화살표 오버레이를 즉시 확인할 수 있게 한다. */
function withMapItem(snapshot) {
  const ps = snapshot.playerState;
  if (ps.loadout.implantIds.includes('implant7')) return snapshot;
  const implantIds = [...ps.loadout.implantIds.slice(0, 2), 'implant7'];
  return { ...snapshot, playerState: { ...ps, loadout: { ...ps.loadout, implantIds } } };
}
