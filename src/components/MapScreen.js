// 160노드 익스트랙션 맵 화면 (docs/extraction-map-implementation-spec.md).
// 전체 지도(노드+엣지)는 항상 보이고, 위협 존재 여부 같은 "내용" 정보만
// 시야(현재+인접) 밖에서는 마지막으로 확인한 값으로 고정된다 — gameReducer.js의
// refreshLocalObservations가 매 행동 끝에 현재+인접 노드를 observations에 스냅샷한다).
// 예외는 대기다: 대기 중에는 주변을 살피지 않으므로 인접 노드도 낡은 정보가 되고, 다음 유료
// 행동이 끝나야 다시 실시간이 된다(observationSuspended).
//
// UI 레이아웃(HUD/구역 라벨/미니맵/선택 노드 패널/범례·로그 접기)은 게임 UI 목업 디자인/
// map-redesign의 개선안을 반영해 재구성했다 — 명령·판정 로직은 이전과 동일, 표현 계층만 변경.
import { html, useState, useEffect, useRef } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { computeCapabilities, listFieldActiveEquipment } from '../engine/capabilityEngine.js';
import { bfsHopDistances } from '../engine/graphUtils.js';
import { canTraverseEdge, cameraHackRange, isCameraHackActive, getSectorLandmarkArrowTarget, isNodeCharted, moveTimeCost, observationSuspended, prizeGradeKnown } from '../engine/runEngine.js';
import { computeFloorOverload, computeOverloadGainMultiplier, getImplantEffect, MAX_DURABILITY } from '../engine/equipmentEngine.js';
import { SECTOR_IDS, SECTOR_NAMES, RUN_COLLAPSE_TIME, LANDMARKS_BY_SECTOR, ADJACENT_SECTOR_IDS } from '../data/facilityLayout.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { CAPABILITY_ORDER, CAPABILITY_LABELS, CAPABILITY_SHORT, CAPABILITY_ROLE } from '../data/capabilityDisplay.js';
import { OverloadGauge } from './OverloadGauge.js';
import { InventoryPopup } from './InventoryPopup.js';
import { Tooltip } from './Tooltip.js';
import { PlayLog } from './PlayLog.js';
import { HistoryControls } from './HistoryControls.js';
import { describeItem } from '../data/itemDisplay.js';
import { EncounterPanel } from './EncounterPanel.js';
import { ItemTooltipContent } from './ItemTooltipContent.js';
import { MapClock, deadlineStyle } from './MapClock.js';
import { capabilityStep } from '../engine/capabilityCosts.js';
import { forecastAction, describeForecast, forecastUnknownPrizeFarm } from '../engine/actionCosts.js';
import {
  runCountdowns, upcomingEvents, timersEndingBefore, observableThreatMoves, staleThreatSightings,
  interruptionNotice, waitBatchNotice, threatMovesDuring, describeNodeLocation,
  EXIT_STATUS_LABELS, TIMELINE_HORIZON,
} from '../engine/mapTimeline.js';
import {
  PRIZE_OPTION_COUNT, CAMERA_HACK_DURATION, WAIT_BATCH_MAX_TICKS,
} from '../data/facilityLayout.js';

const FIELD_ACTION_LABELS = { snapshot_scan: '집중 투시', temporary_barrier: '임시 장벽', remote_intrusion: '원격 침투' };

/** 특수 엣지 feature의 표시 이름. `blocked`/`electronic` 같은 코드 키가 그대로 화면에 나오면
 * 플레이어는 그 통로를 무엇으로 여는지 읽을 수 없다. */
const EDGE_FEATURE_LABELS = { blocked: '물리 잠금', electronic: '전자 잠금', highGround: '높은 지형' };
/** 위협 상태의 표시 이름 — `patrol`/`pursuit` 같은 코드 키가 그대로 툴팁에 나오면 읽히지 않는다. */
const THREAT_MODE_LABELS = { patrol: '순찰', investigate: '조사', alert: '경계', pursuit: '추적', exit_guard: '출구 경계' };
/** @param {string[]} features */
function featureText(features) {
  return features.map((feature) => EDGE_FEATURE_LABELS[feature] || feature).join('·');
}

/** 화면의 모든 시각은 상대 표기다 — 절대 시각(424 / 700)은 괄호로만 병기한다. 700칸짜리 시계를
 * 머릿속에서 빼는 일을 플레이어에게 시키면 계획이 아니라 산수가 된다. */
function ticksUntil(at, now) { return Math.max(0, at - now); }
function inTicksText(at, now) { return `${ticksUntil(at, now)}칸 후`; }
function leftTicksText(at, now) { return `${ticksUntil(at, now)}칸 남음`; }



const PRIZE_AXIS_LABELS = { combat: '전투 강화', infiltration: '침투 강화', resource: '즉시 자원' };
const PRIZE_TIER_LABELS = { normal: '일반', elite: '상급' };
const STEP_LABELS = { surplus: '여유', standard: '표준', strained: '무리', severe: '위태', impossible: '불가' };
const STEP_COLORS = { surplus: '#15803d', standard: 'var(--color-neutral-600)', strained: '#b45309', severe: '#dc2626', impossible: '#dc2626' };

/**
 * 층계(D8)로 바뀌면서 버튼은 더 이상 잠기지 않고 "대가를 치르고 된다"가 됐다. 그 대가가 누르기
 * 전에 보이지 않으면 플레이어는 자기가 무엇을 지불했는지 사후에야 알게 된다 — 그러면 고민할
 * 자리가 사라지므로, 여기서 단계와 통화를 미리 문장으로 만든다.
 *
 * 입력은 엔진이 실제로 청구할 값(actionCosts.forecastAction)이다. 여기서 비용식을 다시 쓰면
 * 상수 하나만 바뀌어도 화면이 조용히 거짓말을 한다.
 * @param {import('../engine/actionCosts.js').ActionForecast} forecast
 * @returns {{step: string, label: string, note: string, color: string, blocked: boolean}|null}
 */
