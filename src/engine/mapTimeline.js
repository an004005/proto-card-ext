// 맵 화면이 시간을 읽는 방식 — 상단 카운터, 가까운 15칸 타임라인, 관측 위협의 다음 이동,
// 작업 중단 안내를 만드는 순수 함수들.
//
// 왜 따로 있나: 붕괴까지 700칸을 전부 그리면 아무것도 읽히지 않는다. 플레이어가 실제로 계획을
// 세우는 범위는 "지금 시작할 행동이 끝나기 전에 무엇이 끝나는가"이고, 그건 열 칸 남짓이다.
// 그래서 숫자 카운터(붕괴·출구 폐쇄)와 가까운 칸의 사건 목록을 함께 쓴다.
//
// 그리고 여기서 만드는 것은 **플레이어가 알 수 있는 것만**이다. 숨은 위협의 위치나 다음 이동은
// 타임라인에 넣지 않는다 — 넣는 순간 정찰과 카메라가 정보 수단으로서 의미를 잃는다.

import {
  RUN_COLLAPSE_TIME, SECTOR_NAMES, THREAT_MOVE_INTERVAL, SECTOR_ALERT_MOVE_INTERVAL,
  SECTOR_ALERT_FAST_MOVE_LEVEL, LOCKDOWN_THREAT_MOVE_INTERVAL, HUNTER_MOVE_INTERVAL,
} from '../data/facilityLayout.js';
import { bfsHopDistances } from './graphUtils.js';
import { describeThreatDecay, detailIncludes } from './runEngine.js';
import { FREE_OBSERVATION_DETAIL_LEVEL } from '../data/facilityLayout.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';

/** @typedef {import('./types.js').FacilityRunState} FacilityRunState */

/** 타임라인이 내다보는 칸 수. 이보다 먼 사건은 카운터 숫자로만 읽는다. */
export const TIMELINE_HORIZON = 15;

/**
 * 타임라인 한 줄.
 * @typedef {object} TimelineEvent
 * @property {number} at 일어나는 시각(칸).
 * @property {number} inTicks 지금부터 몇 칸 뒤인가.
 * @property {string} text 한 줄 설명.
 * @property {'collapse'|'closure'|'opening'|'expiry'|'cooldown'|'threat'|'reinforcement'} kind
 * @property {boolean} ends 무언가가 **끝나는** 사건인가 — 작업 예고 툴팁의 "작업 중 종료"가 이것만 본다.
 * @property {string} [nodeId] 지도에서 가리킬 수 있는 사건이면 그 노드 — 줄에 호버하면 지도가 강조한다.
 */

/** @param {string} sectorId */
function sectorName(sectorId) {
  return SECTOR_NAMES[/** @type {import('./types.js').FacilitySectorId} */ (sectorId)] || sectorId;
}

/** 출구 다섯 상태의 표시 이름. `closed`는 "닫혀 있다"가 아니라 "아직 요청하지 않았다"이다 —
 * 영구 폐쇄(`disabled`)와 헷갈리면 아직 열 수 있는 출구를 포기하게 된다.
 * @type {Record<string, string>} */
export const EXIT_STATUS_LABELS = {
  closed: '미요청',
  requesting: '요청 중',
  opening: '개방 대기',
  open: '열림',
  disabled: '폐쇄됨',
};

/**
 * 상단 카운터 — 붕괴까지, 그리고 유일한 표준 출구 A의 지금 상태와 그 상태가 끝나기까지 남은 칸.
 * 봉쇄는 출구 폐쇄 시각을 건드리지 않으므로(ADR-0083) 여기서 따로 계산할 것도 없다.
 *
 * 폐쇄 시각을 넘겼다고 곧바로 "폐쇄됨"이 아니다(ADR-0054) — 폐쇄 뒤에 금지되는 것은 **새 요청**
 * 뿐이고, 이미 시작된 개방 대기와 열려 있는 창은 끝까지 간다. 그래서 실제로 못 쓰게 된 출구
 * (`disabled`, 또는 아직 요청도 안 한 채 시각을 넘긴 출구)만 폐쇄됨으로 적고, 나머지는 지금
 * 상태의 남은 칸을 보인다.
 * @param {FacilityRunState} run
 * @returns {{collapseIn: number, exits: {exitId: string, closed: boolean, inTicks: number, status: string, stateTicks: number|null, text: string}[]}}
 */
