// 익스트랙션 맵 화면 (docs/extraction-map-implementation-spec.md). 구역은 런마다 네 개씩
// 뽑히므로(ADR-0081) 구역을 훑는 자리는 전부 run.graph.sectorIds를 본다 — 전역 구역 목록을
// 쓰면 이 런에 없는 구역을 그리게 된다.
// 전체 지도(노드+엣지)는 항상 보이고, 위협 존재 여부 같은 "내용" 정보만
// 시야(현재+인접) 밖에서는 마지막으로 확인한 값으로 고정된다 — gameReducer.js의
// refreshLocalObservations가 매 행동 끝에 현재+인접 노드를 observations에 스냅샷한다).
// 예외는 대기다: 대기 중에는 주변을 살피지 않으므로 인접 노드도 낡은 정보가 되고, 다음 유료
// 행동이 끝나야 다시 실시간이 된다(observationSuspended).
//
// UI 레이아웃(HUD/구역 라벨/미니맵/선택 노드 패널/범례·로그 접기)은 게임 UI 목업 디자인/
// map-redesign의 개선안을 반영해 재구성했다 — 명령·판정 로직은 이전과 동일, 표현 계층만 변경.
import { html, useState, useEffect, useRef, useLayoutEffect, useMemo } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { mapViewSignal, mapDebugRevealSignal, DEFAULT_MAP_VIEW } from '../state/mapViewState.js';
import { effectiveCapabilities, computeCapabilities, listFieldActiveEquipment } from '../engine/capabilityEngine.js';
import { bfsHopDistances, bfsHopDistancesOverArcs, isEdgeUnlocked, shortestPathOverArcs, baselineWalkArcs } from '../engine/graphUtils.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING, NODE_RADIUS, PASSAGE_TYPES, layoutPositions, edgePath } from './mapLayout.js';
import {
  canTraverseEdge, cameraHackRange, isCameraHackActive, getSectorLandmarkArrowTarget, isNodeCharted, perceptionInfo,
  moveTimeCost, observationSuspended, prizeGradeKnown, contractDetonationRange, canTransmitContractIntelHere,
  explainEffectiveStealth, detailIncludes, highGroundMobility, nodeContentsAt,
  deviceStatus, canClimbHighGround, describeHunters, isHunter, hasLiveCameraAt, cameraSeesStealth,
} from '../engine/runEngine.js';
import { ladderNote, StepBadge } from './ladderDisplay.js';
import { fakeNoiseRange } from '../engine/recovery.js';
import { adjacentSectorIds } from '../engine/facilityGraph.js';
import { FALSE_BROADCAST_ANY_SECTOR_DECEPTION, ALERT_GAUGE_CAPACITY, ALERT_PRESSURE, CAMERA_PERCEPTION } from '../data/facilityLayout.js';
import { getImplantEffect, MAX_DURABILITY } from '../engine/equipmentEngine.js';
import {
  SECTOR_NAMES, RUN_COLLAPSE_TIME, LANDMARKS_BY_SECTOR,
  CONTRACT_DETONATE_MIN_HOPS, HIGH_GROUND_MOBILITY_REQUIREMENT,
  CAMERA_SNIPE_NOISE, CAMERA_SNIPE_AMMO_COST,
} from '../data/facilityLayout.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { injuryPenalty } from '../engine/capabilityEngine.js';
import { CAPABILITY_ORDER, CAPABILITY_LABELS, CAPABILITY_SHORT, CAPABILITY_ROLE, CAPABILITY_KOREAN } from '../data/capabilityDisplay.js';
import { OverloadToggle } from './OverloadToggle.js';
import { InventoryPopup } from './InventoryPopup.js';
import { Tooltip } from './Tooltip.js';
import { NodeTooltipCard } from './NodeTooltipCard.js';
import { EdgeTooltipCard } from './EdgeTooltipCard.js';
import { ThinGauge } from './ThinGauge.js';
import { PlayLog } from './PlayLog.js';
import { HistoryControls } from './HistoryControls.js';
import { describeItem, EQUIPMENT_DEFS } from '../data/itemDisplay.js';
import { EncounterPanel, stealthBreakdownText } from './EncounterPanel.js';
import { ItemTooltipContent } from './ItemTooltipContent.js';
import { MapClock, deadlineStyle } from './MapClock.js';
import { capabilityStep, CAPABILITY_STEP_MIN_GAP } from '../engine/capabilityCosts.js';
import { forecastAction, describeForecast, forecastUnknownPrizeFarm } from '../engine/actionCosts.js';
import {
  runCountdowns, upcomingEvents, timersEndingBefore, observableThreatMoves, staleThreatSightings,
  interruptionNotice, waitBatchNotice, threatMovesDuring, describeNodeLocation, describeObservedThreat,
  EXIT_STATUS_LABELS, TIMELINE_HORIZON, TASK_LABELS,
} from '../engine/mapTimeline.js';
import {
  PRIZE_OPTION_COUNT, CAMERA_HACK_DURATION, WAIT_BATCH_MAX_TICKS,
} from '../data/facilityLayout.js';

const FIELD_ACTION_LABELS = { snapshot_scan: '집중 투시', temporary_barrier: '임시 장벽', remote_intrusion: '원격 침투', camera_snipe: '카메라 저격' };

/** 특수 엣지 feature의 표시 이름. `blocked`/`electronic` 같은 코드 키가 그대로 화면에 나오면
 * 플레이어는 그 통로를 무엇으로 여는지 읽을 수 없다. */
const EDGE_FEATURE_LABELS = { blocked: '물리 잠금', electronic: '전자 잠금', highGround: '높은 지형' };
/** 위협 상태의 표시 이름 — `patrol`/`pursuit` 같은 코드 키가 그대로 툴팁에 나오면 읽히지 않는다. */
const THREAT_MODE_LABELS = { patrol: '순찰', investigate: '조사', alert: '경계', pursuit: '추적', exit_guard: '출구 경계' };
/** @param {string[]} features */
function featureText(features) {
  return features.map((feature) => EDGE_FEATURE_LABELS[feature] || feature).join('·');
}

/** 화면의 모든 시각은 상대 표기다 — 절대 시각(424 / 490)은 괄호로만 병기한다. 490칸짜리 시계를
 * 머릿속에서 빼는 일을 플레이어에게 시키면 계획이 아니라 산수가 된다. */
function ticksUntil(at, now) { return Math.max(0, at - now); }
function inTicksText(at, now) { return `${ticksUntil(at, now)}칸 후`; }
function leftTicksText(at, now) { return `${ticksUntil(at, now)}칸 남음`; }



const PRIZE_AXIS_LABELS = { combat: '전투 강화', infiltration: '침투 강화', resource: '즉시 자원' };
const PRIZE_TIER_LABELS = { normal: '일반', elite: '상급' };
/** 조우가 다른 맵 행동을 막는 상태인지 — facilityReducer.isBlockedByEncounter와 같은 조건.
 * 막힌 동안 버튼이 눌리는 채로 있으면 눌러도 아무 일이 없어, 화면이 고장난 것처럼 보인다. */
function encounterBlocks(run) {
  const tier = run.encounter?.tier;
  return tier === 'even' || tier === 'forced';
}

const ENCOUNTER_BLOCK_NOTE = '조우 중입니다 — 회피하거나 전투에 들어가기 전에는 이 행동을 할 수 없습니다.';

/**
 * 예고 한 줄과 그 뒤에 붙는 시간 정보. 예고 = 실제 청구 칸이고, 그 칸이 끝나는 시각과 그 전에
 * 끝나버리는 타이머까지 함께 낸다 — 15칸짜리 해킹을 믿고 20칸짜리 작업을 시작하는 실수를 막는다.
 */
function forecastTooltip(run, forecast, label, tip, extraNote, ladder) {
  // 불가일 때는 한 문장이면 된다. 할 수 없는 행동에 "무엇에 쓰이는지"와 "얼마가 드는지"를
  // 함께 늘어놓으면 정작 "왜 안 되는지"가 묻힌다(리뷰 B6).
  if (forecast.blocked) return ladder?.note ? `${ladder.note}.` : '지금 수치로는 시도할 수 없습니다.';
  const lines = [tip];
  {
    const completesAt = run.time + forecast.timeCost;
    // 시간은 "시작 1칸 + 그 자리에서 대기로 채우는 게이지"로 나간다(ADR-0084). 이동만은
    // 게이지가 없는 1칸짜리 행동이다.
    const shape = forecast.actionId === 'move' || forecast.timeCost <= 1
      ? `${forecast.timeCost}칸`
      : `시작 1칸 · 게이지 ${forecast.timeCost - 1}칸`;
    lines.push(`${describeForecast(forecast, label)} · ${shape} · 완료까지 ${forecast.timeCost}칸 후(시각 ${completesAt} / ${RUN_COLLAPSE_TIME}).`);
    const ending = timersEndingBefore(run, completesAt);
    if (ending.length > 0) lines.push(`작업 중 종료: ${ending.map((event) => event.text).join(' · ')}.`);
    // 끝나는 타이머만 보면 정작 가장 위험한 변화 — 이 N칸 동안 옆 방의 적이 몇 번 움직이는가 —
    // 가 한 줄도 안 나온다. 관측 중인 위협에 한해 그 횟수와 시점을 함께 낸다.
    const moves = threatMovesDuring(run, forecast.timeCost);
    if (moves.length > 0) {
      lines.push(`작업 중 위협 이동: ${moves.map((move) => `${describeNodeLocation(run, move.nodeId)} ${move.count}회(${move.offsets.map((offset) => `+${offset}`).join(', ')}칸)`).join(' · ')}.`);
    } else {
      lines.push(`관측 중인 위협 없음 — 이 ${forecast.timeCost}칸은 보이지 않는 곳에서도 흐릅니다.`);
    }
  }
  if (extraNote) lines.push(extraNote);
  return lines.filter(Boolean).join(' ');
}

/**
 * 유료 행동 버튼 하나. 이름 옆에 **실제로 청구될 칸**을 붙이고, 층계가 걸린 행동이면 그 대가까지
 * 함께 낸다. 숫자는 전부 `forecastAction`에서 오며 이 파일에는 비용식이 없다.
 * @param {{run: object, actionId: string, opts?: object, label: string, tip: string,
 *   onClick: () => void, disabled?: boolean, disabledNote?: string}} props
 */
function ActionButton({ run, actionId, opts = {}, label, tip, onClick, disabled, disabledNote }) {
  const forecast = forecastAction(actionId, opts);
  const ladder = ladderNote(forecast);
  const blockedByEncounter = encounterBlocks(run);
  // 게이지가 도는 동안 다른 유료 행동은 걸 수 없다(ADR-0084) — 대기만이 그 게이지를 채운다.
  const blockedByTask = !!run.pendingTask && !TASK_FREE_ACTIONS.has(actionId);
  const note = blockedByEncounter ? ENCOUNTER_BLOCK_NOTE
    : blockedByTask ? TASK_BLOCK_NOTE
    : (disabledNote || (ladder?.blocked ? `${ladder.note}.` : ''));
  return html`
    <${Tooltip} align="left" width=${260} content=${blockedByEncounter ? ENCOUNTER_BLOCK_NOTE : blockedByTask ? TASK_BLOCK_NOTE : forecastTooltip(run, forecast, label, tip, note, ladder)}>
      <button
        class="btn btn-secondary"
        style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }}
        disabled=${disabled || blockedByEncounter || blockedByTask || !!ladder?.blocked}
        onClick=${onClick}
      >${forecast.blocked ? `${label} · 불가` : actionButtonLabel(forecast, label)}${ladder && !ladder.blocked ? html` <${StepBadge} ladder=${ladder} />` : null}</button>
    <//>
  `;
}

/** 진행 중인 게이지를 채우는 유일한 수단 — 이 둘만 작업 중에도 누를 수 있다. */
const TASK_FREE_ACTIONS = new Set(['wait', 'waitBatch']);
const TASK_BLOCK_NOTE = '진행 중인 작업을 끝내거나 떠나야 합니다.';

/**
 * 진행 중인 작업의 게이지 블록. 시간은 더 이상 행동이 알아서 소모하지 않는다(ADR-0084) —
 * 가동한 작업이 여기 남고, 플레이어가 그 자리에서 대기로 게이지를 채우거나 떠나서 포기한다.
 */
function PendingTaskPanel({ run, runCommand }) {
  const task = run.pendingTask;
  if (!task || task.nodeId !== run.playerNodeId) return null;
  const total = Math.max(1, task.completesAt - task.startedAt);
  const filled = Math.max(0, Math.min(total, run.time - task.startedAt));
  const left = Math.max(0, task.completesAt - run.time);
  const batchTicks = Math.min(left, WAIT_BATCH_MAX_TICKS);
  const label = TASK_LABELS[task.kind] || task.kind;
  return html`
    <div style=${{ border: '1px solid var(--color-accent-2-600)', padding: '7px', background: 'rgba(14,165,233,0.08)' }}>
      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-accent-2-700)', marginBottom: '5px' }}>진행 중인 작업</div>
      <${ThinGauge}
        label=${label} value=${filled} max=${total} valueText=${`${left}칸 남음`} width="100%"
        tip=${`${label} — 시작 1칸을 이미 썼고, 남은 ${left}칸은 이 자리에서 대기로 채웁니다. 다른 노드로 이동하면 작업을 포기하게 되며 효과도 보상도 없습니다.`}
      />
      <div style=${{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        <div style=${{ flex: 1 }}>
          <button class="btn btn-primary" style=${{ fontSize: '11px', width: '100%' }}
            onClick=${() => runCommand({ type: 'WAIT' })}>대기 · 1칸</button>
        </div>
        <div style=${{ flex: 1 }}>
          <button class="btn btn-secondary" style=${{ fontSize: '11px', width: '100%' }}
            onClick=${() => runCommand({ type: 'WAIT_BATCH', ticks: batchTicks })}>완료까지 대기 · ${batchTicks}칸</button>
        </div>
      </div>
      <div style=${{ marginTop: '5px', fontSize: '10.5px', color: '#b45309', fontWeight: 700 }}>
        이 노드를 벗어나면 작업을 포기합니다 — 효과도 보상도 남지 않습니다.
      </div>
    </div>
  `;
}

/**
 * 현재 노드 패널의 접이식 묶음 하나. 이 자리에서 할 수 있는 일이 열 몇 가지라 한 줄로 쌓으면
 * 사이드바를 끝까지 굴려야 무엇이 있는지 알 수 있다 — 성격이 같은 것끼리 묶고, 자주 안 쓰는
 * 묶음은 접어 둔다. 안에 그릴 것이 하나도 없으면 머리도 그리지 않는다(빈 제목만 남으면
 * "여기 뭔가 있는데 안 보인다"로 읽힌다).
 * @param {{title: string, open: boolean, onToggle: () => void, children?: any}} props
 */
