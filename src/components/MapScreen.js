// 48노드 익스트랙션 맵 화면 (docs/extraction-map-implementation-spec.md §10, 사용자 피드백으로
// §10.2 안개 설계를 수정: 전체 지도(노드+엣지)는 항상 보이고, 위협 존재 여부 같은 "내용" 정보만
// 시야(현재+인접) 밖에서는 마지막으로 확인한 값으로 고정된다 — gameReducer.js의
// refreshLocalObservations가 매 행동 끝에 현재+인접 노드를 observations에 스냅샷한다).
import { html, useState, useRef } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeCapabilities, listFieldActiveEquipment, effectiveForRequirement } from '../engine/capabilityEngine.js';
import { bfsHopDistances } from '../engine/graphUtils.js';
import { openSpecialEdge, applyOverloadDelta } from '../engine/runEngine.js';
import { computeFloorOverload, computeOverloadGainMultiplier } from '../engine/equipmentEngine.js';
import { SECTOR_IDS, SECTOR_NAMES, RUN_COLLAPSE_TIME } from '../data/facilityLayout.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { OverloadGauge } from './OverloadGauge.js';
import { InventoryPopup } from './InventoryPopup.js';
import { Tooltip } from './Tooltip.js';
import { PlayLog } from './PlayLog.js';
import { HistoryControls } from './HistoryControls.js';

const FIELD_ACTION_LABELS = { snapshot_scan: '집중 투시', temporary_barrier: '임시 장벽', remote_intrusion: '원격 침투' };
const FIELD_TARGET_LABELS = { edge: '엣지(통로) 지정', node_contents: '주변 노드 파악', electronic_device: '전자 장치 지정' };

const CAPABILITY_ORDER = ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception'];
const CAPABILITY_LABELS = { perception: 'Perception', stealth: 'Stealth', hacking: 'Hacking', mobility: 'Mobility', force: 'Force', deception: 'Deception' };
const CAPABILITY_SHORT = { perception: 'P', stealth: 'S', hacking: 'H', mobility: 'M', force: 'F', deception: 'D' };
const CAPABILITY_ROLE = {
  perception: '주변 정보 파악(정찰 해상도).',
  stealth: '은신/소음 억제.',
  hacking: '전자 장치·탈출구 제어.',
  mobility: '이동·회피.',
  force: '물리적 장애물 돌파.',
  deception: '기만·위장.',
};

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
    return raw >= 2 ? '2 이상이라 전투 중 이탈 시도(BEGIN_DISENGAGE) 시 진행도 +1 보너스를 즉시 받습니다.' : '2 이상이면 전투 중 이탈 시도 시 진행도 +1 보너스를 받습니다(현재 미달).';
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

function isTrueAdjacent(run, nodeId) {
  return run.graph.edges.some((e) => (e.from === run.playerNodeId && e.to === nodeId) || (e.to === run.playerNodeId && e.from === nodeId));
}

/**
 * §10.2(수정): 전체 지도는 항상 보인다 — 이 함수는 "얼마나 최신 정보인가"만 구분한다.
 * current=지금 여기, fresh=지금 시야 안(인접), stale=예전에 관측했지만 지금은 시야 밖(마지막
 * 확인 정보 고정), unknown=한 번도 관측한 적 없음(존재/위치만 보임, 내용은 모름).
 */