export function runCountdowns(run) {
  const exits = /** @type {const} */ (['A']).map((exitId) => {
    const exit = /** @type {import('./types.js').StandardExitRuntimeState|undefined} */ (run.exits[exitId]);
    const disabledAt = exit ? exit.disabledAt : RUN_COLLAPSE_TIME;
    const inTicks = Math.max(0, disabledAt - run.time);
    const status = exit ? exit.status : 'disabled';
    const closed = !exit || status === 'disabled' || (status === 'closed' && inTicks === 0);
    /** @param {number|null|undefined} at */
    const remaining = (at) => (at == null ? null : Math.max(0, at - run.time));
    let stateTicks = null;
    let text = '폐쇄됨';
    if (!closed) {
      if (status === 'requesting') { stateTicks = remaining(exit.interactionEndsAt); text = `가동 ${stateTicks}칸 남음`; }
      else if (status === 'opening') { stateTicks = remaining(exit.opensAt); text = `개방까지 ${stateTicks}칸`; }
      else if (status === 'open') { stateTicks = remaining(exit.openEndsAt); text = `열림 ${stateTicks}칸 남음`; }
      else { stateTicks = inTicks; text = `폐쇄까지 ${inTicks}칸`; }
    }
    return { exitId, closed, inTicks, status, stateTicks, text };
  });
  return { collapseIn: Math.max(0, RUN_COLLAPSE_TIME - run.time), exits };
}

/**
 * 노드 하나를 "어디인가"로 말한다 — `comms_12` 같은 내부 id는 플레이어가 지도에서 찾을 수 없다.
 * 구역 이름과 현재 위치 기준 홉수를 함께 낸다.
 * @param {FacilityRunState} run
 * @param {string} nodeId
 * @param {Map<string, number>} [hops] 미리 계산한 현재 위치 기준 홉 거리(없으면 여기서 구한다).
 * @returns {string}
 */
export function describeNodeLocation(run, nodeId, hops) {
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  const name = node ? sectorName(node.sectorId) : nodeId;
  if (nodeId === run.playerNodeId) return `${name} · 현재 위치`;
  const table = hops || (run.playerNodeId ? bfsHopDistances(run.graph.edges, run.playerNodeId) : null);
  const hop = table ? table.get(nodeId) : undefined;
  if (hop === undefined) return `${name} · 닿는 길 없음`;
  return `${name} · ${hop === 1 ? '인접 1홉' : `${hop}홉`}`;
}

/**
 * 지금 실시간으로 보이는 위협들 — 현재 노드, 인접 노드, 그리고 정찰/카메라가 비추고 있는 노드에
 * 서 있는 것만. 여기 없는 위협은 화면이 존재조차 말하지 않는다.
 * @param {FacilityRunState} run
 * @returns {import('./types.js').ThreatRuntimeState[]}
 */
export function observableThreats(run) {
  const visible = reconNodeIds(run);
  for (const nodeId of adjacentNodeIds(run)) visible.add(nodeId);
  // 추적자(ADR-0092)는 관측 규칙의 유일한 예외다 — 어디 있든 항상 보인다. 안 보이는 추적자는
  // "언제 닿는가"를 셀 수 없게 만들어, 끈질김이 압박이 아니라 갑작스러운 사고가 되어버린다.
  return Object.values(run.threats).filter((threat) => threat.alwaysVisible || visible.has(threat.nodeId));
}

/** 정찰(기본 정찰 2홉·해킹한 카메라)이 지금 비추고 있는 노드.
 * @param {FacilityRunState} run @returns {Set<string>} */
function reconNodeIds(run) {
  return new Set(run.activeRecon?.targetNodeIds || []);
}

/** 공짜로 보이는 범위 — 서 있는 자리와 그 인접.
 * @param {FacilityRunState} run @returns {Set<string>} */
function adjacentNodeIds(run) {
  const near = new Set();
  if (!run.playerNodeId) return near;
  near.add(run.playerNodeId);
  for (const edge of run.graph.edges) {
    if (edge.from === run.playerNodeId) near.add(edge.to);
    else if (edge.to === run.playerNodeId) near.add(edge.from);
  }
  return near;
}