function PanelGroup({ title, open, onToggle, children }) {
  const list = (Array.isArray(children) ? children : [children]).flat(Infinity)
    .filter((child) => child !== null && child !== undefined && child !== false && child !== '');
  if (list.length === 0) return null;
  return html`
    <div>
      <div
        role="button" tabindex="0"
        style=${{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
    fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
    color: 'var(--color-neutral-700)', borderBottom: '1px solid var(--color-divider)',
    paddingBottom: '3px', marginBottom: open ? '7px' : '0',
  }}
        onClick=${onToggle}
        onKeyDown=${(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle(); } }}
      >
        <span>${title}</span><span>${open ? '▾' : '▸'}</span>
      </div>
      ${open ? html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>${list}</div>` : null}
    </div>
  `;
}

/**
 * 유료 버튼 라벨의 유일한 규칙 — `이름 · N칸 · 소음 M`. 0인 통화는 적지 않는다.
 * 버튼마다 다른 순서로 적으면 두 버튼을 나란히 놓고 비교할 수 없다.
 * @param {import('../engine/actionCosts.js').ActionForecast} forecast @param {string} label
 */
function actionButtonLabel(forecast, label) {
  const parts = [label, `${forecast.timeCost}칸`];
  if (forecast.noise) parts.push(`소음 ${forecast.noise}`);
  return parts.join(' · ');
}


/**
 * 관측한 위협 한 줄 — `규모 3 · 순찰` 또는 정찰했다면 `니빗 ×2, 잉클렛 · 규모 3 · 순찰`.
 * 규모만 알면 넷이 잡몹인지 보스 하나인지 알 수 없고, 그러면 싸울지 피할지 고를 수 없다(리뷰 B8).
 */
function threatSummaryText(threat) {
  const parts = [];
  if (threat.composition && threat.composition.length > 0) parts.push(countedNames(threat.composition));
  if (threat.size !== null && threat.size !== undefined) parts.push(`규모 ${threat.size}`);
  else parts.push('규모 미상');
  if (threat.mode) parts.push(THREAT_MODE_LABELS[threat.mode] || threat.mode);
  if (threat.alert !== null && threat.alert !== undefined) parts.push(`경계 ${threat.alert}`);
  // ADR-0079: 추적이 언제 풀리는지가 "지금 도망칠 것인가 숨을 것인가"를 가른다.
  if (threat.decay) parts.push(`${threat.decay.ticksLeft}칸 뒤 ${THREAT_MODE_LABELS[threat.decay.nextMode]}로`);
  return parts.join(' · ');
}

/** 툴팁에 덧붙일 한 문장 — 구성을 아직 모르면 어떻게 알아내는지까지 말한다. */
function threatCompositionNote(threat) {
  if (threat.composition && threat.composition.length > 0) return `구성: ${countedNames(threat.composition)}(규모 ${threat.size}).`;
  if (threat.size === null || threat.size === undefined) return '유무만 확인됨 — 규모는 Perception 0 이상의 정찰이 필요합니다.';
  return `규모 ${threat.size} — 구성은 Perception 3 이상으로 정찰해야 알 수 있습니다.`;
}

/** ['니빗','니빗','잉클렛'] -> '니빗 ×2, 잉클렛' */
function countedNames(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ');
}

const FIELD_TARGET_LABELS = { edge: '엣지(통로) 지정', node_contents: '주변 노드 파악', electronic_device: '전자 장치 지정' };
/** camera_snipe처럼 deviceKinds로 좁힌 행동은 무엇을 겨누는지 그대로 적는다. */
const FIELD_DEVICE_LABELS = { camera: '카메라 지정', accessInterface: '접속 인터페이스 지정' };

/**
 * 고지대 통로 한 줄 — 이 통로가 지금 내 Mobility로 공짜인지, HP 몇을 받는지, 아예 못 넘는지.
 * 예전에는 "Mobility 3 필요"만 적혀 있어서 2인 빌드에게는 없는 길로 보였지만, 층계 이후로는
 * 값을 치르고 넘을 수 있다(D8) — 그 값을 누르기 전에 읽을 수 있어야 선택이 된다.
 * @param {{features: string[]}} edge @param {number} mobility 원시 Mobility.
 * @returns {string}
 */
function highGroundNote(edge, mobility) {
  const { required, value, blocked, gap, hpCost } = highGroundParts(edge, mobility);
  const head = `고지대 — Mobility ${required} 기준`;
  if (blocked) return `${head}, 현재 ${value}: 통과 불가`;
  if (gap <= 0) return `${head}, 현재 ${value}: 추가 대가 없음`;
  return `${head}, 현재 부족분 ${gap}: HP −${hpCost}`;
}

/**
 * 같은 판정을 문장이 아니라 숫자로 — 통로 카드는 기준·현재값·부족분·HP를 각각 다른 줄에
 * (그리고 다른 색으로) 적어야 해서 한 문장을 도로 쪼갤 수 없다. 숫자는 여전히 전부
 * `forecastAction`에서 오고, highGroundNote도 이 함수를 읽는다.
 * @param {{features: string[]}} edge @param {number} mobility 원시 Mobility.
 * @returns {{required: number, value: number, blocked: boolean, gap: number, hpCost: number}}
 */
function highGroundParts(edge, mobility) {
  const forecast = forecastAction('traverseHighGround', { edge, value: highGroundMobility(mobility) });
  return {
    required: forecast.required,
    value: forecast.value,
    blocked: forecast.blocked,
    gap: Math.max(0, forecast.required - forecast.value),
    hpCost: forecast.cost?.hpCost ?? 0,
  };
}

/**
 * 카메라 감시 한 줄(ADR-0091). 노드 카드·통로 카드·현재 노드 패널이 같은 문장을 쓴다 — 규칙을
 * 세 곳에서 따로 적으면 하나만 고쳐지고 나머지가 거짓말을 한다.
 */
const CAMERA_WATCH_NOTICE = `카메라 감시 · 지각 ${CAMERA_PERCEPTION}: 이 방에서 행동을 마치거나 떠날 때 실효 Stealth가 ${CAMERA_PERCEPTION} 미만이면 발각, 소음을 내면 즉시 발각`;

/**
 * 현재 값으로 실제로 뭘 할 수 있는지 — 구현된 효과만 정직하게 나열한다.
 *
 * 층계(D8) 이후로는 "몇부터 된다"가 아니라 "표준이 몇이고, 모자라면 무엇으로 값을 치르는가"가
 * 맞는 설명이다. 예전 문구("1 이상이어야 열 수 있습니다")를 그대로 두면 화면이 플레이어에게
 * 거짓말을 한다 — 실제로는 0으로도 열리기 때문이다.
 */
function capabilityActionSummary(key, raw) {
  // 요구치 1 기준으로 지금 이 값이 어느 단계인지 — 대부분의 행동이 요구치 1이다.
  const step = { surplus: '여유', standard: '표준', strained: '무리', severe: '위태', impossible: '불가' }[capabilityStep(raw, 1)];
  const common = `표준 요구치 1 기준 현재 단계는 '${step}'입니다.`;
  if (key === 'hacking') {
    return `전자 잠금 특수 엣지 개방, 카메라·접속 인터페이스·발전기 조작, 구역 통제실 장악, 정보 계약의 확보와 송출에 쓰입니다. 모자라면 구역 경계도가 올라가는 것으로 값을 치릅니다. 탈출구 개방 대기 시간도 이 값이 높을수록 짧아집니다. ${common}`;
  }
  if (key === 'force') {
    return `물리 잠금 특수 엣지 개방, 카메라·발전기 파괴, 전원 차단, 파괴 계약에 쓰입니다. 모자라면 소음이 커지고 장착 장비의 내구도가 깎입니다. ${common}`;
  }
  if (key === 'mobility') {
    // 고지대는 지형 판정이라 0 하한을 적용한 값으로 층계를 가른다(highGroundMobility).
    const R = HIGH_GROUND_MOBILITY_REQUIREMENT;
    const hgValue = highGroundMobility(raw);
    const highGround = hgValue >= R
      ? '높은 지형 특수 엣지를 대가 없이 통과합니다.'
      : canClimbHighGround(raw)
        ? `높은 지형 특수 엣지는 Mobility ${R}이 표준입니다 — 지금은 부족분 ${R - hgValue}만큼 HP로 값을 치르고 넘습니다.`
        : `높은 지형 특수 엣지는 Mobility ${R}이 표준이고, ${R + CAPABILITY_STEP_MIN_GAP} 이상이어야 대가를 치르고 넘을 수 있습니다 — 지금은 통과 불가입니다.`;
    const disengage = raw >= 2 ? '전투 이탈 시작 시 진행도 +1을 받습니다.' : 'Mobility 2부터 전투 이탈 보너스를 받습니다.';
    return `이동은 통로와 무관하게 언제나 1칸이라 Mobility가 이동 시간을 줄이지는 않습니다. 회수 계약 확보에 쓰이며, 모자라면 HP로 값을 치릅니다. ${highGround} ${disengage} ${common}`;
  }
  if (key === 'stealth') {
    // 카메라는 진입이 아니라 **행동 뒤**와 **출발**에 판정한다(ADR-0091). 카메라가 살아 있는
    // 노드에서는 상황 보정 −1이 붙으므로, 실효 은신이 카메라의 지각에 닿으려면 장비 합이 그보다
    // 1 높거나 은엄폐를 써야 한다 — 문구가 그 사실을 그대로 말한다.
    const camera = `카메라 감시 · 지각 ${CAMERA_PERCEPTION}: 카메라가 있는 방에서 행동을 마치거나 그 방을 떠날 때 실효 Stealth가 ${CAMERA_PERCEPTION} 미만이면 발각되고, 소음을 내면 Stealth와 무관하게 즉시 발각됩니다. 살아 있는 카메라는 상황 보정 −1을 주므로 지금 값(${raw})으로는 그 방에서 실효 ${raw - 1}입니다${raw - 1 >= CAMERA_PERCEPTION ? '' : ' — 은엄폐로 메울 수 있습니다'}.`;
    return `이동 소음과 남는 흔적의 강도를 결정하고, 조우 판정에서 위협의 지각(Perception)과 겨룹니다. 회수 계약 확보에도 쓰이며, 모자라면 강한 흔적이 남고 더 모자라면 그 자리에서 구역 경계도가 오릅니다. ${camera} ${common}`;
  }
  if (key === 'perception') {
    return `흔적 정리(수습)에 쓰입니다. 값이 높을수록 정리 시간이 짧아지고, 모자라면 시간으로 값을 치릅니다. ${common}`;
  }
  if (key === 'deception') {
    return `가짜 목표 송출(수습)과 가짜 소음(유인), 조우 속이기에 쓰입니다. 송출은 이 구역 경계도 1을 인접 구역으로 넘기며, 모자라면 심은 가짜 목표의 지속 시간이 짧아지고 가짜 소음의 사거리는 1홉으로 줄어듭니다. 조우 속이기는 Deception 2가 표준이고, 모자라면 성공 기준이 1 높아집니다(0이면 시도 자체가 들통나 그 위협의 경계가 오릅니다). ${common}`;
  }
  return '현재 엔진에 이 값을 요구하거나 참조하는 행동이 아직 없습니다(장비 수치만 집계되고 있음).';
}

const EXIT_STATUS_DESCRIPTIONS = {
  closed: '아직 가동 전. 이 노드에서 탈출구를 가동할 수 있습니다.',
  requesting: '가동 중 — 이 노드에서 대기로 게이지를 채우면 열립니다. 자리를 뜨면 가동이 취소됩니다.',
  opening: '가동 완료 — 곧 열립니다.',
  open: '지금 이 노드에 있으면 다음 행동(이동/정찰 등)이 끝나는 즉시 자동으로 탈출합니다 — 창이 닫히기 전에 아무 행동이나 하세요.',
  disabled: '더 이상 사용할 수 없는 탈출구입니다.',
};

const CANVAS_CENTER = CANVAS_WIDTH / 2;
/** 선택 노드까지의 경로 색. 위협 표식(빨강)·관측(파랑)과 겹치지 않는 초록 — "위협 없음" 예고와
 * 같은 계열이라 '지나갈 수 있는 길'로 읽힌다. */
const ROUTE_COLOR = '#15803d';
/** 고지대만 쓰는 연보라. 어두운 카드 위에서 읽히는 유일한 값이라 토큰 대신 이 리터럴을 쓴다
 * (지도 선의 #7c3aed는 밝은 배경용이고, 검은 카드 위에서는 거의 안 보인다). */
const HIGH_GROUND_COLOR = '#c4b5fd';
/** 지도 위 자리에 붙는 호버 카드의 너비 — 좌우 뒤집기 판정이 이 값을 쓴다.
 * NodeTooltipCard와 EdgeTooltipCard의 기본 너비가 같아 하나면 된다. */
const HOVER_CARD_WIDTH = 300;

/** 노드 유형별 표시 이름. 도면을 읽는 언어이므로 툴팁·패널·범례가 모두 이 표를 쓴다. */
const NODE_TYPE_LABELS = {
  corridor: '복도', office: '사무·작업실', hall: '대공간', vault: '봉인 격실',
  utility: '설비실', watch: '감시 지점', refuge: '은신처', crawlway: '비인가 통로',
};

/** 노드 유형이 하는 일 한 줄. 범례와, 아직 관측하지 않은 노드의 카드가 같은 문장을 쓴다 —
 * 미확인 노드에서 유일하게 말할 수 있는 것이 "이 방은 원래 무엇을 하는 자리인가"다. */
const NODE_TYPE_NOTES = {
  corridor: '지나가는 곳. 기회도 은엄폐도 없다',
  office: '보급품이 많은 평범한 방',
  hall: '시야가 트여 Stealth가 깎인다',
  vault: '닫혀 있고 값어치가 크다',
  utility: '발전기·배전반·서버가 있다',
  watch: '멀리 보기 위한 자리',
  refuge: '숨고 쉴 수 있다',
  crawlway: '도면에 없는 길. 지나가 봐야 지도에 뜬다',
};

/** 점집합의 볼록 껍질(모노톤 체인). 배치 원형마다 구역 모양이 달라 원으로는 감쌀 수 없다. */
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** 구역별 배경 다각형과 라벨 위치(캔버스 좌표). 구역마다 평면도 모양이 다르므로 원이 아니라
 * 볼록 껍질을 바깥으로 조금 밀어낸 다각형으로 감싼다 — 탑 구조는 세로로, 선형 사슬은 길쭉하게
 * 그려져 구역 성격이 배경만 봐도 읽힌다. */
function sectorZones(graph, positions) {
  const zones = {};
  for (const sectorId of graph.sectorIds) {
    const pts = graph.nodes.filter((n) => n.sectorId === sectorId).map((n) => positions[n.id]);
    if (pts.length === 0) continue;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const topY = Math.min(...pts.map((p) => p.y));
    const hull = convexHull(pts);
    const padded = hull.map((p) => {
      const dx = p.x - cx; const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * 26, y: p.y + (dy / len) * 26 };
    });
    zones[sectorId] = { cx, cy, topY, polygon: padded.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') };
  }
  return zones;
}

function isTrueAdjacent(run, nodeId) {
  return run.graph.edges.some((e) => (e.from === run.playerNodeId && e.to === nodeId) || (e.to === run.playerNodeId && e.from === nodeId));
}

/** 현재 위치에서 nodeId로 이어지는 엣지. 이동 시간은 어느 통로든 1칸이다(ADR-0084). */
function findTraversableEdge(run, nodeId) {
  return run.graph.edges.find((e) => (e.from === run.playerNodeId && e.to === nodeId) || (e.to === run.playerNodeId && e.from === nodeId));
}

/**
 * §10.2(수정): 전체 지도는 항상 보인다 — 이 함수는 "얼마나 최신 정보인가"만 구분한다.
 * current=지금 여기, fresh=지금 시야 안(인접), stale=예전에 관측했지만 지금은 시야 밖(마지막
 * 확인 정보 고정), unknown=한 번도 관측한 적 없음(존재/위치만 보임, 내용은 모름).
 */
function nodeKnowledge(run, nodeId, perception = 0) {
  if (run.playerNodeId === nodeId) return 'current';
  if (run.activeRecon?.targetNodeIds.includes(nodeId)) return 'fresh';
  // 대기 중에는 주변을 관측하지 않는다 — 무료 인접 실시간 관측이 끊기고, 마지막으로 본 값이
  // `N칸 전 관측`으로 남는다. 다음 유료 행동이 끝나면 다시 실시간이다. 값을 치른 정찰
  // (activeRecon)은 위에서 이미 통과했으므로 대기 중에도 계속 실시간이다.
  if (isTrueAdjacent(run, nodeId) && !observationSuspended(run, perception)) return 'fresh';
  if (run.observations[nodeId]) return 'stale';
  return 'unknown';
}

function nodeFill(knowledge, hasThreat, isExit) {
  if (isExit) return 'var(--color-accent)';
  if (knowledge === 'current') return 'var(--color-accent-2-700)';
  if (knowledge === 'unknown') return 'var(--color-neutral-300)';
  return hasThreat ? 'var(--color-negative, #dd2b0f)' : 'var(--color-bg)';
}

/**
 * 노드 위 ▲ 표식의 색·굵기·꼬리. 실시간으로 본 위협 목록만 모드를 말할 수 있고, 시야 밖의
 * 마지막 확인 정보(threats === null)는 예전 표식 그대로 둔다.
 * @param {{mode: string}[]|null|undefined} threats
 * @returns {{fill: string, weight: number, suffix: string}}
 */
function threatMarker(threats) {
  const plain = { fill: 'var(--color-accent-2-700, #dd2b0f)', weight: 400, suffix: '' };
  if (!threats || threats.length === 0) return plain;
  if (threats.some((t) => t.mode === 'pursuit')) return { fill: 'var(--color-negative, #dd2b0f)', weight: 900, suffix: '!' };
  if (threats.every((t) => t.mode === 'patrol')) return plain;
  return { ...plain, weight: 800 }; // investigate · alert · exit_guard — 색은 그대로, 굵기만
}

function nodeOpacity(knowledge) {
  if (knowledge === 'stale') return 0.55;
  return 1;
}

/**
 * 노드 본체의 모양. 색은 이미 탈출구·관측 상태·위협 세 축을 쓰고 있으므로 유형은 모양으로
 * 구분한다. 지나가는 곳(복도, 비인가 통로)은 작고, 무언가 있는 곳(방)은 크며, 닫혀 있는 곳
 * (봉인 격실)은 각지고, 대공간은 눈에 띄게 크다.
 * @param {string} type @param {number} x @param {number} y
 */
function nodeBodyShape(type, x, y, attrs) {
  const poly = (points) => html`<polygon points=${points.map(([px, py]) => `${x + px},${y + py}`).join(' ')} ...${attrs}></polygon>`;
  switch (type) {
    case 'corridor': return html`<circle cx=${x} cy=${y} r="4.5" ...${attrs}></circle>`;
    case 'hall': return html`<circle cx=${x} cy=${y} r="13" ...${attrs}></circle>`;
    case 'vault': return html`<rect x=${x - 7.5} y=${y - 7.5} width="15" height="15" ...${attrs}></rect>`;
    case 'utility': return html`<rect x=${x - 8.5} y=${y - 6} width="17" height="12" rx="2" ...${attrs}></rect>`;
    case 'watch': return poly([[0, -10], [9, 7], [-9, 7]]);
    case 'crawlway': return poly([[0, -8], [8, 0], [0, 8], [-8, 0]]);
    case 'refuge': return poly([[0, -10], [9.5, -3], [5.9, 8], [-5.9, 8], [-9.5, -3]]);
    default: return html`<circle cx=${x} cy=${y} r=${NODE_RADIUS} ...${attrs}></circle>`;
  }
}

/** remote_intrusion 대상 후보: 사거리 내 노드(본인 위치 제외). */
function candidateNodesInRange(graph, fromId, range) {
  const hops = bfsHopDistances(graph.edges, fromId);
  return graph.nodes.filter((n) => { const h = hops.get(n.id); return h !== undefined && h > 0 && h <= range; });
}

/**
 * camera_snipe 대상 후보: 시야(잠긴 통로가 끊고 일방통행은 생성 방향만) 안의, 아직 부수지 않은
 * 카메라. 엔진의 판정(runEngine.lineOfSightHops)과 같은 기준이어야 버튼이 거짓말을 하지 않는다.
 */
function candidateCamerasInSight(run, range) {
  const arcs = [];
  for (const edge of run.graph.edges) {
    if (!isEdgeUnlocked(edge, run.openedEdgeIds)) continue;
    arcs.push({ from: edge.from, to: edge.to });
    if (!edge.features.includes('oneWay')) arcs.push({ from: edge.to, to: edge.from });
  }
  const hops = bfsHopDistancesOverArcs(arcs, run.playerNodeId);
  return run.graph.cameras
    .filter((camera) => !(run.disabledCameraIds || []).includes(camera.id))
    .filter((camera) => { const h = hops.get(camera.nodeId); return h !== undefined && h <= range; });
}

/** temporary_barrier 대상 후보: 두 끝점 중 하나라도 사거리 내에 있는 엣지. */
function candidateEdgesInRange(graph, fromId, range) {
  const hops = bfsHopDistances(graph.edges, fromId);
  return graph.edges.filter((e) => {
    const hf = hops.get(e.from); const ht = hops.get(e.to);
    return (hf !== undefined && hf <= range) || (ht !== undefined && ht <= range);
  });
}

/** 출구 상태 다섯 가지의 표시 이름은 mapTimeline이 단일 출처다 — `닫힘`은 아직 요청하지 않은
 * 출구(`미요청`)와 영구 폐쇄(`폐쇄됨`)를 같은 말로 덮어 버렸다. */
function exitStatusLabel(exit) {
  if (exit.kind === 'key') return '열쇠';
  return EXIT_STATUS_LABELS[exit.status] || exit.status;
}

function movementRiskForecast(run, edge, destinationNodeId, mobility) {
  if (!edge) return { label: '경로 없음', color: 'var(--color-negative, #dc2626)' };
  // 예고 비용 = 실제 비용. 엔진의 이동 비용 함수를 그대로 쓴다 — 여기서 식을 베껴 두면
  // 한쪽만 바뀌었을 때 플레이어가 도착 시각을 틀리게 읽는다.
  const arrivalAt = run.time + moveTimeCost(edge, mobility);
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
// 100여 노드가 한 캔버스에 들어가면 한 방의 글자·표식이 몇 픽셀밖에 안 된다. 3배로는 그것을
// 읽을 수 없어 상한을 6배까지 올렸다 — 휠 한 칸(1.1배)과 +/− 버튼은 그대로다.
const ZOOM_MAX = 6;
// 노드 안에 유형 첫 글자(복/사/대/봉/설/감/은/비)를 적기 시작하는 배율 — 이보다 작으면 글자가 도형을 덮는다.
const NODE_TYPE_LETTER_MIN_SCALE = 2.2;
// 카메라 발각 배너를 "긴급"으로 강조하는 시간 창(칸) — CAMERA_HACK_DURATION(15칸)보다
// 조금 길게 잡아, 그 이후는 조용한 이력 표기로 낮춘다(계속 안 사라지면 지금도 쫓기는 중처럼 읽힘).
const CAMERA_DETECTION_BANNER_WINDOW = 20;

function IconHeart() { return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17s-6.2-3.9-6.2-8.5A3.8 3.8 0 0 1 10 6.1a3.8 3.8 0 0 1 6.2 2.4C16.2 13.1 10 17 10 17z"/></svg>`; }
function IconBox() { return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z"/><path d="M3 6.5V14l7 3.5 7-3.5V6.5"/><path d="M10 10v7.5"/></svg>`; }
function IconTarget() { return html`<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.4"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/></svg>`; }
function IconList() { return html`<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h12M4 10h12M4 15h8"/></svg>`; }

/** @param {{kind: string, equipmentId?: string, defId?: string, value?: number, amount?: number}} loot */
function farmLootDisplay(loot) {
  return describeItem({ ...loot, durability: loot.kind === 'equipment' ? 10 : undefined });
}

/**
 * 그 노드에서 정찰로 확인한 확보 대상 등급·역할축. 정찰하지 않았으면 undefined이고, 그때는
 * 서 있어도 "확보 대상이 있다"까지만 보인다(등급·축은 정찰로만, D16의 결).
 * @param {import('../engine/types.js').FacilityRunState} run
 * @param {string} nodeId
 * @param {string} opportunityId
 */
function scoutedGradeOf(run, nodeId, opportunityId) {
  return run.observations[nodeId]?.opportunityGrades?.[opportunityId];
}

/**
 * 그 노드에서 **플레이어가 아는** 내용물(현장 기회·장치). 관측(무료 인접·정찰·해킹한 카메라)이
 * 닿은 노드는 Perception과 무관하게 무엇이 놓여 있는지가 관측 기록에 남는다
 * (runEngine.nodeContentsAt). 디버그는 안개를 무시하고 실제 그래프를 본다.
 * @returns {import('../engine/types.js').NodeContents}
 */
function knownContentsOf(run, nodeId, debugReveal = false) {
  if (debugReveal) return nodeContentsAt(run, nodeId);
  const recorded = run.observations[nodeId]?.contents;
  if (recorded) return recorded;
  // 관측 기록이 아직 없어도 가 본 자리는 두 눈으로 봤다.
  if (run.visitedNodeIds.includes(nodeId)) return nodeContentsAt(run, nodeId);
  return { opportunities: [], devices: [] };
}

/** 장치 상태의 표시 이름 — 종류마다 "작동 중"의 반대말이 다르다. */
const DEVICE_STATUS_LABELS = {
  camera: { active: '카메라 작동 중', hacked: '카메라 해킹됨', destroyed: '카메라 파괴됨' },
  interface: { active: '접속 인터페이스 미해킹', hacked: '접속 인터페이스 해킹됨', destroyed: '접속 인터페이스 파괴됨' },
  generator: { active: '배터리 발전기 작동 중', hacked: '배터리 발전기 해킹됨', destroyed: '배터리 발전기 무력화됨' },
};

/**
 * 카드의 현장 기회 한 행. 기회의 **존재와 남은 횟수**는 관측이 닿으면 보이고(내용물), 확보 대상의
 * 등급·역할축만이 정찰이 사는 깊이다 — 정찰 전에는 "등급·역할축 미확인"이다.
 */
function opportunityRow(run, nodeId, opp, debugReveal) {
  // 남은 횟수는 값을 치른 관측과 서 있는 노드만 안다 — 공짜 인접 시야는 "있다"까지다(ADR-0090).
  const uses = opp.usesRemaining == null ? '남은 횟수 미확인' : `${opp.usesRemaining}회 남음`;
  if (opp.grade !== 'prize') {
    return { kind: 'opportunity', icon: 'supply', tone: 'plain', title: '보급품', detail: uses };
  }
  const live = run.graph.opportunities.find((o) => o.id === opp.id);
  const grade = debugReveal ? { tier: live?.tier, axis: live?.axis } : scoutedGradeOf(run, nodeId, opp.id);
  if (grade) {
    // 역할축은 Perception 1부터 읽힌다(정보 깊이 표) — 0으로 정찰했으면 axis가 null이다.
    const axis = grade.axis ? ` · ${PRIZE_AXIS_LABELS[grade.axis] || grade.axis}` : '';
    return {
      kind: 'opportunity',
      icon: 'prize',
      tone: 'plain',
      title: `확보 대상 · ${PRIZE_TIER_LABELS[grade.tier] || grade.tier}${axis}`,
      detail: grade.axis ? uses : `${uses} · 역할축 미확인(Perception 1 필요)`,
    };
  }
  return {
    kind: 'opportunity', icon: 'prize', tone: 'plain', title: '확보 대상',
    detail: `${uses} · 등급·역할축 미확인(정찰하면 보인다)`,
  };
}

/**
 * 이 노드에 서 있는 위협들을 한 행으로. 실시간으로 보고 있으면 규모·모드까지, 정찰 중이면
 * 구성까지 말한다 — 안 보이는 노드는 "마지막으로 위협을 봤다"까지만(리뷰 B8).
 */
function describeThreatsHere(run, node, liveThreats) {
  if (liveThreats.length === 0) return { title: '위협 포착', detail: '마지막 확인 시점' };
  const described = liveThreats.map((threat) => {
    const observed = describeObservedThreat(run, threat);
    // 관측 기록보다 깊은 것은 그리지 않는다(정보 깊이 표) — 없는 항목은 null로 오므로 거른다.
    const parts = [];
    // 추적자만은 예외다(ADR-0092). 이름을 감추면 카드가 "규모 1 · 추적"이라고만 말해, 회피가
    // 통하는 보통 마커와 구별되지 않는다 — 회피 버튼을 찾다 한 칸을 버리게 된다.
    if (isHunter(threat)) parts.push('추적자');
    if (observed.composition && observed.composition.length > 0) parts.push(countedNames(observed.composition));
    if (observed.size !== null) parts.push(`규모 ${observed.size}`);
    if (observed.mode !== null) parts.push(THREAT_MODE_LABELS[observed.mode] || observed.mode);
    if (observed.alert !== null) parts.push(`경계 ${observed.alert}`);
    if (observed.patrolNext) parts.push(`다음 목적지 ${describeNodeLocation(run, observed.patrolNext)}`);
    return parts.length ? parts.join(' · ') : '있음';
  });
  return { title: `위협 포착 · ${liveThreats.length}개 그룹`, detail: described.join(' / ') };
}

/**
 * 노드 하나를 **구조화된 카드**로 요약 — 지도 위 호버 툴팁과 "선택 노드" 패널이 같은 설명을 쓰고
 * (NodeTooltipCard), describeNodeText가 그것을 한 문장 사본으로 잇는다.
 *
 * 머리(유형·구역·지식 상태) / 행(탈출구·위협·현장 기회·장치·흔적·은신) / 꼬리(정찰 상태)로 나눈다.
 * 없는 행은 만들지 않는다 — 한 줄로 이어 붙이던 시절에는 길수록 무엇이 중요한지 읽히지 않았다.
 *
 * debugReveal이 true면 실제 안개 상태(knowledge)는 그대로 반환하되(이동 가능 판정이 이걸 씀),
 * 내용에는 위협 상세와 내용물까지 안개와 무관하게 전부 담는다.
 */
function describeNode(run, n, threatsByNode, exitByNode, debugReveal = false, baseStealth = null, perception = 0) {
  const knowledge = nodeKnowledge(run, n.id, perception);
  const exit = exitByNode[n.id];
  const live = debugReveal || knowledge === 'current' || knowledge === 'fresh';
  const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
  // 그룹 수는 무료 인접 시야가 주는 정보다(ADR-0090) — 시야 밖으로 나가도 마지막으로 센 수가
  // 관측 기록에 남는다. 그보다 얕게(두 번째 홉) 본 자리만 수를 모른 채 유무만 안다.
  const observedCount = run.observations[n.id]?.threatCount;
  const threatCount = live
    ? (threatsByNode[n.id] || []).length
    : (observedCount ?? (run.observations[n.id]?.hasThreat ? null : 0));
  const observedAt = run.observations[n.id]?.observedAt;
  const knowledgeLabel = {
    current: '현재 위치',
    fresh: '실시간',
    stale: observedAt != null ? `마지막 확인 · ${ticksUntil(run.time, observedAt)}칸 전` : '마지막 확인',
    unknown: '미확인',
  }[knowledge];
  const observedDetail = run.observations[n.id]?.detailLevel;
  // 랜드마크(구역 통제실 = 계약 목표부)는 그 노드를 한 번이라도 관측했을 때만 이름을 말한다 —
  // 계약의 사전 정보 공개도 관측 기록을 미리 채우는 방식이라 같은 판정으로 걸러진다.
  const landmark = run.graph.landmarks.find((l) => l.nodeId === n.id);
  const landmarkKnown = !!landmark && (debugReveal || !!run.observations[n.id] || run.visitedNodeIds.includes(n.id));
  const seized = landmarkKnown && run.revealedPatrolRouteSectorIds.includes(landmark.sectorId);
  const header = {
    typeLabel: NODE_TYPE_LABELS[n.type] || n.type,
    gatewayLabel: n.isGateway ? '구역 출입구' : null,
    sectorName: SECTOR_NAMES[n.sectorId],
    landmark: landmarkKnown ? (LANDMARKS_BY_SECTOR[landmark.sectorId]?.name || landmark.id) : null,
    isObjective: landmarkKnown && run.contract?.sectorId === landmark.sectorId,
    seized,
    knowledge,
    knowledgeLabel,
    debug: debugReveal,
    emptyNote: `내용물은 정찰하거나 직접 가 봐야 보인다. ${NODE_TYPE_NOTES[n.type] || ''}`.trim(),
  };

  const rows = [];
  if (exit) {
    rows.push({
      kind: 'exit',
      tone: 'plain',
      title: exit.kind === 'key' ? '숨겨진 열쇠 탈출구' : `표준 탈출구 ${exit.exitId}`,
      detail: exit.kind === 'key' ? null : exitStatusLabel(exit),
    });
  }
  if (knowledge !== 'unknown' || debugReveal) {
    const debugThreats = debugReveal ? (threatsByNode[n.id] || []) : [];
    if (hasThreat) {
      const described = describeThreatsHere(run, n, live ? (threatsByNode[n.id] || []) : []);
      rows.push({
        kind: 'threat',
        tone: 'threat',
        title: described.title,
        detail: described.detail,
        debugLines: debugThreats.map((t) => `[${t.id}] 규모 ${t.size} · ${t.mode} · 경계 ${t.alert}`),
      });
    } else {
      rows.push({ kind: 'threat', tone: 'muted', title: '위협 없음', detail: '확인 시점 기준' });
    }
  }

  // 내용물 — 정찰이든 무료 인접 관측이든 한 번 닿았으면 현장 기회와 장치가 전부 적혀 있다.
  const contents = knownContentsOf(run, n.id, debugReveal);
  for (const opp of contents.opportunities) rows.push(opportunityRow(run, n.id, opp, debugReveal));
  // 카메라 위치는 런 시작부터 보인다(ADR-0090) — 아직 관측하지 않은 노드에도 장치 행을 적는다.
  const devices = [...contents.devices];
  for (const camera of run.graph.cameras) {
    if (camera.nodeId !== n.id || devices.some((d) => d.kind === 'camera' && d.id === camera.id)) continue;
    devices.push({ kind: 'camera', id: camera.id, status: deviceStatus(run, { kind: 'camera', id: camera.id }) });
  }
  if (devices.length > 0) {
    rows.push({
      kind: 'device',
      tone: 'plain',
      title: '장치',
      chips: devices.map((device) => {
        const status = deviceStatus(run, device);
        return {
          label: DEVICE_STATUS_LABELS[device.kind]?.[status] || device.kind,
          // 아직 작동하는 카메라만 붉게 둔다 — 지나가면 걸리는 유일한 장치다.
          tone: device.kind === 'camera' && status === 'active' ? 'threat' : 'neutral',
        };
      }),
    });
  }

  // 카메라가 살아 있는 방은 카드에도 규칙 한 줄을 적는다 — 그 방에서 무엇을 하면 걸리는지가
  // 위치보다 중요한 정보다(ADR-0091).
  if (devices.some((d) => d.kind === 'camera' && deviceStatus(run, d) === 'active')) {
    rows.push({ kind: 'device', tone: 'threat', title: '카메라 감시', detail: CAMERA_WATCH_NOTICE });
  }

  // 시체·흔적의 위치는 가 본 자리이거나 Perception 4의 정찰 사거리 안에서만 보인다.
  const evidenceVisible = debugReveal || run.visitedNodeIds.includes(n.id) || detailIncludes(observedDetail, 'evidence');
  if (evidenceVisible && run.corpses?.some((c) => c.nodeId === n.id)) {
    rows.push({ kind: 'trace', tone: 'trace', title: '시체가 남아 있음', detail: `위협이 밟으면 신고되어 이 구역 경계 게이지가 +${ALERT_PRESSURE.corpseFound} 오른다` });
  }
  if (evidenceVisible) {
    const traces = (run.evidence || []).filter((e) => e.nodeId === n.id);
    if (traces.length > 0) {
      const strong = traces.filter((e) => e.tier >= 2).length;
      rows.push({
        kind: 'trace',
        tone: 'trace',
        title: `내 흔적 ${traces.length}개${strong ? ` · 강한 흔적 ${strong}개` : ''}`,
        detail: strong ? `발견되면 이 구역 경계 게이지가 +${ALERT_PRESSURE.strongTraceFound} 오른다` : '약한 흔적 — 조사만 끌어온다',
      });
    }
  }

  // ADR-0079 상황 보정 — 서 있는 자리에서 조우 판정에 실제로 쓰일 은신을 분해해 보여준다.
  // 다른 노드에는 붙이지 않는다: 은엄폐·카메라 무력화 상태가 그 자리에 가 봐야 정해진다.
  if (baseStealth !== null && n.id === run.playerNodeId) {
    const explained = explainEffectiveStealth(baseStealth, run);
    rows.push({
      kind: 'stealth',
      tone: 'plain',
      title: '은신 판정',
      detail: stealthBreakdownText(explained.total, explained.base, explained.parts),
    });
  }

  const footer = run.activeRecon?.targetNodeIds.includes(n.id) ? ['실시간 정찰 중'] : [];
  return { knowledge, exit, hasThreat, threatCount, header, rows, footer };
}

/**
 * 구조화된 노드 설명을 한 문장 사본으로 잇는다. 카드는 보이지 않는 사본으로 이 문장을 항상 들고
 * 있다(Tooltip.js와 같은 규칙) — 보조 기술이 읽고, 렌더 테스트가 검사할 수 있어야 한다.
 */
function describeNodeText(description) {
  const { header, rows, footer } = description;
  const parts = [
    `${header.sectorName} · ${header.typeLabel}${header.gatewayLabel ? `(${header.gatewayLabel})` : ''} · ${header.knowledgeLabel}${header.debug ? ' · DEBUG' : ''}`,
    header.landmark ? `${header.landmark}${header.seized ? ' · 장악됨' : ''}${header.isObjective ? ' · 계약 목표부' : ''}` : null,
  ];
  for (const row of rows) {
    parts.push([
      row.title,
      row.detail,
      (row.chips || []).map((chip) => chip.label).join(' · '),
      (row.debugLines || []).join(' / '),
    ].filter(Boolean).join(' — '));
  }
  if (rows.length === 0 && header.emptyNote) parts.push(header.emptyNote);
  parts.push(...footer);
  return parts.filter(Boolean).join(' — ');
}

/** 통로 카드 머리의 종류 이름. EDGE_FEATURE_LABELS는 "무엇으로 막혀 있는가"의 이름이라
 * `높은 지형`이지만, 통로의 **종류**를 부를 때는 `고지대 통로`가 화면의 다른 자리(고지대 행·
 * 범례)와 같은 말이 된다. */
const EDGE_KIND_LABELS = {
  blocked: EDGE_FEATURE_LABELS.blocked,
  electronic: EDGE_FEATURE_LABELS.electronic,
  highGround: '고지대',
  oneWay: '일방통행',
};

/** 접근 모드 세 가지의 표시 이름 — 개방 행이 "어느 모드로 열 것인가"를 함께 적는다. */
const EDGE_APPROACH_LABELS = { safe: '안전', normal: '표준', rush: '강행' };

/**
 * 통로(엣지) 하나를 **구조화된 카드**로 요약 — 지도 위 엣지 호버가 EdgeTooltipCard로 그리고,
 * describeEdgeText가 그것을 한 문장 사본으로 잇는다(게임 UI 목업 디자인/edge-tooltip).
 *
 * 머리(통로 종류 · 상태 배지 · 양 끝 노드) / 행(잠금 → 고지대 → 방향 → 장벽 → 이동) /
 * 꼬리(규칙 한 줄 + 조작 힌트)로 나눈다. 없는 행은 만들지 않는다.
 *
 * 숫자와 판정은 전부 ctx로 받은 기존 계산(forecastAction · ladderNote · canTraverseEdge ·
 * movementRiskForecast · openableEdgeIds …)에서 온다 — 여기서 다시 세면 카드만 엔진과 다른
 * 말을 하게 된다.
 * @param {object} run
 * @param {object} edge
 * @param {{revealed: boolean, capabilities: object, debugReveal?: boolean, openableEdgeIds: Set<string>,
 *   pickableEdgeIds: Set<string>|null, activeBarriers: object, routeEdgeIds: Set<string>|null,
 *   playerHops: Map<string, number>, edgeApproachMode: string, threatMoves: any[]}} ctx
 */
function describeEdge(run, edge, ctx) {
  const {
    revealed, capabilities, debugReveal = false, openableEdgeIds, pickableEdgeIds,
    activeBarriers, routeEdgeIds, playerHops, edgeApproachMode, threatMoves,
  } = ctx;
  const nodeById = (id) => run.graph.nodes.find((n) => n.id === id);
  // 'electronic'은 통로의 종류가 아니라 자물쇠의 종류다 — 막힌 통로는 언제나 'blocked'를 달고,
  // 그중 일부에 'electronic'이 덧붙는다(facilityLayout.js). 그러니 자물쇠는 언제나 하나다.
  const lockFeature = edge.features.includes('electronic') ? 'electronic'
    : edge.features.includes('blocked') ? 'blocked'
    : null;
  const highGround = edge.features.includes('highGround');
  const oneWay = edge.bidirectional === false;
  const opened = run.openedEdgeIds.includes(edge.id);
  const barrier = activeBarriers[edge.id] || null;
  const adjacent = edge.from === run.playerNodeId || edge.to === run.playerNodeId;
  const destinationNodeId = edge.from === run.playerNodeId ? edge.to : edge.from;
  const traversable = adjacent && canTraverseEdge(run, edge, capabilities.mobility);
  const openable = openableEdgeIds.has(edge.id);
  const pickable = !!pickableEdgeIds?.has(edge.id);
  // 일방통행의 역방향 끝에 서 있는가 — 여기서는 들어갈 수 없고, 되돌아올 수도 없다.
  const reverseEnd = revealed && oneWay && edge.to === run.playerNodeId;

  // ── 머리 ────────────────────────────────────────────────────────────────────
  // 특수한 성격은 드러난 통로에서만 이름에 나온다(지도 선 모양과 같은 게이팅) — 아직 양 끝을
  // 한 번도 보지 못한 통로는 그냥 `통로`다.
  const kinds = revealed
    ? [
      lockFeature ? EDGE_KIND_LABELS[lockFeature] : null,
      highGround ? EDGE_KIND_LABELS.highGround : null,
      oneWay ? EDGE_KIND_LABELS.oneWay : null,
    ].filter(Boolean)
    : [];
  const title = `${kinds.length ? `${kinds.join(' · ')} ` : ''}통로`;

  const ACCENT = { background: 'var(--color-accent-2-500)', color: 'var(--color-neutral-900)' };
  const LOCKED = { background: 'var(--color-neutral-700)', color: 'var(--color-bg)' };
  const NEGATIVE = { background: 'var(--color-negative, #dc2626)', color: 'var(--color-bg)' };
  const hgParts = highGround ? highGroundParts(edge, capabilities.mobility) : null;
  let badge = null;
  if (barrier) {
    badge = { label: `장벽 · ${leftTicksText(barrier.expiresAt, run.time)}`, background: 'transparent', color: 'var(--color-bg)', border: '1px solid var(--color-bg)' };
  } else if (reverseEnd) {
    badge = { label: '역방향 · 불가', ...NEGATIVE };
  } else if (revealed && lockFeature && !opened) {
    badge = { label: openable ? '잠김 · 열 수 있음' : '잠김', ...LOCKED };
  } else if (revealed && lockFeature && opened) {
    badge = { label: '개방됨', ...ACCENT };
  } else if (revealed && highGround && adjacent && !traversable) {
    badge = { label: '통과 불가', ...NEGATIVE };
  } else if (traversable) {
    badge = { label: highGround && hgParts.gap > 0 ? '지날 수 있음 · 대가' : '지날 수 있음', ...ACCENT };
  }

  /** 끝 노드 하나 — 주어는 노드 유형이고, 그 뒤에 구역(또는 `현재 위치`)이 온다. */
  const endOf = (nodeId) => {
    const node = nodeById(nodeId);
    const typeLabel = node ? (NODE_TYPE_LABELS[node.type] || node.type) : nodeId;
    if (nodeId === run.playerNodeId) return { typeLabel, note: '현재 위치' };
    const landmark = run.graph.landmarks.find((l) => l.nodeId === nodeId);
    // 랜드마크는 노드 카드와 같은 판정으로만 드러낸다 — 한 번도 닿지 않은 자리의 이름을
    // 통로 카드가 먼저 흘리면 안 된다.
    const landmarkKnown = !!landmark && (debugReveal || !!run.observations[nodeId] || run.visitedNodeIds.includes(nodeId));
    const notes = [node ? SECTOR_NAMES[node.sectorId] : null];
    if (node?.isGateway) notes.push('출입구');
    if (landmarkKnown) notes.push('랜드마크');
    return { typeLabel, note: notes.filter(Boolean).join(' · ') };
  };
  const header = {
    title,
    titleColor: revealed && highGround ? HIGH_GROUND_COLOR : null,
    badge,
    arrow: revealed && oneWay ? '→' : '↔',
    ends: [endOf(edge.from), endOf(edge.to)],
  };

  // ── 행 ──────────────────────────────────────────────────────────────────────
  const rows = [];
  if (revealed && lockFeature && !opened) {
    const kind = lockFeature === 'electronic' ? 'hacking' : 'force';
    const kindLabel = kind === 'hacking' ? 'Hacking' : 'Force';
    const required = edge.requiredCapability ?? 1;
    const current = capabilities[kind];
    const forecast = forecastAction('openEdge', { value: current, capabilityKind: kind, edge, mode: edgeApproachMode });
    const ladder = ladderNote(forecast);
    let detail;
    if (ladder?.blocked) {
      detail = `${ladder.note}`;
    } else if (adjacent && openable) {
      const time = forecast.timeCost;
      const shape = time <= 1 ? `개방 ${time}칸` : `개방 ${time}칸(시작 1 + 게이지 ${time - 1})`;
      // 층계 대가는 ladderNote가 만든 문장을 그대로 쓰되, 이미 앞줄에 적은 시간·소음은 덜어낸다 —
      // 같은 숫자를 한 줄에 두 번 적으면 둘 중 어느 쪽이 실제 청구인지 읽히지 않는다.
      const extra = (ladder && !ladder.blocked ? ladder.note.split(' · ') : [])
        .filter((part) => !part.startsWith('소음') && !part.startsWith('시간') && part !== '추가 대가 없음');
      detail = [`${shape} · 소음 ${forecast.noise} · ${EDGE_APPROACH_LABELS[edgeApproachMode] || edgeApproachMode} 접근`, ...extra].join(' · ');
    } else {
      detail = '양 끝 노드 중 하나에 서면 열 수 있다';
    }
    rows.push({
      kind: 'lock',
      icon: 'lock',
      title: `${kindLabel} ${required} 표준 · 현재 ${current}`,
      titleSuffix: ladder ? { text: ladder.label, color: ladder.color } : null,
      detail,
    });
  }
  if (revealed && highGround) {
    const { required, value, blocked, gap, hpCost } = hgParts;
    const detail = blocked
      ? [{ text: `통과 불가 — Mobility ${required - 2} 이상이어야 대가를 치르고 넘는다` }]
      : gap <= 0
        ? [{ text: '추가 대가 없음' }]
        : [{ text: `부족분 ${gap} → 넘을 때 ` }, { text: `HP −${hpCost}`, color: 'var(--color-accent-2-400)' }, { text: ' · 시간은 그대로 1칸' }];
    rows.push({
      kind: 'highGround',
      icon: 'highGround',
      color: HIGH_GROUND_COLOR,
      title: `Mobility ${required} 기준 · 현재 ${value}`,
      detail,
    });
  }
  if (revealed && oneWay) {
    const fromLabel = header.ends[0].typeLabel;
    const toLabel = header.ends[1].typeLabel;
    rows.push({
      kind: 'direction',
      icon: 'direction',
      color: reverseEnd ? 'var(--color-accent-2-400)' : null,
      title: `${fromLabel} → ${toLabel} 방향만 열려 있다`,
      detail: reverseEnd
        ? '여기서는 들어갈 수 없다. 반대편에서 오는 위협은 이 길로 올 수 있다.'
        : '역방향으로는 돌아올 수 없다',
    });
  }
  if (barrier) {
    rows.push({
      kind: 'barrier',
      icon: 'barrier',
      title: '임시 장벽 · 적 이동 차단',
      detail: `${leftTicksText(barrier.expiresAt, run.time)}(시각 ${barrier.expiresAt}) · 나는 지날 수 있다 · 만료 후 다시 열린다`,
    });
  }
  // 이동 행은 "지금 여기서 이 길로 무엇을 할 수 있는가"다. 역방향 일방통행은 방향 행이 이미
  // 그 답을 말했으므로 중복해서 적지 않는다.
  if (adjacent && !reverseEnd) {
    const lockedNow = !!lockFeature && !opened && revealed;
    const risk = movementRiskForecast(run, edge, destinationNodeId, capabilities.mobility);
    const detail = [{ text: risk.label, color: risk.color }];
    // 도착지에 위협이 있다면 그것이 어떤 상태로 얼마나 자주 움직이는지까지 — 관측한 만큼만.
    const observed = threatMoves.find((threat) => threat.nodeId === destinationNodeId);
    if (observed?.mode) detail.push({ text: ` · ${THREAT_MODE_LABELS[observed.mode] || observed.mode}` });
    if (observed?.interval) detail.push({ text: ` · ${observed.interval}칸마다 이동` });
    rows.push({
      kind: 'move',
      icon: 'move',
      color: traversable ? null : 'var(--color-neutral-400)',
      title: traversable ? '이동 1칸'
        : lockedNow ? '이동 1칸 — 열기 전에는 지날 수 없다'
        : '이동 1칸 — 지금은 지날 수 없다',
      detail,
    });
  } else if (!adjacent) {
    const hops = [playerHops.get(edge.from), playerHops.get(edge.to)].filter((h) => h !== undefined);
    const onRoute = !!routeEdgeIds?.has(edge.id);
    rows.push({
      kind: 'move',
      icon: 'move',
      color: 'var(--color-neutral-400)',
      title: `${hops.length ? `여기서 ${Math.max(...hops)}홉` : '닿는 길 없음'}${onRoute ? ' · 최단 경로에 포함' : ''}`,
      detail: onRoute ? '선택한 노드로 가는 길이 이 통로를 지난다' : '인접하지 않아 지금은 이동 대상이 아니다',
    });
  }

  // ── 꼬리 ────────────────────────────────────────────────────────────────────
  const rule = barrier ? '장벽은 현장 장비로 다시 칠 수 있다'
    : reverseEnd ? '다른 길로 돌아가야 한다'
    : revealed && lockFeature && opened ? '열린 문은 위협도 지난다'
    : openable ? '패널의 접근 모드(안전/표준/강행)가 적용된다'
    : revealed && lockFeature && !opened ? '열면 런 내내 열려 있다'
    : revealed && highGround ? 'Mobility 0 이하는 통과 불가'
    : adjacent ? '이동 소음은 출발 시각에 난다'
    : '';
  const hint = pickable ? '클릭해 지정'
    : openable ? '클릭해 개방'
    : traversable ? '노드를 더블클릭해 이동'
    : null;

  return { header, rows, footer: { rule, hint } };
}

/**
 * 구조화된 통로 설명을 한 문장 사본으로 잇는다 — 카드는 이 문장을 보이지 않게 항상 들고 있다
 * (NodeTooltipCard와 같은 규칙). 보조 기술이 읽고, 렌더 테스트가 검사한다.
 */
function describeEdgeText(description) {
  const { header, rows, footer } = description;
  const endText = (end) => `${end.typeLabel}${end.note ? `(${end.note})` : ''}`;
  const parts = [
    `${header.title}${header.badge ? ` · ${header.badge.label}` : ''}`,
    `${endText(header.ends[0])} ${header.arrow} ${endText(header.ends[1])}`,
  ];
  for (const row of rows) {
    const detail = Array.isArray(row.detail) ? row.detail.map((part) => part.text).join('') : row.detail;
    parts.push([`${row.title || ''}${row.titleSuffix ? ` ${row.titleSuffix.text}` : ''}`, detail].filter(Boolean).join(' — '));
  }
  parts.push(footer.rule, footer.hint);
  return parts.filter(Boolean).join(' — ');
}

export function MapScreen() {
  const [showInventory, setShowInventory] = useState(false);
  const [error, setError] = useState('');
  const [fieldPicker, setFieldPicker] = useState(null); // {instanceId, contract} | null — 대상(엣지/노드) 지정 중인 현장 장비
  const [noisePicker, setNoisePicker] = useState(false); // 가짜 소음(D)의 대상 노드를 고르는 중인가
  // 지도 확대/이동은 컴포넌트 밖 시그널에 산다(state/mapViewState.js) — 이 화면은 전투·보상·
  // 인벤토리 팝업마다 언마운트되므로 useState에 두면 그때마다 뷰가 초기화된다.
  const view = mapViewSignal.value;
  const setView = (next) => {
    mapViewSignal.value = typeof next === 'function' ? next(mapViewSignal.value) : next;
  };
  // 커스텀 툴팁(브라우저 기본 title의 지연 없이 즉시 표시). 두 종류가 있다:
  // - {anchor: {x, y}, node?} — 노드·통로처럼 지도 위에 자리가 있는 것. anchor는 **캔버스 좌표**라
  //   호버 중에 지도를 끌어도 카드가 그 자리에 붙어 있고, 커서보다 한 프레임 늦게 따라오지 않는다.
  // - {x, y, text} — 임플란트 화살표처럼 지도 위 자리가 없는 것. 그때만 커서를 따라간다.
  // node는 describeNode의 구조화된 설명이고, 그때는 NodeTooltipCard로 그린다.
  const [hover, setHover] = useState(null);
  const mapAreaRef = useRef(null); // 캔버스 좌표를 화면 좌표로 바꿀 때 기준이 되는 지도 영역
  const hoverCardRef = useRef(null);
  const [hoverCardPos, setHoverCardPos] = useState({ left: -9999, top: -9999 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // 노드 호버 시 연결 엣지 강조용
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null); // 통로 호버 시 그 통로를 굵게 — 카드가 어느 선을 말하는지 보여야 한다
  const [selectedNodeId, setSelectedNodeId] = useState(null); // 클릭해 "선택 노드" 패널에 고정한 노드
  const [legendOpen, setLegendOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // 디버그: 안개/미발견 상태 무시하고 전부 표시(순수 뷰 전환 — 실제 run 상태는 안 건드림).
  // 뷰와 같은 시그널에 둬서 전투 한 번에 꺼지지 않는다.
  const debugReveal = mapDebugRevealSignal.value;
  const setDebugReveal = (next) => {
    mapDebugRevealSignal.value = typeof next === 'function' ? next(mapDebugRevealSignal.value) : next;
  };
  const [farmPlan, setFarmPlan] = useState(null);
  const [edgeApproachMode, setEdgeApproachMode] = useState('normal'); // 특수 엣지 개방의 접근 방식(안전/표준/강행)
  const [capabilityOpen, setCapabilityOpen] = useState(false); // Capability 블록은 기본 접힘 — 행동이 위로 온다
  // 현재 노드 패널의 세 묶음. 수습·장비는 매 칸 쓰는 것이 아니라 기본으로 접어 둔다.
  const [panelGroupsOpen, setPanelGroupsOpen] = useState({ actions: true, devices: true, cleanup: false });
  const togglePanelGroup = (key) => setPanelGroupsOpen((open) => ({ ...open, [key]: !open[key] }));
  const [farmToast, setFarmToast] = useState(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, moved: false });
  const nodeRefs = useRef({}); // nodeId -> 히트 영역 엘리먼트(화살표 이동이 포커스를 옮길 때 쓴다)
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const run = snapshot.facilityRunState;

  // 훅은 조기 반환(run이 없는 순간)보다 **위**에 있어야 한다. 아래에 두면 맵이 없는 프레임과
  // 있는 프레임의 훅 개수가 달라져 preact의 훅 순서가 어긋난다 — 다른 훅의 상태가 엉뚱한
  // 자리로 밀려 들어간다(리뷰 A8).
  const farmResult = run && run.lastActionResult?.kind === 'farm' && run.lastActionResult.loot
    ? run.lastActionResult
    : null;
  const farmToastKey = farmResult ? `${farmResult.opportunityId}:${farmResult.completedAt}` : null;
  useEffect(() => {
    if (!farmResult || !farmToastKey) return undefined;
    setFarmToast({ key: farmToastKey, loot: farmResult.loot });
    const timer = setTimeout(() => setFarmToast((current) => (current?.key === farmToastKey ? null : current)), 3500);
    return () => clearTimeout(timer);
  }, [farmToastKey]);

  // 지도 배치와 홉 거리는 그래프와 현재 위치가 그대로면 값도 그대로다 — 호버 한 번에 200여
  // 노드를 다시 배치하지 않도록 기억해 둔다(리뷰 A8).
  const positions = useMemo(() => (run ? layoutPositions(run.graph) : {}), [run?.graph]);
  const cameraHops = useMemo(
    () => (run ? bfsHopDistances(run.graph.edges, run.playerNodeId) : new Map()),
    [run?.graph, run?.playerNodeId],
  );

  // rAF 스로틀: 마우스가 움직일 때마다 setState를 부르면 한 프레임에 수십 번 다시 그린다.
  const hoverFrameRef = useRef({ id: 0, pending: null });
  const scheduleHover = (next) => {
    hoverFrameRef.current.pending = next;
    // 브라우저 밖(헤드리스 렌더 테스트)에는 rAF가 없다 — 그때는 그냥 즉시 반영한다.
    if (typeof requestAnimationFrame !== 'function') { setHover(next); return; }
    if (hoverFrameRef.current.id) return;
    hoverFrameRef.current.id = requestAnimationFrame(() => {
      hoverFrameRef.current.id = 0;
      setHover(hoverFrameRef.current.pending);
    });
  };
  useEffect(() => () => {
    if (hoverFrameRef.current.id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(hoverFrameRef.current.id);
  }, []);

  // 지도 위에 자리가 있는 호버(노드·통로)는 그 자리에 붙인다. 캔버스 좌표 → 화면 좌표 변환은
  // SVG의 뷰박스 맞춤(fit)과 팬/줌(view)을 차례로 적용한 것이며, 오른쪽으로 삐져나가면 왼쪽으로
  // 뒤집고 위아래는 화면 안으로 민다(Tooltip.js와 같은 규칙).
  useLayoutEffect(() => {
    if (!hover?.anchor || !mapAreaRef.current) return;
    const rect = mapAreaRef.current.getBoundingClientRect();
    const fit = Math.min(rect.width / CANVAS_WIDTH, rect.height / CANVAS_HEIGHT) || 1;
    const screenX = rect.left + (rect.width - CANVAS_WIDTH * fit) / 2
      + fit * (view.x + CANVAS_CENTER + view.scale * (hover.anchor.x - CANVAS_CENTER));
    const screenY = rect.top + (rect.height - CANVAS_HEIGHT * fit) / 2
      + fit * (view.y + CANVAS_CENTER + view.scale * (hover.anchor.y - CANVAS_CENTER));
    const width = HOVER_CARD_WIDTH;
    const gap = (NODE_RADIUS + 12) * fit * view.scale;
    const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 800;
    const height = hoverCardRef.current ? hoverCardRef.current.getBoundingClientRect().height : 0;
    let left = screenX + gap;
    if (left + width > viewportWidth - 8) left = screenX - gap - width;
    setHoverCardPos({
      left: Math.max(8, left),
      top: Math.max(8, Math.min(viewportHeight - height - 8, screenY - 12)),
    });
  }, [hover, view.x, view.y, view.scale]);

  if (!run) return null;

  // 사용 중인 오버라이드 칩이 있으면 예고와 버튼도 상한으로 판정해야 한다 — 엔진과 화면이 다른
  // 수치를 보면 "불가"라고 적힌 버튼이 눌리는 순간 성공한다(ADR-0086).
  const capabilities = effectiveCapabilities(snapshot);
  // 단, 지도에 무엇이 보이는가(관측의 신선도·인접 노드 내용)는 실제 장비의 Perception으로만
  // 그린다. 사용이 0칸이고 취소가 환불되므로, 상한 Perception으로 그리면 "썼다가 취소"로
  // 인접 노드의 실시간 정보를 공짜로 훔쳐볼 수 있다.
  const viewCapabilities = computeCapabilities(ps.loadout);
  // 부상 페널티(ADR-0093)는 장비 합에서 얼마가 깎였는지를 화면이 분해해 적을 수 있어야 한다 —
  // 실효값만 보여주면 "장비를 바꿔야 하는가, 붕대를 써야 하는가"를 고를 수 없다. 칩을 쓰는
  // 동안은 여섯 값이 상한으로 고정되므로 분해할 것도 없다.
  const injury = run.overrideArmed ? 0 : injuryPenalty(ps.hp, ps.maxHp);
  const hasMapImplant = !!getImplantEffect(ps.loadout, 'sectorLandmarkArrow');
  const landmarkArrowTarget = getSectorLandmarkArrowTarget(run, hasMapImplant);
  const fieldEquipment = listFieldActiveEquipment(ps.loadout);
  const burdenCount = getBurdenItems(ps.inventory).length;
  const zones = sectorZones(run.graph, positions);

  const nodeTypeById = {};
  for (const node of run.graph.nodes) nodeTypeById[node.id] = node.type;

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
  // 통제실 장악은 구역당 1회(C3) — 이미 장악한 구역이면 버튼을 잠그고 이유를 말한다.
  const controlRoomAlreadySeized = !!currentLandmark && run.revealedPatrolRouteSectorIds.includes(currentLandmark.sectorId);
  const currentExit = exitByNode[run.playerNodeId];
  const currentOpportunities = run.graph.opportunities.filter((o) => o.nodeId === run.playerNodeId && o.usesRemaining > 0);
  const visitedNodeIds = new Set(run.visitedNodeIds);
  // 도면에 없는 노드(비인가 통로)는 직접 보기 전까지 지도에 그리지 않는다(D16). 구조를 감추는
  // 유일한 예외이며, 그 노드로 이어지는 통로도 함께 숨는다.
  const chartedNodeIds = new Set(run.graph.nodes.filter((n) => debugReveal || isNodeCharted(run, n)).map((n) => n.id));
  // 장치의 위치는 가 봤거나, 관측이 닿아 내용물이 기록된 노드에서 드러난다(Perception과 무관).
  // 지도 글자(C/I/G)와 해킹·파괴 버튼이 같은 하나의 판정을 써야 "보이는데 못 고르는" 장치가 없다.
  const isDeviceVisible = (nodeId) => debugReveal || visitedNodeIds.has(nodeId) || !!run.observations[nodeId]?.contents;
  // 카메라만은 런 시작부터 전부 보인다(ADR-0090) — 어디에 눈이 달려 있는지는 시설을 들어서기
  // 전에 아는 정보다. 인터페이스·발전기는 그대로 관측해야 드러난다.
  const cameraByNode = Object.fromEntries(run.graph.cameras.map((camera) => [camera.nodeId, camera]));
  const interfaceNodeIds = new Set(run.graph.accessInterfaces.filter((entry) => isDeviceVisible(entry.nodeId)).map((entry) => entry.nodeId));
  const currentInterface = run.graph.accessInterfaces.find((entry) => entry.nodeId === run.playerNodeId);
  const currentInterfaceHacked = !!currentInterface && (run.hackedInterfaceIds || []).includes(currentInterface.id);
  const cameraRange = cameraHackRange(capabilities.hacking);
  // 같은 표를 위치 서술(`통신·관제탑 · 인접 1홉`)에도 쓴다 — 노드 id는 지도에서 찾을 수 없다.
  const playerHops = cameraHops;
  const whereIs = (nodeId) => describeNodeLocation(run, nodeId, playerHops);
  const canHackDevice = (nodeId) => {
    if (capabilities.hacking < 1) return false;
    const targetSectorId = run.graph.nodes.find((node) => node.id === nodeId)?.sectorId;
    if (currentInterfaceHacked && targetSectorId === currentSectorId) return true;
    return (cameraHops.get(nodeId) ?? Infinity) <= cameraRange;
  };
  const hackableCameras = run.graph.cameras.filter((camera) => canHackDevice(camera.nodeId)
    && !(run.disabledCameraIds || []).includes(camera.id));
  const generatorByNode = Object.fromEntries((run.graph.generators || []).filter((generator) => isDeviceVisible(generator.nodeId)).map((generator) => [generator.nodeId, generator]));
  const currentGenerator = (run.graph.generators || []).find((generator) => generator.nodeId === run.playerNodeId);
  // 랜드마크 기호는 안개가 걷힌 노드에서만 그린다(툴팁의 규칙과 같다). 계약 목표부는 색을 달리한다.
  const landmarkByNode = Object.fromEntries(run.graph.landmarks.map((landmark) => [landmark.nodeId, landmark]));
  const currentCamera = run.graph.cameras.find((camera) => camera.nodeId === run.playerNodeId);
  // §4단계 — 시체와 흔적은 내가 만든 것이라 위치를 항상 안다(안개와 무관). 전원 차단 중인
  // 구역과 다음 증원 예정 시각도 여기서 뽑는다.
  const corpseByNode = Object.fromEntries((run.corpses || []).map((c) => [c.nodeId, c]));
  // 흔적 수는 Map으로 센다 — 스프레드 누적은 흔적 하나마다 객체를 통째로 다시 만든다.
  const traceCountByNode = new Map();
  for (const evidence of run.evidence || []) traceCountByNode.set(evidence.nodeId, (traceCountByNode.get(evidence.nodeId) || 0) + 1);
  const currentCorpse = corpseByNode[run.playerNodeId];
  const currentTraces = (run.evidence || []).filter((e) => e.nodeId === run.playerNodeId);
  const powerCutSectorIds = new Set((run.powerCuts || []).filter((c) => c.expiresAt > run.time).map((c) => c.sectorId));
  // Deception 3 이상은 인접 구역이 아니라 아무 구역으로나 가짜 목표를 쏠 수 있다(D).
  const broadcastSectorIds = currentSectorId
    ? (capabilities.deception >= FALSE_BROADCAST_ANY_SECTOR_DECEPTION
      ? Object.keys(run.sectorAlerts).filter((id) => id !== currentSectorId)
      : adjacentSectorIds(run.graph, currentSectorId))
    : [];
  // 가짜 목표를 쏠 수 있는 구역 목록(Deception 3 이상이면 이웃이 아니어도 된다).
  const broadcastTargetSectorIds = broadcastSectorIds;
  const hackableGenerators = (run.graph.generators || []).filter((generator) => isDeviceVisible(generator.nodeId)
    && canHackDevice(generator.nodeId) && !run.disabledGeneratorIds.includes(generator.id));
  const activeReconNodeIds = new Set(run.activeRecon?.targetNodeIds || []);
  const openableEdgeIds = new Set(
    run.graph.edges
      .filter((e) => (e.from === run.playerNodeId || e.to === run.playerNodeId)
        && e.features.includes('blocked')
        && !run.openedEdgeIds.includes(e.id))
      .map((e) => e.id),
  );
  const currentSpecialEdges = run.graph.edges.filter((e) => openableEdgeIds.has(e.id));
  /** 이 엣지를 여는 데 필요한 Capability 수치와 현재 유효치. 승강기처럼 1보다 높은 것이 있다. */
  // 층계 판정은 원시 수치를 그대로 쓴다(capabilityCosts.capabilityStep). 여기서 max(0, x)로
  // 자르면 화면만 엔진과 다른 판정을 하게 되고, 그러면 버튼이 "열 수 있다"고 예고한 문을
  // 클릭 핸들러가 거절한다.
  const edgeOpenRequirement = (edge) => {
    const kind = edge.features.includes('electronic') ? 'hacking' : 'force';
    return { kind, required: edge.requiredCapability ?? 1, current: capabilities[kind] };
  };
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
  // 어떤 노드까지의 최단 경로. 지금 실제로 지날 수 있는 통로만 센다(잠긴 문 제외, 일방통행은
  // 생성 방향만, 고지대는 넘을 수 있을 때만) — 통행 규칙은 graphUtils.baselineWalkArcs 한 곳에
  // 있고 여기서는 옵션만 준다. 지도에 없는 노드(미발견 비인가 통로)를 거치는 길은 플레이어가
  // 아직 모르는 정보라 제외한다. 훅이 아니라 순수 계산이므로 조기 반환 뒤에 있어도 안전하다.
  // 선택한 노드(실선)와 호버 중인 노드(미리보기 점선)가 같은 계산을 쓴다.
  const routeTo = (nodeId) => {
    if (!nodeId || nodeId === run.playerNodeId || !chartedNodeIds.has(nodeId)) return null;
    const chartedEdges = run.graph.edges.filter((edge) => chartedNodeIds.has(edge.from) && chartedNodeIds.has(edge.to));
    const arcs = baselineWalkArcs(chartedEdges, {
      openedEdgeIds: run.openedEdgeIds, allowHighGround: canClimbHighGround(capabilities.mobility), withEdgeIds: true,
    });
    return shortestPathOverArcs(arcs, run.playerNodeId, nodeId);
  };
  const routeToSelected = routeTo(selectedNodeId);
  const routeEdgeIds = routeToSelected ? new Set(routeToSelected.edgeIds) : null;
  const routeNodeIds = routeToSelected ? new Set(routeToSelected.nodeIds) : null;
  // 노드를 고르기 전에도 "저기까지 몇 칸인가"를 보여준다 — 고른 뒤에는 실선 경로 하나만 남기고
  // 미리보기를 그리지 않는다(두 경로가 겹치면 어느 쪽이 확정인지 읽히지 않는다).
  const routePreview = !selectedNodeId && hoveredNodeId ? routeTo(hoveredNodeId) : null;
  const previewEdgeIds = routePreview ? new Set(routePreview.edgeIds) : null;
  // 경로 위 노드의 순번(1..N) — 플레이어가 선 자리는 세지 않는다.
  const routeHopByNode = new Map((routeToSelected?.nodeIds || []).slice(1).map((id, index) => [id, index + 1]));

  /**
   * 커맨드를 보내고, 스냅샷이 그대로면 실패 사유를 말한다. "행동 실패 — 조건을 확인하세요"만
   * 띄우면 플레이어는 무엇이 막았는지 알 수 없다 — 대부분은 조우이고, 그건 화면에 이미
   * 드러나 있는 정보다.
   * @param {object} command @param {string} [reason] 호출부가 아는 더 구체적인 사유.
   */
  function runCommand(command, reason) {
    const before = snapshotSignal.value;
    dispatch(command);
    if (snapshotSignal.value !== before) { setError(''); setFieldPicker(null); return; }
    if (encounterBlocks(run)) setError('조우 중이라 막혔습니다 — 회피하거나 전투에 들어가세요.');
    else setError(reason || '행동 실패 — 조건을 확인하세요.');
  }

  // 탭 정지점 하나 = 지금 선택한 노드(없으면 현재 위치). 화살표는 연결된 통로를 따라 옮긴다 —
  // 지도는 격자가 아니므로 방향키는 "그 방향에 가장 가까운 이웃"으로 읽는다.
  const focusedNodeId = selectedNodeId && chartedNodeIds.has(selectedNodeId) ? selectedNodeId : run.playerNodeId;
  const ARROW_VECTORS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const moveFocusFrom = (nodeId, key) => {
    const vector = ARROW_VECTORS[key];
    const from = positions[nodeId];
    if (!vector || !from) return false;
    const neighbors = run.graph.edges
      .map((e) => (e.from === nodeId ? e.to : e.to === nodeId ? e.from : null))
      .filter((id) => id && chartedNodeIds.has(id));
    let best = null;
    let bestScore = 0;
    for (const id of neighbors) {
      const to = positions[id];
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const score = ((to.x - from.x) * vector[0] + (to.y - from.y) * vector[1]) / length;
      if (score > 0.3 && score > bestScore) { best = id; bestScore = score; }
    }
    if (!best) return false;
    setSelectedNodeId(best);
    nodeRefs.current[best]?.focus?.();
    return true;
  };
  const handleNodeKeyDown = (ev, nodeId) => {
    if (ev.key === 'Enter' || ev.key === ' ') { handleNodeSelect(nodeId); return; }
    if (ARROW_VECTORS[ev.key] && moveFocusFrom(nodeId, ev.key)) ev.preventDefault();
  };

  const handleNodeSelect = (nodeId) => {
    if (dragRef.current.moved) return; // 지도 드래그 끝에 이어진 클릭은 무시
    setSelectedNodeId(nodeId);
  };

  /**
   * 지금 그 노드로 바로 넘어갈 수 있는가. 더블클릭 이동과 호버 카드의 힌트가 같은 판정을 써야
   * 한다 — 힌트가 "더블클릭해 이동"이라고 적어 놓고 눌러도 아무 일이 없으면 화면이 거짓말이다.
   */
  const canMoveNow = (nodeId) => {
    if (!isTrueAdjacent(run, nodeId)) return false;
    if (encounterBlocks(run)) return false;
    const edge = findTraversableEdge(run, nodeId);
    return !!edge && canTraverseEdge(run, edge, capabilities.mobility);
  };

  /** 인접하고 지날 수 있는 노드는 더블클릭만으로 넘어간다 — 선택 → 패널 버튼 두 걸음을 아낀다. */
  const handleNodeDoubleClick = (nodeId) => {
    if (dragRef.current.moved) return; // 지도 드래그 끝에 이어진 클릭은 무시
    if (!canMoveNow(nodeId)) return;
    handleMove(nodeId);
  };

  const handleMove = (nodeId) => {
    if (!isTrueAdjacent(run, nodeId)) return;
    if (encounterBlocks(run)) { setError('조우 중이라 막혔습니다 — 회피하거나 전투에 들어가세요.'); return; }
    runCommand({ type: 'MOVE_TO_NODE', nodeId });
    // 경로를 따라 걷는 동안에는 선택을 놓지 않는다 — 놓아 버리면 한 칸 갈 때마다 목적지를
    // 다시 찍어야 한다. 목적지에 도착했을 때만 선택을 비운다(그 자리가 곧 현재 노드다).
    if (nodeId === selectedNodeId) setSelectedNodeId(null);
  };

  const handleEdgeClick = (edge) => {
    if (dragRef.current.moved) return;
    if (pickableEdgeIds) {
      if (!pickableEdgeIds.has(edge.id)) return;
      runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: edge.id });
      return;
    }
    if (!openableEdgeIds.has(edge.id)) return;
    if (encounterBlocks(run)) { setError('조우 중이라 막혔습니다 — 회피하거나 전투에 들어가세요.'); return; }
    const requirement = edgeOpenRequirement(edge);
    // 층계(D8) 이후로 요구치 미달은 잠김이 아니라 "더 비싸게 열린다"이다. 버튼과 지도가 그렇게
    // 예고하므로 클릭 가드도 같은 판정을 써야 한다 — 정말 막히는 것은 불가 단계뿐이다.
    if (capabilityStep(requirement.current, requirement.required) === 'impossible') {
      const kindLabel = requirement.kind === 'hacking' ? 'Hacking' : 'Force';
      setError(`${kindLabel} ${requirement.required}이 표준, ${requirement.required - 2} 이상이면 대가를 치르고 열 수 있습니다(현재 ${requirement.current}).`);
      return;
    }
    runCommand({ type: 'OPEN_SPECIAL_EDGE', edgeId: edge.id, capabilityKind: requirement.kind, mode: edgeApproachMode });
  };

  const zoomBy = (factor) => setView((v) => ({ ...v, scale: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.scale * factor)) }));
  const resetView = () => setView(DEFAULT_MAP_VIEW);
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
  // 호버는 rAF 한 프레임에 한 번만 반영한다(scheduleHover) — 마우스를 한 번 훑으면
  // onMouseMove가 수십 번 오는데, 그때마다 100여 노드 지도를 다시 그리면 눈에 띄게 끊긴다.
  const showHover = (ev, text) => scheduleHover({ x: ev.clientX, y: ev.clientY, text });
  /** 노드와 통로는 문장이 아니라 카드다(NodeTooltipCard / EdgeTooltipCard) — 지도 임플란트
   * 화살표처럼 성격이 하나뿐인 표식만 그대로 문자열을 쓴다. 두 카드의 자리는 커서가 아니라
   * 그 대상의 **캔버스 좌표**다(anchor) — 노드는 제 자리에, 통로는 가운데에 붙는다. */
  const showNodeHover = (pos, description, hint) => scheduleHover({ anchor: { x: pos.x, y: pos.y }, node: description, hint });
  const showEdgeHover = (pos, description) => scheduleHover({ anchor: { x: pos.x, y: pos.y }, edge: description });
  const hideHover = () => scheduleHover(null);
  const recenterAt = (canvasX, canvasY) => setView((v) => ({ ...v, x: -(canvasX - CANVAS_CENTER) * v.scale, y: -(canvasY - CANVAS_CENTER) * v.scale }));
  /** 패널 줄을 눌렀을 때 지도를 그 노드로 옮긴다 — 위치를 말로만 읽어 주면 결국 눈으로 찾아야 한다. */
  const focusOnNode = (nodeId) => {
    const pos = positions[nodeId];
    if (pos) recenterAt(pos.x, pos.y);
  };

  // 현재 뷰(팬/줌)에서 실제로 보이는 캔버스 좌표 범위 — 미니맵 뷰포트 사각형 계산용.
  const visibleRect = {
    minX: (0 - view.x - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    maxX: (CANVAS_WIDTH - view.x - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    minY: (0 - view.y - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
    maxY: (CANVAS_HEIGHT - view.y - CANVAS_CENTER) / view.scale + CANVAS_CENTER,
  };

  const inspectedId = selectedNodeId || run.playerNodeId;
  const inspectedNode = run.graph.nodes.find((n) => n.id === inspectedId);
  // 패널도 호버 카드와 같은 설명을 쓴다 — 두 곳이 다른 문구를 만들면 하나가 조용히 낡는다.
  // 디버그 전체보기도 그대로 반영한다(지도만 다 보이고 패널은 안 보이면 디버그가 반쪽이다).
  const inspected = inspectedNode
    ? describeNode(run, inspectedNode, threatsByNode, exitByNode, debugReveal, viewCapabilities.stealth, viewCapabilities.perception)
    : null;
  const inspectedObservedAt = selectedNodeId && run.observations[selectedNodeId] ? run.observations[selectedNodeId].observedAt : null;
  const selectedEdge = selectedNodeId ? findTraversableEdge(run, selectedNodeId) : null;
  const selectedEdgeTraversable = selectedEdge ? canTraverseEdge(run, selectedEdge, capabilities.mobility) : false;
  const selectedCamera = selectedNodeId ? cameraByNode[selectedNodeId] : null;
  const selectedCameraActive = selectedCamera
    && !(run.disabledCameraIds || []).includes(selectedCamera.id)
    && !isCameraHackActive(run, selectedCamera.id);
  // 서 있는 자리가 카메라 노드이고 지금 실효 은신이 카메라의 지각에 못 미치면, 다음 행동을
  // 마치거나 자리를 뜨는 순간 걸린다 — 그 사실은 노드를 고르지 않아도 상시 보여야 한다.
  const cameraWatchingHere = hasLiveCameraAt(run, run.playerNodeId)
    && cameraSeesStealth(explainEffectiveStealth(capabilities.stealth, run).total);

  // 시간에 관한 화면 정보는 전부 mapTimeline의 순수 함수에서 온다 — 여기서 다시 세지 않는다.
  const encounterBlocked = encounterBlocks(run);
  const countdowns = runCountdowns(run);
  const cooldownLabels = Object.fromEntries(fieldEquipment.map((eq) => [
    eq.instanceId, FIELD_ACTION_LABELS[eq.contract.fieldAction.kind] || eq.contract.fieldAction.kind,
  ]));
  const timeline = upcomingEvents(run, TIMELINE_HORIZON, { cooldownLabels });
  // 추적자는 관측 규칙을 타지 않는다(ADR-0092) — 위협 패널의 첫 줄과 지도 표식을 여기서 만들고,
  // 아래 일반 위협 목록에서는 빼서 같은 개체가 두 번 읽히지 않게 한다.
  const hunterMarks = describeHunters(run);
  const hunterIds = new Set(hunterMarks.map((h) => h.id));
  const threatMoves = observableThreatMoves(run).filter((threat) => !hunterIds.has(threat.id));
  const staleSightings = staleThreatSightings(run);
  const interruption = interruptionNotice(run);
  const waitNotice = waitBatchNotice(run);

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--color-divider)', padding: 'var(--space-3) var(--space-6)', flexShrink: 0 }}>
        <div style=${{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <h2 style=${{ margin: 0, fontSize: '18px' }}>시설맵</h2>
          ${run.contract ? html`
            <span style=${{ fontSize: '11px', color: run.contract.status === 'completed' ? 'var(--color-accent-700)' : 'var(--color-neutral-600)' }}>
              계약 「${run.contract.name}」 — ${{ accepted: '진행 중', acquired: '확보됨', completed: '완료' }[run.contract.status]}
              ${run.lockdown ? html`<strong style=${{ color: 'var(--color-negative, #dd2b0f)' }}> · 봉쇄 중(위협 가속 — 출구 폐쇄 시각은 그대로)</strong>` : null}
            </span>
          ` : null}
        </div>
        <div style=${{ display: 'flex', gap: 0, fontSize: '13px', alignItems: 'stretch' }}>
          <${Tooltip} content=${`현재 체력입니다. 0이 되면 전투 불능으로 런이 종료됩니다. 필드에서는 소모품으로만 회복할 수 있습니다.${injury > 0 ? ` 지금은 HP가 ${Math.round((ps.hp / ps.maxHp) * 100)}%라 여섯 Capability가 전부 ${injury} 깎여 있습니다 — 회복하면 그 자리에서 풀립니다(ADR-0093).` : ''}`}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
              <${IconHeart} /><span>HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
              ${injury > 0 ? html`<span class="tag" style=${{ background: 'var(--color-negative, #dd2b0f)', color: 'var(--color-bg)', fontWeight: 800, fontSize: '10px', padding: '0 5px' }}>부상 −${injury}</span>` : null}
            </div>
          <//>
          <${MapClock} run=${run} countdowns=${countdowns} />
          <div style=${{ display: 'flex', alignItems: 'center', width: '130px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
            <${OverloadToggle} active=${ps.overloadActive} compact=${true} />
          </div>
          ${/* 칩 잔량은 HP와 같은 줄에 산다 — 지도와 전투가 같은 통을 쓰므로(ADR-0086) 행동
                패널이 아니라 런의 상태로 읽혀야 한다. */ null}
          <${Tooltip} width=${260} content="오버라이드 칩 잔량입니다. 지도의 긴급 권한 코드와 전투의 충격 코어가 같은 통을 씁니다.">
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)', color: run.overrideArmed ? 'var(--color-accent-700)' : undefined, fontWeight: run.overrideArmed ? 800 : undefined }}>
              <span>오버라이드 <strong>${ps.overrideChips || 0}</strong>${run.overrideArmed ? ' · 사용 중' : ''}</span>
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
<${Tooltip} content="지도 기호 범례를 엽니다.">
            <button class="btn btn-secondary" style=${{ fontSize: '13px', fontWeight: 800, width: '34px', padding: '6px 0' }} onClick=${() => setLegendOpen((v) => !v)}>?</button>
          <//>
          <${Tooltip} content="이번 런에서 한 행동과 그때 흐른 칸을 순서대로 봅니다.">
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '6px 10px', background: logOpen ? 'var(--color-accent-100)' : undefined }} onClick=${() => setLogOpen((v) => !v)}><${IconList} /></button>
          <//>
          <${Tooltip} width=${240} content="디버그: 안개/미발견 상태를 무시하고 위협 상세·현장 기회·특수 엣지·열쇠 탈출구를 전부 표시합니다. 뷰 전환일 뿐이며 실제 진행 상태는 그대로입니다.">
            <button
              class="btn btn-secondary"
              style=${{
                fontSize: '11px', fontWeight: 800, padding: '6px 10px', letterSpacing: '0.03em',
                borderColor: 'var(--color-accent-2-700)', color: debugReveal ? 'var(--color-bg)' : 'var(--color-accent-2-700)',
                background: debugReveal ? 'var(--color-accent-2-700)' : undefined,
              }}
              onClick=${() => setDebugReveal((v) => !v)}
            >DEBUG 전체보기</button>
          <//>
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
        const where = describeNodeLocation(run, run.lastCameraDetection.nodeId, playerHops);
        return html`
          <div
            style=${{
              fontSize: '12px', fontWeight: 800, padding: '7px var(--space-6)', flexShrink: 0, cursor: 'pointer',
              color: recent ? 'var(--color-bg)' : 'var(--color-text)',
              background: recent ? 'var(--color-negative, #dd2b0f)' : 'var(--color-neutral-200)',
            }}
            onMouseEnter=${() => setHoveredNodeId(run.lastCameraDetection.nodeId)}
            onMouseLeave=${() => setHoveredNodeId(null)}
            onClick=${() => focusOnNode(run.lastCameraDetection.nodeId)}
          >
            카메라 발각 — ${where}에서 ${elapsed}칸 전 위치가 노출됐습니다.${recent ? ' 반경 3홉 내 적이 이 위치로 이동했습니다.' : ''}
          </div>
        `;
      })() : null}

      ${interruption ? html`
        <div style=${{
    fontSize: '12px', fontWeight: 700, padding: '7px var(--space-6)', flexShrink: 0,
    color: 'var(--color-bg)', background: '#b45309',
  }}>
          ${interruption.text}
        </div>
      ` : null}

      ${/* 떠 있는 것들은 한 컨테이너에 세로로 쌓는다 — 전에는 조우 패널과 파밍 토스트가 같은
          좌표에 겹쳐 떠서, 파밍 직후 매복이 나면 그 사실을 알리는 토스트가 조우 패널 뒤에 가려졌다. */ null}
      ${run.encounter || farmToast ? html`
        <div style=${{ position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', pointerEvents: 'none' }}>
          ${farmToast ? (() => {
            const loot = farmLootDisplay(farmToast.loot);
            return html`<div style=${{ minWidth: '240px', padding: '10px 14px', border: '1px solid #15803d', borderLeft: '4px solid #15803d', background: '#f0fdf4', boxShadow: 'var(--shadow-lg)', color: '#14532d', fontSize: '12px', pointerEvents: 'auto' }}>
              <div style=${{ fontWeight: 800, marginBottom: '2px' }}>파밍 획득</div>
              <div><strong style=${{ color: loot.color }}>${loot.name}</strong>${loot.sub ? ` · ${loot.sub}` : ''}</div>
            </div>`;
          })() : null}
          ${run.encounter ? html`<div style=${{ pointerEvents: 'auto' }}><${EncounterPanel} run=${run} capabilities=${capabilities} /></div>` : null}
        </div>
      ` : null}

      <div style=${{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref=${mapAreaRef} style=${{ position: 'relative', flex: 1, background: 'var(--color-bg)' }}
          onMouseDown=${handleCanvasMouseDown}
          onMouseMove=${handleCanvasMouseMove}
          onMouseUp=${handleCanvasMouseUp}
          onMouseLeave=${handleCanvasMouseUp}
        >
          <div style=${{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${() => zoomBy(1.25)}>+</button>
            <button class="btn btn-secondary" style=${{ fontSize: '12px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${() => zoomBy(1 / 1.25)}>−</button>
            <${Tooltip} content="지도를 현재 위치로 되돌립니다.">
              <button class="btn btn-secondary" style=${{ fontSize: '11px', padding: '4px 9px', background: 'var(--color-bg)' }} onClick=${focusOnPlayer}><${IconTarget} /></button>
            <//>
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
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)' }}></span>한 번도 확인 안 함 — 방이 있다는 것만 알고 안에 무엇이 있는지는 모른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-accent)' }}></span>탈출구(A/B/K, 안개 무관 항상 표시)</div>
                <div style=${{ borderTop: '1px solid var(--color-divider)', margin: '3px 0', paddingTop: '5px', fontWeight: 700 }}>노드 유형 — 모양으로 구분</div>
                ${Object.entries(NODE_TYPE_NOTES).map(([type, note]) => html`
                  <div key=${type} style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" style=${{ flex: '0 0 auto' }}>
                      ${nodeBodyShape(type, 14, 14, { fill: 'var(--color-bg)', stroke: 'var(--color-divider)', 'stroke-width': 1.5 })}
                    </svg>
                    <span><b>${NODE_TYPE_LABELS[type]}</b> — ${note}</span>
                  </div>
                `)}
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>⇄</span>구역 출입구(관문). 인접 구역으로 넘어가는 유일한 일반 통로이자 증원이 들어오는 자리</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-negative, #dd2b0f)', fontWeight: 900 }}>†</span>전투에서 이긴 자리에 남은 시체. 위협이 밟으면 신고되어 경계 게이지가 오른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: '#b45309', fontWeight: 800 }}>˙N</span>내가 남긴 흔적 수. 강한 흔적이 발견되면 경계 게이지가 오른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▲N</span>포착된 위협 그룹 수(시야 밖에서는 그룹 수 없이 ▲만)</div>
                <div style=${{ borderTop: '1px solid var(--color-divider)', margin: '3px 0', paddingTop: '5px', fontWeight: 700 }}>위협 표식 — 실시간으로 볼 때만 모드가 붙는다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-accent-2-700, #dd2b0f)' }}>▲N</span>순찰 — 정해진 길을 돈다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-accent-2-700, #dd2b0f)', fontWeight: 800 }}>▲N</span>조사/경계 — 무언가를 보고 움직이는 중</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-negative, #dd2b0f)', fontWeight: 900 }}>▲N!</span>추적 — 나를 쫓고 있다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-negative, #dd2b0f)', fontWeight: 900 }}>◆ 추적자</span>경계도 3단계가 내보낸 개체. 안개와 무관하게 항상 보이고, 회피·속이기 없이 전투만 남는다. 20칸 동안 나를 보지 못하거나, 그 구역 경계도가 3 아래로 내려가거나, 통제실을 장악하면 물러난다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '2px dashed var(--color-accent-2-700)' }}></span>미개방 특수 엣지(인접 시 클릭해 개방)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '3px dotted var(--color-neutral-900)' }}></span>임시 장벽 활성(적 이동 차단, 시한부)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▶</span>일방통행 엣지(화살표 방향으로만 이동 가능)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)', position: 'relative' }}><span style=${{ position: 'absolute', top: '-3px', right: '-3px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-accent-2-700)' }}></span></span>보급품 위치 — 짧고 조용하게 끝나고 보상이 바로 들어온다(DEBUG 전체보기 켰을 때만 표시)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-accent-2-700)', fontWeight: 900 }}>◆</span>확보 대상 — 길고 시끄러운 대신 후보 3개 중 하나를 고른다. 주황색 ◆는 상급(받는 장비가 새것으로 들어온다)</div>
                ${/* 지도에 실제로 그려지는 기호인데 범례에 없던 것들 — 없으면 화면의 C·I·G와
                    구역 색이 무엇인지 알 방법이 없다(리뷰 B7). */ null}
                <div style=${{ borderTop: '1px solid var(--color-divider)', margin: '3px 0', paddingTop: '5px', fontWeight: 700 }}>장치와 구역 상태</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: '#dc2626', fontWeight: 900 }}>C</span>카메라 — 작동 중(빨강) / <span style=${{ color: '#0ea5e9', fontWeight: 900 }}>해킹됨(파랑)</span> / <span style=${{ color: '#64748b', fontWeight: 900 }}>파괴됨(회색)</span>. 위치는 런 시작부터 전부 보인다. 그 방에서 행동을 마치거나 떠날 때 실효 Stealth ${CAMERA_PERCEPTION} 미만이면 발각되고, 소음을 내면 즉시 발각된다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: '#7c3aed', fontWeight: 900 }}>I</span>접속 인터페이스 — 장악하면 이 구역의 발견된 카메라·발전기를 거리와 무관하게 원격 조작할 수 있다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: '#ca8a04', fontWeight: 900 }}>G</span>배터리 발전기 — 살아 있으면 이 구역 적이 전투 시작 시 갑옷 5를 받는다(<span style=${{ color: '#64748b', fontWeight: 900 }}>회색은 무력화됨</span>)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', border: '1.5px dashed #7c3aed', boxSizing: 'border-box' }}></span>구역 랜드마크(통제실 장악 자리, 구역당 하나). 안개가 걷히면 이름이 툴팁에 보인다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', border: '2.5px solid var(--color-accent-2-700)', boxSizing: 'border-box' }}></span>계약 목표부 — 이번 계약의 확보·설치·데이터 확보 자리</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', background: 'var(--color-negative, #dd2b0f)', opacity: 0.18, border: '1px solid var(--color-divider)' }}></span>구역 배경색 = 경계도. 진할수록 높고, 높으면 위협이 자주 움직이고 증원이 빨라진다</div>
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
                ${run.graph.sectorIds.map((sectorId, i) => {
                  const zone = zones[sectorId];
                  if (!zone) return null;
                  const alert = run.sectorAlerts[sectorId];
                  const isCurrent = sectorId === currentSectorId;
                  return html`
                    <g key=${sectorId}>
                      <polygon points=${zone.polygon} fill=${i % 2 === 0 ? 'var(--color-neutral-100)' : 'transparent'} stroke="var(--color-divider)" stroke-width="1" stroke-dasharray="2 5" opacity="0.7"></polygon>
                      <text x=${zone.cx} y=${zone.topY - 14} text-anchor="middle" font-size="14" font-weight="800" fill=${isCurrent ? 'var(--color-accent-700)' : 'var(--color-neutral-700)'}>${SECTOR_NAMES[sectorId]}</text>
                      ${[0, 1, 2].map((d) => html`<circle key=${d} cx=${zone.cx - 16 + d * 11} cy=${zone.topY - 4} r="2.6" fill=${d < alert.level ? 'var(--color-accent-600)' : 'var(--color-neutral-300)'}></circle>`)}
                    </g>
                  `;
                })}
              </g>
              <g>
                ${run.graph.edges.map((e) => {
                  if (!chartedNodeIds.has(e.from) || !chartedNodeIds.has(e.to)) return null;
                  const from = positions[e.from]; const to = positions[e.to];
                  // 특수 엣지의 존재(잠김/일방통행 여부)는 두 끝 노드 중 하나라도 가봤거나
                  // 정찰해 본 적이 있어야만(unknown이 아니어야) 드러난다 — 그 전까지는 평범한
                  // 엣지처럼 보인다. 실제로 열 수 있는지(openable)는 항상 인접 엣지에서만
                  // 계산되므로 이 게이팅과 무관하게 이미 안전하다.
                  const revealed = debugReveal || nodeKnowledge(run, e.from, viewCapabilities.perception) !== 'unknown' || nodeKnowledge(run, e.to, viewCapabilities.perception) !== 'unknown';
                  const special = e.features.length > 0 && revealed;
                  const opened = run.openedEdgeIds.includes(e.id);
                  const openable = openableEdgeIds.has(e.id);
                  const pickable = pickableEdgeIds?.has(e.id);
                  const barrier = activeBarriers[e.id];
                  const highGround = e.features.includes('highGround');
                  const highlighted = !!highlightedEdgeIds?.has(e.id) || e.id === hoveredEdgeId;
                  const onRoute = !!routeEdgeIds?.has(e.id);
                  const onPreviewRoute = !!previewEdgeIds?.has(e.id);
                  const dashed = special && !opened;
                  const clickable = openable || !!pickable;
                  // 복도끼리 잇는 엣지는 그 구역 평면도의 뼈대다. 굵게 그려야 격자·사슬·방사·탑
                  // 같은 배치 원형이 방들 사이에 묻히지 않고 한눈에 읽힌다.
                  const isSpine = !special && PASSAGE_TYPES.has(nodeTypeById[e.from]) && PASSAGE_TYPES.has(nodeTypeById[e.to]);
                  const stroke = barrier ? 'var(--color-neutral-900)' : pickable ? 'var(--color-accent)' : openable ? 'var(--color-accent-2-700)' : highGround ? '#7c3aed' : 'var(--color-divider)';
                  const oneWay = e.bidirectional === false && revealed;
                  // 통로의 설명은 문장이 아니라 카드다(EdgeTooltipCard) — 잠금·고지대·방향·
                  // 장벽·이동은 서로 다른 결정을 부르므로 각자의 줄을 가져야 한다.
                  const edgeDescription = describeEdge(run, e, {
                    revealed, capabilities, debugReveal, openableEdgeIds, pickableEdgeIds,
                    activeBarriers, routeEdgeIds, playerHops, edgeApproachMode, threatMoves,
                  });
                  const { d: pathD, midX, midY, angleDeg } = edgePath(from, to);
                  return html`
                    <g key=${e.id}>
                      ${highlighted ? html`<path d=${pathD} fill="none" stroke="var(--color-accent-300)" stroke-width="9" pointer-events="none"></path>` : null}
                      ${onRoute ? html`<path class="map-route-edge" d=${pathD} fill="none" stroke=${ROUTE_COLOR} stroke-width="7" stroke-linecap="round" opacity="0.85" pointer-events="none"></path>` : null}
                      ${onPreviewRoute ? html`<path class="map-route-preview" d=${pathD} fill="none" stroke=${ROUTE_COLOR} stroke-width="5" stroke-linecap="round" stroke-dasharray="6 4" opacity="0.35" pointer-events="none"></path>` : null}
                      <path d=${pathD} fill="none" stroke=${stroke} stroke-width=${clickable ? 4 : isSpine ? 3 : 1.2} stroke-dasharray=${barrier ? '2 3' : dashed ? '5 3' : undefined} opacity=${isSpine || clickable || special ? 1 : 0.6} pointer-events="none"></path>
                      ${oneWay ? html`<polygon points="-7,-5 7,0 -7,5" fill=${stroke} transform=${`translate(${midX},${midY}) rotate(${angleDeg})`} pointer-events="none"></polygon>` : null}
                      ${/* 카드가 통로 가운데(midX, midY)에 붙으므로 커서를 따라다닐 필요가 없다 —
                          매 프레임 호버를 다시 예약하던 onMouseMove를 걷어냈다. */ null}
                      <path
                        d=${pathD} fill="none" stroke="transparent" stroke-width="16"
                        data-edge-id=${e.id}
                        style=${{ cursor: clickable ? 'pointer' : 'default' }}
                        onClick=${() => handleEdgeClick(e)}
                        onMouseEnter=${() => { showEdgeHover({ x: midX, y: midY }, edgeDescription); setHoveredEdgeId(e.id); }}
                        onMouseLeave=${() => { hideHover(); setHoveredEdgeId(null); }}
                        tabindex=${clickable ? 0 : undefined}
                        onFocus=${() => { showEdgeHover({ x: midX, y: midY }, edgeDescription); setHoveredEdgeId(e.id); }}
                        onBlur=${() => { hideHover(); setHoveredEdgeId(null); }}
                        onKeyDown=${(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) handleEdgeClick(e); }}
                      ></path>
                    </g>
                  `;
                })}
              </g>
              ${run.graph.nodes.map((n) => {
                if (!chartedNodeIds.has(n.id)) return null;
                const knowledge = nodeKnowledge(run, n.id, viewCapabilities.perception);
                const pos = positions[n.id];
                const exit = exitByNode[n.id];
                const live = debugReveal || knowledge === 'current' || knowledge === 'fresh';
                const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
                const threatCount = live ? (threatsByNode[n.id] || []).length : (run.observations[n.id]?.hasThreat ? null : 0);
                // displayKnowledge: 디버그 모드에서 색/투명도만 "다 보임"으로 바꾼다(진짜 knowledge는
                // 그대로 둬서 이동 가능 판정 등 다른 로직은 안개 규칙을 그대로 따른다).
                const displayKnowledge = debugReveal ? (n.id === run.playerNodeId ? 'current' : 'fresh') : knowledge;
                // 관측이 닿은 노드는 무엇이 놓여 있는지가 기록에 남으므로 지도에도 ◆(확보 대상)·
                // ○(보급품)로 남는다 — 정찰에 쓴 칸의 대가가 화면에 계속 보여야 "어디를 정찰할까"가
                // 결정이 된다. 등급(정예 색)만은 여전히 정찰로 읽은 것만 쓴다.
                const nodeContents = knownContentsOf(run, n.id, debugReveal);
                const opportunity = nodeContents.opportunities.find((o) => o.grade === 'prize') || nodeContents.opportunities[0];
                const prizeTier = opportunity && opportunity.grade === 'prize'
                  ? (debugReveal
                    ? run.graph.opportunities.find((o) => o.id === opportunity.id)?.tier
                    : scoutedGradeOf(run, n.id, opportunity.id)?.tier)
                  : null;
                const nodeDescription = describeNode(run, n, threatsByNode, exitByNode, debugReveal, viewCapabilities.stealth, viewCapabilities.perception);
                const nodeHint = canMoveNow(n.id) ? '클릭해 선택 · 더블클릭해 이동' : '클릭해 선택';
                const isSelected = n.id === selectedNodeId || (!selectedNodeId && n.id === run.playerNodeId);
                const activelyObserved = activeReconNodeIds.has(n.id);
                const camera = cameraByNode[n.id];
                const hasInterface = interfaceNodeIds.has(n.id);
                const generator = generatorByNode[n.id];
                return html`
                  <g key=${n.id}>
                    ${activelyObserved ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="rgba(14, 165, 233, 0.16)" stroke="#0ea5e9" stroke-width="3" pointer-events="none"></circle>` : null}
                    ${isSelected ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 6} fill="none" stroke="var(--color-accent)" stroke-width="2" pointer-events="none"></circle>` : null}
                    ${routeNodeIds?.has(n.id) && n.id !== run.playerNodeId && n.id !== selectedNodeId ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 5} fill="none" stroke=${ROUTE_COLOR} stroke-width="2.5" opacity="0.85" pointer-events="none"></circle>` : null}
                    ${exit
                      ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 4} fill=${nodeFill(displayKnowledge, hasThreat, true)} stroke="var(--color-divider)" stroke-width="1.5" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none"></circle>`
                      : nodeBodyShape(n.type, pos.x, pos.y, {
                        fill: nodeFill(displayKnowledge, hasThreat, false),
                        stroke: 'var(--color-divider)',
                        'stroke-width': 1.5,
                        opacity: nodeOpacity(displayKnowledge),
                        'pointer-events': 'none',
                      })}
                    ${/* 확대하면 도형만으로는 유형이 잘 안 읽힌다 — 그때만 유형 첫 글자를 안에 적는다.
                        현재 위치와 탈출구는 이미 자기 표식(A/B/K)을 달고 있으므로 건너뛴다. */ null}
                    ${view.scale >= NODE_TYPE_LETTER_MIN_SCALE && !exit && n.id !== run.playerNodeId ? html`
                      <text x=${pos.x} y=${pos.y + 3} text-anchor="middle" font-size="7" font-weight="800" fill="var(--color-neutral-700)" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">${(NODE_TYPE_LABELS[n.type] || n.type).charAt(0)}</text>
                    ` : null}
                    ${routeHopByNode.get(n.id) ? html`
                      <g pointer-events="none">
                        <circle cx=${pos.x + NODE_RADIUS + 4} cy=${pos.y - NODE_RADIUS - 4} r="9" fill=${ROUTE_COLOR}></circle>
                        <text x=${pos.x + NODE_RADIUS + 4} y=${pos.y - NODE_RADIUS - 1} text-anchor="middle" font-size="8" font-weight="800" fill="var(--color-bg)">${routeHopByNode.get(n.id)}</text>
                      </g>
                    ` : null}
                    ${n.isGateway ? html`<text x=${pos.x - 13} y=${pos.y + 13} text-anchor="middle" font-size="11" font-weight="900" fill="var(--color-neutral-700)" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">⇄</text>` : null}
                    ${exit ? html`<text x=${pos.x} y=${pos.y + 5} text-anchor="middle" font-size="12" font-weight="800" fill="var(--color-bg)" pointer-events="none">${exit.kind === 'key' ? 'K' : exit.exitId}</text>` : null}
                    ${hasThreat ? (() => {
                      // 실시간으로 보고 있는 노드에서는 "몇 마리"만이 아니라 "지금 무엇을 하는
                      // 중인가"가 이동 결정을 바꾼다 — 순찰 옆은 지나갈 수 있어도 추적 중인
                      // 무리 옆은 지나갈 수 없다. 시야 밖의 낡은 관측은 모드를 모르므로 그대로
                      // 둔다(아는 척하면 안 된다).
                      const marker = threatMarker(live ? threatsByNode[n.id] : null);
                      return html`<text x=${pos.x} y=${pos.y - NODE_RADIUS - 8} text-anchor="middle" font-size="13" font-weight=${marker.weight} fill=${marker.fill} opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">▲${threatCount ?? ''}${marker.suffix}</text>`;
                    })() : null}
                    ${opportunity && opportunity.grade === 'prize'
                      ? html`<text x=${pos.x + 9} y=${pos.y - 6} text-anchor="middle" font-size="11" font-weight="900" fill=${prizeTier === 'elite' ? '#b45309' : 'var(--color-accent-2-700)'} pointer-events="none">◆</text>`
                      : (opportunity ? html`<circle cx=${pos.x + 9} cy=${pos.y - 9} r="3.5" fill="var(--color-accent-2-700)" stroke="var(--color-bg)" stroke-width="1" pointer-events="none"></circle>` : null)}
                    ${corpseByNode[n.id] ? html`<text x=${pos.x + 12} y=${pos.y + 13} text-anchor="middle" font-size="11" font-weight="900" fill="var(--color-negative, #dd2b0f)" pointer-events="none">†</text>` : null}
                    ${traceCountByNode.get(n.id) ? html`<text x=${pos.x - 12} y=${pos.y + 4} text-anchor="middle" font-size="9" font-weight="800" fill="#b45309" opacity="0.85" pointer-events="none">˙${traceCountByNode.get(n.id)}</text>` : null}
                    ${camera ? html`<text x=${pos.x - 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledCameraIds?.includes(camera.id) ? '#64748b' : (isCameraHackActive(run, camera.id) ? '#0ea5e9' : '#dc2626')} pointer-events="none">C</text>` : null}
                    ${hasInterface ? html`<text x=${pos.x + 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill="#7c3aed" pointer-events="none">I</text>` : null}
                    ${generator ? html`<text x=${pos.x} y=${pos.y + 22} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledGeneratorIds.includes(generator.id) ? '#64748b' : '#ca8a04'} pointer-events="none">G</text>` : null}
                    ${(() => {
                      const landmark = landmarkByNode[n.id];
                      if (!landmark || (knowledge === 'unknown' && !debugReveal)) return null;
                      const isObjective = !!run.contract && run.contract.sectorId === landmark.sectorId;
                      return html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 3} fill="none" stroke=${isObjective ? 'var(--color-accent-2-700)' : '#7c3aed'} stroke-width=${isObjective ? 2.5 : 1.5} stroke-dasharray=${isObjective ? null : '3 2'} opacity=${nodeOpacity(displayKnowledge)} pointer-events="none"></circle>`;
                    })()}
                    ${/* roving tabindex — 탭 순서에 노드가 160개 들어가면 키보드로는 사이드바에
                        닿을 수 없다. 탭 정지점은 지금 보고 있는 노드 하나뿐이고, 나머지는 그
                        자리에서 화살표로 옮겨 다닌다. */ null}
                    <circle
                      ref=${(el) => { if (el) nodeRefs.current[n.id] = el; else delete nodeRefs.current[n.id]; }}
                      cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="transparent"
                      data-node-id=${n.id}
                      style=${{ cursor: 'pointer' }}
                      onClick=${() => handleNodeSelect(n.id)}
                      onDblClick=${() => handleNodeDoubleClick(n.id)}
                      onMouseEnter=${() => { showNodeHover(pos, nodeDescription, nodeHint); setHoveredNodeId(n.id); }}
                      onMouseLeave=${() => { hideHover(); setHoveredNodeId(null); }}
                      tabindex=${n.id === focusedNodeId ? 0 : -1}
                      onFocus=${() => { showNodeHover(pos, nodeDescription, nodeHint); setHoveredNodeId(n.id); }}
                      onBlur=${() => { hideHover(); setHoveredNodeId(null); }}
                      onKeyDown=${(ev) => handleNodeKeyDown(ev, n.id)}
                    ></circle>
                  </g>
                `;
              })}
              ${/* 추적자(ADR-0092)는 관측·안개·도면 여부와 무관하게 **항상** 그린다. 노드 루프
                  바깥의 독립 레이어인 이유가 그것이다 — 루프는 도면에 없는 노드를 건너뛰므로,
                  거기 그리면 추적자가 비인가 통로로 들어선 순간 지도에서 사라진다. 어디 있는지
                  모르는 추적자는 "언제 닿는가"를 셀 수 없게 만들어 압박이 아니라 사고가 된다. */ null}
              <g pointer-events="none">
                ${hunterMarks.map((hunter) => {
                  const pos = positions[hunter.nodeId];
                  if (!pos) return null;
                  return html`
                    <g key=${hunter.id}>
                      <text x=${pos.x} y=${pos.y + NODE_RADIUS + 12} text-anchor="middle" font-size="12" font-weight="900" fill="var(--color-negative, #dd2b0f)">◆</text>
                      <text x=${pos.x} y=${pos.y + NODE_RADIUS + 22} text-anchor="middle" font-size="9" font-weight="800" fill="var(--color-negative, #dd2b0f)">추적자</text>
                    </g>
                  `;
                })}
              </g>
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
                if (!chartedNodeIds.has(e.from) || !chartedNodeIds.has(e.to)) return null;
                const from = positions[e.from]; const to = positions[e.to];
                return html`<line key=${e.id} x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} stroke="var(--color-neutral-300)" stroke-width="1.5"></line>`;
              })}
              ${run.graph.nodes.map((n) => {
                if (!chartedNodeIds.has(n.id)) return null;
                const pos = positions[n.id];
                const exit = exitByNode[n.id];
                const isCurrent = n.id === run.playerNodeId;
                if (exit) return html`<circle key=${n.id} cx=${pos.x} cy=${pos.y} r="9" fill="var(--color-accent)"></circle>`;
                return html`<circle key=${n.id} cx=${pos.x} cy=${pos.y} r=${isCurrent ? 12 : 5} fill=${isCurrent ? 'var(--color-accent-2-700)' : 'var(--color-neutral-400)'}></circle>`;
              })}
              <rect x=${visibleRect.minX} y=${visibleRect.minY} width=${visibleRect.maxX - visibleRect.minX} height=${visibleRect.maxY - visibleRect.minY} fill="none" stroke="var(--color-accent)" stroke-width="8"></rect>
            </svg>
          </div>

          ${hover && hover.node ? html`
            <div ref=${hoverCardRef} style=${{
              position: 'fixed', left: `${hoverCardPos.left}px`, top: `${hoverCardPos.top}px`, zIndex: 100,
              boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
            }}>
              <${NodeTooltipCard} description=${hover.node} text=${describeNodeText(hover.node)} hint=${hover.hint || '클릭해 선택'} />
            </div>
          ` : null}
          ${hover && hover.edge ? html`
            <div ref=${hoverCardRef} style=${{
              position: 'fixed', left: `${hoverCardPos.left}px`, top: `${hoverCardPos.top}px`, zIndex: 100,
              boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
            }}>
              <${EdgeTooltipCard} description=${hover.edge} text=${describeEdgeText(hover.edge)} />
            </div>
          ` : null}
          ${/* 지도 위에 자리가 없는 표식(임플란트 화살표)만 커서를 따라간다. */ null}
          ${hover && !hover.node && !hover.edge ? html`
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
            ${(() => {
    const cut = (run.powerCuts || []).find((c) => c.sectorId === currentSectorId && c.expiresAt > run.time);
    const cutText = cut ? `전원 차단 중(${leftTicksText(cut.expiresAt, run.time)} · 그동안 상승 멈춤)` : '';
    const p = ALERT_PRESSURE;
    const tip = `구역 경계 단계(0~3)와 그 아래 압력 게이지(0~${ALERT_GAUGE_CAPACITY}).`
      + ` 카메라에 걸리면 +${p.cameraDetection}, 남긴 시체가 발견되면 +${p.corpseFound}, 강한 흔적이 발견되면 +${p.strongTraceFound},`
      + ` 층계 위태로 그 자리에서 들키면 +${p.botchedAction}, 위협이 조사하고도 원인을 못 찾으면 +${p.failedInvestigation}입니다.`
      + ` 게이지가 가득 차면 단계가 1 오르고 남은 양은 다음 단계로 이월됩니다.`
      + ` 단계는 저절로 내려가지 않고 수습 수단으로만 내려가며, 그때 게이지는 0이 됩니다.`
      + ` 전원 차단 중인 구역은 압력이 오르지 않습니다.`
      + ` 단계가 높을수록 그 구역 위협들이 더 쉽게 추적 모드로 전환되고 증원이 빨리 옵니다.`;
    return html`
              <div style=${{ marginTop: '4px' }}>
                <${ThinGauge}
                  label=${`경계도 ${currentSectorAlert ? currentSectorAlert.level : '-'}/3`}
                  value=${currentSectorAlert ? currentSectorAlert.pressure : 0} max=${ALERT_GAUGE_CAPACITY}
                  valueText=${`${currentSectorAlert ? currentSectorAlert.pressure : 0}/${ALERT_GAUGE_CAPACITY}`}
                  tip=${tip} tipWidth=${280} width="100%" color="var(--color-accent-600)"
                />
                ${cutText ? html`<div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)' }}>${cutText}</div>` : null}
              </div>
            `;
  })()}
            ${currentSectorId && run.revealedPatrolRouteSectorIds.includes(currentSectorId) && run.reinforcements?.[currentSectorId] ? html`
              <${Tooltip} align="left" content="통제실을 장악해 이 구역의 교대 일정이 보입니다. 증원은 구역 관문(⇄)으로 들어오며, 전투로 비운 자리만 채웁니다.">
                <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', width: 'fit-content' }}>다음 증원 ${inTicksText(run.reinforcements[currentSectorId].nextAt, run.time)}</div>
              <//>
            ` : null}
            <div style=${{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              ${['A'].map((exitId) => html`
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
            <${Tooltip} align="left" width=${260} content=${`지금부터 ${TIMELINE_HORIZON}칸 안에 일어나는, 지금 알 수 있는 사건만 시각순으로 보여줍니다. 그보다 먼 것은 위의 카운터 숫자로 읽습니다. 관측하지 못한 위협의 위치와 이동은 여기 나오지 않습니다.`}>
              <h4 style=${{ margin: '0 0 6px', width: 'fit-content' }}>앞으로 ${TIMELINE_HORIZON}칸</h4>
            <//>
            ${timeline.length === 0
    ? html`<div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)' }}>${TIMELINE_HORIZON}칸 안에 예정된 사건이 없습니다.</div>`
    : html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              ${timeline.map((event) => html`
                <div
                  key=${`${event.at}:${event.text}`}
                  style=${{
                    display: 'flex', gap: '6px', fontSize: '10.5px', cursor: event.nodeId ? 'pointer' : 'default',
                    ...(event.kind === 'collapse' || event.kind === 'closure' ? deadlineStyle(event.inTicks) : { color: 'var(--color-neutral-700)' }),
                  }}
                  onMouseEnter=${() => { if (event.nodeId) setHoveredNodeId(event.nodeId); }}
                  onMouseLeave=${() => { if (event.nodeId) setHoveredNodeId(null); }}
                  onClick=${() => { if (event.nodeId) focusOnNode(event.nodeId); }}
                >
                  <span style=${{ minWidth: '40px', fontWeight: 800, textAlign: 'right' }}>${event.inTicks}칸 후</span>
                  <span>${event.text}</span>
                </div>
              `)}
            </div>`}
          </div>

          <div style=${{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)' }}>
            <h4 style=${{ margin: '0 0 6px' }}>위협</h4>
            ${/* 추적자는 언제나 첫 줄이다 — 다른 마커가 몇이든 이 개체가 몇 홉에 있고 몇 칸 뒤에
                흔적을 놓치는가가 다음 한 칸의 결정을 가장 크게 바꾼다(ADR-0092). */ null}
            ${hunterMarks.map((hunter) => html`
              <${Tooltip} key=${hunter.id} align="left" width=${260} content=${`경계도 3단계가 내보낸 개체입니다. 조우 회피도 속이기도 통하지 않고, 같은 노드에 닿으면 곧바로 전투입니다. 2칸마다 한 번 움직이며(경계도·봉쇄와 무관), ${hunter.ticksUntilLost}칸 동안 나를 보지 못하면 물러납니다. 구역 경계도를 3 아래로 내리거나 그 구역 통제실을 장악해도 물러납니다.`}>
                <div
                  style=${{ fontSize: '10.5px', color: 'var(--color-negative, #dd2b0f)', fontWeight: 900, width: 'fit-content', cursor: 'pointer', marginBottom: '3px' }}
                  onMouseEnter=${() => setHoveredNodeId(hunter.nodeId)}
                  onMouseLeave=${() => setHoveredNodeId(null)}
                  onClick=${() => focusOnNode(hunter.nodeId)}
                >
                  ◆ 추적자 · ${SECTOR_NAMES[hunter.sectorId] || hunter.sectorId} · 나와 ${hunter.hopsFromPlayer ?? '?'}홉 · 놓치기까지 ${hunter.ticksUntilLost}칸
                </div>
              <//>
            `)}
            ${hunterMarks.length > 0 && threatMoves.length === 0 && staleSightings.length === 0
    ? null
    : threatMoves.length === 0 && staleSightings.length === 0
    ? html`<div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)' }}>지금 보고 있는 위협이 없습니다.</div>`
    : html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              ${threatMoves.map((threat) => html`
                <${Tooltip} key=${threat.id} align="left" width=${250} content=${`${whereIs(threat.nodeId)}에서 관측 중입니다. ${threatCompositionNote(threat)} ${threat.interval !== null && threat.interval !== undefined ? `지금 상태(${THREAT_MODE_LABELS[threat.mode] || threat.mode})를 유지하면 ${threat.interval}칸마다 한 번 움직입니다 — 추적으로 바뀌면 더 빨라집니다.` : '이동 주기는 Perception 2부터 읽힙니다.'} 어디로 갈지는 알 수 없습니다. 줄을 누르면 지도가 그 자리로 갑니다.`}>
                  <div
                    style=${{ fontSize: '10.5px', color: 'var(--color-negative, #dd2b0f)', fontWeight: 700, width: 'fit-content', cursor: 'pointer' }}
                    onMouseEnter=${() => setHoveredNodeId(threat.nodeId)}
                    onMouseLeave=${() => setHoveredNodeId(null)}
                    onClick=${() => focusOnNode(threat.nodeId)}
                  >
                    ${whereIs(threat.nodeId)} · ${threatSummaryText(threat)}${threat.ticksUntilMove !== null && threat.ticksUntilMove !== undefined ? ` · 다음 이동까지 ${threat.ticksUntilMove}칸` : ''}
                  </div>
                <//>
              `)}
              ${staleSightings.slice(0, 4).map((sighting) => html`
                <div
                  key=${sighting.nodeId}
                  style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', cursor: 'pointer', width: 'fit-content' }}
                  onMouseEnter=${() => setHoveredNodeId(sighting.nodeId)}
                  onMouseLeave=${() => setHoveredNodeId(null)}
                  onClick=${() => focusOnNode(sighting.nodeId)}
                >
                  ${whereIs(sighting.nodeId)} · ${sighting.ticksAgo}칸 전 관측
                </div>
              `)}
            </div>`}
          </div>

          <div style=${{ padding: 'var(--space-3) var(--space-4)', flex: 1 }}>
            <h4 style=${{ margin: '0 0 4px' }}>${selectedNodeId && selectedNodeId !== run.playerNodeId ? '선택 노드' : '현재 노드'}</h4>
            ${inspected ? html`
              <div style=${{ marginBottom: '10px' }}>
                <${NodeTooltipCard} description=${inspected} text=${describeNodeText(inspected)} width=${308} />
              </div>
              ${inspected.knowledge === 'stale' && inspectedObservedAt != null ? html`<div style=${{ fontSize: '10.5px', fontStyle: 'italic', color: 'var(--color-neutral-600)', marginBottom: '10px' }}>${run.time - inspectedObservedAt}칸 전 관측 (시각 ${inspectedObservedAt}) — 그 사이 상황이 바뀌었을 수 있습니다.</div>` : null}

              ${selectedNodeId && selectedNodeId !== run.playerNodeId ? html`
                <div class="map-route-summary" style=${{ fontSize: '11px', fontWeight: 800, color: routeToSelected ? ROUTE_COLOR : 'var(--color-negative, #dc2626)', marginBottom: '8px' }}>
                  ${routeToSelected
                    ? `최단 경로: ${routeToSelected.edgeIds.length}칸 이동 · 지도에 표시`
                    : '최단 경로: 지금 지날 수 있는 길이 없음(잠긴 문·일방통행 역방향·넘을 수 없는 고지대·아직 지도에 없는 노드)'}
                </div>
                ${/* 칸 수 하나로는 "어디를 지나가는가"를 알 수 없다 — 지나는 방과 위협을 순서대로
                    적고, 줄을 누르면 지도가 그 자리로 간다. */ null}
                ${routeToSelected ? (() => {
                  const specialCounts = {};
                  for (const edgeId of routeToSelected.edgeIds) {
                    const edge = run.graph.edges.find((e) => e.id === edgeId);
                    if (!edge) continue;
                    if (edge.features.includes('highGround')) specialCounts['고지대'] = (specialCounts['고지대'] || 0) + 1;
                    if (edge.features.includes('oneWay') || edge.bidirectional === false) specialCounts['일방통행'] = (specialCounts['일방통행'] || 0) + 1;
                  }
                  const specialText = Object.entries(specialCounts).map(([label, count]) => `${label} ${count}`).join(' · ');
                  return html`
                    <div class="map-route-list" style=${{ display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '8px' }}>
                      ${routeToSelected.nodeIds.slice(1).map((id, index) => {
                        const node = run.graph.nodes.find((n) => n.id === id);
                        const threatened = (threatsByNode[id] || []).length > 0;
                        return html`
                          <div
                            key=${id} role="button" tabindex="0"
                            style=${{ fontSize: '10.5px', color: 'var(--color-neutral-700)', cursor: 'pointer' }}
                            onClick=${() => focusOnNode(id)}
                            onKeyDown=${(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); focusOnNode(id); } }}
                          >
                            ${index + 1}. ${NODE_TYPE_LABELS[node?.type] || node?.type || id} · ${SECTOR_NAMES[node?.sectorId] || ''}
                            ${threatened ? html`<span style=${{ color: 'var(--color-accent-2-700)', fontWeight: 800 }}> · ▲ 위협</span>` : null}
                            ${node?.isGateway ? ' · 관문' : ''}
                          </div>
                        `;
                      })}
                      ${specialText ? html`<div style=${{ fontSize: '10.5px', color: '#7c3aed', fontWeight: 700, marginTop: '2px' }}>경로의 특수 통로: ${specialText}</div>` : null}
                    </div>
                  `;
                })() : null}
                ${/* 인접 노드는 이미 "이 노드로 이동"이 있으므로 그때는 이 버튼을 내지 않는다 —
                    같은 한 칸을 두 버튼이 걸면 어느 쪽이 무엇인지 읽히지 않는다. */ null}
                ${routeToSelected && routeToSelected.nodeIds.length > 1 && !isTrueAdjacent(run, selectedNodeId) ? (() => {
                  const nextNodeId = routeToSelected.nodeIds[1];
                  const nextNode = run.graph.nodes.find((n) => n.id === nextNodeId);
                  const nextEdge = findTraversableEdge(run, nextNodeId);
                  const nextTraversable = nextEdge ? canTraverseEdge(run, nextEdge, capabilities.mobility) : false;
                  const blockedByTask = !!run.pendingTask;
                  return html`
                    <${Tooltip} align="left" width=${260} content=${encounterBlocked ? ENCOUNTER_BLOCK_NOTE
                      : blockedByTask ? TASK_BLOCK_NOTE
                      : `경로의 첫 칸(${NODE_TYPE_LABELS[nextNode?.type] || nextNodeId})으로 한 칸 이동합니다. 선택은 그대로 남으므로 같은 버튼을 눌러 계속 걸을 수 있습니다.`}>
                      <button
                        class="btn btn-primary"
                        style=${{ fontSize: '12px', width: '100%', marginBottom: '8px' }}
                        disabled=${!nextTraversable || encounterBlocked || blockedByTask}
                        onClick=${() => handleMove(nextNodeId)}
                      >경로 따라 한 칸 이동 (다음: ${NODE_TYPE_LABELS[nextNode?.type] || nextNodeId})</button>
                    <//>
                  `;
                })() : null}
              ` : null}
              ${/* 이동 가능 여부는 "관측이 최신인가"가 아니라 "통로로 이어져 있는가"다 — 대기로
                    인접 관측이 낡아도 옆 방으로 걸어갈 수 있다. */ null}
              ${selectedNodeId && selectedNodeId !== run.playerNodeId && isTrueAdjacent(run, selectedNodeId) ? html`
                <${Tooltip} align="left" width=${260} content=${encounterBlocked ? ENCOUNTER_BLOCK_NOTE : '인접 노드로 이동합니다. 이동 소음은 출발 시각에 나고, 도착 판정은 완료 칸에 한 번 합니다.'}>
                  <button class="btn btn-primary" disabled=${!selectedEdgeTraversable || encounterBlocked} style=${{ fontSize: '12px', width: '100%', marginBottom: '2px' }} onClick=${() => handleMove(selectedNodeId)}>이 노드로 이동</button>
                <//>
                <div style=${{ fontSize: '10.5px', color: selectedEdgeTraversable ? 'var(--color-neutral-600)' : 'var(--color-negative, #dd2b0f)', marginBottom: '10px' }}>
                  ${selectedEdge
                    ? `${describeForecast(forecastAction('move', { edge: selectedEdge, value: capabilities.mobility }), '이동')}${selectedEdge.features.includes('highGround') ? ` · ${highGroundNote(selectedEdge, capabilities.mobility)}` : ''}`
                    : '경로 없음'}
                </div>
                ${selectedEdgeTraversable ? html`<div style=${{ fontSize: '10.5px', color: movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).color, marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>${movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).label}</div>` : null}
                ${selectedCameraActive ? html`<div style=${{ fontSize: '10.5px', color: '#dc2626', marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>${CAMERA_WATCH_NOTICE}</div>` : null}
              ` : null}

              ${(!selectedNodeId || selectedNodeId === run.playerNodeId) ? html`
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <${PanelGroup} title="여기서 할 수 있는 것" open=${panelGroupsOpen.actions} onToggle=${() => togglePanelGroup('actions')}>
                  ${cameraWatchingHere ? html`<div style=${{ fontSize: '10.5px', color: '#dc2626', marginBottom: '8px', fontWeight: 800 }}>${CAMERA_WATCH_NOTICE}</div>` : null}
                  <${PendingTaskPanel} run=${run} runCommand=${runCommand} />
                  <div>
                    <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>오버라이드 칩</div>
                    <${Tooltip} align="left" width=${280} content=${run.overrideArmed
                      ? '사용을 취소하고 칩을 돌려받습니다.'
                      : '긴급 권한 코드: 오버라이드 칩 하나로 다음 유료 행동 하나를 모든 Capability 4로 판정합니다(요구치 부족 없음, 사다리 대가 없음). 행동을 마치면 칩이 소모됩니다. 대기·장비 교체·소모품 사용처럼 판정이 없는 행동은 칩을 쓰지 않습니다.'}>
                      <button
                        class=${run.overrideArmed ? 'btn btn-primary' : 'btn btn-secondary'}
                        style=${{ fontSize: '12px', width: '100%' }}
                        disabled=${!run.overrideArmed && (ps.overrideChips || 0) <= 0}
                        onClick=${() => runCommand({ type: 'USE_OVERRIDE_CHIP' })}
                      >${run.overrideArmed ? '오버라이드 칩 사용 중 · 취소' : '오버라이드 칩 사용'} · 칩 ×${ps.overrideChips || 0}</button>
                    <//>
                    ${run.overrideArmed ? html`
                      <div style=${{ marginTop: '5px', padding: '5px 7px', borderLeft: '3px solid var(--color-accent-700)', background: 'var(--color-accent-100)', fontSize: '10.5px', fontWeight: 700 }}>
                        긴급 권한 코드 활성 — 다음 유료 행동은 모든 Capability 4로 판정
                      </div>
                    ` : null}
                  </div>
                  <div>
                    <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>정찰</div>
                    <${ActionButton}
                      run=${run} actionId="recon"
                      label="기본 정찰"
                      tip=${`무료 인접 시야가 이미 위협 유무·그룹 수·모드와 무엇이 놓여 있는지를 알려줍니다. 정찰이 사는 것은 그 다음의 **깊이**입니다 — 확보 대상의 등급·역할축, 현장 기회의 남은 횟수, 은엄폐 값, 시체·흔적, 위협의 규모·경계·다음 이동${perceptionInfo(capabilities.perception).reconHops > 1 ? ' · 구성' : ''}. 사거리는 ${perceptionInfo(capabilities.perception).reconHops}홉(Perception ${capabilities.perception})이고, 정찰 중에는 대기 중에도 그 자리가 실시간으로 유지됩니다. 소음 없이 항상 성공하지만 도중에 적이 도착하면 중단되어 아무것도 얻지 못합니다.`}
                      onClick=${() => runCommand({ type: 'BASIC_RECON' })}
                    />
                    ${run.activeRecon ? html`
                      <div style=${{ marginTop: '5px', padding: '5px 7px', borderLeft: '3px solid #0ea5e9', background: 'rgba(14, 165, 233, 0.10)', fontSize: '10.5px' }}>
                        실시간 정찰 중 · ${run.activeRecon.source === 'camera' ? `카메라 ${run.activeRecon.sourceNodeId}` : '현재 위치'}
                        ${run.activeRecon.expiresAt == null ? ' · 이동/다른 정찰 전까지 유지' : ` · ${leftTicksText(run.activeRecon.expiresAt, run.time)}`}
                      </div>
                    ` : null}
                  </div>

                  <div>
                    <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>대기</div>
                    <div style=${{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                      <div style=${{ flex: 1 }}>
                      <${ActionButton}
                        run=${run} actionId="wait"
                        label="대기"
                        tip="시계를 1칸 진행시킵니다. HP·경계도는 회복되지 않습니다 — 개방·쿨다운·적 위치를 기다리거나, 진행 중인 작업의 게이지를 채우는 용도입니다."
                        onClick=${() => runCommand({ type: 'WAIT' })}
                      />
                      </div>
                      <div style=${{ flex: 1 }}>
                        <${ActionButton}
                          run=${run} actionId="waitBatch" opts=${{ ticks: WAIT_BATCH_MAX_TICKS }}
                          label="묶음 대기"
                          tip=${`최대 ${WAIT_BATCH_MAX_TICKS}칸을 1칸씩 기다립니다. 새 조우, 출구 개방/폐쇄, 붕괴, 진행 중인 작업의 완료가 생기면 즉시 멈추고 실제로 흐른 칸만 소모됩니다 — 아래 칸 수는 그 최대치입니다.`}
                          onClick=${() => runCommand({ type: 'WAIT_BATCH', ticks: WAIT_BATCH_MAX_TICKS })}
                        />
                      </div>
                    </div>
                    ${waitNotice ? html`<div style=${{ marginTop: '4px', fontSize: '10.5px', color: '#b45309', fontWeight: 700 }}>${waitNotice.text}</div>` : null}
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
                            <${ActionButton}
                              run=${run} actionId="concealment"
                              label=${`은엄폐 사용 (은신 +${concealmentValue})`}
                              tip=${`이 노드에 배치된 은엄폐(+${concealmentValue})를 사용해 이 자리에 머무는 동안 실효 Stealth를 올립니다. 다른 노드로 이동하면 사라집니다.`}
                              onClick=${() => runCommand({ type: 'USE_CONCEALMENT' })}
                            />
                          `}
                      </div>
                    `;
                  })()}

                  ${run.contract && run.contract.status !== 'completed' ? (() => {
                    const contract = run.contract;
                    const landmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
                    const atObjective = !!landmark && landmark.nodeId === run.playerNodeId;
                    const atAnyLandmark = !!currentLandmark;
                    const TYPE_LABEL = { retrieval: '회수', destroy: '파괴', intel: '정보' };

                    let statusLine = '';
                    let button = null;
                    if (contract.type === 'retrieval' && contract.status === 'accepted') {
                      statusLine = atObjective ? '물건을 확보하세요.' : `목표부(${SECTOR_NAMES[contract.sectorId]} · ${LANDMARKS_BY_SECTOR[contract.sectorId].name})에서 확보할 수 있습니다.`;
                      // Stealth와 Mobility 중 높은 쪽으로 친다 — 엔진이 그렇게 판정하므로 표시도 같아야 한다.
                      const kind = capabilities.mobility > capabilities.stealth ? 'mobility' : 'stealth';
                      button = html`<${ActionButton}
                        run=${run} actionId="contractRetrieve"
                        opts=${{ value: Math.max(capabilities.stealth, capabilities.mobility), capabilityKind: kind }}
                        disabled=${!atObjective}
                        label="물건 확보"
                        tip="조용히든 빠르게든 물건을 들고 나옵니다 — Stealth와 Mobility 중 높은 쪽으로 판정하고, 모자라면 그 수단의 통화로 값을 치릅니다. 확보하는 순간 봉쇄가 켜집니다."
                        onClick=${() => runCommand({ type: 'ACQUIRE_CONTRACT_GOODS' })}
                      />`;
                    } else if (contract.type === 'retrieval' && contract.status === 'acquired') {
                      statusLine = '물건을 들고 탈출구를 밟으면 완료됩니다. 버리면 계약이 실패합니다.';
                    } else if (contract.type === 'destroy' && contract.status === 'accepted') {
                      statusLine = atObjective ? '폭약을 설치하세요 — 설치만으로는 완료가 아닙니다.' : `목표부(${SECTOR_NAMES[contract.sectorId]} · ${LANDMARKS_BY_SECTOR[contract.sectorId].name})에서 설치할 수 있습니다.`;
                      button = html`<${ActionButton}
                        run=${run} actionId="contractDestroy" opts=${{ value: capabilities.force }} disabled=${!atObjective}
                        label="폭약 설치"
                        tip=${`목표부에 폭약을 답니다. 설치하는 순간 봉쇄가 켜지고(위협 가속), 계약은 목표부에서 ${CONTRACT_DETONATE_MIN_HOPS}홉 이상 떨어진 자리에서 기폭해야 완료됩니다.`}
                        onClick=${() => runCommand({ type: 'DESTROY_CONTRACT_TARGET' })}
                      />`;
                    } else if (contract.type === 'destroy' && contract.status === 'acquired') {
                      // C5: 설치와 기폭을 갈랐다 — 여기서부터가 "터뜨리고 빠져나오는" 구간이다.
                      const range = contractDetonationRange(run);
                      statusLine = range.ok
                        ? '충분히 떨어졌습니다 — 지금 기폭할 수 있습니다.'
                        : `기폭하려면 목표부에서 ${range.requiredHops}홉 이상 떨어져야 합니다(현재 ${range.hops ?? '?'}홉).`;
                      button = html`<${ActionButton}
                        run=${run} actionId="contractDetonate" disabled=${!range.ok}
                        disabledNote=${range.ok ? '' : `아직 너무 가깝습니다 — ${range.requiredHops}홉 이상 떨어지세요.`}
                        label="기폭"
                        tip="설치한 폭약을 터뜨려 계약을 완료합니다. Capability 요구는 없고 시간만 듭니다."
                        onClick=${() => runCommand({ type: 'DETONATE_CONTRACT_CHARGE' })}
                      />`;
                    } else if (contract.type === 'intel' && contract.status === 'accepted') {
                      statusLine = atObjective ? '데이터를 확보하세요.' : `목표부(${SECTOR_NAMES[contract.sectorId]} · ${LANDMARKS_BY_SECTOR[contract.sectorId].name})에서 확보할 수 있습니다.`;
                      button = html`<${ActionButton}
                        run=${run} actionId="contractIntel" opts=${{ value: capabilities.hacking }} disabled=${!atObjective}
                        label="데이터 확보"
                        tip="목표부에서 데이터를 땁니다. 이것만으로는 완료가 아니며, 이후 목표부 구역에 인접한 구역의 랜드마크에서 송출해야 합니다. 확보하는 순간 봉쇄가 켜져 위협이 빨라집니다."
                        onClick=${() => runCommand({ type: 'ACQUIRE_CONTRACT_INTEL' })}
                      />`;
                    } else if (contract.type === 'intel' && contract.status === 'acquired') {
                      // C5: 목표부 구역에서는 송출할 수 없고, 이웃 구역까지만 허용한다 — 확보와
                      // 완료가 한 자리에서 끝나면 계약의 마지막 장이 사라지고, 아무 구역이나
                      // 허용하면 어느 랜드마크가 싼지 전 구역을 재봐야 해서 계획이 읽히지 않는다.
                      const canTransmit = canTransmitContractIntelHere(run);
                      const transmitSectorNames = adjacentSectorIds(run.graph, contract.sectorId)
                        .map((id) => SECTOR_NAMES[id]).join(' · ');
                      statusLine = canTransmit
                        ? '여기서 송출할 수 있습니다.'
                        : (atAnyLandmark
                          ? `여기서는 송출할 수 없습니다 — ${SECTOR_NAMES[contract.sectorId]}에 인접한 ${transmitSectorNames}의 랜드마크에서 송출하세요.`
                          : `${transmitSectorNames}의 랜드마크에서 송출하면 완료됩니다.`);
                      button = html`<${ActionButton}
                        run=${run} actionId="contractTransmit" opts=${{ value: capabilities.hacking }} disabled=${!canTransmit}
                        disabledNote=${canTransmit ? '' : `${transmitSectorNames}의 랜드마크에서만 송출할 수 있습니다.`}
                        label="데이터 송출"
                        tip=${`확보한 데이터를 내보내면 계약이 완료됩니다. 목표부 구역(${SECTOR_NAMES[contract.sectorId]})에 인접한 ${transmitSectorNames}의 랜드마크여야 합니다.`}
                        onClick=${() => runCommand({ type: 'TRANSMIT_CONTRACT_INTEL' })}
                      />`;
                    }

                    return html`
                      <div>
                        <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: '4px' }}>계약 — ${TYPE_LABEL[contract.type]} · ${contract.name}</div>
                        <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '6px' }}>${statusLine}</div>
                        ${button}
                      </div>
                    `;
                  })() : null}

                  ${currentOpportunities.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>현장 기회</div>
                      ${currentOpportunities.map((opp, idx) => {
                        // 보급품은 그냥 줍는 것이고, 확보 대상은 길고 시끄러운 대신 후보 셋 중에서
                        // 고른다(D10·D11). 누르기 전에 그 차이가 보여야 "저기까지 갈 만한가"를 묻는다.
                        const isPrize = opp.grade === 'prize';
                        const tier = opp.tier || 'normal';
                        // 확보 대상의 등급·축은 그 노드를 정찰해야 보인다. 모르는 채로도 팔 수 있지만
                        // (정보 없이 거는 도박을 남긴다) 그때는 값을 하나로 약속할 수 없어 범위로 적고,
                        // 완료 시각·타이머 계산은 최악(상급)을 기준으로 보수적으로 낸다.
                        const graded = !isPrize || debugReveal || prizeGradeKnown(run, opp.id, run.playerNodeId);
                        const range = graded ? null : forecastUnknownPrizeFarm('normal');
                        // 예고 = 실제 청구. 표준 접근 기준 칸 수와 소음을 엔진과 같은 함수에서 받는다.
                        const forecast = forecastAction('farm', { isPrize, tier: graded ? tier : 'elite', mode: 'normal' });
                        const timeText = range ? range.timeText : `${forecast.timeCost}칸`;
                        const noiseText = range ? range.noiseText : `${forecast.noise}`;
                        const name = isPrize ? `확보 대상 · ${graded ? PRIZE_TIER_LABELS[tier] : '등급 미확인'}` : '보급품';
                        const tip = isPrize
                          ? (graded
                            ? `${PRIZE_AXIS_LABELS[opp.axis] || opp.axis} 계열 후보 ${PRIZE_OPTION_COUNT}개 중 하나를 골라 가져갑니다. 표준 접근 ${timeText} · 소음 ${noiseText}로 길고 시끄러우며, 고르기 전에 이 자리를 뜨면 후보는 사라집니다. 앞으로 ${opp.usesRemaining}번 더 파밍할 수 있습니다.`
                            : `등급과 역할축은 이 노드를 정찰해야 보입니다. 모르는 채로 팔 수 있고, 표준 접근 ${timeText} · 소음 ${noiseText} 중 실제 등급의 값이 그대로 청구됩니다. 후보 ${PRIZE_OPTION_COUNT}개는 파고 나서야 무슨 계열인지 알 수 있습니다.`)
                          : `이 노드의 보급품을 바로 챙깁니다. 표준 접근 ${timeText} · 소음 ${noiseText}로 짧고 조용하며, 고를 것은 없습니다. 앞으로 ${opp.usesRemaining}번 더 파밍할 수 있습니다.`;
                        return html`
                          <${Tooltip} key=${opp.id} align="left" width=${260} content=${forecastTooltip(run, forecast, name, tip, encounterBlocked ? ENCOUNTER_BLOCK_NOTE : '')}>
                            <button class="btn btn-secondary" style=${{ fontSize: '12px', width: '100%', marginBottom: '4px' }} disabled=${encounterBlocked} onClick=${() => setFarmPlan(opp)}>
                              ${name}${currentOpportunities.length > 1 ? ` #${idx + 1}` : ''} (${opp.usesRemaining}회 남음) · ${timeText}${forecast.noise ? ` · 소음 ${noiseText}` : ''}
                              ${isPrize && graded ? html`<span style=${{ fontSize: '10px', fontWeight: 800, color: '#b45309' }}> · ${PRIZE_AXIS_LABELS[opp.axis] || opp.axis}</span>` : null}
                            </button>
                          <//>
                        `;
                      })}
                    </div>
                  ` : null}
                  ${farmPlan ? html`
                    <div style=${{ padding: '8px', border: '1px solid #b45309', background: '#fffbeb', fontSize: '11px' }}>
                      <strong>파밍 계획</strong> · 실행 전 접근 방식을 고르거나 중단할 수 있습니다. 행동 중 적 유입 시 전투가 발생할 수 있습니다.
                      <div style=${{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                        ${[
    { mode: 'safe', label: '안전', note: '적 유입 위험은 낮지만 붕괴까지의 시간을 더 씁니다.' },
    { mode: 'normal', label: '파밍 실행', note: '시간과 위험의 표준 선택입니다.' },
    { mode: 'rush', label: '강행', note: '빠르지만 적 유입·추적 위험이 커집니다.' },
  ].map(({ mode, label, note }) => {
    const planIsPrize = farmPlan.grade === 'prize';
    const planGraded = !planIsPrize || debugReveal || prizeGradeKnown(run, farmPlan.id, run.playerNodeId);
    const planRange = planGraded ? null : forecastUnknownPrizeFarm(mode);
    const forecast = forecastAction('farm', { isPrize: planIsPrize, tier: planGraded ? (farmPlan.tier || 'normal') : 'elite', mode });
    const planTimeText = planRange ? planRange.timeText : `${forecast.timeCost}칸`;
    const planNoiseText = planRange ? planRange.noiseText : `${forecast.noise}`;
    return html`
                          <${Tooltip} key=${mode} width=${260} content=${forecastTooltip(run, forecast, label, `${note} 소음 ${planNoiseText}.${planRange ? ' 등급을 모르므로 범위로 적습니다 — 실제 청구는 실제 등급의 값입니다.' : ''}`, '')}>
                            <button class=${mode === 'normal' ? 'btn btn-primary' : 'btn btn-secondary'} onClick=${() => { runCommand({ type: 'USE_OPPORTUNITY', opportunityId: farmPlan.id, mode }); setFarmPlan(null); }}>${label} · ${planTimeText}${forecast.noise ? ` · 소음 ${planNoiseText}` : ''}</button>
                          <//>
                        `;
  })}
                        <${Tooltip} content="아직 파밍을 시작하지 않고 선택창만 닫습니다. 시간·소음·아이템 변화가 없습니다.">
                          <button class="btn btn-secondary" onClick=${() => setFarmPlan(null)}>중단</button>
                        <//>
                      </div>
                    </div>
                  ` : null}
                  ${run.pendingFarmChoice ? html`
                    <div style=${{ padding: '8px', border: '2px solid #b45309', background: '#fffbeb', fontSize: '11px' }}>
                      <strong>확보 대상 — ${PRIZE_TIER_LABELS[run.pendingFarmChoice.tier]} · ${PRIZE_AXIS_LABELS[run.pendingFarmChoice.axis]}</strong>
                      <div style=${{ color: 'var(--color-neutral-600)', margin: '3px 0 6px' }}>
                        하나만 가져갈 수 있습니다. 지금 인벤토리에 무엇을 넣을 자리가 있는지 보고 고르세요 — 이 자리를 뜨면 나머지는 사라집니다.
                        <div style=${{ marginTop: '2px' }}>소지품 ${ps.inventory.items.length}/${ps.inventory.capacity}${burdenCount > 0 ? ` · 과적 ${burdenCount}개` : ''}</div>
                      </div>
                      <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        ${run.pendingFarmChoice.options.map((option, index) => {
                          const described = farmLootDisplay(option);
                          // 이름만 보고 고르라고 하면 고민할 근거가 없다 — 창고와 같은 아이템
                          // 상세(추가되는 카드, Capability 보정)를 그대로 붙인다.
                          // 일반 등급의 내구도는 고른 뒤에 굴린다(3~9). 확정되지 않은 값을
                          // 미리 적어 두면 거짓말이 되므로 상급(항상 새것)만 숫자를 보인다.
                          const item = { ...option, durability: option.kind === 'equipment' && run.pendingFarmChoice.tier === 'elite' ? MAX_DURABILITY : undefined };
                          return html`
                            <${Tooltip} key=${index} align="left" width=${250} content=${html`<${ItemTooltipContent} item=${item} />`}>
                              <button
                                class="btn btn-secondary"
                                style=${{ fontSize: '11.5px', width: '100%', textAlign: 'left' }}
                                onClick=${() => runCommand({ type: 'SELECT_FARM_REWARD', optionIndex: index })}
                              >
                                ${described.name}
                                <span style=${{ fontSize: '10px', color: 'var(--color-neutral-600)' }}> · ${described.sub}</span>
                              </button>
                            <//>
                          `;
                        })}
                      </div>
                    </div>
                  ` : null}
                  ${run.lastActionResult?.kind === 'farm' && run.lastActionResult.completedAt === run.time ? html`
                    <div style=${{ padding: '6px 8px', borderLeft: `3px solid ${run.lastActionResult.status === 'ambushed' ? '#dc2626' : '#15803d'}`, background: run.lastActionResult.status === 'ambushed' ? '#fef2f2' : '#f0fdf4', fontSize: '10.5px' }}>
                      ${run.lastActionResult.status === 'ambushed'
                        ? '파밍 완료 직후 습격 발생 — 기회 사용은 반영되었습니다.'
                        : (run.pendingFarmChoice
                          ? '파밍 완료 — 아직 아무것도 받지 않았습니다. 위에서 하나를 고르세요.'
                          : '파밍 완료 — 보상과 남은 사용 횟수가 반영되었습니다.')}
                    </div>
                  ` : null}

                  ${currentSpecialEdges.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>환경 조작</div>
                      ${/* 파밍과 같은 3모드 선택 — 개방도 "시간을 더 쓰고 조용히"와 "빨리 시끄럽게"의
                           선택이므로, 한쪽에만 모드를 주면 같은 결정을 두 규칙으로 배우게 된다. */ null}
                      <div style=${{ display: 'flex', gap: '4px', marginBottom: '5px' }}>
                        ${[['safe', '안전'], ['normal', '표준'], ['rush', '강행']].map(([mode, modeLabel]) => html`
                          <button
                            key=${mode}
                            class=${edgeApproachMode === mode ? 'btn btn-primary' : 'btn btn-secondary'}
                            style=${{ fontSize: '10px', padding: '2px 8px' }}
                            onClick=${() => setEdgeApproachMode(mode)}
                          >${modeLabel}</button>
                        `)}
                      </div>
                      ${currentSpecialEdges.map((edge) => {
                        const { kind, required, current } = edgeOpenRequirement(edge);
                        const kindLabel = kind === 'hacking' ? 'Hacking' : 'Force';
                        // 층계(D8) 이후 요구치 미달은 잠김이 아니라 "더 비싸게 열린다"이다 — 그 대가를
                        // 버튼에 붙여 눌리기 전에 보이게 한다. 정말 막히는 것은 요구치보다 3 이상 낮을 때뿐.
                        return html`
                          <${ActionButton}
                            key=${edge.id} run=${run} actionId="openEdge"
                            opts=${{ value: current, capabilityKind: kind, edge, mode: edgeApproachMode }}
                            label=${`${featureText(edge.features)} 통로 개방`}
                            tip=${`이 통로는 ${featureText(edge.features)}으로 막혀 있습니다. ${kindLabel} ${required}이 표준, ${required - 2} 이상이면 대가를 치르고 열 수 있습니다(현재 ${current}). 지도에서 이 엣지를 직접 클릭해도 됩니다.`}
                            onClick=${() => handleEdgeClick(edge)}
                          />
                        `;
                      })}
                    </div>
                  ` : null}

                  <//>
                  <${PanelGroup} title="장치·시설" open=${panelGroupsOpen.devices} onToggle=${() => togglePanelGroup('devices')}>
                  ${currentInterface ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: '4px' }}>카메라 접속 인터페이스</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>
                        ${currentInterfaceHacked
    ? '접속 완료 · 이 구역의 발견한 모든 해킹 지점에 원격 접속할 수 있습니다.'
    : `미해킹 · 이 노드에서 먼저 접속 인터페이스를 해킹해야 구역 원격 접속이 열립니다. Hacking ${capabilities.hacking}의 직접 사거리는 ${cameraRange}홉입니다.`}
                      </div>
                      ${!currentInterfaceHacked ? html`
                        <${ActionButton}
                          run=${run} actionId="hackInterface" opts=${{ value: capabilities.hacking }}
                          label="접속 인터페이스 해킹"
                          tip="이 노드의 접속 인터페이스를 장악하면, 이 구역의 카메라·발전기에 거리와 무관하게 원격 접속할 수 있습니다. 카메라의 위치는 런 시작부터 지도에 보이므로 인터페이스가 파는 것은 위치가 아니라 접근입니다."
                          onClick=${() => runCommand({ type: 'HACK_ACCESS_INTERFACE', interfaceId: currentInterface.id })}
                        />
                      ` : null}
                      ${hackableCameras.length > 0 ? hackableCameras.map((camera) => html`
                        <${ActionButton}
                          key=${camera.id} run=${run} actionId="hackCamera" opts=${{ value: capabilities.hacking }}
                          label=${`카메라 해킹 — ${whereIs(camera.nodeId)}${currentInterfaceHacked ? ' · 구역 원격' : ''}`}
                          tip=${`그 카메라를 ${CAMERA_HACK_DURATION}칸 동안 무력화하고, 그동안 카메라 주변 노드를 실시간으로 관측합니다.`}
                          onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}
                        />
                      `) : null}
                      ${hackableGenerators.map((generator) => html`
                        <${ActionButton}
                          key=${generator.id} run=${run} actionId="disableGeneratorHack" opts=${{ value: capabilities.hacking }}
                          label=${`배터리 발전기 ${currentInterfaceHacked ? '원격' : '직접'} 무력화 — ${whereIs(generator.nodeId)}`}
                          tip="이 구역 적이 전투 시작 시 받는 갑옷 5를 없앱니다."
                          onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: generator.id, capabilityKind: 'hacking' })}
                        />
                      `)}
                    </div>
                  ` : null}

                  ${!currentInterface && (hackableCameras.length > 0 || hackableGenerators.length > 0) ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: '4px' }}>직접 해킹</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>Hacking ${capabilities.hacking} · 현재 노드는 Hacking 1부터, 이후 레벨마다 직접 사거리가 1홉씩 늘어납니다.</div>
                      ${hackableCameras.map((camera) => html`
                        <${ActionButton}
                          key=${camera.id} run=${run} actionId="hackCamera" opts=${{ value: capabilities.hacking }}
                          label=${`카메라 해킹 — ${whereIs(camera.nodeId)}`}
                          tip=${`그 카메라를 ${CAMERA_HACK_DURATION}칸 동안 무력화하고, 그동안 카메라 주변 노드를 실시간으로 관측합니다.`}
                          onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}
                        />
                      `)}
                      ${hackableGenerators.map((generator) => html`
                        <${ActionButton}
                          key=${generator.id} run=${run} actionId="disableGeneratorHack" opts=${{ value: capabilities.hacking }}
                          label=${`배터리 발전기 해킹 무력화 — ${whereIs(generator.nodeId)}`}
                          tip="이 구역 적이 전투 시작 시 받는 갑옷 5를 없앱니다."
                          onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: generator.id, capabilityKind: 'hacking' })}
                        />
                      `)}
                    </div>
                  ` : null}

                  ${currentCamera ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#dc2626', marginBottom: '4px' }}>현재 노드 카메라</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>
                        ${(run.disabledCameraIds || []).includes(currentCamera.id)
    ? '파괴됨 · 더 이상 감지하지 않습니다.'
    : `해킹은 ${CAMERA_HACK_DURATION}칸 동안 정찰을 제공하고, 파괴는 영구적으로 감지를 막지만 소음을 발생시킵니다.`}
                      </div>
                      ${!(run.disabledCameraIds || []).includes(currentCamera.id) ? html`
                        <${ActionButton}
                          run=${run} actionId="destroyCamera" opts=${{ value: capabilities.force }}
                          label="카메라 파괴"
                          tip="이 노드의 카메라를 영구히 부숩니다. 해킹과 달리 되살아나지 않지만 소음이 크고, Force가 모자라면 장착 무기의 내구도까지 깎입니다."
                          onClick=${() => runCommand({ type: 'DESTROY_CAMERA', cameraId: currentCamera.id })}
                        />
                      ` : null}
                    </div>
                  ` : null}

                  ${currentGenerator ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#ca8a04', marginBottom: '4px' }}>배터리 발전기</div>
                      <div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '5px' }}>${run.disabledGeneratorIds.includes(currentGenerator.id) ? '무력화됨 — 이 구역 적의 시작 갑옷 보너스가 없습니다.' : '가동 중 — 이 구역 모든 적은 전투 시작 시 갑옷 5를 얻습니다.'}</div>
                      ${!run.disabledGeneratorIds.includes(currentGenerator.id) ? html`
                        <${ActionButton}
                          run=${run} actionId="disableGeneratorForce" opts=${{ value: capabilities.force }}
                          label="Force로 발전기 무력화"
                          tip="발전기를 부숴 이 구역 적의 전투 시작 갑옷 5를 없앱니다. 해킹과 달리 이 노드에 서 있어야 하고 소음이 큽니다."
                          onClick=${() => runCommand({ type: 'DISABLE_GENERATOR', generatorId: currentGenerator.id, capabilityKind: 'force' })}
                        />` : null}
                    </div>
                  ` : null}

                  ${currentLandmark ? (() => {
                    // 엔진과 같은 식으로 센다(runEngine.hackControlRoom: max(1, 해킹)). 화면만
                    // max(0, …)으로 자르면 해킹 0으로 장악했을 때 1레벨이 잠긴 것처럼 보인다.
                    const level = Math.min(3, Math.max(1, capabilities.hacking));
                    const rows = [
                      { level: 1, label: '순찰경로 영구 표시' },
                      // 잠긴 줄은 아직 값이 정해지지 않았다 — `경계도 -0`이라고 적으면 도달해도
                      // 아무 일도 없는 것처럼 읽힌다. 그 줄에는 공식을 그대로 보인다.
                      { level: 2, label: level >= 2 ? `경계도 -${level - 1}` : '경계도 −(해킹−1)' },
                      { level: 3, label: '인접 구역 경계도 -1' },
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
                        <${ActionButton}
                          run=${run} actionId="controlRoom" opts=${{ value: capabilities.hacking }}
                          label="통제실 장악"
                          disabled=${controlRoomAlreadySeized}
                          disabledNote=${controlRoomAlreadySeized ? '이 구역 통제실은 이미 장악했습니다 — 장악은 구역당 한 번뿐입니다.' : ''}
                          tip="구역 랜드마크 노드에서만, 구역당 한 번만 시도할 수 있습니다. 접속 인터페이스 해킹과는 별개입니다. Hacking이 모자라도 시도할 수 있지만, 그때 얻는 것은 1레벨(순찰경로 공개)까지입니다."
                          onClick=${() => runCommand({ type: 'HACK_CONTROL_ROOM' })}
                        />
                      </div>
                    `;
                  })() : null}

                  <//>
                  <${PanelGroup} title="수습·장비" open=${panelGroupsOpen.cleanup} onToggle=${() => togglePanelGroup('cleanup')}>
                  ${(() => {
                    // §4단계 수습 수단(D12) + 시체 처리(D13). 액션마다 블록을 새로 만들면 사이드
                    // 패널이 넘치므로, 지금 이 노드에서 실제로 할 수 있는 것만 한 블록에 모은다.
                    const canClean = currentTraces.length > 0;
                    const canCut = !!currentInterface && !powerCutSectorIds.has(currentSectorId);
                    const canBroadcast = !!currentInterface && (currentSectorAlert?.level || 0) > 0;
                    // 가짜 소음(D)은 자리를 가리지 않는다 — 접속 인터페이스도 경계도도 필요 없다.
                    const noiseRange = fakeNoiseRange(capabilities.deception);
                    const canFakeNoise = noiseRange > 0;
                    if (!currentCorpse && !canClean && !canCut && !canBroadcast && !canFakeNoise) return null;
                    const cut = (run.powerCuts || []).find((c) => c.sectorId === currentSectorId && c.expiresAt > run.time);
                    return html`
                      <div>
                        <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-negative, #dd2b0f)', marginBottom: '4px' }}>수습</div>
                        ${cut ? html`<div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)', marginBottom: '6px' }}>전원 차단 중 — ${leftTicksText(cut.expiresAt, run.time)}. 그동안 이 구역 경계도가 오르지 않습니다(전자 자물쇠도 해킹 불가).</div>` : null}
                        ${currentCorpse ? html`
                          <${ActionButton}
                            run=${run} actionId="corpse"
                            label="시체 처리"
                            tip="여기 남은 시체를 치웁니다. 두고 가면 위협이 밟는 순간 신고되어 이 구역 경계도가 오르고 조사가 몰립니다."
                            onClick=${() => runCommand({ type: 'DISPOSE_CORPSE' })}
                          />
                        ` : null}
                        ${canClean ? html`
                          <${ActionButton}
                            run=${run} actionId="cleanTraces" opts=${{ value: capabilities.perception }}
                            label=${`흔적 정리(${currentTraces.length}개)`}
                            tip=${`이 노드에 남은 흔적 ${currentTraces.length}개를 지웁니다. 강한 흔적은 발견되면 경계도를 올리므로, 원인을 미리 없애는 수단입니다. Perception이 높을수록 짧아지고, 그동안 무방비입니다.`}
                            onClick=${() => runCommand({ type: 'CLEAN_TRACES' })}
                          />
                        ` : null}
                        ${canCut ? html`
                          <${ActionButton}
                            run=${run} actionId="cutPower" opts=${{ value: capabilities.force }}
                            label="전원 차단"
                            tip="배전을 끊어 이 구역 경계도 상승을 한동안 멈춥니다. 낮추는 게 아니라 미루는 것입니다. 큰 소음이 나고, 그동안 이 구역 전자 자물쇠는 해킹으로 열 수 없습니다(Force로 뜯는 것은 됩니다)."
                            onClick=${() => runCommand({ type: 'CUT_POWER' })}
                          />
                        ` : null}
                        ${canBroadcast ? broadcastTargetSectorIds.map((target) => {
                          // 상한(3)에 찬 구역으로는 넘길 수 없다 — 넘기면 +1이 잘려 경계도가
                          // 사라지고, 옮기는 수단이 지우는 수단이 된다(총량 보존, ADR-0073).
                          const full = (run.sectorAlerts[target]?.level || 0) >= 3;
                          const tip = full
                            ? `${SECTOR_NAMES[target]}은 이미 경계도 3입니다 — 더 받을 수 없어 넘길 수 없습니다.`
                            : `이 구역 경계도를 1 낮추고 ${SECTOR_NAMES[target]}에 그만큼 넘깁니다. 총량은 그대로이고, 그쪽으로 위협의 시선까지 옮겨갑니다. 이 구역의 경계 게이지는 0이 됩니다.`;
                          return html`
                            <${ActionButton}
                              key=${target} run=${run} actionId="falseBroadcast" opts=${{ value: capabilities.deception }} disabled=${full}
                              label=${`가짜 목표 → ${SECTOR_NAMES[target]}`}
                              tip=${`${tip} 대상 구역 경계도는 현재 ${run.sectorAlerts[target]?.level || 0}/3(게이지 ${run.sectorAlerts[target]?.pressure || 0}/${ALERT_GAUGE_CAPACITY})입니다.`}
                              onClick=${() => runCommand({ type: 'BROADCAST_FALSE_TARGET', targetSectorId: target })}
                            />
                          `;
                        }) : null}
                        ${canFakeNoise ? html`
                          <${ActionButton}
                            run=${run} actionId="fakeNoise" opts=${{ value: capabilities.deception }}
                            label=${noisePicker ? '가짜 소음 — 대상 선택 중' : `가짜 소음 (${noiseRange}홉 이내)`}
                            tip=${`${noiseRange}홉 이내의 노드 하나에 강도 ${capabilities.deception >= 3 ? 2 : 1}짜리 소음을 심습니다. 위협은 진짜 소음과 구별하지 못하고 그쪽으로 조사하러 갑니다. 경계도는 옮기지 않습니다 — 시선만 끕니다. 소음은 완료 시각에 납니다.`}
                            onClick=${() => setNoisePicker((v) => !v)}
                          />
                        ` : null}
                        ${noisePicker ? html`
                          <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: '6px' }}>
                            ${candidateNodesInRange(run.graph, run.playerNodeId, noiseRange).map((node) => html`
                              <button key=${node.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                                onClick=${() => { setNoisePicker(false); runCommand({ type: 'PLANT_FAKE_NOISE', targetNodeId: node.id }); }}>
                                ${whereIs(node.id)}
                              </button>
                            `)}
                            <button class="btn btn-secondary" style=${{ fontSize: '10px', padding: '2px 7px' }} onClick=${() => setNoisePicker(false)}>취소</button>
                          </div>
                        ` : null}
                      </div>
                    `;
                  })()}

                  ${fieldEquipment.length > 0 ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>현장 장비</div>
                      ${fieldEquipment.map((eq) => {
                        const fa = eq.contract.fieldAction;
                        const label = FIELD_ACTION_LABELS[fa.kind] || fa.kind;
                        const onCooldown = (run.fieldCooldowns[eq.instanceId] || 0) > run.time;
                        const needsTarget = fa.targetKind !== 'node_contents';
                        const disabled = onCooldown;
                        const handleClick = () => {
                          if (needsTarget) setFieldPicker({ instanceId: eq.instanceId, contract: eq.contract });
                          else runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: eq.instanceId });
                        };
                        return html`
                          <${ActionButton}
                            key=${eq.instanceId} run=${run}
                            actionId=${fa.kind === 'camera_snipe' ? 'cameraSnipe' : 'fieldEquipment'}
                            opts=${fa.kind === 'camera_snipe' ? { value: capabilities.perception } : { contract: fa }}
                            disabled=${disabled}
                            label=${`${label} 사용${needsTarget ? '…' : ''}`}
                            tip=${`${EQUIPMENT_DEFS[eq.equipmentId]?.name || eq.equipmentId} 능동 효과. ${(fa.deviceKinds || []).map((k) => FIELD_DEVICE_LABELS[k]).filter(Boolean).join('·') || FIELD_TARGET_LABELS[fa.targetKind] || fa.targetKind}. 재사용 대기 ${fa.cooldown}칸${fa.duration ? `, 지속 ${fa.duration}칸` : ''}.${fa.kind === 'camera_snipe' ? ` 시야 ${fa.range}홉 안의 카메라를 영구히 부숩니다 — 총성(소음 ${CAMERA_SNIPE_NOISE})은 지금 서 있는 자리에서 나고 파편(강한 흔적)은 카메라 자리에 남으며, 예비탄 ${CAMERA_SNIPE_AMMO_COST}발을 씁니다.` : ''}${fa.targetKind === 'edge' ? ' 지도에서 강조된 엣지를 직접 클릭해 지정할 수 있습니다.' : ''}`}
                            disabledNote=${onCooldown ? `재사용 대기 중 — ${leftTicksText(run.fieldCooldowns[eq.instanceId] || 0, run.time)}.` : ''}
                            onClick=${handleClick}
                          />
                        `;
                      })}
                    </div>
                  ` : null}

                  ${currentExit && currentExit.kind === 'standard' && currentExit.status === 'closed' ? html`
                    <div>
                      <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>탈출구</div>
                      <${ActionButton}
                        run=${run} actionId="exitActivate" opts=${{ value: capabilities.hacking }}
                        label=${`탈출구 ${currentExit.exitId} 가동 (Hacking ${capabilities.hacking})`}
                        tip="탈출구를 가동합니다. 가동에 드는 것은 1칸이고, 나머지는 이 자리에서 대기로 채우는 게이지입니다 — Hacking이 높을수록 게이지가 짧습니다. 게이지가 차면 문이 열리고, 이 노드에서 다음 행동이 끝나는 즉시 자동으로 탈출합니다. 자리를 뜨면 가동이 취소됩니다."
                        onClick=${() => runCommand({ type: 'REQUEST_EXTRACTION', exitId: currentExit.exitId })}
                      />
                    </div>
                  ` : null}

                  ${fieldPicker ? html`
                    <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', border: '1px solid var(--color-divider)', padding: 'var(--space-2)', fontSize: '11px' }}>
                      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>${fieldPicker.contract.fieldAction.kind === 'camera_snipe'
                          ? `대상 카메라 선택 (시야 ${fieldPicker.contract.fieldAction.range}홉 — 잠긴 통로 너머는 보이지 않습니다)`
                          : fieldPicker.contract.fieldAction.targetKind === 'edge'
                          ? `대상 엣지 선택 (사거리 ${fieldPicker.contract.fieldAction.range}) — 지도의 강조된 선 클릭`
                          : `대상 노드 선택 (사거리 ${fieldPicker.contract.fieldAction.range})`}</strong>
                        <button class="btn btn-secondary" style=${{ fontSize: '10px', padding: '2px 7px' }} onClick=${() => setFieldPicker(null)}>취소</button>
                      </div>
                      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        ${fieldPicker.contract.fieldAction.kind === 'camera_snipe'
                          ? candidateCamerasInSight(run, fieldPicker.contract.fieldAction.range).map((camera) => html`
                            <button key=${camera.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                              onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: camera.id })}>
                              ${whereIs(camera.nodeId)} — ${DEVICE_STATUS_LABELS.camera[deviceStatus(run, { ...camera, kind: 'camera' })]}
                            </button>
                          `)
                          : fieldPicker.contract.fieldAction.targetKind === 'edge'
                          ? candidateEdgesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((edge) => html`
                            <button key=${edge.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                              onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: edge.id })}>
                              ${whereIs(edge.from)} ↔ ${whereIs(edge.to)}
                            </button>
                          `)
                          : candidateNodesInRange(run.graph, run.playerNodeId, fieldPicker.contract.fieldAction.range).map((node) => html`
                            <button key=${node.id} class="btn btn-secondary" style=${{ fontSize: '10.5px' }}
                              onClick=${() => runCommand({ type: 'USE_FIELD_EQUIPMENT', instanceId: fieldPicker.instanceId, targetId: node.id })}>
                              ${whereIs(node.id)}
                            </button>
                          `)}
                      </div>
                    </div>
                  ` : null}
                  <//>
                </div>
              ` : null}
            ` : null}
          </div>
          <div style=${{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
            ${/* 로드아웃은 런 중에 거의 바뀌지 않는다 — 매번 읽을 것이 아니라 확인할 것이므로
                기본은 접어 두고, 행동 버튼이 사이드바 위쪽을 차지하게 한다. */ null}
            <button
              class="btn btn-secondary"
              style=${{ fontSize: '11px', width: '100%', textAlign: 'left' }}
              onClick=${() => setCapabilityOpen((v) => !v)}
            >${capabilityOpen ? '▾' : '▸'} Capability — ${CAPABILITY_ORDER.map((key) => `${CAPABILITY_SHORT[key]} ${capabilities[key] >= 0 ? '+' : ''}${capabilities[key]}`).join(' · ')}</button>
            ${capabilityOpen ? html`
              <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: '6px' }}>
                ${CAPABILITY_ORDER.map((key) => {
                  const raw = capabilities[key];
                  // 부상 중이면 합계만으로는 무엇이 값을 깎았는지 읽히지 않는다 — 분해해 적는다.
                  const breakdown = injury > 0
                    ? ` 장비 합 ${viewCapabilities[key]} − 부상 ${injury} = 실효 ${raw}.`
                    : '';
                  return html`
                    <${Tooltip} key=${key} width=${240} align="left" content=${`${CAPABILITY_LABELS[key]}(${CAPABILITY_KOREAN[key]}) — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(층계 판정은 이 원시 수치를 그대로 씁니다 — 0으로 자르지 않습니다. 예외는 고지대 통과 하나로, 지형 판정이라 0 하한을 적용한 값으로 층계를 가릅니다).${breakdown} ${capabilityActionSummary(key, raw)}`}>
                      <span class="tag tag-outline" tabIndex="0">${CAPABILITY_SHORT[key]}(${CAPABILITY_KOREAN[key]}) ${raw >= 0 ? '+' : ''}${raw}</span>
                    <//>
                  `;
                })}
              </div>
            ` : null}
          </div>
        </div>
      </div>

      ${showInventory ? html`<${InventoryPopup} mode="manage" onClose=${() => setShowInventory(false)} />` : null}
    </div>
  `;
}