function ladderNote(forecast) {
  const kind = forecast.capabilityKind;
  const cost = forecast.cost;
  // 층계가 걸리지 않는 고정 비용 행동(정찰·대기·시체 처리 등)은 뱃지가 없다.
  if (!kind || !cost || !forecast.step) return null;
  const step = forecast.step;
  if (step === 'impossible') {
    // 한 문장으로만 말한다. 예전에는 버튼에 '불가', 뱃지에 또 '불가', 그리고 요구치를 두 개
    // (표준 R과 시도 하한 R-2) 나란히 적어서, 셋 중 무엇이 진짜 조건인지 읽히지 않았다.
    return {
      step,
      label: STEP_LABELS[step],
      note: `${CAPABILITY_LABELS[kind]} ${forecast.required}이 표준, ${forecast.required - 2} 이상이면 대가를 치르고 시도 가능(현재 ${forecast.value})`,
      color: STEP_COLORS[step],
      blocked: true,
    };
  }
  const parts = [];
  // 시간 가감은 예고가 실제로 더한 만큼만 적는다 — 흔적 정리처럼 전용 시간표를 쓰는 행동은
  // 층계 가감을 받지 않으므로, 층계표를 그대로 베끼면 버튼이 없는 대가를 말하게 된다.
  const timeDelta = forecast.parts.filter((part) => part.label === '능력').reduce((acc, part) => acc + part.delta, 0);
  if (timeDelta !== 0) parts.push(`시간 ${timeDelta > 0 ? '+' : ''}${timeDelta}칸`);
  // 소음과 과부화는 **총량**이다. `+`를 붙이면 "지금보다 2 더"로 읽히지만 실제로는 "이 행동이
  // 낼 소음이 2"라는 뜻이다. 층계가 그 값을 바꿨을 때만 기본값과의 차이를 괄호로 덧붙인다.
  const amount = (label, value, baseValue) => {
    const delta = value - baseValue;
    if (delta === 0) return `${label} ${value}`;
    return `${label} ${value}(기본 ${baseValue} ${delta > 0 ? '+' : '−'} ${STEP_LABELS[step]} ${Math.abs(delta)})`;
  };
  if (cost.noise !== 0 || forecast.baseNoise !== 0) parts.push(amount('소음', cost.noise, forecast.baseNoise));
  if (cost.overload !== 0 || forecast.baseOverload !== 0) parts.push(amount('과부화', cost.overload, forecast.baseOverload));
  if (cost.hpCost) parts.push(`HP -${cost.hpCost}`);
  if (cost.durabilityLoss) parts.push(`장비 내구도 -${cost.durabilityLoss}`);
  if (cost.duration != null) parts.push(`지속 ${cost.duration}칸`);
  if (cost.leavesStrongTrace) parts.push('강한 흔적이 남음');
  if (cost.raisesAlert) parts.push('이 구역 경계도 +1');
  return {
    step,
    label: STEP_LABELS[step],
    note: parts.length ? parts.join(' · ') : '추가 대가 없음',
    color: STEP_COLORS[step],
    blocked: false,
  };
}

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
function forecastTooltip(run, forecast, label, tip, extraNote) {
  const lines = [tip];
  if (forecast.blocked) {
    lines.push('지금 수치로는 시도할 수 없습니다.');
  } else {
    const completesAt = run.time + forecast.timeCost;
    lines.push(`${describeForecast(forecast, label)} · 완료까지 ${forecast.timeCost}칸 후(시각 ${completesAt} / ${RUN_COLLAPSE_TIME}).`);
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

/** 층계 다섯 단계가 무엇인지 — 뱃지에 "무리"라고만 쓰여 있으면 그게 좋은 건지 나쁜 건지,
 * 투자하면 뭐가 나아지는지 알 수 없다. 뱃지마다 같은 설명을 달아 둔다. */
const LADDER_EXPLAINER = html`<div>
  <div style=${{ fontWeight: 800, marginBottom: '5px' }}>Capability 층계</div>
  <div>요구치를 못 넘겨도 시도할 수 있습니다. 대신 모자란 만큼 그 Capability의 통화로 값을 치릅니다.</div>
  <div style=${{ marginTop: '5px' }}>
    여유(+1 이상) 시간 −1칸<br />
    표준(요구치와 같음) 추가 대가 없음<br />
    무리(−1) 시간 +2칸 + 대가 하나<br />
    위태(−2) 시간 +4칸 + 무거운 대가<br />
    불가(−3 이하) 시도 불가
  </div>
  <div style=${{ marginTop: '5px', opacity: 0.85 }}>
    통화는 Capability마다 다릅니다 — Hacking은 과부화, Force는 소음과 장비 내구도, Stealth는 강한 흔적과 경계도, Mobility는 HP, Deception은 효과 지속, Perception은 시간.
  </div>
</div>`;

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
  const note = blockedByEncounter ? ENCOUNTER_BLOCK_NOTE : (disabledNote || (ladder?.blocked ? `${ladder.note}.` : ''));
  return html`
    <${Tooltip} align="left" width=${260} content=${forecastTooltip(run, forecast, label, tip, note)}>
      <button
        class="btn btn-secondary"
        style=${{ fontSize: '11px', width: '100%', marginBottom: '4px' }}
        disabled=${disabled || blockedByEncounter || !!ladder?.blocked}
        onClick=${onClick}
      >${forecast.blocked ? `${label} · 불가` : actionButtonLabel(forecast, label)}${ladder && !ladder.blocked ? html` <${StepBadge} ladder=${ladder} />` : null}</button>
    <//>
  `;
}

/**
 * 유료 버튼 라벨의 유일한 규칙 — `이름 · N칸 · 소음 M · 과부화 K`. 0인 통화는 적지 않는다.
 * 버튼마다 다른 순서로 적으면 두 버튼을 나란히 놓고 비교할 수 없다.
 * @param {import('../engine/actionCosts.js').ActionForecast} forecast @param {string} label
 */
function actionButtonLabel(forecast, label) {
  const parts = [label, `${forecast.timeCost}칸`];
  if (forecast.noise) parts.push(`소음 ${forecast.noise}`);
  if (forecast.overload) parts.push(`과부화 ${forecast.overload}`);
  return parts.join(' · ');
}

/** 버튼 옆에 붙는 짧은 층계 뱃지. */
function StepBadge({ ladder }) {
  return html`<${Tooltip} width=${250} content=${LADDER_EXPLAINER}>
    <span style=${{ fontSize: '10px', fontWeight: 800, color: ladder.color, textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>${ladder.label}${ladder.step === 'standard' ? '' : ` · ${ladder.note}`}</span>
  <//>`;
}
const FIELD_TARGET_LABELS = { edge: '엣지(통로) 지정', node_contents: '주변 노드 파악', electronic_device: '전자 장치 지정' };

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
    return `전자(electronic) 특수 엣지 개방, 카메라·접속 인터페이스·발전기 조작, 구역 통제실 장악, 정보 계약의 확보와 송출에 쓰입니다. 모자라면 과부화로 값을 치릅니다. 탈출구 개방 대기 시간도 이 값이 높을수록 짧아집니다. ${common}`;
  }
  if (key === 'force') {
    return `봉쇄(blocked) 특수 엣지 개방, 카메라·발전기 파괴, 전원 차단, 파괴 계약에 쓰입니다. 모자라면 소음이 커지고 장착 장비의 내구도가 깎입니다. ${common}`;
  }
  if (key === 'mobility') {
    const highGround = raw >= 3 ? '높은 지형 특수 엣지를 통과할 수 있습니다.' : 'Mobility 3부터 높은 지형 특수 엣지를 통과할 수 있습니다(이 게이트는 지형 판정이라 층계가 적용되지 않습니다).';
    const disengage = raw >= 2 ? '전투 이탈 시작 시 진행도 +1을 받습니다.' : 'Mobility 2부터 전투 이탈 보너스를 받습니다.';
    return `이동 시간이 이 값에 따라 줄어듭니다. 회수 계약 확보에도 쓰이며, 모자라면 HP로 값을 치릅니다. ${highGround} ${disengage} ${common}`;
  }
  if (key === 'stealth') {
    const camera = raw >= 3 ? '카메라에 발각되지 않고 이동 흔적도 남기지 않습니다.' : '카메라 노드 진입 시 발각됩니다. Stealth 3부터 카메라를 피할 수 있습니다.';
    return `이동 소음과 남는 흔적의 강도를 결정하고, 조우 판정에서 위협의 perception과 겨룹니다. 회수 계약 확보에도 쓰이며, 모자라면 강한 흔적이 남고 더 모자라면 그 자리에서 구역 경계도가 오릅니다. ${camera} ${common}`;
  }
  if (key === 'perception') {
    return `흔적 정리(수습)에 쓰입니다. 값이 높을수록 정리 시간이 짧아지고, 모자라면 시간으로 값을 치릅니다. ${common}`;
  }
  if (key === 'deception') {
    return `가짜 목표 송출(수습)에 쓰입니다. 이 구역 경계도 1을 인접 구역으로 넘기며, 모자라면 심은 가짜 목표의 지속 시간이 짧아집니다. ${common}`;
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

/** 이 길이(캔버스 px)를 넘는 엣지는 직선 대신 곡선으로 그린다. */
const CURVED_EDGE_MIN_LENGTH = 150;

/**
 * 엣지를 그릴 경로. 짧은 엣지는 직선이지만, 구역을 가로지르거나 링을 건너뛰는 긴 엣지는
 * 곡선으로 그린다 — 직선으로 그으면 평면도 위를 그대로 관통해 어느 노드에 붙은 줄인지
 * 읽히지 않는다. 일방통행 화살표가 놓일 중점과 그 지점의 접선 각도도 함께 돌려준다.
 * @param {{x: number, y: number}} from @param {{x: number, y: number}} to
 */
function edgePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < CURVED_EDGE_MIN_LENGTH) {
    return {
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
      angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
    };
  }
  // 2차 베지어 한 개. 제어점을 중점에서 수직으로 밀어 활처럼 휜다.
  const bulge = Math.min(length * 0.16, 90);
  const nx = -dy / length;
  const ny = dx / length;
  const cx = (from.x + to.x) / 2 + nx * bulge * 2;
  const cy = (from.y + to.y) / 2 + ny * bulge * 2;
  return {
    d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`,
    // t=0.5 지점과 그 접선(베지어 미분).
    midX: (from.x + 2 * cx + to.x) / 4,
    midY: (from.y + 2 * cy + to.y) / 4,
    angleDeg: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI,
  };
}

/** 지나가기 위한 노드 — 이들끼리 잇는 엣지가 그 구역 평면도의 복도 뼈대다. */
const PASSAGE_TYPES = new Set(['corridor', 'hall', 'crawlway']);

/** 노드 유형별 표시 이름. 도면을 읽는 언어이므로 툴팁·패널·범례가 모두 이 표를 쓴다. */
const NODE_TYPE_LABELS = {
  corridor: '복도', office: '사무·작업실', hall: '대공간', vault: '봉인 격실',
  utility: '설비실', watch: '감시 지점', refuge: '은신처', crawlway: '비인가 통로',
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
  for (const sectorId of SECTOR_IDS) {
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
  // 대기 중에는 주변을 관측하지 않는다 — 무료 인접 실시간 관측이 끊기고, 마지막으로 본 값이
  // `N칸 전 관측`으로 남는다. 다음 유료 행동이 끝나면 다시 실시간이다. 값을 치른 정찰
  // (activeRecon)은 위에서 이미 통과했으므로 대기 중에도 계속 실시간이다.
  if (isTrueAdjacent(run, nodeId) && !observationSuspended(run)) return 'fresh';
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
const ZOOM_MAX = 3;
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
 * 노드 툴팁의 현장 기회 한 줄. 보급품은 현행대로 서 있을 때만 보이고, 확보 대상은 정찰한 뒤에만
 * 등급·역할축이 붙는다 — 정찰 전에는 서 있어도 "등급·역할축 미확인"이다.
 */
function describeOpportunity(run, node, opp, knowledge, debugReveal) {
  if (!opp) return null;
  const here = debugReveal || knowledge === 'current';
  if (opp.grade !== 'prize') return here ? `보급품 ${opp.usesRemaining}회 남음` : null;
  const grade = debugReveal ? { tier: opp.tier, axis: opp.axis } : scoutedGradeOf(run, node.id, opp.id);
  if (grade) {
    return `확보 대상(${PRIZE_TIER_LABELS[grade.tier] || grade.tier} · ${PRIZE_AXIS_LABELS[grade.axis] || grade.axis}) ${opp.usesRemaining}회 남음`;
  }
  return here ? '확보 대상 있음 — 등급·역할축 미확인(정찰하면 보인다)' : null;
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
    `${SECTOR_NAMES[n.sectorId]} · ${NODE_TYPE_LABELS[n.type] || n.type}${n.isGateway ? '(구역 출입구)' : ''} · ${knowledgeLabel}${debugReveal ? ' · DEBUG' : ''}`,
    exit ? (exit.kind === 'key' ? '숨겨진 열쇠 탈출구' : `표준 탈출구 ${exit.exitId} (${exitStatusLabel(exit)})`) : null,
    (knowledge === 'unknown' && !debugReveal) ? null : (hasThreat ? `위협 포착${threatCount ? ` (${threatCount}개 그룹)` : ''}` : '위협 없음(확인 시점 기준)'),
    describeOpportunity(run, n, opp, knowledge, debugReveal),
    camera ? `카메라 ${run.disabledCameraIds?.includes(camera.id) ? '파괴됨' : (isCameraHackActive(run, camera.id) ? '해킹됨' : '작동 중')}` : null,
    accessInterface ? `접속 인터페이스 ${run.hackedInterfaceIds?.includes(accessInterface.id) ? '해킹됨' : '미해킹'}` : null,
    generator ? `배터리 발전기 ${run.disabledGeneratorIds.includes(generator.id) ? '무력화됨' : '작동 중'}` : null,
    run.corpses?.some((c) => c.nodeId === n.id) ? '시체가 남아 있음 — 위협이 밟으면 신고되어 이 구역 경계도가 오른다' : null,
    (() => {
      const traces = (run.evidence || []).filter((e) => e.nodeId === n.id);
      if (traces.length === 0) return null;
      const strong = traces.filter((e) => e.tier >= 2).length;
      return `내 흔적 ${traces.length}개${strong ? ` (강한 흔적 ${strong}개 — 발견되면 경계도가 오른다)` : ' (약한 흔적 — 조사만 끌어온다)'}`;
    })(),
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
  const [edgeApproachMode, setEdgeApproachMode] = useState('normal'); // 특수 엣지 개방의 접근 방식(안전/표준/강행)
  const [capabilityOpen, setCapabilityOpen] = useState(false); // Capability 블록은 기본 접힘 — 행동이 위로 온다
  const [farmToast, setFarmToast] = useState(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, moved: false });
  const nodeRefs = useRef({}); // nodeId -> 히트 영역 엘리먼트(화살표 이동이 포커스를 옮길 때 쓴다)
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
  const currentExit = exitByNode[run.playerNodeId];
  const currentOpportunities = run.graph.opportunities.filter((o) => o.nodeId === run.playerNodeId && o.usesRemaining > 0);
  const visitedNodeIds = new Set(run.visitedNodeIds);
  // 도면에 없는 노드(비인가 통로)는 직접 보기 전까지 지도에 그리지 않는다(D16). 구조를 감추는
  // 유일한 예외이며, 그 노드로 이어지는 통로도 함께 숨는다.
  const chartedNodeIds = new Set(run.graph.nodes.filter((n) => debugReveal || isNodeCharted(run, n)).map((n) => n.id));
  const isDeviceVisible = (nodeId) => debugReveal || visitedNodeIds.has(nodeId);
  const cameraByNode = Object.fromEntries(run.graph.cameras.filter((camera) => isDeviceVisible(camera.nodeId)).map((camera) => [camera.nodeId, camera]));
  const interfaceNodeIds = new Set(run.graph.accessInterfaces.filter((entry) => isDeviceVisible(entry.nodeId)).map((entry) => entry.nodeId));
  const currentInterface = run.graph.accessInterfaces.find((entry) => entry.nodeId === run.playerNodeId);
  const currentInterfaceHacked = !!currentInterface && (run.hackedInterfaceIds || []).includes(currentInterface.id);
  const cameraRange = cameraHackRange(capabilities.hacking);
  const cameraHops = bfsHopDistances(run.graph.edges, run.playerNodeId);
  // 같은 표를 위치 서술(`통신·관제탑 · 인접 1홉`)에도 쓴다 — 노드 id는 지도에서 찾을 수 없다.
  const playerHops = cameraHops;
  const whereIs = (nodeId) => describeNodeLocation(run, nodeId, playerHops);
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
  // §4단계 — 시체와 흔적은 내가 만든 것이라 위치를 항상 안다(안개와 무관). 전원 차단 중인
  // 구역과 다음 증원 예정 시각도 여기서 뽑는다.
  const corpseByNode = Object.fromEntries((run.corpses || []).map((c) => [c.nodeId, c]));
  const traceCountByNode = (run.evidence || []).reduce((acc, e) => ({ ...acc, [e.nodeId]: (acc[e.nodeId] || 0) + 1 }), {});
  const currentCorpse = corpseByNode[run.playerNodeId];
  const currentTraces = (run.evidence || []).filter((e) => e.nodeId === run.playerNodeId);
  const powerCutSectorIds = new Set((run.powerCuts || []).filter((c) => c.expiresAt > run.time).map((c) => c.sectorId));
  const adjacentSectorIds = currentSectorId ? (ADJACENT_SECTOR_IDS[currentSectorId] || []) : [];
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

  const handleMove = (nodeId) => {
    if (!isTrueAdjacent(run, nodeId)) return;
    if (encounterBlocks(run)) { setError('조우 중이라 막혔습니다 — 회피하거나 전투에 들어가세요.'); return; }
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
  const inspected = inspectedNode ? describeNode(run, inspectedNode, threatsByNode, exitByNode) : null;
  const inspectedObservedAt = selectedNodeId && run.observations[selectedNodeId] ? run.observations[selectedNodeId].observedAt : null;
  const selectedEdge = selectedNodeId ? findTraversableEdge(run, selectedNodeId) : null;
  const selectedEdgeTraversable = selectedEdge ? canTraverseEdge(run, selectedEdge, capabilities.mobility) : false;
  const selectedCamera = selectedNodeId ? cameraByNode[selectedNodeId] : null;
  const selectedCameraActive = selectedCamera
    && !(run.disabledCameraIds || []).includes(selectedCamera.id)
    && !isCameraHackActive(run, selectedCamera.id);

  // 시간에 관한 화면 정보는 전부 mapTimeline의 순수 함수에서 온다 — 여기서 다시 세지 않는다.
  const encounterBlocked = encounterBlocks(run);
  const countdowns = runCountdowns(run);
  const cooldownLabels = Object.fromEntries(fieldEquipment.map((eq) => [
    eq.instanceId, FIELD_ACTION_LABELS[eq.contract.fieldAction.kind] || eq.contract.fieldAction.kind,
  ]));
  const timeline = upcomingEvents(run, TIMELINE_HORIZON, { cooldownLabels });
  const threatMoves = observableThreatMoves(run);
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
              ${run.lockdown ? html`<strong style=${{ color: 'var(--color-negative, #dd2b0f)' }}> · 봉쇄 중(위협 가속, 출구 B 조기 폐쇄)</strong>` : null}
            </span>
          ` : null}
        </div>
        <div style=${{ display: 'flex', gap: 0, fontSize: '13px', alignItems: 'stretch' }}>
          <${Tooltip} content="현재 체력입니다. 0이 되면 전투 불능으로 런이 종료됩니다. 필드에서는 소모품으로만 회복할 수 있습니다.">
            <div style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 var(--space-3)', borderRight: '1px solid var(--color-divider)' }}>
              <${IconHeart} /><span>HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
            </div>
          <//>
          <${MapClock} run=${run} countdowns=${countdowns} />
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
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)' }}></span>한 번도 확인 안 함 — 방이 있다는 것만 알고 안에 무엇이 있는지는 모른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-accent)' }}></span>탈출구(A/B/K, 안개 무관 항상 표시)</div>
                <div style=${{ borderTop: '1px solid var(--color-divider)', margin: '3px 0', paddingTop: '5px', fontWeight: 700 }}>노드 유형 — 모양으로 구분</div>
                ${[['corridor', '지나가는 곳. 기회도 은엄폐도 없다'], ['office', '보급품이 많은 평범한 방'], ['hall', '시야가 트여 Stealth가 깎인다'], ['vault', '닫혀 있고 값어치가 크다'], ['utility', '발전기·배전반·서버가 있다'], ['watch', '멀리 보기 위한 자리'], ['refuge', '숨고 쉴 수 있다'], ['crawlway', '도면에 없는 길. 지나가 봐야 지도에 뜬다']].map(([type, note]) => html`
                  <div key=${type} style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" style=${{ flex: '0 0 auto' }}>
                      ${nodeBodyShape(type, 14, 14, { fill: 'var(--color-bg)', stroke: 'var(--color-divider)', 'stroke-width': 1.5 })}
                    </svg>
                    <span><b>${NODE_TYPE_LABELS[type]}</b> — ${note}</span>
                  </div>
                `)}
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>⇄</span>구역 출입구(관문). 인접 구역으로 넘어가는 유일한 일반 통로이자 증원이 들어오는 자리</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-negative, #dd2b0f)', fontWeight: 900 }}>†</span>전투에서 이긴 자리에 남은 시체. 위협이 밟으면 신고되어 경계도가 오른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: '#b45309', fontWeight: 800 }}>˙N</span>내가 남긴 흔적 수. 강한 흔적이 발견되면 경계도가 오른다</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▲N</span>포착된 위협 그룹 수(시야 밖에서는 그룹 수 없이 ▲만)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '2px dashed var(--color-accent-2-700)' }}></span>미개방 특수 엣지(인접 시 클릭해 개방)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '16px', borderTop: '3px dotted var(--color-neutral-900)' }}></span>임시 장벽 활성(적 이동 차단, 시한부)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>▶</span>일방통행 엣지(화살표 방향으로만 이동 가능)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--color-neutral-300)', position: 'relative' }}><span style=${{ position: 'absolute', top: '-3px', right: '-3px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-accent-2-700)' }}></span></span>보급품 위치 — 짧고 조용하게 끝나고 보상이 바로 들어온다(DEBUG 전체보기 켰을 때만 표시)</div>
                <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style=${{ color: 'var(--color-accent-2-700)', fontWeight: 900 }}>◆</span>확보 대상 — 길고 시끄러운 대신 후보 3개 중 하나를 고른다. 주황색 ◆는 상급(받는 장비가 새것으로 들어온다)</div>
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
                  // 복도끼리 잇는 엣지는 그 구역 평면도의 뼈대다. 굵게 그려야 격자·사슬·방사·탑
                  // 같은 배치 원형이 방들 사이에 묻히지 않고 한눈에 읽힌다.
                  const isSpine = !special && PASSAGE_TYPES.has(nodeTypeById[e.from]) && PASSAGE_TYPES.has(nodeTypeById[e.to]);
                  const stroke = barrier ? 'var(--color-neutral-900)' : pickable ? 'var(--color-accent)' : openable ? 'var(--color-accent-2-700)' : highGround ? '#7c3aed' : 'var(--color-divider)';
                  const barrierLabel = barrier ? ` — 임시 장벽 활성(적 이동 차단, ${leftTicksText(barrier.expiresAt, run.time)})` : '';
                  const oneWay = e.bidirectional === false && revealed;
                  const levelNote = special && !opened && (e.requiredCapability ?? 1) > 1
                    ? ` · ${e.features.includes('electronic') ? 'Hacking' : 'Force'} ${e.requiredCapability}이 표준` : '';
                  // 이동 시간은 **내 Mobility를 얹은 뒤**의 값이다 — 통로의 기본 비용만 보여 주면
                  // 그 숫자로 도착 시각을 계산한 플레이어가 매번 틀린다.
                  const walkTime = moveTimeCost(e, capabilities.mobility);
                  const walkNote = walkTime === e.timeCost ? `${walkTime}칸` : `${walkTime}칸(기본 ${e.timeCost})`;
                  const edgeLabel = `${whereIs(e.from)} ${oneWay ? '→' : '↔'} ${whereIs(e.to)} — 이동 시간 ${walkNote}${oneWay ? ' — 일방통행(역방향 이동 불가)' : ''}${special ? ` — 특수 엣지(${featureText(e.features)})${opened ? ' · 개방됨' : ' · 미개방'}${levelNote}` : ''}${barrierLabel}`;
                  const { d: pathD, midX, midY, angleDeg } = edgePath(from, to);
                  return html`
                    <g key=${e.id}>
                      ${highlighted ? html`<path d=${pathD} fill="none" stroke="var(--color-accent-300)" stroke-width="9" pointer-events="none"></path>` : null}
                      <path d=${pathD} fill="none" stroke=${stroke} stroke-width=${clickable ? 4 : isSpine ? 3 : 1.2} stroke-dasharray=${barrier ? '2 3' : dashed ? '5 3' : undefined} opacity=${isSpine || clickable || special ? 1 : 0.6} pointer-events="none"></path>
                      ${oneWay ? html`<polygon points="-7,-5 7,0 -7,5" fill=${stroke} transform=${`translate(${midX},${midY}) rotate(${angleDeg})`} pointer-events="none"></polygon>` : null}
                      <path
                        d=${pathD} fill="none" stroke="transparent" stroke-width="16"
                        style=${{ cursor: clickable ? 'pointer' : 'default' }}
                        onClick=${() => handleEdgeClick(e)}
                        onMouseEnter=${(ev) => showHover(ev, edgeLabel)} onMouseMove=${(ev) => showHover(ev, edgeLabel)} onMouseLeave=${hideHover}
                        tabindex=${clickable ? 0 : undefined}
                        onFocus=${(ev) => showHover(ev, edgeLabel)} onBlur=${hideHover}
                        onKeyDown=${(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) handleEdgeClick(e); }}
                      ></path>
                    </g>
                  `;
                })}
              </g>
              ${run.graph.nodes.map((n) => {
                if (!chartedNodeIds.has(n.id)) return null;
                const knowledge = nodeKnowledge(run, n.id);
                const pos = positions[n.id];
                const exit = exitByNode[n.id];
                const live = debugReveal || knowledge === 'current' || knowledge === 'fresh';
                const hasThreat = live ? (threatsByNode[n.id] || []).length > 0 : !!run.observations[n.id]?.hasThreat;
                const threatCount = live ? (threatsByNode[n.id] || []).length : (run.observations[n.id]?.hasThreat ? null : 0);
                // displayKnowledge: 디버그 모드에서 색/투명도만 "다 보임"으로 바꾼다(진짜 knowledge는
                // 그대로 둬서 이동 가능 판정 등 다른 로직은 안개 규칙을 그대로 따른다).
                const displayKnowledge = debugReveal ? (n.id === run.playerNodeId ? 'current' : 'fresh') : knowledge;
                // 정찰로 등급을 확인한 확보 대상은 지도에 ◆로 남는다 — 4칸을 쓴 대가가 화면에
                // 계속 보여야 "어디를 정찰할까"가 결정이 된다.
                const opportunity = debugReveal
                  ? run.graph.opportunities.find((o) => o.nodeId === n.id && o.usesRemaining > 0)
                  : run.graph.opportunities.find((o) => o.nodeId === n.id && o.usesRemaining > 0 && scoutedGradeOf(run, n.id, o.id));
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
                    ${exit
                      ? html`<circle cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 4} fill=${nodeFill(displayKnowledge, hasThreat, true)} stroke="var(--color-divider)" stroke-width="1.5" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none"></circle>`
                      : nodeBodyShape(n.type, pos.x, pos.y, {
                        fill: nodeFill(displayKnowledge, hasThreat, false),
                        stroke: 'var(--color-divider)',
                        'stroke-width': 1.5,
                        opacity: nodeOpacity(displayKnowledge),
                        'pointer-events': 'none',
                      })}
                    ${n.isGateway ? html`<text x=${pos.x - 13} y=${pos.y + 13} text-anchor="middle" font-size="11" font-weight="900" fill="var(--color-neutral-700)" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">⇄</text>` : null}
                    ${exit ? html`<text x=${pos.x} y=${pos.y + 5} text-anchor="middle" font-size="12" font-weight="800" fill="var(--color-bg)" pointer-events="none">${exit.kind === 'key' ? 'K' : exit.exitId}</text>` : null}
                    ${hasThreat ? html`<text x=${pos.x} y=${pos.y - NODE_RADIUS - 8} text-anchor="middle" font-size="13" fill="var(--color-accent-2-700, #dd2b0f)" opacity=${nodeOpacity(displayKnowledge)} pointer-events="none">▲${threatCount ?? ''}</text>` : null}
                    ${opportunity && opportunity.grade === 'prize'
                      ? html`<text x=${pos.x + 9} y=${pos.y - 6} text-anchor="middle" font-size="11" font-weight="900" fill=${opportunity.tier === 'elite' ? '#b45309' : 'var(--color-accent-2-700)'} pointer-events="none">◆</text>`
                      : (opportunity ? html`<circle cx=${pos.x + 9} cy=${pos.y - 9} r="3.5" fill="var(--color-accent-2-700)" stroke="var(--color-bg)" stroke-width="1" pointer-events="none"></circle>` : null)}
                    ${corpseByNode[n.id] ? html`<text x=${pos.x + 12} y=${pos.y + 13} text-anchor="middle" font-size="11" font-weight="900" fill="var(--color-negative, #dd2b0f)" pointer-events="none">†</text>` : null}
                    ${traceCountByNode[n.id] ? html`<text x=${pos.x - 12} y=${pos.y + 4} text-anchor="middle" font-size="9" font-weight="800" fill="#b45309" opacity="0.85" pointer-events="none">˙${traceCountByNode[n.id]}</text>` : null}
                    ${camera ? html`<text x=${pos.x - 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledCameraIds?.includes(camera.id) ? '#64748b' : (isCameraHackActive(run, camera.id) ? '#0ea5e9' : '#dc2626')} pointer-events="none">C</text>` : null}
                    ${hasInterface ? html`<text x=${pos.x + 12} y=${pos.y - 10} text-anchor="middle" font-size="9" font-weight="900" fill="#7c3aed" pointer-events="none">I</text>` : null}
                    ${generator ? html`<text x=${pos.x} y=${pos.y + 22} text-anchor="middle" font-size="9" font-weight="900" fill=${run.disabledGeneratorIds.includes(generator.id) ? '#64748b' : '#ca8a04'} pointer-events="none">G</text>` : null}
                    ${/* roving tabindex — 탭 순서에 노드가 160개 들어가면 키보드로는 사이드바에
                        닿을 수 없다. 탭 정지점은 지금 보고 있는 노드 하나뿐이고, 나머지는 그
                        자리에서 화살표로 옮겨 다닌다. */ null}
                    <circle
                      ref=${(el) => { if (el) nodeRefs.current[n.id] = el; else delete nodeRefs.current[n.id]; }}
                      cx=${pos.x} cy=${pos.y} r=${NODE_RADIUS + 10} fill="transparent"
                      style=${{ cursor: 'pointer' }}
                      onClick=${() => handleNodeSelect(n.id)}
                      onMouseEnter=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onMouseMove=${(ev) => showHover(ev, nodeTitle)}
                      onMouseLeave=${() => { hideHover(); setHoveredNodeId(null); }}
                      tabindex=${n.id === focusedNodeId ? 0 : -1}
                      onFocus=${(ev) => { showHover(ev, nodeTitle); setHoveredNodeId(n.id); }}
                      onBlur=${() => { hideHover(); setHoveredNodeId(null); }}
                      onKeyDown=${(ev) => handleNodeKeyDown(ev, n.id)}
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
            <${Tooltip} align="left" content="구역 경계 단계(0~3) — 조사하고도 원인을 못 찾거나, 카메라에 걸리거나, 남긴 시체·강한 흔적이 발견될 때마다 1씩 오릅니다. 저절로 내려가지 않으며(수습 수단으로만 낮춥니다), 높을수록 그 구역 위협들이 더 쉽게 추적 모드로 전환되고 증원이 빨리 옵니다.">
              <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', width: 'fit-content' }}>
                경계도 ${currentSectorAlert ? currentSectorAlert.level : '-'}/3${(() => {
    const cut = (run.powerCuts || []).find((c) => c.sectorId === currentSectorId && c.expiresAt > run.time);
    return cut ? ` · 전원 차단 중(${leftTicksText(cut.expiresAt, run.time)} · 그동안 상승 멈춤)` : '';
  })()}
              </div>
            <//>
            ${currentSectorId && run.revealedPatrolRouteSectorIds.includes(currentSectorId) && run.reinforcements?.[currentSectorId] ? html`
              <${Tooltip} align="left" content="통제실을 장악해 이 구역의 교대 일정이 보입니다. 증원은 구역 관문(⇄)으로 들어오며, 전투로 비운 자리만 채웁니다.">
                <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', width: 'fit-content' }}>다음 증원 ${inTicksText(run.reinforcements[currentSectorId].nextAt, run.time)}</div>
              <//>
            ` : null}
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
            ${threatMoves.length === 0 && staleSightings.length === 0
    ? html`<div style=${{ fontSize: '10.5px', color: 'var(--color-neutral-600)' }}>지금 보고 있는 위협이 없습니다.</div>`
    : html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              ${threatMoves.map((threat) => html`
                <${Tooltip} key=${threat.id} align="left" width=${250} content=${`${whereIs(threat.nodeId)}에서 관측 중입니다. 지금 상태(${THREAT_MODE_LABELS[threat.mode] || threat.mode})를 유지하면 ${threat.interval}칸마다 한 번 움직입니다 — 추적으로 바뀌면 더 빨라집니다. 어디로 갈지는 알 수 없습니다. 줄을 누르면 지도가 그 자리로 갑니다.`}>
                  <div
                    style=${{ fontSize: '10.5px', color: 'var(--color-negative, #dd2b0f)', fontWeight: 700, width: 'fit-content', cursor: 'pointer' }}
                    onMouseEnter=${() => setHoveredNodeId(threat.nodeId)}
                    onMouseLeave=${() => setHoveredNodeId(null)}
                    onClick=${() => focusOnNode(threat.nodeId)}
                  >
                    ${whereIs(threat.nodeId)} · 다음 이동까지 ${threat.ticksUntilMove}칸
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
              <div style=${{ fontSize: '11px', color: 'var(--color-neutral-600)', marginBottom: '10px' }}>${inspected.title}</div>
              ${inspected.knowledge === 'stale' && inspectedObservedAt != null ? html`<div style=${{ fontSize: '10.5px', fontStyle: 'italic', color: 'var(--color-neutral-600)', marginBottom: '10px' }}>${run.time - inspectedObservedAt}칸 전 관측 (시각 ${inspectedObservedAt}) — 그 사이 상황이 바뀌었을 수 있습니다.</div>` : null}

              ${/* 이동 가능 여부는 "관측이 최신인가"가 아니라 "통로로 이어져 있는가"다 — 대기로
                    인접 관측이 낡아도 옆 방으로 걸어갈 수 있다. */ null}
              ${selectedNodeId && selectedNodeId !== run.playerNodeId && isTrueAdjacent(run, selectedNodeId) ? html`
                <${Tooltip} align="left" width=${260} content=${encounterBlocked ? ENCOUNTER_BLOCK_NOTE : '인접 노드로 이동합니다. 이동 소음은 출발 시각에 나고, 도착 판정은 완료 칸에 한 번 합니다.'}>
                  <button class="btn btn-primary" disabled=${!selectedEdgeTraversable || encounterBlocked} style=${{ fontSize: '12px', width: '100%', marginBottom: '2px' }} onClick=${() => handleMove(selectedNodeId)}>이 노드로 이동</button>
                <//>
                <div style=${{ fontSize: '10.5px', color: selectedEdgeTraversable ? 'var(--color-neutral-600)' : 'var(--color-negative, #dd2b0f)', marginBottom: '10px' }}>
                  ${selectedEdge?.features.includes('highGround') && capabilities.mobility < 3
                    ? `높은 지형 — Mobility 3 필요 (현재 ${capabilities.mobility})`
                    : (selectedEdge
                      ? describeForecast(forecastAction('move', { edge: selectedEdge, value: capabilities.mobility }), '이동')
                      : '경로 없음')}
                </div>
                ${selectedEdgeTraversable ? html`<div style=${{ fontSize: '10.5px', color: movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).color, marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>${movementRiskForecast(run, selectedEdge, selectedNodeId, capabilities.mobility).label}</div>` : null}
                ${selectedCameraActive && capabilities.stealth < 3 ? html`<div style=${{ fontSize: '10.5px', color: '#dc2626', marginTop: '-7px', marginBottom: '10px', fontWeight: 800 }}>카메라 감시: Stealth 3 미만으로 진입하면 발각되어 주변 적이 추적합니다.</div>` : null}
              ` : null}

              ${(!selectedNodeId || selectedNodeId === run.playerNodeId) ? html`
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>
                    <div style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: '4px' }}>정찰</div>
                    <${ActionButton}
                      run=${run} actionId="recon"
                      label="기본 정찰"
                      tip="현재 노드와 인접 노드에 위협이 있는지 없는지만 확인합니다(정확한 수·경계 상태는 알 수 없음). 소음 없이 항상 성공하며, 완료 시점의 상태를 관측합니다. 도중에 적이 도착하면 중단되어 아무것도 얻지 못합니다."
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
                        tip="시계를 1칸 진행시킵니다. HP·과부화·경계도는 회복되지 않습니다 — 개방·쿨다운·적 위치를 기다리는 용도입니다."
                        onClick=${() => runCommand({ type: 'WAIT' })}
                      />
                      </div>
                      <div style=${{ flex: 1 }}>
                        <${ActionButton}
                          run=${run} actionId="waitBatch" opts=${{ ticks: WAIT_BATCH_MAX_TICKS }}
                          label="묶음 대기"
                          tip=${`최대 ${WAIT_BATCH_MAX_TICKS}칸을 1칸씩 기다립니다. 새 조우, 출구 개방/폐쇄, 붕괴가 생기면 즉시 멈추고 실제로 흐른 칸만 소모됩니다 — 아래 칸 수는 그 최대치입니다.`}
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
                          tip="이 노드의 접속 인터페이스를 장악하면, 이 구역에서 이미 발견한 카메라·발전기에 거리와 무관하게 원격 접속할 수 있습니다."
                          onClick=${() => runCommand({ type: 'HACK_ACCESS_INTERFACE', interfaceId: currentInterface.id })}
                        />
                      ` : null}
                      ${hackableCameras.length > 0 ? hackableCameras.map((camera) => html`
                        <${ActionButton}
                          key=${camera.id} run=${run} actionId="hackCamera" opts=${{ value: capabilities.hacking }}
                          label=${`${camera.nodeId} 카메라 해킹 (${currentInterfaceHacked ? '구역 원격' : `${cameraHops.get(camera.nodeId) ?? '?'}홉 직접`})`}
                          tip=${`그 카메라를 ${CAMERA_HACK_DURATION}칸 동안 무력화하고, 그동안 카메라 주변 노드를 실시간으로 관측합니다.`}
                          onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}
                        />
                      `) : null}
                      ${hackableGenerators.map((generator) => html`
                        <${ActionButton}
                          key=${generator.id} run=${run} actionId="disableGeneratorHack" opts=${{ value: capabilities.hacking }}
                          label=${`배터리 발전기 ${currentInterfaceHacked ? '원격' : '직접'} 무력화 (${currentInterfaceHacked ? '구역 원격' : `${cameraHops.get(generator.nodeId) ?? '?'}홉`})`}
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
                          label=${`${camera.nodeId} 카메라 해킹 (${cameraHops.get(camera.nodeId)}홉)`}
                          tip=${`그 카메라를 ${CAMERA_HACK_DURATION}칸 동안 무력화하고, 그동안 카메라 주변 노드를 실시간으로 관측합니다.`}
                          onClick=${() => runCommand({ type: 'HACK_CAMERA', cameraId: camera.id })}
                        />
                      `)}
                      ${hackableGenerators.map((generator) => html`
                        <${ActionButton}
                          key=${generator.id} run=${run} actionId="disableGeneratorHack" opts=${{ value: capabilities.hacking }}
                          label=${`배터리 발전기 해킹 무력화 (${cameraHops.get(generator.nodeId)}홉)`}
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
                          tip="구역 랜드마크 노드에서만 시도할 수 있습니다. 접속 인터페이스 해킹과는 별개입니다. Hacking이 모자라도 시도할 수 있지만, 그때 얻는 것은 1레벨(순찰경로 공개)까지입니다."
                          onClick=${() => runCommand({ type: 'HACK_CONTROL_ROOM' })}
                        />
                      </div>
                    `;
                  })() : null}

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
                      statusLine = atObjective ? '목표를 파괴하세요.' : `목표부(${SECTOR_NAMES[contract.sectorId]} · ${LANDMARKS_BY_SECTOR[contract.sectorId].name})에서 파괴할 수 있습니다.`;
                      button = html`<${ActionButton}
                        run=${run} actionId="contractDestroy" opts=${{ value: capabilities.force }} disabled=${!atObjective}
                        label="목표 파괴"
                        tip="목표부를 부숩니다. 확보와 완료가 동시라 이 한 번으로 계약이 끝나지만, 그 순간 봉쇄가 켜집니다."
                        onClick=${() => runCommand({ type: 'DESTROY_CONTRACT_TARGET' })}
                      />`;
                    } else if (contract.type === 'intel' && contract.status === 'accepted') {
                      statusLine = atObjective ? '데이터를 확보하세요.' : `목표부(${SECTOR_NAMES[contract.sectorId]} · ${LANDMARKS_BY_SECTOR[contract.sectorId].name})에서 확보할 수 있습니다.`;
                      button = html`<${ActionButton}
                        run=${run} actionId="contractIntel" opts=${{ value: capabilities.hacking }} disabled=${!atObjective}
                        label="데이터 확보"
                        tip="목표부에서 데이터를 땁니다. 이것만으로는 완료가 아니며, 이후 아무 구역 랜드마크에서 송출해야 합니다. 확보하는 순간 봉쇄가 켜집니다."
                        onClick=${() => runCommand({ type: 'ACQUIRE_CONTRACT_INTEL' })}
                      />`;
                    } else if (contract.type === 'intel' && contract.status === 'acquired') {
                      statusLine = atAnyLandmark ? '아무 랜드마크에서나 송출할 수 있습니다.' : '아무 구역 랜드마크에서나 송출하면 완료됩니다.';
                      button = html`<${ActionButton}
                        run=${run} actionId="contractTransmit" opts=${{ value: capabilities.hacking }} disabled=${!atAnyLandmark}
                        label="데이터 송출"
                        tip="확보한 데이터를 내보내면 계약이 완료됩니다. 목표부일 필요는 없고 아무 구역 랜드마크면 됩니다."
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

                  ${(() => {
                    // §4단계 수습 수단(D12) + 시체 처리(D13). 액션마다 블록을 새로 만들면 사이드
                    // 패널이 넘치므로, 지금 이 노드에서 실제로 할 수 있는 것만 한 블록에 모은다.
                    const canClean = currentTraces.length > 0;
                    const canCut = !!currentInterface && !powerCutSectorIds.has(currentSectorId);
                    const canBroadcast = !!currentInterface && (currentSectorAlert?.level || 0) > 0;
                    if (!currentCorpse && !canClean && !canCut && !canBroadcast) return null;
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
                        ${canBroadcast ? adjacentSectorIds.map((target) => {
                          // 상한(3)에 찬 구역으로는 넘길 수 없다 — 넘기면 +1이 잘려 경계도가
                          // 사라지고, 옮기는 수단이 지우는 수단이 된다(총량 보존, ADR-0073).
                          const full = (run.sectorAlerts[target]?.level || 0) >= 3;
                          const tip = full
                            ? `${SECTOR_NAMES[target]}은 이미 경계도 3입니다 — 더 받을 수 없어 넘길 수 없습니다.`
                            : `이 구역 경계도를 1 낮추고 ${SECTOR_NAMES[target]}에 그만큼 넘깁니다. 총량은 그대로이고, 그쪽으로 위협의 시선까지 옮겨갑니다.`;
                          return html`
                            <${ActionButton}
                              key=${target} run=${run} actionId="falseBroadcast" opts=${{ value: capabilities.deception }} disabled=${full}
                              label=${`가짜 목표 → ${SECTOR_NAMES[target]}`}
                              tip=${`${tip} 대상 구역 경계도는 현재 ${run.sectorAlerts[target]?.level || 0}/3입니다.`}
                              onClick=${() => runCommand({ type: 'BROADCAST_FALSE_TARGET', targetSectorId: target })}
                            />
                          `;
                        }) : null}
                      </div>
                    `;
                  })()}

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
                            key=${eq.instanceId} run=${run} actionId="fieldEquipment" opts=${{ contract: fa }}
                            disabled=${disabled}
                            label=${`${label} 사용${needsTarget ? '…' : ''}`}
                            tip=${`${eq.equipmentId} 능동 효과. ${FIELD_TARGET_LABELS[fa.targetKind] || fa.targetKind}. 과부화 +${fa.overloadGain}, 재사용 대기 ${fa.cooldown}칸${fa.duration ? `, 지속 ${fa.duration}칸` : ''}.${fa.targetKind === 'edge' ? ' 지도에서 강조된 엣지를 직접 클릭해 지정할 수 있습니다.' : ''}`}
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
                        run=${run} actionId="requestExtraction"
                        label=${`탈출구 ${currentExit.exitId} 개방 요청 (Hacking ${capabilities.hacking})`}
                        tip="탈출구를 여는 절차를 시작합니다. 요청 후 Hacking Capability가 높을수록 개방까지 대기 시간이 짧아지고, 열리면 이 노드에서 다음 행동이 끝나는 즉시 자동으로 탈출합니다(별도 확정 불필요). 일정 시간이 지나면 창이 다시 닫힙니다."
                        onClick=${() => runCommand({ type: 'REQUEST_EXTRACTION', exitId: currentExit.exitId })}
                      />
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
                      <div style=${{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        ${fieldPicker.contract.fieldAction.targetKind === 'edge'
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
                  return html`
                    <${Tooltip} key=${key} width=${240} align="left" content=${`${CAPABILITY_LABELS[key]} — ${CAPABILITY_ROLE[key]} 현재 값 ${raw >= 0 ? '+' : ''}${raw}(층계 판정은 이 원시 수치를 그대로 씁니다). ${capabilityActionSummary(key, raw)}`}>
                      <span class="tag tag-outline">${CAPABILITY_SHORT[key]} ${raw >= 0 ? '+' : ''}${raw}</span>
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