/**
 * 관측한 위협이 "무엇인가". 얼마나 깊이 보이는지는 그 노드를 **어느 깊이로 관측했는가**가
 * 정한다(`observation.detailLevel`, PERCEPTION_INFO_TABLE). 무료 인접 관측은 Perception과
 * 무관하게 유무·규모까지 고정이고, 그 위는 값을 치른 정찰이 Perception만큼 사 온다.
 *
 * 읽히지 않는 항목은 `null`이다 — 화면이 관측 기록보다 깊은 것을 그리지 못하게 하려면,
 * "모른다"가 빈 값이 아니라 명시적인 null이어야 한다.
 * @param {FacilityRunState} run
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {{detailLevel: number, size: number|null, mode: string|null, alert: number|null, composition: string[]|null, patrolNext: string|null, scouted: boolean}}
 */
export function describeObservedThreat(run, threat) {
  const detailLevel = run.observations?.[threat.nodeId]?.detailLevel ?? FREE_OBSERVATION_DETAIL_LEVEL;
  const monsterIds = /** @type {string[]} */ (/** @type {any} */ (threat).monsterIds || []);
  const route = threat.patrolRoute || [];
  const patrolNext = route.length ? route[(threat.patrolIndex + 1) % route.length] : null;
  return {
    detailLevel,
    size: detailIncludes(detailLevel, 'size') ? threat.size : null,
    mode: detailIncludes(detailLevel, 'mode') ? threat.mode : null,
    alert: detailIncludes(detailLevel, 'alert') ? threat.alert : null,
    composition: detailIncludes(detailLevel, 'composition') ? monsterIds.map((id) => MONSTER_DEFINITIONS[id]?.name || id) : null,
    patrolNext: detailIncludes(detailLevel, 'patrolNext') ? patrolNext : null,
    scouted: detailIncludes(detailLevel, 'composition'),
  };
}

/**
 * 관측 중인 위협 하나의 표시 정보. 다음 이동까지 남은 칸은 **현재 상태를 유지할 때**의 값이다 —
 * 추적으로 바뀌면 간격이 짧아지므로 그 사실을 문구에 함께 낸다. 미래 경로는 만들지 않는다.
 * @param {FacilityRunState} run
 * @returns {{id: string, nodeId: string, mode: string|null, ticksUntilMove: number|null, interval: number|null, detailLevel: number, size: number|null, alert: number|null, composition: string[]|null, patrolNext: string|null, scouted: boolean, decay: {nextMode: string, ticksLeft: number}|null}[]}
 */
export function observableThreatMoves(run) {
  return observableThreats(run).map((threat) => {
    const described = describeObservedThreat(run, threat);
    // "다음 이동까지 몇 칸"은 Perception 2부터 읽히는 정보다(정보 깊이 표). 그보다 얕게 본
    // 위협에 대해서는 화면이 이 숫자를 아예 갖지 못한다.
    const knowsNextMove = detailIncludes(described.detailLevel, 'nextMove');
    return {
      id: threat.id,
      nodeId: threat.nodeId,
      ticksUntilMove: knowsNextMove ? Math.max(0, threat.nextMoveAt - run.time) : null,
      interval: knowsNextMove ? threatMoveInterval(run, threat) : null,
      // ADR-0079 경계 감쇠 예고 — `추적 · 3칸 뒤 조사로`. 모드를 읽을 깊이가 아니면 숨긴다.
      decay: described.mode !== null ? describeThreatDecay(run, threat) : null,
      ...described,
    };
  });
}

/**
 * 그 위협이 지금 상태를 유지할 때의 이동 간격. runEngine.resolveMoveInterval과 같은 표를
 * 같은 순서로 읽는다 — 봉쇄와 경계도 2 이상을 빠뜨리면 화면이 실제보다 느린 적을 보여준다.
 * @param {FacilityRunState} run
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {number}
 */
function threatMoveInterval(run, threat) {
  // 추적자만은 경계도 가속·봉쇄와 무관하게 고정 간격이다(ADR-0092).
  if (threat.kind === 'hunter') return HUNTER_MOVE_INTERVAL;
  const alertLevel = run.sectorAlerts?.[threat.sectorId]?.level ?? 0;
  const table = run.lockdown ? LOCKDOWN_THREAT_MOVE_INTERVAL : THREAT_MOVE_INTERVAL;
  let interval = table[threat.mode] ?? table.patrol;
  if (alertLevel >= SECTOR_ALERT_FAST_MOVE_LEVEL) {
    interval = Math.min(interval, SECTOR_ALERT_MOVE_INTERVAL[threat.mode] ?? SECTOR_ALERT_MOVE_INTERVAL.patrol);
  }
  return interval;
}

