// 160노드 익스트랙션 맵 화면 (docs/extraction-map-implementation-spec.md).
// 전체 지도(노드+엣지)는 항상 보이고, 위협 존재 여부 같은 "내용" 정보만
// 시야(현재+인접) 밖에서는 마지막으로 확인한 값으로 고정된다 — gameReducer.js의
// refreshLocalObservations가 매 행동 끝에 현재+인접 노드를 observations에 스냅샷한다).
//
// UI 레이아웃(HUD/구역 라벨/미니맵/선택 노드 패널/범례·로그 접기)은 게임 UI 목업 디자인/
// map-redesign의 개선안을 반영해 재구성했다 — 명령·판정 로직은 이전과 동일, 표현 계층만 변경.
import { html, useState, useEffect, useRef } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeCapabilities, listFieldActiveEquipment, effectiveForRequirement } from '../engine/capabilityEngine.js';
import { bfsHopDistances } from '../engine/graphUtils.js';
import { openSpecialEdge, applyOverloadDelta, canTraverseEdge, cameraHackRange, isCameraHackActive, getSectorLandmarkArrowTarget } from '../engine/runEngine.js';
import { computeFloorOverload, computeOverloadGainMultiplier, getImplantEffect } from '../engine/equipmentEngine.js';
import { SECTOR_IDS, SECTOR_NAMES, RUN_COLLAPSE_TIME, LANDMARKS_BY_SECTOR } from '../data/facilityLayout.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { CAPABILITY_ORDER, CAPABILITY_LABELS, CAPABILITY_SHORT, CAPABILITY_ROLE } from '../data/capabilityDisplay.js';
import { OverloadGauge } from './OverloadGauge.js';
import { InventoryPopup } from './InventoryPopup.js';
import { Tooltip } from './Tooltip.js';
import { PlayLog } from './PlayLog.js';
import { HistoryControls } from './HistoryControls.js';
import { describeItem } from '../data/itemDisplay.js';
import { EncounterPanel } from './EncounterPanel.js';

const FIELD_ACTION_LABELS = { snapshot_scan: '집중 투시', temporary_barrier: '임시 장벽', remote_intrusion: '원격 침투' };
const FIELD_TARGET_LABELS = { edge: '엣지(통로) 지정', node_contents: '주변 노드 파악', electronic_device: '전자 장치 지정' };

/** 현재 값으로 실제로 뭘 할 수 있는지 — 구현된 효과만 정직하게 나열(미구현 항목은 그렇다고 밝힘). */
function capabilityActionSummary(key, raw) {
  const eff = effectiveForRequirement(raw);
  if (key === 'hacking') {
    const opens = eff >= 1 ? '전자(electronic) 특수 엣지를 개방할 수 있습니다.' : '1 이상이어야 전자 특수 엣지를 개방할 수 있습니다(현재 미달).';
    return `${opens} 탈출구 개방 요청 시에도 이 값이 쓰이며, 높을수록 개방 대기 시간이 짧아집니다.`;
  }
  if (key === 'force') {
    return eff >= 1 ? '봉쇄(blocked) 특수 엣지를 개방할 수 있습니다.' : '1 이상이어야 봉쇄 특수 엣지를 개방할 수 있습니다(현재 미달).';
  }
  if (key === 'mobility') {
    const highGround = raw >= 3 ? '높은 지형 특수 엣지를 통과할 수 있습니다.' : 'Mobility 3부터 높은 지형 특수 엣지를 통과할 수 있습니다.';
    const disengage = raw >= 2 ? '전투 이탈 시작 시 진행도 +1을 받습니다.' : 'Mobility 2부터 전투 이탈 보너스를 받습니다.';
    return `${highGround} ${disengage}`;
  }
  if (key === 'stealth') {
    return raw >= 3 ? '카메라에 발각되지 않고 이동 흔적도 남기지 않습니다.' : '카메라 노드 진입 시 발각됩니다. Stealth 3부터 카메라를 피할 수 있습니다.';
  }
  return '현재 엔진에 이 값을 요구하거나 참조하는 행동이 아직 없습니다(장비 수치만 집계되고 있음).';
}

const EXIT_STATUS_DESCRIPTIONS = {
  closed: '아직 요청 전. 이 노드에서 탈출구 개방 요청을 보낼 수 있습니다.',
  requesting: '개방 요청 처리 중 — 잠시 후 개방 대기 상태로 넘어갑니다.',
  opening: '요청 완료, 개방 대기 중 — 곧 열립니다(Hacking이 높을수록 대기 시간이 짧아집니다).',
  open: '지금 이 노드에 있으면 다음 행동(이동/정찰 등)이 끝나는 즉시 자동으로 탈출합니다 — 창이 닫히기 전에 아무 행동이나 하세요.',
  disabled: '더 이상 사용할 수 없는 탈출구입니다.',
};

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 1400;
const CANVAS_PADDING = 50;
const CANVAS_CENTER = CANVAS_WIDTH / 2;
const NODE_RADIUS = 8;