function nodeKnowledge(run, nodeId) {
  if (run.playerNodeId === nodeId) return 'current';
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
  const synced = {
    ...run, overload: ps.overload,
    overloadFloor: computeFloorOverload(ps.loadout), overloadGainMultiplier: computeOverloadGainMultiplier(ps.loadout),
  };
  try {
    return actionFn(synced).overload > 100;
  } catch {
    return false;
  }
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export function MapScreen() {
  const [showInventory, setShowInventory] = useState(false);
  const [error, setError] = useState('');
  const [fieldPicker, setFieldPicker] = useState(null); // {instanceId, contract} | null — 대상(엣지/노드) 지정 중인 현장 장비
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 }); // 지도 확대/이동
  const [hover, setHover] = useState(null); // {x, y, text} | null — 커스텀 툴팁(브라우저 기본 title의 지연 없이 즉시 표시)
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // 노드 호버 시 연결 엣지 강조용
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, moved: false });
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const run = snapshot.facilityRunState;
  if (!run) return null;

  const capabilities = computeCapabilities(ps.loadout);
  const fieldEquipment = listFieldActiveEquipment(ps.loadout);
  const burdenCount = getBurdenItems(ps.inventory).length;
  const positions = layoutPositions(run.graph);

  const threatsByNode = {};
  for (const threat of Object.values(run.threats)) (threatsByNode[threat.nodeId] ||= []).push(threat);
  const exitByNode = {};
  for (const exit of Object.values(run.exits)) {
    if (exit.kind === 'key' && !run.keyDiscovered) continue;
    exitByNode[exit.nodeId] = exit;
  }

  const currentSectorId = run.graph.nodes.find((n) => n.id === run.playerNodeId)?.sectorId;
  const currentSectorAlert = currentSectorId ? run.sectorAlerts[currentSectorId] : null;
  const currentExit = exitByNode[run.playerNodeId];
  const currentOpportunities = run.graph.opportunities.filter((o) => o.nodeId === run.playerNodeId && o.usesRemaining > 0);
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

  const handleNodeClick = (nodeId) => {
    if (dragRef.current.moved) return; // 지도 드래그 끝에 이어진 클릭은 무시
    if (!isTrueAdjacent(run, nodeId)) return;
    runCommand({ type: 'MOVE_TO_NODE', nodeId });
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

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>시설맵</h2>
        <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '13px', alignItems: 'center' }}>
          <${Tooltip} content="현재 체력입니다. 0이 되면 전투 불능으로 런이 종료됩니다. 필드에서는 소모품으로만 회복할 수 있습니다.">
            <span>HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
          <//>
          <${Tooltip} content="시설이 붕괴되기까지 남은 시간입니다. 4000에 도달하면 즉시 런이 종료됩니다(탈출 실패).">
            <span>시간 <strong>${run.time}</strong>/${RUN_COLLAPSE_TIME}</span>
          <//>
          <${Tooltip} content=${`인벤토리 용량(${ps.inventory.capacity}칸)을 넘는 아이템은 "짐"이 되어 전투 중 저주 카드로 덱에 섞입니다. 용량 안으로 정리하세요.`}>
            <span>인벤토리 <strong>${ps.inventory.items.length}</strong>/${ps.inventory.capacity}${burdenCount > 0 ? ` (짐 ${burdenCount})` : ''}</span>
          <//>
          <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '6px 12px' }} onClick=${() => setShowInventory(true)}>인벤토리 / 장비교체</button>
        </div>
      </div>

      <div style=${{ border: '2px solid var(--color-divider)', padding: 'var(--space-2) var(--space-3)', width: '360px', fontSize: '11px' }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span class="tag tag-outline">행동 로그</span>
          <${HistoryControls} />
        </div>
        <${PlayLog} />
      </div>

      <div style=${{ width: '320px' }}>
        <${Tooltip} content="현재 장착 장비가 만드는 과부화 바닥선(흰 눈금) 위로는 전투/현장 행동으로 계속 쌓입니다. 100에 도달하면 즉시 멜트다운으로 런이 종료됩니다.">
          <${OverloadGauge} overload=${ps.overload} floor=${run.overloadFloor} />
        <//>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-3)', fontSize: '13px', alignItems: 'center', flexWrap: 'wrap' }}>
        ${CAPABILITY_ORDER.map((key) => {
          const raw = capabilities[key];
          const eff = effectiveForRequirement(raw);
          return html`
            <${Tooltip} key=${key} width=${240} content=${`${CAPABILITY_LABELS[key]} — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(요구치 판정 시 유효치 ${eff}). ${capabilityActionSummary(key, raw)}`}>
              <span class="tag tag-outline">${CAPABILITY_SHORT[key]} ${raw >= 0 ? '+' : ''}${raw}</span>
            <//>
          `;
        })}
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '13px', alignItems: 'center', flexWrap: 'wrap' }}>
        <${Tooltip} content="이 구역의 경계 단계(0~3)입니다. 소음/가짜 목표를 조사했다가 원인을 못 찾을 때마다 1씩 오르며, 저절로 내려가지 않습니다. 높을수록 이 구역 위협들이 더 쉽게 추적 모드로 전환됩니다.">
          <span>현재 구역 <strong>${currentSectorId ? SECTOR_NAMES[currentSectorId] : '-'}</strong> 경계 ${currentSectorAlert ? currentSectorAlert.level : '-'}</span>
        <//>
        ${['A', 'B'].map((exitId) => html`
          <${Tooltip} key=${exitId} content=${`표준 탈출구 ${exitId}. ${EXIT_STATUS_DESCRIPTIONS[run.exits[exitId].status]}`}>
            <span>${exitId} <strong>${exitStatusLabel(run.exits[exitId])}</strong></span>
          <//>
        `)}
        <${Tooltip} content="시설 어딘가의 현장 기회(파밍 지점)를 확보하면 낮은 확률로 발견되는 숨겨진 열쇠 탈출구입니다. 발견 전엔 위치를 알 수 없습니다.">
          <span>열쇠 탈출구 <strong>${run.keyDiscovered ? '알려짐' : '-'}</strong></span>
        <//>
      </div>

      ${error ? html`<div style=${{ fontSize: '12px', color: 'var(--color-negative, #dd2b0f)' }}>${error}</div>` : null}

      <div style=${{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <${Tooltip} content="현재 노드와 인접 노드에 위협이 있는지 없는지만 확인합니다(정확한 수·경계 상태는 알 수 없음). 시간 80 소요, 소음 없음, 항상 성공합니다.">
          <button class="btn btn-secondary" style=${{ fontSize: '12px' }} onClick=${() => runCommand({ type: 'BASIC_RECON' })}>기본 정찰</button>
        <//>
        ${currentOpportunities.map((opp, idx) => html`
          <${Tooltip} key=${opp.id} content=${`이 노드의 현장 기회(자원)를 확보해 소지품으로 가져갑니다. 시간이 걸리고 약간의 소음이 발생하며, 이 기회는 앞으로 ${opp.usesRemaining}번 더 파밍할 수 있습니다.`}>
            <button class="btn btn-secondary" style=${{ fontSize: '12px' }} onClick=${() => runCommand({ type: 'USE_OPPORTUNITY', opportunityId: opp.id, mode: 'normal' })}>현장 파밍${currentOpportunities.length > 1 ? ` #${idx + 1}` : ''} (${opp.usesRemaining}회 남음)</button>
          <//>
        `)}
        ${currentSpecialEdges.map((edge) => {
          const kind = edge.features.includes('electronic') ? 'hacking' : 'force';
          const kindLabel = kind === 'hacking' ? 'Hacking' : 'Force';
          const overOverload = wouldExceedOverload(run, ps, (s) => openSpecialEdge(s, edge.id, kind, capabilities[kind], 'normal'));
          return html`
            <${Tooltip} key=${edge.id} content=${`이 통로는 특수 엣지(${edge.features.join('/')})로 막혀 있습니다. ${kindLabel} Capability 1 이상이 있어야 개방할 수 있고, 개방하면 소음/흔적이 남습니다. 현재 ${kindLabel} 유효치: ${effectiveForRequirement(capabilities[kind])}. 지도에서 이 엣지를 직접 클릭해도 됩니다.${overOverload ? ' 지금 열면 과부화가 100을 넘어 비활성화되어 있습니다.' : ''}`}>
              <button class="btn btn-secondary" style=${{ fontSize: '12px' }} disabled=${overOverload} onClick=${() => handleEdgeClick(edge)}>
                특수 엣지 개방 (${edge.features.join('/')})
              </button>
            <//>
          `;
        })}
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
            <${Tooltip} key=${eq.instanceId} content=${`${eq.equipmentId} 능동 효과. ${FIELD_TARGET_LABELS[fa.targetKind] || fa.targetKind}. 시간 ${fa.timeCost}, 과부화 +${fa.overloadGain}, 재사용 대기 ${fa.cooldown}${fa.duration ? `, 지속 ${fa.duration}` : ''}.${onCooldown ? ' (현재 재사용 대기 중)' : ''}${overOverload ? ' 지금 쓰면 과부화가 100을 넘어 비활성화되어 있습니다.' : ''}${fa.targetKind === 'edge' ? ' 지도에서 강조된 엣지를 직접 클릭해 지정할 수 있습니다.' : ''}`}>
              <button class="btn btn-secondary" style=${{ fontSize: '12px' }}
                disabled=${disabled}
                onClick=${handleClick}>
                ${label} 사용${needsTarget ? '…' : ''}
              </button>
            <//>
          `;
        })}
        ${currentExit && currentExit.kind === 'standard' && currentExit.status === 'closed'
          ? html`
            <${Tooltip} content="탈출구를 여는 절차를 시작합니다. 요청 후 Hacking Capability가 높을수록 개방까지 대기 시간이 짧아지고, 열리면 이 노드에서 다음 행동이 끝나는 즉시 자동으로 탈출합니다(별도 확정 불필요). 일정 시간이 지나면 창이 다시 닫힙니다.">
              <button class="btn btn-primary" style=${{ fontSize: '12px' }} onClick=${() => runCommand({ type: 'REQUEST_EXTRACTION', exitId: currentExit.exitId })}>탈출구 ${currentExit.exitId} 개방 요청 (Hacking ${effectiveForRequirement(capabilities.hacking)})</button>
            <//>
          `
          : null}
      </div>

      ${fieldPicker ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', border: '1px solid var(--color-divider)', padding: 'var(--space-3)', fontSize: '12px' }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>${fieldPicker.contract.fieldAction.targetKind === 'edge'
              ? `대상 엣지를 선택하세요 (사거리 ${fieldPicker.contract.fieldAction.range}) — 지도에서 강조된 선을 클릭해도 됩니다`
              : `대상 노드를 선택하세요 (사거리 ${fieldPicker.contract.fieldAction.range})`}</strong>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} onClick=${() => setFieldPicker(null)}>취소</button>
          </div>
          ${wouldExceedOverload(run, ps, (s) => applyOverloadDelta(s, fieldPicker.contract.fieldAction.overloadGain))
            ? html`<div style=${{ color: 'var(--color-negative, #dd2b0f)' }}>지금 이 장비를 쓰면 과부화가 100을 넘어, 어떤 대상을 골라도 실행할 수 없습니다.</div>`
            : html`
              <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                ${fieldPicker.contract.fieldAction.targetKind === 'edge'
                  ? candidateEdgesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((edge) => html`
                    <button key=${edge.id} class="btn btn-secondary" style=${{ fontSize: '11px' }}
                      onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: edge.id })}>
                      ${edge.from} ↔ ${edge.to}
                    </button>
                  `)
                  : candidateNodesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((node) => html`
                    <button key=${node.id} class="btn btn-secondary" style=${{ fontSize: '11px' }}
                      onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: node.id })}>
                      ${SECTOR_NAMES[node.sectorId]} · ${node.id}
                    </button>
                  `)}
              </div>
            `}
        </div>
      ` : null}

      <div style=${{ display: 'flex', gap: 'var(--space-4)' }}>
        <div style=${{ position: 'relative', flexShrink: 0 }}>
          <div style=${{ position: 'absolute', top: '6px', right: '6px', zIndex: 1, display: 'flex', gap: '4px' }}>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} onClick=${() => zoomBy(1.25)}>+</button>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} onClick=${() => zoomBy(1 / 1.25)}>-</button>
            <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '2px 8px' }} onClick=${resetView}>초기화</button>
          </div>
          <svg
            width=${CANVAS_WIDTH} height=${CANVAS_HEIGHT}
            style=${{ background: 'var(--color-bg)', border: '1px solid var(--color-divider)', cursor: dragRef.current.dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onWheel=${handleWheel}
            onMouseDown=${handleCanvasMouseDown}
            onMouseMove=${handleCanvasMouseMove}
            onMouseUp=${handleCanvasMouseUp}
            onMouseLeave=${handleCanvasMouseUp}
          >
            <g transform=${`translate(${view.x}, ${view.y}) translate(${CANVAS_WIDTH / 2}, ${CANVAS_HEIGHT / 2}) scale(${view.scale}) translate(${-CANVAS_WIDTH / 2}, ${-CANVAS_HEIGHT / 2})`}>
              <g>
                ${run.graph.edges.map((e) => {
                  const from = positions[e.from]; const to = positions[e.to];
                  const special = e.features.length > 0;
                  const opened = run.openedEdgeIds.includes(e.id);
                  const openable = openableEdgeIds.has(e.id);
                  const pickable = pickableEdgeIds?.has(e.id);
                  const barrier = activeBarriers[e.id];
                  const highlighted = !!highlightedEdgeIds?.has(e.id);
                  const dashed = special && !opened;
                  const clickable = openable || !!pickable;
                  const stroke = barrier ? 'var(--color-neutral-900)' : pickable ? 'var(--color-accent)' : openable ? 'var(--color-accent-2-700)' : 'var(--color-divider)';
                  const barrierLabel = barrier ? ` — 임시 장벽 활성(적 이동 차단, 만료 ${barrier.expiresAt})` : '';
                  const edgeLabel = `${e.from} ↔ ${e.to}${special ? ` — 특수 엣지(${e.features.join('/')})${opened ? ' · 개방됨' : ' · 미개방'}` : ''}${barrierLabel}`;
                  return html`
                    <g key=${e.id}>
                      ${highlighted ? html`<line x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke="var(--color-accent-300)" stroke-width="9" pointer-events="none"></line>` : null}
                      <line x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke=${stroke} stroke-width=${clickable ? 4 : 1.5} stroke-dasharray=${barrier ? '2 3' : dashed ? '5 3' : undefined} pointer-events="none"></line>
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
                const clickable = knowledge === 'fresh';
                const live = knowledge === 'current' || knowledge === 'fresh';
                const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
                const threatCount = live ? (threatsByNode[n.id] || []).length : (run.observations[n.id]?.hasThreat ? null : 0);
                const knowledgeLabel = { current: '현재 위치', fresh: '시야 안(실시간)', stale: '마지막 확인 정보(고정)', unknown: '미확인' }[knowledge];
                const nodeTitle = [
                  `${SECTOR_NAMES[n.sectorId]} · ${knowledgeLabel}`,
                  exit ? (exit.kind === 'key' ? '숨겨진 열쇠 탈출구' : `표준 탈출구 ${exit.exitId} (${exitStatusLabel(exit)})`) : null,
                  knowledge === 'unknown' ? null : (hasThreat ? `위협 포착${threatCount ? ` (${threatCount}개 그룹)` : ''}` : '위협 없음(확인 시점 기준)'),
                ].filter(Boolean).join(' — ');
                return html`
                  <g key=${n.id}>
                    <circle cx=${pos.x} cy=${pos.y} r=${exit ? NODE_RADIUS + 4 : NODE_RADIUS} fill=${nodeFill(knowledge, hasThreat, !!exit)} stroke="var(--color-divider)" stroke-width="1.5" opacity=${nodeOpacity(knowledge)} pointer-events="none"></circle>
                    ${exit ? html`<text x=${pos.x} y=${pos.y + 5} text-anchor="middle" font-size="12" font-weight="800" fill="var(--color-bg)" pointer-events="none">${exit.kind === 'key' ? 'K' : exit.exitId}</text>` : null}
                    ${hasThreat ? html`<text x=${pos.x} y=${pos.y - NODE_RADIUS - 8} text-anchor="middle" font-size="13" fill="var(--color-accent-2-700, #dd2b0f)" opacity=${nodeOpacity(knowledge)} pointer-events="none">▲${threatCount ?? ''}</text>` : null}
                    <circle
                      cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="transparent"
                      style=${{ cursor: clickable ? 'pointer' : 'default' }}
                      onClick=${() => handleNodeClick(n.id)}
                      onMouseEnter=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onMouseMove=${(ev) => showHover(ev, nodeTitle)}
                      onMouseLeave=${() => { hideHover(); setHoveredNodeId(null); }}
                      tabindex=${clickable ? 0 : undefined}
                      onFocus=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onBlur=${() => { hideHover(); setHoveredNodeId(null); }}
                      onKeyDown=${(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) handleNodeClick(n.id); }}
                    ></circle>
                  </g>
                `;
              })}
            </g>
          </svg>

          ${hover ? html`
            <div style=${{
              position: 'fixed', left: `${hover.x + 14}px`, top: `${hover.y + 14}px`, zIndex: 100,
              background: 'var(--color-neutral-900)', color: 'var(--color-bg)', padding: '6px 10px',
              fontSize: '11px', lineHeight: 1.5, maxWidth: '260px', boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
            }}>${hover.text}</div>
          ` : null}
        </div>

        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '12px', minWidth: '200px' }}>
          <${Tooltip} content="구역 경계 단계(0~3) — 소음/가짜 목표를 조사하고도 원인을 못 찾을 때마다 1씩 오릅니다. 저절로 내려가지 않으며, 높을수록 그 구역 위협들이 더 쉽게 추적 모드로 전환됩니다.">
            <h4 style=${{ margin: 0, width: 'fit-content' }}>구역 경계도</h4>
          <//>
          ${SECTOR_IDS.map((sectorId) => html`<div key=${sectorId}>${SECTOR_NAMES[sectorId]}: ${run.sectorAlerts[sectorId].level}</div>`)}

          <h4 style=${{ margin: '12px 0 0' }}>범례</h4>
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
        </div>
      </div>

      ${showInventory ? html`<${InventoryPopup} mode="manage" onClose=${() => setShowInventory(false)} />` : null}
    </div>
  `;
}