/**
 * 지금 `timeCost`칸짜리 작업을 시작하면 그동안 **관측 중인** 위협이 각각 몇 번 움직이는가.
 *
 * 예고 툴팁의 "작업 중 종료"는 끝나는 타이머만 보기 때문에, 정작 가장 위험한 변화 — 그 20칸
 * 동안 옆 방의 적이 네 번 움직인다는 사실 — 이 한 줄도 나오지 않았다. 여기서 그 횟수와 각
 * 이동이 몇 칸째에 일어나는지를 만든다. 현재 상태를 유지할 때의 예정이며 미래 경로는 만들지
 * 않는다(추적으로 바뀌면 더 빨라진다).
 * @param {FacilityRunState} run
 * @param {number} timeCost
 * @returns {{id: string, nodeId: string, mode: string, count: number, offsets: number[]}[]}
 */
export function threatMovesDuring(run, timeCost) {
  if (!Number.isFinite(timeCost) || timeCost <= 0) return [];
  return observableThreatMoves(run)
    .map((threat) => {
      /** @type {number[]} */
      const offsets = [];
      // 다음 이동 시각을 읽을 깊이로 보지 못한 위협은 예고에 넣지 않는다 — 화면이 모르는 것을
      // 세어 보여주면 정보 깊이가 UI에서 새어 나간다.
      if (threat.ticksUntilMove === null || threat.interval === null) return { id: threat.id, nodeId: threat.nodeId, mode: threat.mode, count: 0, offsets: [] };
      for (let at = threat.ticksUntilMove; at <= timeCost; at += Math.max(1, threat.interval)) offsets.push(at);
      return { id: threat.id, nodeId: threat.nodeId, mode: threat.mode, count: offsets.length, offsets };
    })
    .filter((entry) => entry.count > 0);
}

/**
 * 시야 밖이라 "마지막으로 확인한 정보"로 굳은 위협 목격. `N칸 전 관측`의 N이 여기서 나온다 —
 * 카메라 발각 배너의 "N칸 전"과 같은 형식을 쓰기 위한 단일 출처다.
 * @param {FacilityRunState} run
 * @returns {{nodeId: string, ticksAgo: number}[]}
 */
export function staleThreatSightings(run) {
  const live = new Set(observableThreats(run).map((threat) => threat.nodeId));
  return Object.entries(run.observations)
    .filter(([nodeId, observation]) => observation.hasThreat && !live.has(nodeId))
    .map(([nodeId, observation]) => ({ nodeId, ticksAgo: Math.max(0, run.time - observation.observedAt) }))
    .sort((a, b) => a.ticksAgo - b.ticksAgo);
}

/**
 * 지금부터 `horizon`칸 안에 일어나는, 플레이어가 알 수 있는 사건 전부를 시각순으로.
 * @param {FacilityRunState} run
 * @param {number} [horizon]
 * @param {{cooldownLabels?: Record<string, string>}} [opts] 장비 인스턴스 id는 화면에서 읽을 수
 *   없는 문자열이라, 사람이 읽는 이름을 아는 호출부(로드아웃을 들고 있는 화면)가 넘겨준다.
 * @returns {TimelineEvent[]}
 */