/** 그래프 노드의 절대 기하 좌표(facilityGraph.js가 생성)를 캔버스에 맞춰 스케일/이동한다. */
function layoutPositions(graph) {
  const xs = graph.nodes.map((n) => n.x);
  const ys = graph.nodes.map((n) => n.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min(
    (CANVAS_WIDTH - CANVAS_PADDING * 2) / (maxX - minX || 1),
    (CANVAS_HEIGHT - CANVAS_PADDING * 2) / (maxY - minY || 1),
  );
  const positions = {};
  for (const node of graph.nodes) {
    positions[node.id] = { x: CANVAS_PADDING + (node.x - minX) * scale, y: CANVAS_PADDING + (node.y - minY) * scale };
  }
  return positions;
}

/** 구역별 중심·반경(캔버스 좌표) — 지도 위 구역 배경/라벨용. 노드 산포가 원형이 아니어도(임의
 * 기하) 안전하도록, 중심은 평균, 반경은 중심에서 가장 먼 노드까지 거리로 잡는다. */
function sectorZones(graph, positions) {
  const zones = {};
  for (const sectorId of SECTOR_IDS) {
    const pts = graph.nodes.filter((n) => n.sectorId === sectorId).map((n) => positions[n.id]);
    if (pts.length === 0) continue;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const topY = Math.min(...pts.map((p) => p.y));
    const radius = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + 34;
    zones[sectorId] = { cx, cy, topY, radius };
  }
  return zones;
}

function isTrueAdjacent(run, nodeId) {
  return run.graph.edges.some((e) => (e.from === run.playerNodeId && e.to === nodeId) || (e.to === run.playerNodeId && e.from === nodeId));
}

/** 현재 위치에서 nodeId로 이어지는 엣지 — 있다면 그 엣지의 timeCost가 실제 이동 소모 시간이다
 * (runEngine.js의 moveToAdjacentNode가 그대로 쓰는 값, 기하학적 길이로 엣지마다 다르다). */
function findTraversableEdge(run, nodeId) {
  return run.graph.edges.find((e) => (e.from === run.playerNodeId && e.to === nodeId) || (e.to === run.playerNodeId && e.from === nodeId));
}

/**
 * §10.2(수정): 전체 지도는 항상 보인다 — 이 함수는 "얼마나 최신 정보인가"만 구분한다.
 * current=지금 여기, fresh=지금 시야 안(인접), stale=예전에 관측했지만 지금은 시야 밖(마지막
 * 확인 정보 고정), unknown=한 번도 관측한 적 없음(존재/위치만 보임, 내용은 모름).
 */
function nodeKnowledge(run, nodeId) {
  if (run.playerNodeId === nodeId) return 'current';
  if (run.activeRecon?.targetNodeIds.includes(nodeId)) return 'fresh';
  if (isTrueAdjacent(run, nodeId)) return 'fresh';
  if (run.observations[nodeId]) return 'stale';
  return 'unknown';
}

function nodeFill(knowledge, hasThreat, isExit) {
  if (isExit) return 'var(--color-accent)';
  if (knowledge === 'current') return 'var(--color-accent-2-700)';
  if (knowledge === 'unknown') return 'var(--color-neutral-300)';
  return hasThreat ? 'var(--color-negative, #dd2b0f)' : 'var(--color-bg)';
}

function nodeOpacity(knowledge) {
  if (knowledge === 'stale') return 0.55;
  return 1;
}

/** remote_intrusion 대상 후보: 사거리 내 노드(본인 위치 제외). */
function candidateNodesInRange(graph, fromId, range) {
  const hops = bfsHopDistances(graph.edges, fromId);
  return graph.nodes.filter((n) => { const h = hops.get(n.id); return h !== undefined && h > 0 && h <= range; });
}

/** temporary_barrier 대상 후보: 두 끝점 중 하나라도 사거리 내에 있는 엣지. */
function candidateEdgesInRange(graph, fromId, range) {
  const hops = bfsHopDistances(graph.edges, fromId);
  return graph.edges.filter((e) => {
    const hf = hops.get(e.from); const ht = hops.get(e.to);
    return (hf !== undefined && hf <= range) || (ht !== undefined && ht <= range);
  });
}

function exitStatusLabel(exit) {
  if (exit.kind === 'key') return '열쇠';
  const labels = { closed: '닫힘', requesting: '요청 중', opening: '개방 대기', open: '열림', disabled: '비활성' };
  return labels[exit.status];
}

/**
 * 정찰(맵)에서 과부화가 100을 넘게 되는 행동은 애초에 버튼을 비활성화한다 — runEngine.js의
 * 실제 순수 함수를 그대로(부작용 없이) 미리 호출해 결과 overload만 확인한다. 던지면(자격
 * 미달 등 다른 이유로 실패) 과부화 판단과 무관하므로 막지 않는다 — 실제 클릭 시 에러로 뜬다.
 */
function wouldExceedOverload(run, ps, actionFn) {
  // Overload 100 is no longer a map-side game-over condition. Combat converts excess into status cards.
  return false;
}

function movementRiskForecast(run, edge, destinationNodeId, mobility) {
  if (!edge) return { label: '경로 없음', color: 'var(--color-negative, #dc2626)' };
  const multiplier = [1.4, 1.2, 1, 0.9, 0.8, 0.7, 0.6][Math.max(-2, Math.min(4, mobility)) + 2];
  const arrivalAt = run.time + Math.max(10, Math.round(edge.timeCost * multiplier));
  const direct = Object.values(run.threats).filter((threat) => threat.nodeId === destinationNodeId).length;
  if (direct > 0) return { label: `도착 예상: 적 ${direct}그룹`, color: 'var(--color-negative, #dc2626)' };
  const hops = bfsHopDistances(run.graph.edges, destinationNodeId);
  const inbound = Object.values(run.threats).filter((threat) => {
    const hop = hops.get(threat.nodeId);
    return hop === 1 && threat.nextMoveAt <= arrivalAt;
  }).length;
  if (inbound > 0) return { label: `도착 중 적 유입 가능 · ${inbound}그룹`, color: '#b45309' };
  return { label: '도착 예상: 위협 없음', color: '#15803d' };
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
// 카메라 발각 배너를 "긴급"으로 강조하는 시간 창(시간 단위) — CAMERA_HACK_DURATION(300)보다
// 조금 길게 잡아, 그 이후는 조용한 이력 표기로 낮춘다(계속 안 사라지면 지금도 쫓기는 중처럼 읽힘).
const CAMERA_DETECTION_BANNER_WINDOW = 400;

function IconHeart() { return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17s-6.2-3.9-6.2-8.5A3.8 3.8 0 0 1 10 6.1a3.8 3.8 0 0 1 6.2 2.4C16.2 13.1 10 17 10 17z"/></svg>`; }
function IconClock() { return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>`; }
function IconBox() { return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z"/><path d="M3 6.5V14l7 3.5 7-3.5V6.5"/><path d="M10 10v7.5"/></svg>`; }
function IconTarget() { return html`<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.4"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/></svg>`; }
function IconList() { return html`<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h12M4 10h12M4 15h8"/></svg>`; }

/** @param {{kind: string, equipmentId?: string, defId?: string, value?: number, amount?: number}} loot */
function farmLootDisplay(loot) {
  return describeItem({ ...loot, durability: loot.kind === 'equipment' ? 10 : undefined });
}

/**
 * 노드 하나를 사람이 읽는 문장으로 요약 — 지도 위 호버 툴팁과 "선택 노드" 패널이 같은 문구를 쓴다.
 * debugReveal이 true면 실제 안개 상태(knowledge)는 그대로 반환하되(이동 가능 판정이 이걸 씀),
 * 문구에는 위협 상세(모드/경계/규모)와 현장 기회까지 안개와 무관하게 덧붙인다.
 */
function describeNode(run, n, threatsByNode, exitByNode, debugReveal = false) {
  const knowledge = nodeKnowledge(run, n.id);
  const exit = exitByNode[n.id];
  const live = debugReveal || knowledge === 'current' || knowledge === 'fresh';
  const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
  const threatCount = live ? (threatsByNode[n.id] || []).length : (run.observations[n.id]?.hasThreat ? null : 0);
  const knowledgeLabel = { current: '현재 위치', fresh: '시야 안(실시간)', stale: '마지막 확인 정보(고정)', unknown: '미확인' }[knowledge];
  const opp = run.graph.opportunities.find((o) => o.nodeId === n.id && o.usesRemaining > 0);
  const devicesDiscovered = debugReveal || run.visitedNodeIds.includes(n.id);
  const camera = devicesDiscovered ? run.graph.cameras.find((device) => device.nodeId === n.id) : null;
  const accessInterface = devicesDiscovered ? run.graph.accessInterfaces.find((device) => device.nodeId === n.id) : null;
  const generator = devicesDiscovered ? (run.graph.generators || []).find((device) => device.nodeId === n.id) : null;
  const debugThreats = debugReveal ? (threatsByNode[n.id] || []) : [];
  const title = [
    `${SECTOR_NAMES[n.sectorId]} · ${knowledgeLabel}${debugReveal ? ' · DEBUG' : ''}`,
    exit ? (exit.kind === 'key' ? '숨겨진 열쇠 탈출구' : `표준 탈출구 ${exit.exitId} (${exitStatusLabel(exit)})`) : null,
    (knowledge === 'unknown' && !debugReveal) ? null : (hasThreat ? `위협 포착${threatCount ? ` (${threatCount}개 그룹)` : ''}` : '위협 없음(확인 시점 기준)'),
    debugReveal && opp ? `현장 기회 ${opp.usesRemaining}회 남음` : null,
    camera ? `카메라 ${run.disabledCameraIds?.includes(camera.id) ? '파괴됨' : (isCameraHackActive(run, camera.id) ? '해킹됨' : '작동 중')}` : null,
    accessInterface ? `접속 인터페이스 ${run.hackedInterfaceIds?.includes(accessInterface.id) ? '해킹됨' : '미해킹'}` : null,
    generator ? `배터리 발전기 ${run.disabledGeneratorIds.includes(generator.id) ? '무력화됨' : '작동 중'}` : null,
    run.activeRecon?.targetNodeIds.includes(n.id) ? '실시간 정찰 중' : null,
    debugThreats.length ? debugThreats.map((t) => `[${t.id}] 규모 ${t.size} · ${t.mode} · 경계 ${t.alert}`).join(' / ') : null,
  ].filter(Boolean).join(' — ');
  return { knowledge, exit, hasThreat, threatCount, title };
}

export function MapScreen() {
  const [showInventory, setShowInventory] = useState(false);
  const [error, setError] = useState('');
  const [fieldPicker, setFieldPicker] = useState(null); // {instanceId, contract} | null — 대상(엣지/노드) 지정 중인 현장 장비
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 }); // 지도 확대/이동
  const [hover, setHover] = useState(null); // {x, y, text} | null — 커스텀 툴팁(브라우저 기본 title의 지연 없이 즉시 표시)
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // 노드 호버 시 연결 엣지 강조용
  const [selectedNodeId, setSelectedNodeId] = useState(null); // 클릭해 "선택 노드" 패널에 고정한 노드
  const [legendOpen, setLegendOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [debugReveal, setDebugReveal] = useState(false); // 디버그: 안개/미발견 상태 무시하고 전부 표시(순수 뷰 전환 — 실제 run 상태는 안 건드림)
  const [farmPlan, setFarmPlan] = useState(null);
  const [farmToast, setFarmToast] = useState(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, moved: false });
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const run = snapshot.facilityRunState;
  if (!run) return null;

  const farmResult = run.lastActionResult?.kind === 'farm' && run.lastActionResult.loot
    ? run.lastActionResult
    : null;
  const farmToastKey = farmResult ? `${farmResult.opportunityId}:${farmResult.completedAt}` : null;
  useEffect(() => {
    if (!farmResult || !farmToastKey) return undefined;
    setFarmToast({ key: farmToastKey, loot: farmResult.loot });
    const timer = setTimeout(() => setFarmToast((current) => (current?.key === farmToastKey ? null : current)), 3500);
    return () => clearTimeout(timer);
  }, [farmToastKey]);

  const capabilities = computeCapabilities(ps.loadout);
  const hasMapImplant = !!getImplantEffect(ps.loadout, 'sectorLandmarkArrow');
  const landmarkArrowTarget = getSectorLandmarkArrowTarget(run, hasMapImplant);
  const fieldEquipment = listFieldActiveEquipment(ps.loadout);
  const burdenCount = getBurdenItems(ps.inventory).length;
  const positions = layoutPositions(run.graph);
  const zones = sectorZones(run.graph, positions);

  const threatsByNode = {};
  for (const threat of Object.values(run.threats)) (threatsByNode[threat.nodeId] ||= []).push(threat);
  const exitByNode = {};
  for (const exit of Object.values(run.exits)) {
    if (exit.kind === 'key' && !run.keyDiscovered && !debugReveal) continue;
    exitByNode[exit.nodeId] = exit;
  }

  const currentSectorId = run.graph.nodes.find((n) => n.id === run.playerNodeId)?.sectorId;
  const currentSectorAlert = currentSectorId ? run.sectorAlerts[currentSectorId] : null;
  const currentLandmark = run.graph.landmarks.find((l) => l.nodeId === run.playerNodeId);
  const currentExit = exitByNode[run.playerNodeId];
  const currentOpportunities = run.graph.opportunities.filter((o) => o.nodeId === run.playerNodeId && o.usesRemaining > 0);
  const visitedNodeIds = new Set(run.visitedNodeIds);
  const isDeviceVisible = (nodeId) => debugReveal || visitedNodeIds.has(nodeId);
  const cameraByNode = Object.fromEntries(run.graph.cameras.filter((camera) => isDeviceVisible(camera.nodeId)).map((camera) => [camera.nodeId, camera]));
  const interfaceNodeIds = new Set(run.graph.accessInterfaces.filter((entry) => isDeviceVisible(entry.nodeId)).map((entry) => entry.nodeId));
  const currentInterface = run.graph.accessInterfaces.find((entry) => entry.nodeId === run.playerNodeId);
  const currentInterfaceHacked = !!currentInterface && (run.hackedInterfaceIds || []).includes(currentInterface.id);
  const cameraRange = cameraHackRange(capabilities.hacking);
  const cameraHops = bfsHopDistances(run.graph.edges, run.playerNodeId);
  const canHackDevice = (nodeId) => {
    if (capabilities.hacking < 1) return false;
    const targetSectorId = run.graph.nodes.find((node) => node.id === nodeId)?.sectorId;
    if (currentInterfaceHacked && targetSectorId === currentSectorId) return true;
    return (cameraHops.get(nodeId) ?? Infinity) <= cameraRange;
  };
  const hackableCameras = run.graph.cameras.filter((camera) => isDeviceVisible(camera.nodeId)
    && canHackDevice(camera.nodeId) && !(run.disabledCameraIds || []).includes(camera.id));
  const generatorByNode = Object.fromEntries((run.graph.generators || []).filter((generator) => isDeviceVisible(generator.nodeId)).map((generator) => [generator.nodeId, generator]));
  const currentGenerator = (run.graph.generators || []).find((generator) => generator.nodeId === run.playerNodeId);
  const currentCamera = run.graph.cameras.find((camera) => camera.nodeId === run.playerNodeId);
  const hackableGenerators = (run.graph.generators || []).filter((generator) => isDeviceVisible(generator.nodeId)
    && canHackDevice(generator.nodeId) && !run.disabledGeneratorIds.includes(generator.id));
  const activeReconNodeIds = new Set(run.activeRecon?.targetNodeIds || []);
  const openableEdgeIds = new Set(
    run.graph.edges
      .filter((e) => (e.from === run.playerNodeId || e.to === run.playerNodeId)
        && (e.features.includes('blocked') || e.features.includes('electronic'))
        && !run.openedEdgeIds.includes(e.id))
      .map((e) => e.id),
  );
  const currentSpecialEdges = run.graph.edges.filter((e) => openableEdgeIds.has(e.id));
  const pickableEdgeIds = fieldPicker && fieldPicker.contract.fieldAction.targetKind === 'edge'
    ? new Set(candidateEdgesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((e) => e.id))
    : null;
  const activeBarriers = {};
  for (const b of run.activeBarriers) activeBarriers[b.edgeId] = b;
  const highlightedEdgeIds = hoveredNodeId
    ? new Set(
      run.graph.edges
        .filter((e) => (e.from === hoveredNodeId || e.to === hoveredNodeId)
          && (hoveredNodeId === run.playerNodeId || e.from === run.playerNodeId || e.to === run.playerNodeId))
        .map((e) => e.id),
    )
    : null;

  function runCommand(command) {
    const before = snapshotSignal.value;
    dispatch(command);
    if (snapshotSignal.value === before) setError('행동 실패 — 조건을 확인하세요.');
    else { setError(''); setFieldPicker(null); }
  }

  const handleNodeSelect = (nodeId) => {
    if (dragRef.current.moved) return; // 지도 드래그 끝에 이어진 클릭은 무시
    setSelectedNodeId(nodeId);
  };

  const handleMove = (nodeId) => {
    if (!isTrueAdjacent(run, nodeId)) return;
    runCommand({ type: 'MOVE_TO_NODE', nodeId });
    setSelectedNodeId(null);
  };

  const handleEdgeClick = (edge) => {
    if (dragRef.current.moved) return;
    if (pickableEdgeIds) {
      if (!pickableEdgeIds.has(edge.id)) return;
      runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: edge.id });
      return;
    }
    if (!openableEdgeIds.has(edge.id)) return;
    const kind = edge.features.includes('electronic') ? 'hacking' : 'force';
    runCommand({ type: 'OPEN_SPECIAL_EDGE', edgeId: edge.id, capabilityKind: kind, mode: 'normal' });
  };

  const zoomBy = (factor) => setView((v) => ({ ...v, scale: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.scale * factor)) }));
  const resetView = () => setView({ x: 0, y: 0, scale: 1 });
  const focusOnPlayer = () => {
    const pos = positions[run.playerNodeId];
    const scale = Math.max(view.scale, 1.3);
    setView({ scale, x: -(pos.x - CANVAS_CENTER) * scale, y: -(pos.y - CANVAS_CENTER) * scale });
  };
  const handleWheel = (ev) => {
    ev.preventDefault();
    zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  const handleCanvasMouseDown = (ev) => {
    dragRef.current = { dragging: true, lastX: ev.clientX, lastY: ev.clientY, moved: false };
  };
  const handleCanvasMouseMove = (ev) => {
    if (!dragRef.current.dragging) return;
    const dx = ev.clientX - dragRef.current.lastX;
    const dy = ev.clientY - dragRef.current.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
    dragRef.current.lastX = ev.clientX;
    dragRef.current.lastY = ev.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const handleCanvasMouseUp = () => { dragRef.current.dragging = false; };
  const showHover = (ev, text) => setHover({ x: ev.clientX, y: ev.clientY, text });
  const hideHover = () => setHover(null);
  const recenterAt = (canvasX, canvasY) => setView((v) => ({ ...v, x: -(canvasX - CANVAS_CENTER) * v.scale, y: -(canvasY - CANVAS_CENTER) * v.scale }));

  // 현재 뷰(팬/줌)에서 실제로 보이는 캔버스 좌표 범위 — 미니맵 뷰포트 사각형 계산용.
  const visibleRect = {
    minX: (0 - view.x - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    maxX: (CANVAS_WIDTH - view.x - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    minY: (0 - view.y - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    maxY: (CANVAS_HEIGHT - view.y - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
  };

  const inspectedId = selectedNodeId || run.playerNodeId;
  const inspectedNode = run.graph.nodes.find((n) => n.id === inspectedId);
  const inspected = inspectedNode ? describeNode(run, inspectedNode, threatsByNode, exitByNode) : null;
  const inspectedObservedAt = selectedNodeId && run.observations[selectedNodeId] ? run.observations[selectedNodeId].observedAt : null;
  const selectedEdge = selectedNodeId ? findTraversableEdge(run, selectedNodeId) : null;
  const selectedEdgeTraversable = selectedEdge ? canTraverseEdge(run, selectedEdge, capabilities.mobility) : false;
  const selectedCamera = selectedNodeId ? cameraByNode[selectedNodeId] : null;
  const selectedCameraActive = selectedCamera
    && !(run.disabledCameraIds || []).includes(selectedCamera.id)
    && !isCameraHackActive(run, selectedCamera.id);

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--color-divider)', padding: 'var(--space-3) var(--space-6)', flexShrink: 0 }}>
        <h2 style=${{ margin: 0, fontSize: '18px' }}>시설맵</h2>
        <div style=${{ display: 'flex', gap: 0, fontSize: '13px', alignItems: 'stretch' }}>
          <${Tooltip} content="현재 체력입니다. 0이 되면 전투 불능으로 런이 종료됩니다. 필드에서는 소모품으로만 회복할 수 있습니다.">
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
              <${IconHeart} /><span>HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
            </div>
          <//>
          <${Tooltip} content=${`시설이 붕괴되기까지 남은 시간입니다. ${RUN_COLLAPSE_TIME}에 도달하면 즉시 런이 종료됩니다(탈출 실패).`}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
              <${IconClock} /><span>시간 <strong>${run.time}</strong>/${RUN_COLLAPSE_TIME}</span>
            </div>
          <//>
          <${Tooltip} content="현재 장착 장비가 만드는 과부화 바닥선 위로는 전투/현장 행동으로 계속 쌓입니다. 100을 넘겨도 런은 종료되지 않지만, 초과분은 전투 중 상태이상 카드로 전환됩니다.">
            <div style=${{ display: 'flex', alignItems: 'center', width: '130px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
              <${OverloadGauge} overload=${ps.overload} floor=${run.overloadFloor} compact=${true} />
            </div>
          <//>
          <${Tooltip} content=${`인벤토리 용량(${ps.inventory.capacity}칸)을 넘는 아이템은 "짐"이 되어 전투 중 과적 카드로 덱에 섞입니다. 용량 안으로 정리하세요.`}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)' }}>
              <${IconBox} /><span>인벤토리 <strong>${ps.inventory.items.length}</strong>/${ps.inventory.capacity}${burdenCount > 0 ? ` (짐 ${burdenCount})` : ''}</span>
            </div>
          <//>
        </div>
        <div style=${{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '6px 12px' }} onClick=${() => setShowInventory(true)}>인벤토리 / 장비교체</button>
          <button class="btn btn-secondary" style=${{ fontSize: '13px', fontWeight: 800, width: '34px', padding: '6px 0' }} onClick=${() => setLegendOpen((v) => !v)} title="범례">?</button>
          <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '6px 10px', background: logOpen ? 'var(--color-accent-100)' : undefined }} onClick=${() => setLogOpen((v) => !v)} title="행동 로그"><${IconList} /></button>
          <button
            class="btn btn-secondary"
            style=${{
              fontSize: '11px', fontWeight: 800, padding: '6px 10px', letterSpacing: '0.03em',
              borderColor: 'var(--color-accent-2-700)', color: debugReveal ? 'var(--color-bg)' : 'var(--color-accent-2-700)',
              background: debugReveal ? 'var(--color-accent-2-700)' : undefined,
            }}
            onClick=${() => setDebugReveal((v) => !v)}
            title="디버그: 안개/미발견 상태 무시하고 위협 상세·현장 기회·특수 엣지·열쇠 탈출구를 전부 표시(뷰 전환일 뿐, 실제 진행 상태는 그대로 유지)"
          >DEBUG 전체보기</button>
        </div>
      </div>

      ${logOpen ? html`
        <div style=${{ border: 'none', borderBottom: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-6)', fontSize: '11px', flexShrink: 0 }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span class="tag tag-outline">행동 로그</span>
            <${HistoryControls} />
          </div>
          <div style=${{ maxHeight: '140px', overflowY: 'auto' }}><${PlayLog} /></div>
        </div>
      ` : null}

      ${error ? html`<div style=${{ fontSize: '12px', color: 'var(--color-negative, #dd2b0f)', padding: '0 var(--space-6)', flexShrink: 0 }}>${error}</div>` : null}
      ${run.lastCameraDetection ? (() => {
        const elapsed = run.time - run.lastCameraDetection.detectedAt;
        const recent = elapsed <= CAMERA_DETECTION_BANNER_WINDOW; // 최근 한동안만 "긴급"으로 강조 — 계속 안 사라지면 지금도 쫓기는 중처럼 읽혀서 오해를 줌.
        return html`
          <div style=${{
            fontSize: '12px', fontWeight: 800, padding: '7px var(--space-6)', flexShrink: 0,
            color: recent ? 'var(--color-bg)' : 'var(--color-text)',
            background: recent ? 'var(--color-negative, #dd2b0f)' : 'var(--color-neutral-200)',
          }}>
            카메라 발각 — ${run.lastCameraDetection.nodeId}에서 ${elapsed}포인트 전 위치가 노출됐습니다.${recent ? ' 반경 3홉 내 적이 이 위치로 이동했습니다.' : ''}
          </div>
        `;
      })() : null}

      ${run.encounter ? html`<${EncounterPanel} run=${run} capabilities=${capabilities} />` : null}

      ${farmToast ? (() => {
        const loot = farmLootDisplay(farmToast.loot);
        return html`<div style=${{ position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)', zIndex: 20, minWidth: '240px', padding: '10px 14px', border: '1px solid #15803d', borderLeft: '4px solid #15803d', background: '#f0fdf4', boxShadow: 'var(--shadow-lg)', color: '#14532d', fontSize: '12px' }}>
          <div style=${{ fontWeight: 800, marginBottom: '2px' }}>파밍 획득</div>
          <div><strong style=${{ color: loot.color }}>${loot.name}</strong>${loot.sub ? ` · ${loot.sub}` : ''}</div>
        </div>`;
      })() : null}

      <div style=${{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style=${{ position: 'relative', flex: 1, background: 'var(--color-bg)' }}
          onMouseDown=${handleCanvasMouseDown}
          onMouseMove=${handleCanvasMouseMove}
          onMouseUp=${handleCanvasMouseUp}
          onMouseLeave=${handleCanvasMouseUp}
        >
          <div style=${{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${() => zoomBy(1.25)}>+</button>
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${() => zoomBy(1 / 1.25)}>−</button>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${focusOnPlayer} title="현재 위치로"><${IconTarget} /></button>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${resetView}>초기화</button>
          </div>

          ${legendOpen ? html`
            <div style=${{
              position: 'absolute', top: '10px', left: '10px', zIndex: 3, width: '250px',
              background: 'var(--color-bg)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-3)', fontSize: '11px',
            }}>
              <div style=${{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong>범례</strong>
                <button class="btn btn-secondary" style=${{ fontSize: '10px', padding: '1px 7px' }} onClick=${() => setLegendOpen(false)}>닫기</button>
              </div>
              <div style=${{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-accent-2-700)' }}></span>현재 위치</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-bg)', border: '1.5px solid var(--color-divider)' }}></span>시야 안 · 안전(실시간)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-negative, #dd2b0f)' }}></span>시야 안 · 위협 포착(실시간)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-bg)', border: '1.5px solid var(--color-divider)', opacity: 0.55 }}></span>시야 밖 · 마지막 확인 안전</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-negative, #dd2b0f)', opacity: 0.55 }}></span>시야 밖 · 마지막 확인 위협</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)' }}></span>한 번도 확인 안 함</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-accent)' }}></span>탈출구(A/B/K, 안개 무관 항상 표시)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▲N</span>포착된 위협 그룹 수(시야 밖에서는 그룹 수 없이 ▲만)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '2px dashed var(--color-accent-2-700)' }}></span>미개방 특수 엣지(인접 시 클릭해 개방)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '3px dotted var(--color-neutral-900)' }}></span>임시 장벽 활성(적 이동 차단, 시한부)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▶</span>일방통행 엣지(화살표 방향으로만 이동 가능)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)', position: 'relative' }}><span style=${{ position: 'absolute', top: '-3px', right: '-3px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-accent-2-700)' }}></span></span>현장 기회 위치(DEBUG 전체보기 켰을 때만 표시)</div>
              </div>
            </div>
          ` : null}

          <svg
            width="100%" height="100%" viewBox=${`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} preserveAspectRatio="xMidYMid meet"
            style=${{ display: 'block', cursor: dragRef.current.dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onWheel=${handleWheel}
          >
            <g transform=${`translate(${view.x}, ${view.y}) translate(${CANVAS_CENTER}, ${CANVAS_CENTER}) scale(${view.scale}) translate(${-CANVAS_CENTER}, ${-CANVAS_CENTER})`}>
              <g>
                ${SECTOR_IDS.map((sectorId, i) => {
                  const zone = zones[sectorId];
                  if (!zone) return null;
                  const alert = run.sectorAlerts[sectorId];
                  const isCurrent = sectorId === currentSectorId;
                  return html`
                    <g key=${sectorId}>
                      <circle cx=${zone.cx} cy=${zone.cy} r=${zone.radius} fill=${i % 2 === 0 ? 'var(--color-neutral-100)' : 'transparent'} stroke="var(--color-divider)" stroke-width="1" stroke-dasharray="2 5" opacity="0.7"></circle>
                      <text x=${zone.cx} y=${zone.topY - 14} text-anchor="middle" font-size="14" font-weight="800" fill=${isCurrent ? 'var(--color-accent-700)' : 'var(--color-neutral-700)'}>${SECTOR_NAMES[sectorId]}</text>
                      ${[0, 1, 2].map((d) => html`<circle key=${d} cx=${zone.cx - 16 + d * 11} cy=${zone.topY - 4} r="2.6" fill=${d < alert.level ? 'var(--color-accent-600)' : 'var(--color-neutral-300)'}></circle>`)}
                    </g>
                  `;
                })}
              </g>
              <g>
                ${run.graph.edges.map((e) => {
                  const from = positions[e.from]; const to = positions[e.to];
                  // 특수 엣지의 존재(잠김/일방통행 여부)는 두 끝 노드 중 하나라도 가봤거나
                  // 정찰해 본 적이 있어야만(unknown이 아니어야) 드러난다 — 그 전까지는 평범한
                  // 엣지처럼 보인다. 실제로 열 수 있는지(openable)는 항상 인접 엣지에서만
                  // 계산되므로 이 게이팅과 무관하게 이미 안전하다.
                  const revealed = debugReveal || nodeKnowledge(run, e.from) !== 'unknown' || nodeKnowledge(run, e.to) !== 'unknown';
                  const special = e.features.length > 0 && revealed;
                  const opened = run.openedEdgeIds.includes(e.id);
                  const openable = openableEdgeIds.has(e.id);
                  const pickable = pickableEdgeIds?.has(e.id);
                  const barrier = activeBarriers[e.id];
                  const highGround = e.features.includes('highGround');
                  const highlighted = !!highlightedEdgeIds?.has(e.id);
                  const dashed = special && !opened;
                  const clickable = openable || !!pickable;
                  const stroke = barrier ? 'var(--color-neutral-900)' : pickable ? 'var(--color-accent)' : openable ? 'var(--color-accent-2-700)' : highGround ? '#7c3aed' : 'var(--color-divider)';
                  const barrierLabel = barrier ? ` — 임시 장벽 활성(적 이동 차단, 만료 ${barrier.expiresAt})` : '';
                  const oneWay = e.bidirectional === false && revealed;
                  const edgeLabel = `${e.from} ${oneWay ? '→' : '↔'} ${e.to} — 이동 시간 ${e.timeCost}${oneWay ? ' — 일방통행(역방향 이동 불가)' : ''}${special ? ` — 특수 엣지(${e.features.join('/')})${opened ? ' · 개방됨' : ' · 미개방'}` : ''}${barrierLabel}`;
                  const midX = (from.x + to.x) / 2; const midY = (from.y + to.y) / 2;
                  const angleDeg = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
                  return html`
                    <g key=${e.id}>
                      ${highlighted ? html`<line x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke="var(--color-accent-300)" stroke-width="9" pointer-events="none"></line>` : null}
                      <line x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke=${stroke} stroke-width=${clickable ? 4 : 1.5} stroke-dasharray=${barrier ? '2 3' : dashed ? '5 3' : undefined} pointer-events="none"></line>
                      ${oneWay ? html`<polygon points="-7,-5 7,0 -7,5" fill=${stroke} transform=${`translate(${midX},${midY}) rotate(${angleDeg})`} pointer-events="none"></polygon>` : null}
                      <line
                        x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke="transparent" stroke-width="16"
                        style=${{ cursor: clickable ? 'pointer' : 'default' }}
                        onClick=${() => handleEdgeClick(e)}
                        onMouseEnter=${(ev) => showHover(ev, edgeLabel)} onMouseMove=${(ev) => showHover(ev, edgeLabel)} onMouseLeave=${hideHover}
                        tabindex=${clickable ? 0 : undefined}
                        onFocus=${(ev) => showHover(ev, edgeLabel)} onBlur=${hideHover}
                        onKeyDown=${(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) handleEdgeClick(e); }}
                      ></line>
                    </g>
                  `;
                })}
              </g>
              ${run.graph.nodes.map((n) => {
                const knowledge = nodeKnowledge(run, n.id);
                const pos = positions[n.id];
                const exit = exitByNode[n.id];
                const live = debugReveal || knowledge === 'current' || knowledge === 'fresh';
                const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
                const threatCount = live ? (threatsByNode[n.id] || []).length : (run.observations[n.id]?.hasThreat ? null : 0);
                // displayKnowledge: 디버그 모드에서 색/투명도만 "다 보임"으로 바꾼다(진짜 knowledge는
                // 그대로 둬서 이동 가능 판정 등 다른 로직은 안개 규칙을 그대로 따른다).
                const displayKnowledge = debugReveal ? (n.id === run.playerNodeId ? 'current' : 'fresh') : knowledge;
                const opportunity = debugReveal ? run.graph.opportunities.find((o) => o.nodeId === n.id && o.usesRemaining > 0) : null;
                const nodeTitle = describeNode(run, n, threatsByNode, exitByNode, debugReveal).title;
                const isSelected = n.id === selectedNodeId || (!selectedNodeId && n.id === run.playerNodeId);
                const activelyObserved = activeReconNodeIds.has(n.id);
                const camera = cameraByNode[n.id];
                const hasInterface = interfaceNodeIds.has(n.id);
                const generator = generatorByNode[n.id];
                return html`
                  <g key=${n.id}>
                    ${activelyObserved ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="rgba(14, 165, 233, 0.16)" stroke="#0ea5e9" stroke-width="3" pointer-events="none"></circle>` : null}
                    ${isSelected ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 6} fill="none" stroke="var(--color-accent)" stroke-width="2" pointer-events="none"></circle>` : null}
                    <circle cx=${pos.x} cy=${pos.y} r=${exit ? NODE_RADIUS + 4 : NODE_RADIUS} fill=${nodeFill(displayKnowledge, hasThreat, !!exit)} stroke="var(--color-divider)" stroke-width="1.5" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none"></circle>
                    ${exit ? html`<text x=${pos.x} y=${pos.y + 5} text-anchor="middle" font-size="12" font-weight="800" fill="var(--color-bg)" pointer-events="none">${exit.kind === 'key' ? 'K' : exit.exitId}</text>` : null}
                    ${hasThreat ? html`<text x=${pos.x} y=${pos.y - NODE_RADIUS - 8} text-anchor="middle" font-size="13" fill="var(--color-accent-2-700, #dd2b0f)" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">▲${threatCount ?? ''}</text>` : null}
                    ${opportunity ? html`<circle cx=${pos.x + 9} cy=${pos.y - 9} r="3.5" fill="var(--color-accent-2-700)" stroke="var(--color-bg)" stroke-width="1" pointer-events="none"></circle>` : null}
                    ${camera ? html`<text x=${pos.x - 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledCameraIds?.includes(camera.id) ? '#64748b' : (isCameraHackActive(run, camera.id) ? '#0ea5e9' : '#dc2626')} pointer-events="none">C</text>` : null}
                    ${hasInterface ? html`<text x=${pos.x + 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill="#7c3aed" pointer-events="none">I</text>` : null}
                    ${generator ? html`<text x=${pos.x} y=${pos.y + 22} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledGeneratorIds.includes(generator.id) ? '#64748b' : '#ca8a04'} pointer-events="none">G</text>` : null}
                    <circle
                      cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="transparent"
                      style=${{ cursor: 'pointer' }}
                      onClick=${() => handleNodeSelect(n.id)}
                      onMouseEnter=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onMouseMove=${(ev) => showHover(ev, nodeTitle)}
                      onMouseLeave=${() => { hideHover(); setHoveredNodeId(null); }}
                      tabindex="0"
                      onFocus=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onBlur=${() => { hideHover(); setHoveredNodeId(null); }}
                      onKeyDown=${(ev) => { if (ev.key === 'Enter' || ev.key === ' ') handleNodeSelect(n.id); }}
                    ></circle>
                  </g>
                `;
              })}
              ${landmarkArrowTarget ? (() => {
                const from = positions[run.playerNodeId];
                const to = positions[landmarkArrowTarget.nodeId];
                const angle = Math.atan2(to.y - from.y, to.x - from.x);
                const angleDeg = angle * 180 / Math.PI;
                const sx = from.x + Math.cos(angle) * 20;
                const sy = from.y + Math.sin(angle) * 20;
                const ax = from.x + Math.cos(angle) * 46;
                const ay = from.y + Math.sin(angle) * 46;
                const name = LANDMARKS_BY_SECTOR[landmarkArrowTarget.sectorId]?.name || landmarkArrowTarget.id;
                const label = `지도 임플란트 — 구역 핵심시설: ${name}`;
                return html`
                  <g pointer-events="none">
                    <line x1=${sx} y1=${sy} x2=${ax} y2=${ay} stroke="var(--color-accent)" stroke-width="3" stroke-linecap="round"></line>
                    <polygon points="-6,-5 8,0 -6,5" fill="var(--color-accent)" transform=${`translate(${ax},${ay}) rotate(${angleDeg})`}></polygon>
                  </g>
                  <circle
                    cx=${ax} cy=${ay} r="14" fill="transparent" style=${{ cursor: 'default' }}
                    onMouseEnter=${(ev) => showHover(ev, label)} onMouseMove=${(ev) => showHover(ev, label)} onMouseLeave=${hideHover}
                  ></circle>
                `;
              })() : null}
            </g>
          </svg>

          <div style=${{ position: 'absolute', left: '10px', bottom: '10px', width: '180px', height: '180px', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-md)', zIndex: 2 }}>
            <svg width="100%" height="100%" viewBox=${`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} style=${{ display: 'block', cursor: 'pointer' }}
              onClick=${(ev) => {
                const rect = ev.currentTarget.getBoundingClientRect();
                const px = (ev.clientX - rect.left) / rect.width * CANVAS_WIDTH;
                const py = (ev.clientY - rect.top) / rect.height * CANVAS_HEIGHT;
                recenterAt(px, py);
              }}
            >
              ${run.graph.edges.map((e) => {
                const from = positions[e.from]; const to = positions[e.to];
                return html`<line key=${e.id} x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke="var(--color-neutral-300)" stroke-width="1.5"></line>`;
              })}
              ${run.graph.nodes.map((n) => {
                const pos = positions[n.id];
                const exit = exitByNode[n.id];
                const isCurrent = n.id === run.playerNodeId;
                if (exit) return html`<circle key=${n.id} cx=${pos.x} cy=${pos.y} r="9" fill="var(--color-accent)"></circle>`;
                return html`<circle key=${n.id} cx=${pos.x} cy=${pos.y} r=${isCurrent ? 12 : 5} fill=${isCurrent ? 'var(--color-accent-2-700)' : 'var(--color-neutral-400)'}></circle>`;
              })}
              <rect x=${visibleRect.minX} y=${visibleRect.minY} width=${visibleRect.maxX - visibleRect.minX} height=${visibleRect.maxY - visibleRect.minY} fill="none" stroke="var(--color-accent)" stroke-width="8"></rect>
            </svg>
          </div>

          ${hover ? html`
            <div style=${{
              position: 'fixed', left: `${hover.x + 14}px`, top: `${hover.y + 14}px`, zIndex: 100,
              background: 'var(--color-neutral-900)', color: 'var(--color-bg)', padding: '6px 10px',
              fontSize: '11px', lineHeight: 1.5, maxWidth: '260px', boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
            }}>${hover.text}</div>
          ` : null}
        </div>

        <div style=${{ width: '340px', flexShrink: 0, borderLeft: '2px solid var(--color-divider)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style=${{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)' }}>
            <h4 style=${{ margin: '0 0 6px' }}>현재 위치</h4>
            <div style=${{ fontSize: '15px', fontWeight: 800 }}>${currentSectorId ? SECTOR_NAMES[currentSectorId] : '-'}</div>
            <${Tooltip} align="left" content="구역 경계 단계(0~3) — 소음/가짜 목표를 조사하고도 원인을 못 찾을 때마다 1씩 오릅니다. 저절로 내려가지 않으며, 높을수록 그 구역 위협들이 더 쉽게 추적 모드로 전환됩니다.">
              <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', width: 'fit-content' }}>경계도 ${currentSectorAlert ? currentSectorAlert.level : '-'}/3</div>
            <//>
            <div style=${{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              ${['A', 'B'].map((exitId) => html`
                <${Tooltip} key=${exitId} align="left" content=${`표준 탈출구 ${exitId}. ${EXIT_STATUS_DESCRIPTIONS[run.exits[exitId].status]}`}>
                  <span class="tag tag-outline" style=${{ fontSize: '11px' }}>${exitId} <strong>${exitStatusLabel(run.exits[exitId])}</strong></span>
                <//>
              `)}
              <${Tooltip} align="left" content="시설 어딘가의 현장 기회(파밍 지점)를 확보하면 낮은 확률로 발견되는 숨겨진 열쇠 탈출구입니다. 발견 전엔 위치를 알 수 없습니다.">
                <span class="tag tag-outline" style=${{ fontSize: '11px' }}>열쇠 <strong>${run.keyDiscovered ? '알려짐' : '-'}</strong></span>
              <//>
            </div>
          </div>

          <div style=${{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)' }}>
            <h4 style=${{ margin: '0 0 8px' }}>Capability</h4>
            <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              ${CAPABILITY_ORDER.map((key) => {
                const raw = capabilities[key];
                const eff = effectiveForRequirement(raw);
                return html`
                  <${Tooltip} key=${key} width=${240} align="left" content=${`${CAPABILITY_LABELS[key]} — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(요구치 판정 시 유효치 ${eff}). ${capabilityActionSummary(key, raw)}`}>
                    <span class="tag tag-outline">${CAPABILITY_SHORT[key]} ${raw >= 0 ? '+' : ''}${raw}</span>
                  <//>
                `;
              })}
            </div>
          </div>

          <div style=${{ padding: 'var(--space-3) var(--space-4)', flex: 1 }}>
            <h4 style=${{ margin: '0 0 4px' }}>${selectedNodeId && selectedNodeId !== run.playerNodeId ? '선택 노드' : '현재 노드'}</h4>
            ${inspected ? html`
              <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', marginBottom: '10px' }}>${inspected.title}</div>
              ${inspected.knowledge === 'stale' && inspectedObservedAt != null ? html`<div style=${{ fontSize: '10.5px', fontStyle: 'italic', color: 'var(--color-neutral-600)', marginBottom: '10px' }}>마지막 관측: 시간 ${inspectedObservedAt} 시점 — 그 사이 상황이 바뀌었을 수 있습니다.</div>` : null}

              ${selectedNodeId && selectedNodeId !== run.playerNodeId && inspected.knowledge === 'fresh' ? html`
                <button class="btn btn-primary" disabled=${!selectedEdgeTraversable} style=${{ fontSize: '12px', width: '100%', marginBottom: '2px' }} onClick=${() => handleMove(selectedNodeId)}>이 노드로 이동</button>
                <div style=${{ fontSize: '10.5px', color: selectedEdgeTraversable ? 'var(--color-neutral-600)' : 'var(--color-negative, #dd2b0f)', marginBottom: '10px' }}>
                  ${selectedEdge?.features.includes('highGround') && capabilities.mobility < 3
                    ? `높은 지형 — Mobility 3 필요 (현재 ${capabilities.mobility})`
                    : `기본 시간 ${selectedEdge?.timeCost ?? '?'} · Mobility 보정 적용`}
                </div>
                ${selectedEdgeTraversable ? html`<div style=${{ fontSize: '10.5px', color: movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).color, marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>${movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).label}</div>` : null}
                ${selectedCameraActive && capabilities.stealth < 3 ? html`<div style=${{ fontSize: '10.5px', color: '#dc2626', marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>카메라 감시: Stealth 3 미만으로 진입하면 발각되어 주변 적이 추적합니다.</div>` : null}
              ` : null}

              ${(!selectedNodeId || selectedNodeId === run.playerNodeId) ? html`
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>정찰</div>
                    <${Tooltip} align="left" content="현재 노드와 인접 노드에 위협이 있는지 없는지만 확인합니다(정확한 수·경계 상태는 알 수 없음). 시간 80 소요, 소음 없음, 항상 성공합니다.">
                      <button class="btn btn-secondary" style=${{ fontSize: '12px', width: '100%' }} onClick=${() => runCommand({ type: 'BASIC_RECON' })}>기본 정찰</button>
                    <//>
                    ${run.activeRecon ? html`
                      <div style=${{ marginTop: '5px', padding: '5px 7px', borderLeft: '3px solid #0ea5e9', background: 'rgba(14, 165, 233, 0.10)', fontSize: '10.5px' }}>
                        실시간 정찰 중 · ${run.activeRecon.source === 'camera' ? `카메라 ${run.activeRecon.sourceNodeId}` : '현재 위치'}
                        ${run.activeRecon.expiresAt == null ? ' · 이동/다른 정찰 전까지 유지' : ` · ${run.activeRecon.expiresAt}까지`}
                      </div>
                    ` : null}
                  </div>

                  ${(() => {
                    const concealmentValue = run.graph.concealmentByNodeId[run.playerNodeId];
                    const scouted = run.observations[run.playerNodeId]?.concealment != null;
                    if (!concealmentValue || !scouted) return null;
                    const active = run.activeConcealment?.nodeId === run.playerNodeId;
                    return html`
                      <div>
                        <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: '4px' }}>은엄폐</div>
                        ${active
                          ? html`<div style=${{ fontSize: '10.5px', color: 'var(--color-accent-700)', fontWeight: 800 }}>사용 중 · 은신 +${run.activeConcealment.bonus} (이 노드를 벗어나면 사라짐)</div>`
                          : html`
                            <${Tooltip} align="left" content=${`이 노드에 배치된 은엄폐(+${concealmentValue})를 사용해 이 자리에 머무는 동안 실효 Stealth를 올립니다. 시간 20 소요. 다른 노드로 이동하면 사라집니다.`}>
                              <button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', borderColor: 'var(--color-accent)', color: 'var(--color-accent-700)' }} onClick=${() => runCommand({ type: 'USE_CONCEALMENT' })}>은엄폐 사용 (은신 +${concealmentValue}, 시간 20)</button>
                            <//>
                          `}
                      </div>
                    `;
                  })()}

                  ${currentInterface ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: '4px' }}>카메라 접속 인터페이스</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>
                        ${currentInterfaceHacked
    ? '접속 완료 · 이 구역의 발견한 모든 해킹 지점에 원격 접속할 수 있습니다.'
    : `미해킹 · 이 노드에서 먼저 접속 인터페이스를 해킹해야 구역 원격 접속이 열립니다. Hacking ${capabilities.hacking}의 직접 사거리는 ${cameraRange}홉입니다.`}
                      </div>
                      ${!currentInterfaceHacked ? html`
                        <button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'HACK_ACCESS_INTERFACE', interfaceId: currentInterface.id })}>
                          접속 인터페이스 해킹 (시간 100 · 과부화 +6)
                        </button>
                      ` : null}
                      ${hackableCameras.length > 0 ? hackableCameras.map((camera) => html`
                        <button key=${camera.id} class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}>
                          ${camera.nodeId} 카메라 해킹 (${currentInterfaceHacked ? '구역 원격' : `${cameraHops.get(camera.nodeId) ?? '?'}홉 직접`})
                        </button>
                      `) : null}
                      ${hackableGenerators.map((generator) => html`
                        <button key=${generator.id} class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: generator.id, capabilityKind: 'hacking' })}>
                          배터리 발전기 ${currentInterfaceHacked ? '원격' : '직접'} 무력화 (${currentInterfaceHacked ? '구역 원격' : `${cameraHops.get(generator.nodeId) ?? '?'}홉`} · 과부화 +6)
                        </button>
                      `)}
                    </div>
                  ` : null}

                  ${!currentInterface && (hackableCameras.length > 0 || hackableGenerators.length > 0) ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: '4px' }}>직접 해킹</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>Hacking ${capabilities.hacking} · 현재 노드는 Hacking 1부터, 이후 레벨마다 직접 사거리가 1홉씩 늘어납니다.</div>
                      ${hackableCameras.map((camera) => html`
                        <button key=${camera.id} class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}>${camera.nodeId} 카메라 해킹 (${cameraHops.get(camera.nodeId)}홉)</button>
                      `)}
                      ${hackableGenerators.map((generator) => html`
                        <button key=${generator.id} class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: generator.id, capabilityKind: 'hacking' })}>배터리 발전기 해킹 무력화 (${cameraHops.get(generator.nodeId)}홉 · 과부화 +6)</button>
                      `)}
                    </div>
                  ` : null}

                  ${currentCamera ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#dc2626', marginBottom: '4px' }}>현재 노드 카메라</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>
                        ${(run.disabledCameraIds || []).includes(currentCamera.id)
    ? '파괴됨 · 더 이상 감지하지 않습니다.'
    : '해킹은 300시간 동안 정찰을 제공하고, 파괴는 영구적으로 감지를 막지만 소음을 발생시킵니다.'}
                      </div>
                      ${!(run.disabledCameraIds || []).includes(currentCamera.id) ? html`
                        <button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'DESTROY_CAMERA', cameraId: currentCamera.id })}>카메라 파괴 (Force 1 · 시간 100 · 소음 2)</button>
                      ` : null}
                    </div>
                  ` : null}

                  ${currentGenerator ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#ca8a04', marginBottom: '4px' }}>배터리 발전기</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>${run.disabledGeneratorIds.includes(currentGenerator.id) ? '무력화됨 — 이 구역 적의 시작 갑옷 보너스가 없습니다.' : '가동 중 — 이 구역 모든 적은 전투 시작 시 갑옷 5를 얻습니다.'}</div>
                      ${!run.disabledGeneratorIds.includes(currentGenerator.id) ? html`<button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }} onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: currentGenerator.id, capabilityKind: 'force' })}>Force로 발전기 무력화 (시간 100 · 소음 2)</button>` : null}
                    </div>
                  ` : null}

                  ${currentLandmark ? (() => {
                    const level = Math.max(0, Math.min(3, effectiveForRequirement(capabilities.hacking)));
                    const rows = [
                      { level: 1, label: '순찰경로 영구 표시' },
                      { level: 2, label: `경계도 -${Math.max(0, level - 1)}` },
                      { level: 3, label: '맵 전체 위협 patrol 전환' },
                    ];
                    return html`
                      <div>
                        <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: '4px' }}>구역 통제실</div>
                        <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '6px' }}>
                          현재 해킹 ${capabilities.hacking} — 실행하면 도달한 레벨까지 전부 적용됩니다(상위 레벨이 하위 효과 포함).
                        </div>
                        <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                          ${rows.map((row) => html`
                            <div key=${row.level} style=${{
                              display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', padding: '4px 6px',
                              background: row.level <= level ? 'var(--color-accent-100)' : 'var(--color-neutral-100)',
                              color: row.level <= level ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
                            }}>
                              <span>해킹 ${row.level}</span><span>${row.label}${row.level > level ? ' (잠김)' : ''}</span>
                            </div>
                          `)}
                        </div>
                        <${Tooltip} align="left" content="구역 랜드마크 노드에서만 시도할 수 있습니다. 접속 인터페이스 해킹과는 별개입니다. 시간 150 · 과부화 +10.">
                          <button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%' }} disabled=${level < 1} onClick=${() => runCommand({ type: 'HACK_CONTROL_ROOM' })}>통제실 해킹 실행</button>
                        <//>
                      </div>
                    `;
                  })() : null}

                  ${currentOpportunities.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>현장 기회</div>
                      ${currentOpportunities.map((opp, idx) => html`
                        <${Tooltip} key=${opp.id} align="left" content=${`이 노드의 현장 기회(자원)를 확보해 소지품으로 가져갑니다. 시간이 걸리고 약간의 소음이 발생하며, 이 기회는 앞으로 ${opp.usesRemaining}번 더 파밍할 수 있습니다.`}>
                          <button class="btn btn-secondary" style=${{ fontSize: '12px', width: '100%', marginBottom: '4px' }} onClick=${() => setFarmPlan(opp)}>현장 파밍${currentOpportunities.length > 1 ? ` #${idx + 1}` : ''} (${opp.usesRemaining}회 남음)</button>
                        <//>
                      `)}
                    </div>
                  ` : null}
                  ${farmPlan ? html`
                    <div style=${{ padding: '8px', border: '1px solid #b45309', background: '#fffbeb', fontSize: '11px' }}>
                      <strong>파밍 계획</strong> · 실행 전 접근 방식을 고르거나 중단할 수 있습니다. 행동 중 적 유입 시 전투가 발생할 수 있습니다.
                      <div style=${{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <${Tooltip} content="시간 +40, 소음 -1(최소 0). 적 유입 위험은 낮지만 시설 붕괴 시간은 더 소비합니다.">
                          <button class="btn btn-secondary" onClick=${() => { runCommand({ type: 'USE_OPPORTUNITY', opportunityId: farmPlan.id, mode: 'safe' }); setFarmPlan(null); }}>안전</button>
                        <//>
                        <${Tooltip} content="기본 시간 140, 기본 소음 1로 파밍합니다. 시간과 위험의 표준 선택입니다.">
                          <button class="btn btn-primary" onClick=${() => { runCommand({ type: 'USE_OPPORTUNITY', opportunityId: farmPlan.id, mode: 'normal' }); setFarmPlan(null); }}>파밍 실행</button>
                        <//>
                        <${Tooltip} content="시간 -40(최소 20), 소음 +1(최대 3). 빠르지만 적 유입·추적 위험이 커집니다.">
                          <button class="btn btn-secondary" onClick=${() => { runCommand({ type: 'USE_OPPORTUNITY', opportunityId: farmPlan.id, mode: 'rush' }); setFarmPlan(null); }}>강행</button>
                        <//>
                        <${Tooltip} content="아직 파밍을 시작하지 않고 선택창만 닫습니다. 시간·소음·아이템 변화가 없습니다.">
                          <button class="btn btn-secondary" onClick=${() => setFarmPlan(null)}>중단</button>
                        <//>
                      </div>
                    </div>
                  ` : null}
                  ${run.lastActionResult?.kind === 'farm' ? html`
                    <div style=${{ padding: '6px 8px', borderLeft: `3px solid ${run.lastActionResult.status === 'ambushed' ? '#dc2626' : '#15803d'}`, background: run.lastActionResult.status === 'ambushed' ? '#fef2f2' : '#f0fdf4', fontSize: '10.5px' }}>
                      ${run.lastActionResult.status === 'ambushed' ? '파밍 완료 직후 습격 발생 — 보상과 기회 사용은 반영되었습니다.' : '파밍 완료 — 보상과 남은 사용 횟수가 반영되었습니다.'}
                    </div>
                  ` : null}

                  ${currentSpecialEdges.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>환경 조작</div>
                      ${currentSpecialEdges.map((edge) => {
                        const kind = edge.features.includes('electronic') ? 'hacking' : 'force';
                        const kindLabel = kind === 'hacking' ? 'Hacking' : 'Force';
                        const overOverload = wouldExceedOverload(run, ps, (s) => openSpecialEdge(s, edge.id, kind, capabilities[kind], 'normal'));
                        return html`
                          <${Tooltip} key=${edge.id} align="left" content=${`이 통로는 특수 엣지(${edge.features.join('/')})로 막혀 있습니다. ${kindLabel} Capability 1 이상이 있어야 개방할 수 있고, 개방하면 소음/흔적이 남습니다. 현재 ${kindLabel} 유효치: ${effectiveForRequirement(capabilities[kind])}. 지도에서 이 엣지를 직접 클릭해도 됩니다.${overOverload ? ' 지금 열면 과부화가 100을 넘어 비활성화되어 있습니다.' : ''}`}>
                            <button class="btn btn-secondary" style=${{ fontSize: '12px', width: '100%', marginBottom: '4px' }} disabled=${overOverload} onClick=${() => handleEdgeClick(edge)}>
                              특수 엣지 개방 (${edge.features.join('/')})
                            </button>
                          <//>
                        `;
                      })}
                    </div>
                  ` : null}

                  ${fieldEquipment.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>현장 장비</div>
                      ${fieldEquipment.map((eq) => {
                        const fa = eq.contract.fieldAction;
                        const label = FIELD_ACTION_LABELS[fa.kind] || fa.kind;
                        const onCooldown = (run.fieldCooldowns[eq.instanceId] || 0) > run.time;
                        const needsTarget = fa.targetKind !== 'node_contents';
                        const overOverload = wouldExceedOverload(run, ps, (s) => applyOverloadDelta(s, fa.overloadGain));
                        const disabled = onCooldown || overOverload;
                        const handleClick = () => {
                          if (needsTarget) setFieldPicker({ instanceId: eq.instanceId, contract: eq.contract });
                          else runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: eq.instanceId });
                        };
                        return html`
                          <${Tooltip} key=${eq.instanceId} align="left" content=${`${eq.equipmentId} 능동 효과. ${FIELD_TARGET_LABELS[fa.targetKind] || fa.targetKind}. 시간 ${fa.timeCost}, 과부화 +${fa.overloadGain}, 재사용 대기 ${fa.cooldown}${fa.duration ? `, 지속 ${fa.duration}` : ''}.${onCooldown ? ' (현재 재사용 대기 중)' : ''}${overOverload ? ' 지금 쓰면 과부화가 100을 넘어 비활성화되어 있습니다.' : ''}${fa.targetKind === 'edge' ? ' 지도에서 강조된 엣지를 직접 클릭해 지정할 수 있습니다.' : ''}`}>
                            <button class="btn btn-secondary" style=${{ fontSize: '12px', width: '100%', marginBottom: '4px' }}
                              disabled=${disabled}
                              onClick=${handleClick}>
                              ${label} 사용${needsTarget ? '…' : ''}
                            </button>
                          <//>
                        `;
                      })}
                    </div>
                  ` : null}

                  ${currentExit && currentExit.kind === 'standard' && currentExit.status === 'closed' ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>탈출구</div>
                      <${Tooltip} align="left" content="탈출구를 여는 절차를 시작합니다. 요청 후 Hacking Capability가 높을수록 개방까지 대기 시간이 짧아지고, 열리면 이 노드에서 다음 행동이 끝나는 즉시 자동으로 탈출합니다(별도 확정 불필요). 일정 시간이 지나면 창이 다시 닫힙니다.">
                        <button class="btn btn-primary" style=${{ fontSize: '12px', width: '100%' }} onClick=${() => runCommand({ type: 'REQUEST_EXTRACTION', exitId: currentExit.exitId })}>탈출구 ${currentExit.exitId} 개방 요청 (Hacking ${effectiveForRequirement(capabilities.hacking)})</button>
                      <//>
                    </div>
                  ` : null}

                  ${fieldPicker ? html`
                    <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', border: '1px solid var(--color-divider)', padding: 'var(--space-2)', fontSize: '11px' }}>
                      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>${fieldPicker.contract.fieldAction.targetKind === 'edge'
                          ? `대상 엣지 선택 (사거리 ${fieldPicker.contract.fieldAction.range}) — 지도의 강조된 선 클릭`
                          : `대상 노드 선택 (사거리 ${fieldPicker.contract.fieldAction.range})`}</strong>
                        <button class="btn btn-secondary" style=${{ fontSize: '10px', padding: '2px 7px' }} onClick=${() => setFieldPicker(null)}>취소</button>
                      </div>
                      ${wouldExceedOverload(run, ps, (s) => applyOverloadDelta(s, fieldPicker.contract.fieldAction.overloadGain))
                        ? html`<div style=${{ color: 'var(--color-negative, #dd2b0f)' }}>지금 이 장비를 쓰면 과부화가 100을 넘어, 어떤 대상을 골라도 실행할 수 없습니다.</div>`
                        : html`
                          <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            ${fieldPicker.contract.fieldAction.targetKind === 'edge'
                              ? candidateEdgesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((edge) => html`
                                <button key=${edge.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                                  onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: edge.id })}>
                                  ${edge.from} ↔ ${edge.to}
                                </button>
                              `)
                              : candidateNodesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((node) => html`
                                <button key=${node.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                                  onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: node.id })}>
                                  ${SECTOR_NAMES[node.sectorId]} · ${node.id}
                                </button>
                              `)}
                          </div>
                        `}
                    </div>
                  ` : null}
                </div>
              ` : null}
            ` : null}
          </div>
        </div>
      </div>

      ${showInventory ? html`<${InventoryPopup} mode="manage" onClose=${() => setShowInventory(false)} />` : null}
    </div>
  `;
}