export function upcomingEvents(run, horizon = TIMELINE_HORIZON, opts = {}) {
  const limit = run.time + horizon;
  const cooldownLabels = opts.cooldownLabels || {};
  /** @type {TimelineEvent[]} */
  const events = [];
  const hops = run.playerNodeId ? bfsHopDistances(run.graph.edges, run.playerNodeId) : undefined;
  /** @param {number} at @param {string} text @param {TimelineEvent['kind']} kind @param {boolean} ends @param {string} [nodeId] */
  const push = (at, text, kind, ends, nodeId) => {
    if (!Number.isFinite(at) || at <= run.time || at > limit) return;
    events.push({ at, inTicks: at - run.time, text, kind, ends, ...(nodeId ? { nodeId } : {}) });
  };

  push(RUN_COLLAPSE_TIME, '시설 붕괴', 'collapse', true);

  for (const exitId of /** @type {const} */ (['A'])) {
    const exit = /** @type {import('./types.js').StandardExitRuntimeState|undefined} */ (run.exits[exitId]);
    if (!exit || exit.kind !== 'standard') continue;
    // 폐쇄 시각은 "그 뒤로 새 가동을 시작할 수 없다"는 뜻이다(ADR-0054). 이미 가동·개방·열림으로
    // 넘어간 출구는 그 시각에 아무 일도 일어나지 않으므로, 그때 끝난다고 예고하면 예고 툴팁이
    // "작업 중 종료: 출구 A 영구 폐쇄"라는 거짓말을 한다. 아직 요청 전인 출구만 이 줄을 낸다.
    if (exit.status === 'closed') push(exit.disabledAt, `출구 ${exitId} 영구 폐쇄(새 가동 마감)`, 'closure', true, exit.nodeId);
    if (exit.status === 'requesting' && exit.interactionEndsAt !== null) push(exit.interactionEndsAt, `출구 ${exitId} 개방`, 'opening', false, exit.nodeId);
    if (exit.status === 'opening' && exit.opensAt !== null) push(exit.opensAt, `출구 ${exitId} 개방`, 'opening', false, exit.nodeId);
    if (exit.status === 'open' && exit.openEndsAt !== null) push(exit.openEndsAt, `출구 ${exitId} 개방 창 종료`, 'expiry', true, exit.nodeId);
  }

  for (const entry of run.hackedCameras) {
    const nodeId = run.graph.cameras.find((camera) => camera.id === entry.cameraId)?.nodeId;
    push(entry.expiresAt, `카메라 해킹 종료 · ${nodeId ? describeNodeLocation(run, nodeId, hops) : entry.cameraId}`, 'expiry', true, nodeId);
  }
  for (const cut of run.powerCuts) push(cut.expiresAt, `${sectorName(cut.sectorId)} 전원 복구`, 'expiry', true);
  for (const barrier of run.activeBarriers) push(barrier.expiresAt, '임시 장벽 소멸', 'expiry', true);
  for (const decoy of run.falseTargets) push(decoy.expiresAt, `가짜 목표 소멸 · ${describeNodeLocation(run, decoy.sourceNodeId, hops)}`, 'expiry', true, decoy.sourceNodeId);
  if (run.activeRecon?.expiresAt != null) push(run.activeRecon.expiresAt, '실시간 정찰 종료', 'expiry', true);
  for (const [instanceId, readyAt] of Object.entries(run.fieldCooldowns)) {
    push(readyAt, `${cooldownLabels[instanceId] || '현장 장비'} 재사용 가능`, 'cooldown', true);
  }

  // 증원은 순찰경로가 공개된 구역(통제실 장악)에서만 예정 시각을 알 수 있다.
  for (const sectorId of run.revealedPatrolRouteSectorIds) {
    const clock = run.reinforcements?.[sectorId];
    if (clock) push(clock.nextAt, `${sectorName(sectorId)} 증원`, 'reinforcement', false);
  }

  // 위협 이동은 위협 패널이 이미 위협별로 말한다. 타임라인에는 "가장 이른 한 번"만 남겨
  // 같은 사실을 두 곳에서 두 번 읽지 않게 한다(나머지는 패널에서 본다).
  const nextThreatMove = observableThreats(run)
    .slice()
    .sort((a, b) => a.nextMoveAt - b.nextMoveAt)[0];
  if (nextThreatMove) push(nextThreatMove.nextMoveAt, `가장 이른 위협 이동 · ${describeNodeLocation(run, nextThreatMove.nodeId, hops)}`, 'threat', false, nextThreatMove.nodeId);

  // 진행 중인 작업의 게이지가 차는 시각(ADR-0084). 이제는 커맨드 사이에도 `pendingTask`가
  // 남아 있을 수 있으므로, 그 완료 시각이 타임라인의 한 줄이 된다.
  if (run.pendingTask) {
    push(run.pendingTask.completesAt, `${TASK_LABELS[run.pendingTask.kind] || '작업'} 완료`, 'opening', false, run.pendingTask.nodeId || undefined);
  }

  return events.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text));
}

/**
 * `at`(작업 완료 예정 시각)보다 **먼저** 끝나는 타이머들. 예고 툴팁이 "작업 중 종료: 카메라 해킹"
 * 을 말할 수 있게 하는 자리다 — 15칸짜리 해킹을 믿고 20칸짜리 작업을 시작하는 실수를 막는다.
 * @param {FacilityRunState} run
 * @param {number} at
 * @returns {TimelineEvent[]}
 */
export function timersEndingBefore(run, at) {
  const horizon = at - run.time;
  if (horizon <= 0) return [];
  return upcomingEvents(run, horizon).filter((event) => event.ends);
}

/** 작업 종류를 사람이 읽는 이름으로 — 중단 안내가 "무엇이 끊겼는지" 말하려면 필요하다.
 * @type {Record<string, string>} */
export const TASK_LABELS = {
  recon: '기본 정찰',
  wait: '대기',
  evade: '조우 회피',
  concealment: '은엄폐 사용',
  corpse: '시체 처리',
  exitActivate: '탈출구 가동',
  equipSwap: '장비 교체',
  mapConsumable: '소모품 사용',
  farm: '파밍',
  fieldEquipment: '현장 장비 사용',
  openEdge: '특수 엣지 개방',
  hackInterface: '접속 인터페이스 해킹',
  hackCamera: '카메라 해킹',
  destroyCamera: '카메라 파괴',
  disableGenerator: '발전기 무력화',
  controlRoom: '통제실 장악',
  contract: '계약 작업',
  cleanTraces: '흔적 정리',
  cutPower: '전원 차단',
  falseBroadcast: '가짜 목표 송출',
};

/** @type {Record<string, string>} */
const INTERRUPT_REASONS = {
  threatContact: '적 접촉',
  collapsed: '시설 붕괴',
  abandoned: '자리를 떠남',
};

/**
 * 방금 끝난 작업이 중단됐다면 한 줄로 알린다 — 무엇이, 몇 칸 진행한 뒤, 무엇 때문에 끊겼고
 * 효과·보상이 하나도 적용되지 않았음을.
 *
 * 파밍은 자기 배너(lastActionResult)를 이미 갖고 있어 여기서는 내지 않는다. 둘 다 내면 같은
 * 사건이 화면에 두 번 뜬다.
 *
 * 배너는 그 사건이 일어난 **그 칸에만** 뜬다 — 파밍 결과·묶음 대기 배너와 같은 규칙이다.
 * 남겨 두면 인벤토리 정렬 같은 무료 조작을 할 때마다 몇 칸 전에 끝난 중단이 다시 읽혀서,
 * 방금 또 끊긴 것처럼 보인다.
 * @param {FacilityRunState|null|undefined} run
 * @returns {{kind: string, label: string, elapsed: number, reason: string, text: string}|null}
 */
export function interruptionNotice(run) {
  const outcome = run?.lastTaskOutcome;
  if (!outcome || outcome.status !== 'interrupted') return null;
  if (outcome.kind === 'farm') return null;
  if (outcome.completedAt !== run.time) return null;
  const label = TASK_LABELS[outcome.kind] || outcome.kind;
  const elapsed = Math.max(0, outcome.completedAt - outcome.startedAt);
  const reason = INTERRUPT_REASONS[outcome.reason ?? 'threatContact'] || '알 수 없는 사유';
  return {
    kind: outcome.kind,
    label,
    elapsed,
    reason,
    text: `${label} 중단 — ${elapsed}칸 진행 후 ${reason}. 시간만 소모되고 효과·보상은 적용되지 않았습니다.`,
  };
}

/** @type {Record<string, string>} */
const WAIT_STOP_REASONS = {
  encounter: '새 조우',
  exitChange: '출구 상태 변화',
  runEnded: '런 종료',
  blocked: '행동이 막힘',
  taskDone: '작업 완료',
};

/**
 * 묶음 대기가 요청한 칸을 다 채우지 못하고 멈췄다면 그 사실을 한 줄로. 다 채웠으면 말할 것이
 * 없다 — 조용히 지나간 5칸에 배너를 띄우면 매번 읽히는 잡음이 된다.
 * @param {FacilityRunState|null|undefined} run
 * @returns {{elapsed: number, requested: number, reason: string, text: string}|null}
 */
export function waitBatchNotice(run) {
  const batch = run?.lastWaitBatch;
  // 지난 대기의 기록이 화면에 남아 있으면 이후 행동마다 같은 문구가 다시 읽힌다 — 그 대기가
  // 끝난 바로 그 칸에만 낸다(파밍 배너와 같은 규칙).
  if (!batch || batch.elapsed >= batch.requested || batch.completedAt !== run.time) return null;
  const reason = (batch.reason && WAIT_STOP_REASONS[batch.reason]) || '알 수 없는 사유';
  return {
    elapsed: batch.elapsed,
    requested: batch.requested,
    reason,
    text: `${batch.elapsed}칸 후 중단: ${reason}`,
  };
}
