// Time/threat-AI/noise/pursuit/exit-lifecycle engine (docs/extraction-map-implementation-spec.md
// §5, §7). Pure and deterministic like facilityGraph.js — every function returns a new state and
// threads rngState explicitly.
//
// Scope note: §5.1's generic `PendingAction` queue (recon/farm/hack/swap/etc.) is NOT built here
// — those are concrete field actions that don't exist yet (Capability system is a later phase).
// This module implements the time/world-tick/threat/exit machinery that those actions will later
// plug into: `advanceTime` processes the timer/expiry/threat-movement events from §5.1.2 and §5.2
// on their own, and `requestExtraction`/`reportNoise`/`reportSighting` are the minimal external
// inputs needed to drive and test that machinery independently. The `PLAY_CARD`/`MOVE_EDGE`-style
// command surface is added once real field actions exist.

import { createRngState, pick } from './rng.js';
import { RuleViolation } from './errors.js';
import { bfsHopDistances, bfsHopDistancesOverArcs, buildAdjacency, isEdgeUnlocked } from './graphUtils.js';
import { effectiveForRequirement } from './capabilityEngine.js';
import { capabilityStep, resolveCapabilityCost } from './capabilityCosts.js';
import { requireActionCost, forecastAction, actionTimeCost, moveTimeCost } from './actionCosts.js';
import { pickThreatEncounter } from '../data/dropTables.js';
import { rollFieldLootOptions } from './fieldLoot.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import {
  RUN_COLLAPSE_TIME, EXIT_A_DISABLED_AT,
  EXIT_OPEN_WINDOW, EXIT_ACTIVATE_TIME_BY_HACKING, NOISE_DURATION,
  INVESTIGATION_MEMORY_DURATION, THREAT_MOVE_INTERVAL, SECTOR_ALERT_MOVE_INTERVAL, SECTOR_ALERT_FAST_MOVE_LEVEL,
  SECTOR_ALERT_MIN_ENEMY_ALERT, NOISE_HOP_RANGE, ALERT_GAUGE_CAPACITY, ALERT_PRESSURE,
  APPROACH_TIME_DELTA, APPROACH_NOISE_DELTA, APPROACH_MIN_TIME, BASIC_RECON_TIME,
  SUPPLY_FARM_TIME, SUPPLY_FARM_NOISE, PRIZE_FARM_TIME, PRIZE_FARM_NOISE,
  FORCE_TIER1_TIME, FORCE_BASE_NOISE, HACKING_TIER1_TIME, HACKING_BASE_NOISE,
  CAMERA_STEALTH_THRESHOLD, CAMERA_ALERT_RANGE, CAMERA_HACK_TIME,
  CAMERA_HACK_DURATION, CAMERA_HACK_RANGE_BY_HACKING, CAMERA_FORCE_TIME, CAMERA_FORCE_NOISE,
  CAMERA_SNIPE_AMMO_COST,

  GENERATOR_HACK_TIME, GENERATOR_FORCE_TIME, GENERATOR_FORCE_NOISE,
  CONCEALMENT_ACTION_TIME_COST, HALL_STEALTH_PENALTY, CONTROL_ROOM_HACK_TIME,
  STEALTH_CONTEXT_CAMERA, STEALTH_CONTEXT_POWER_CUT, STEALTH_CONTEXT_LOCKDOWN,
  ENCOUNTER_DECEIVE_REQUIREMENT, ENCOUNTER_DECEIVE_STEP_PENALTY, HIGH_GROUND_MOBILITY_REQUIREMENT,
  PURSUIT_DECAY_TICKS, INVESTIGATE_DECAY_TICKS, PURSUIT_DECAY_ALERT,
  CONTRACT_ACQUIRE_TIME, CONTRACT_DESTROY_TIME,
  CONTRACT_TRANSMIT_TIME,
  LOCKDOWN_THREAT_MOVE_INTERVAL,
  CORPSE_DISPOSAL_TIME, DISCOVERY_NOISE_INTENSITY,
  EVIDENCE_TIER_RAISING_ALERT, REINFORCEMENT_INTERVAL, REINFORCEMENT_LOCKDOWN_INTERVAL,
  WAIT_TICK_TIME, ENCOUNTER_EVADE_TIME, BASIC_RECON_HOP_RANGE, CONTRACT_DETONATE_MIN_HOPS,
  PERCEPTION_INFO_TABLE, FREE_OBSERVATION_DETAIL_LEVEL, PERCEPTION_WAIT_OBSERVATION_MIN,
  HUNTER_MOVE_INTERVAL, HUNTER_LOSE_TICKS, HUNTER_SIGHT_HOPS, HUNTER_STEALTH_THRESHOLD,
  FREE_FAR_OBSERVATION_DETAIL_LEVEL, CURRENT_NODE_DETAIL_LEVEL, PERCEPTION_FREE_FAR_VIEW_MIN,
} from '../data/facilityLayout.js';
import { adjacentSectorIds } from './facilityGraph.js';


// 모듈 레벨 카운터는 같은 프로세스에서 같은 seed로 여러 번 플레이하면(예: 헤드리스 테스트가
// playSeed(seed)를 두 번 호출) 잔여 카운터 상태 때문에 재현성이 깨진다 — 항상 state에서
// 결정론적으로 파생시킨다.
/** @param {string} prefix @param {number} time @param {number} count */
function freshId(prefix, time, count) { return `${prefix}_${time}_${count}`; }

/** id for a new entry appended to a state-derived list — dedup key is that list's own length, so it stays deterministic without a separate counter. @param {import('./types.js').FacilityRunState} state @param {unknown[]} list @param {string} prefix */
function idForNewEntry(state, list, prefix) { return freshId(prefix, state.time, list.length); }

/**
 * 탈출구 가동 게이지의 길이(칸). Hacking이 정한다(ADR-0084).
 * @param {number} effectiveHacking -2..4
 */
export function exitActivateTimeFor(effectiveHacking) {
  const clamped = Math.max(-2, Math.min(4, effectiveHacking));
  return EXIT_ACTIVATE_TIME_BY_HACKING[clamped + 2];
}

/**
 * @param {import('./types.js').FacilityGraph} graph
 * @param {number} seed
 * @param {{revealLandmarks?: boolean, revealLandmarkSectorIds?: string[], contract?: object}} [runConfig] 런 시작 조건 — 계약과 사전 정보 공개.
 * @returns {import('./types.js').FacilityRunState}
 */
export function createRunState(graph, seed, runConfig = {}) {
  /** @type {Record<string, import('./types.js').ExitRuntimeState>} */
  const exits = {};
  for (const placement of graph.exits) {
    if (placement.exitId === 'key') {
      exits.key = { kind: 'key', nodeId: placement.nodeId };
    } else {
      exits[placement.exitId] = {
        kind: 'standard',
        exitId: placement.exitId,
        nodeId: placement.nodeId,
        status: 'closed',
        disabledAt: EXIT_A_DISABLED_AT,
        interactionEndsAt: null,
        opensAt: null,
        openEndsAt: null,
        requestId: null,
        signalStartedAt: null,
      };
    }
  }

  // §신규 조우 시스템: 위협 마커에 속한 몬스터 구성을 런 시작 시 한 번 뽑아 고정한다
  // (computeThreatPerception이 이 monsterIds로 perception을 계산하고, 실제 전투 진입 시에도
  // 이 구성을 그대로 쓴다 — 조우 때 "본" 위험도와 실제로 붙는 적이 달라지지 않게).
  let rngState = createRngState(seed);
  /** @type {Record<string, import('./types.js').ThreatRuntimeState>} */
  const threats = {};
  for (const roster of graph.threats) {
    const rolled = pickThreatEncounter(rngState, roster.sectorId, roster.size);
    rngState = rolled.rngState;
    threats[roster.id] = {
      id: roster.id,
      sectorId: roster.sectorId,
      size: roster.size,
      monsterIds: rolled.monsterIds,
      patrolRoute: roster.patrolRoute,
      patrolIndex: 0,
      nodeId: roster.patrolRoute[0],
      mode: 'patrol',
      alert: 0,
      nextMoveAt: THREAT_MOVE_INTERVAL.patrol,
      lastKnownPlayerNodeId: null,
      lastObservedPlayerAt: null,
      pursuitStrength: 0,
      target: null,
      investigationMemory: null,
    };
  }

  /** @type {Record<string, import('./types.js').SectorAlertState>} */
  const sectorAlerts = {};
  for (const sectorId of graph.sectorIds) sectorAlerts[sectorId] = { level: 0, pressure: 0, resolvedEventIds: [] };

  // D17: 런 시작 시점의 정보 공개. 계약 난이도가 정하는 값이고(3단계에서 계약이 이 자리를
  // 채운다), 구현은 관측 집합에 미리 넣어 두는 것뿐이라 정찰·지도 임플란트와 같은 경로를 쓴다.
  // 위협·카메라·은엄폐·비인가 통로는 어떤 난이도에서도 공개하지 않으므로 hasThreat은 false다.
  /** @type {Record<string, {observedAt: number, hasThreat: boolean}>} */
  const observations = {};
  if (runConfig.revealLandmarks) {
    for (const landmark of graph.landmarks) observations[landmark.nodeId] = { observedAt: 0, hasThreat: false };
  }
  // 계약의 "사전 정보" 선불 — 계약 목표부 랜드마크만 미리 공개한다. revealLandmarks(전체
  // 공개, D17 난이도용)와는 별도 옵션이라 둘이 같이 켜져도 서로 덮어쓰지 않는다.
  for (const sectorId of runConfig.revealLandmarkSectorIds || []) {
    const landmark = graph.landmarks.find((l) => l.sectorId === sectorId);
    if (landmark) observations[landmark.nodeId] = { observedAt: 0, hasThreat: false };
  }

  // 계약(§3단계). 수락된 계약을 넘겨받아 진행 상태를 이 런에 심는다 — 여기서부터는
  // facilityRunState.contract가 유일한 소스이고, 로드아웃 단계의 GameSnapshot.activeContract는
  // 더 이상 참조하지 않는다.
  const contract = runConfig.contract
    ? { ...runConfig.contract, status: 'accepted', acquiredAt: null, completedAt: null }
    : null;
  return {
    graph,
    time: 0,
    rngState,
    phase: 'active',
    playerNodeId: graph.startNodeId,
    visitedNodeIds: [graph.startNodeId],
    openedEdgeIds: [],
    observations,
    // 조우 속이기를 이미 한 번 쓴 위협(D) — 위협당 한 번뿐이다.
    deceivedThreatIds: [],
    fieldCooldowns: {},
    activeBarriers: [],
    hackedCameras: [],
    disabledCameraIds: [],
    hackedInterfaceIds: [],
    disabledGeneratorIds: [],
    activeRecon: null,
    // 대기 중에는 주변을 관측하지 않는다. 대기가 끝난 시각을 적어 두면 refreshLocalObservations가
    // 인접 노드를 갱신하지 않고, 화면도 그 자리를 실시간이 아니라 낡은 정보로 읽는다. 다음 유료
    // 행동이 끝나면 null로 돌아가 다시 실시간이 된다.
    lastWaitEndedAt: null,
    lastCameraDetection: null,
    lastActionResult: null,
    exits: /** @type {any} */ (exits),
    threats,
    // 추적자(ADR-0092). 경계도 3단계에 오른 구역이 하나씩 내보내며, 그 구역이 3 아래로
    // 내려가면 목록에서도 빠져 다시 3이 될 때 새로 나온다.
    hunterSpawnedSectorIds: [],
    hunterLog: [],
    // 추적자 관측 판정이 읽는 실효 Stealth. 리듀서가 매 행동 앞에서 찍어 준다 — runEngine은
    // 로드아웃을 보지 못하므로, 카메라 판정이 stealth를 인자로 받는 것과 같은 구조다.
    playerStealth: 0,
    noiseEvents: [],
    falseTargets: [],
    evidence: [],
    sectorAlerts,
    combatTrigger: null,
    keyDiscovered: false,
    // 오버라이드 칩 사용 상태는 런 시작에 꺼져 있다 — 칩을 써야 켜진다(ADR-0086).
    overrideArmed: false,
    activeConcealment: null,
    revealedPatrolRouteSectorIds: [],
    encounter: null,
    contract,
    lockdown: null,
    corpses: [],
    pendingFarmChoice: null,
    pendingHpLoss: 0,
    pendingDurabilityLoss: 0,
    // 예약된 현장 작업과 그 결과(planned §9). 작업은 시작 시 예약만 하고, 완료 시각의 칸
    // 경계에서 한 번에 확정된다. 완료 전에 적이 접촉하면 중단되고 경과한 칸만 청구된다.
    pendingTask: null,
    lastTaskOutcome: null,
    // 전투 중인 위협 — 그동안 맵에서 움직이지 않는다(planned §8).
    engagedThreatId: null,
    // 구역마다 독립된 교대 시계. 통제실을 장악하면 그 구역의 다음 시각이 보인다(D14).
    reinforcements: Object.fromEntries(graph.sectorIds.map((id) => [id, { nextAt: REINFORCEMENT_INTERVAL, alertSeen: 0 }])),
    powerCuts: [],
  };
}

/**
 * §10.2 설계: 안개는 노드/엣지의 "존재"를 가리지 않는다(항상 전체 지도가 보인다) — 대신
 * 현재 노드+인접 노드의 위협 존재 여부만 매 행동 끝에 observations로 스냅샷해 둔다. 시야
 * 밖으로 벗어나도 그 스냅샷은 지워지지 않고 "마지막으로 확인한 정보"로 남는다(MapScreen.js가
 * observations 유무로 fresh/stale/unknown을 구분한다). gameReducer.js의 loadout/facility/combat
 * 커맨드 모듈이 모두 공통으로 호출하므로(맵 진입 시·시설 액션 후·전투 라운드 종료 후) 순수
 * FacilityRunState 함수로서 이 engine 레벨에 둔다 — 어느 커맨드 모듈에도 종속시키지 않기 위해서.
 * @param {import('./types.js').FacilityRunState} run
 * @param {number} [effectivePerception] 대기 중 관측 차단의 예외 판정에 쓴다(Perception 2 이상).
 * @returns {import('./types.js').FacilityRunState}
 */
/**
 * 실효 Perception이 정하는 정보 깊이 한 줄(PERCEPTION_INFO_TABLE). 표 밖의 값은 양끝으로 자른다.
 * @param {number} effectivePerception
 * @returns {import('../data/facilityLayout.js').PerceptionInfoLevel}
 */
export function perceptionInfo(effectivePerception) {
  const index = Math.max(-2, Math.min(4, effectivePerception ?? 0)) + 2;
  return PERCEPTION_INFO_TABLE[index];
}

/**
 * 그 깊이에서 이 항목이 읽히는가. UI와 엔진이 같은 하나의 판정을 쓴다 — 화면이 관측 기록에
 * 없는 것을 "추론해서" 채우면 정보 깊이는 표가 아니라 컴포넌트마다의 관습이 된다.
 * @param {number|undefined} detailLevel 관측 기록의 detailLevel
 * @param {string} field threat/extra 항목 이름
 * @returns {boolean}
 */
export function detailIncludes(detailLevel, field) {
  const row = PERCEPTION_INFO_TABLE.find((entry) => entry.level === (detailLevel ?? 0));
  if (!row) return false;
  return row.threat.includes(/** @type {any} */ (field)) || row.extra.includes(/** @type {any} */ (field));
}

/**
 * 대기 중에도 인접 1홉의 실시간 관측이 유지되는가. Perception 2 이상이면 눈을 감고 기다리지
 * 않는다 — 대기 관측 차단의 유일한 예외다.
 * @param {number} effectivePerception
 */
export function keepsObservationWhileWaiting(effectivePerception) {
  return (effectivePerception ?? 0) >= PERCEPTION_WAIT_OBSERVATION_MIN;
}

/**
 * 관측 기록 한 칸을 **병합**한다. 관측은 여러 경로가 같은 노드에 각자 아는 것을 적어 넣는
 * 공용 노트다 — 무료 인접 관측은 위협·출구, 정찰은 은엄폐와 확보 대상 등급, 정밀 스캔은 넓은
 * 범위의 위협. 어느 한 경로가 통째로 교체하면 다른 경로가 시간을 들여 알아낸 것이 소리 없이
 * 지워진다(리뷰 A6: 정찰 뒤 스캔을 쏘면 은엄폐 버튼이 사라졌다). 그래서 쓰기는 전부 여기로만.
 * `undefined` 값은 덮어쓰지 않는다.
 * @param {Record<string, import('./types.js').NodeObservation>} observations 원본을 건드리지 않는다
 * @param {string} nodeId
 * @param {Partial<import('./types.js').NodeObservation>} patch
 * @returns {Record<string, import('./types.js').NodeObservation>} 새 맵
 */
/**
 * 두 내용물 기록을 합친다. 새 기록이 "무엇이 있는가"의 최신 진실이므로 목록 자체는 새것을
 * 쓰되, 얕은 기록이 비워 둔 항목(정찰이 사는 남은 횟수)은 예전에 알아낸 값을 남긴다 — 그러지
 * 않으면 정찰한 노드 옆을 한 번 지나가는 것만으로 4칸을 들여 산 정보가 지워진다.
 * @param {import('./types.js').NodeContents|undefined} previous
 * @param {import('./types.js').NodeContents} next
 * @returns {import('./types.js').NodeContents}
 */
function mergeContents(previous, next) {
  if (!previous) return next;
  const before = new Map((previous.opportunities || []).map((entry) => [entry.id, entry]));
  return {
    opportunities: (next.opportunities || []).map((entry) => (entry.usesRemaining === undefined && before.get(entry.id)?.usesRemaining !== undefined
      ? { ...entry, usesRemaining: before.get(entry.id).usesRemaining }
      : entry)),
    devices: next.devices || [],
  };
}

export function mergeObservation(observations, nodeId, patch) {
  const previous = observations[nodeId];
  const merged = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'contents') { merged.contents = mergeContents(previous?.contents, /** @type {any} */ (value)); continue; }
    // detailLevel만은 덮어쓰지 않고 더 깊은 쪽을 남긴다. 값을 치른 정찰이 적어둔 항목들은
    // 얕은 무료 관측이 지나가도 그대로 남으므로(패치에 없는 키는 보존), 깊이도 함께 남아
    // 있어야 UI가 그 항목을 계속 그릴 수 있다.
    if (key === 'detailLevel') merged.detailLevel = Math.max(previous?.detailLevel ?? 0, /** @type {number} */ (value));
    else /** @type {any} */ (merged)[key] = value;
  }
  return { ...observations, [nodeId]: merged };
}

export function refreshLocalObservations(run, effectivePerception = 0) {
  if (!run.playerNodeId) return run;
  // 대기 직후에는 서 있는 자리만 갱신한다 — 숨어서 기다리는 동안 주변을 살피지는 않으므로
  // 인접 노드의 위협 정보는 대기 전에 마지막으로 본 그대로 낡는다(observationSuspended).
  // 예외는 Perception 2 이상이다 — 그때는 기다리는 동안에도 인접 1홉이 실시간으로 유지된다.
  const nearNodeIds = new Set([run.playerNodeId]);
  /** Perception 2 이상이 한 홉 더 보는 자리 — 여기는 위협 유무까지다. */
  const farNodeIds = new Set();
  if (run.lastWaitEndedAt == null || keepsObservationWhileWaiting(effectivePerception)) {
    for (const e of run.graph.edges) {
      if (e.from === run.playerNodeId) nearNodeIds.add(e.to);
      else if (e.to === run.playerNodeId) nearNodeIds.add(e.from);
    }
    if ((effectivePerception ?? 0) >= PERCEPTION_FREE_FAR_VIEW_MIN) {
      for (const e of run.graph.edges) {
        if (nearNodeIds.has(e.from) && !nearNodeIds.has(e.to)) farNodeIds.add(e.to);
        else if (nearNodeIds.has(e.to) && !nearNodeIds.has(e.from)) farNodeIds.add(e.from);
      }
    }
  }
  /** @type {Record<string, number>} */
  const threatCountByNodeId = {};
  for (const threat of Object.values(run.threats)) {
    threatCountByNodeId[threat.nodeId] = (threatCountByNodeId[threat.nodeId] || 0) + 1;
  }
  /** @type {Record<string, import('./types.js').ExitRuntimeState>} */
  const exitByNodeId = {};
  for (const exit of Object.values(run.exits)) exitByNodeId[exit.nodeId] = exit;
  let observations = { ...run.observations };
  for (const nodeId of nearNodeIds) {
    const exit = exitByNodeId[nodeId];
    const count = threatCountByNodeId[nodeId] || 0;
    // 기존 관측을 **병합**한다. 통째로 교체하면 정찰(basicRecon)이 같은 노드에 적어둔
    // concealment 같은 항목이 바로 다음 행동의 이 갱신에서 지워져, 정찰 산출이 0이 되고
    // 은엄폐 버튼(scouted 조건)이 영영 뜨지 않는다. 이 함수는 "시야에 든 노드의 최신
    // 위협·출구 상태"만 덮어쓰는 책임이다.
    //
    // 서 있는 자리와 옆방은 다르다(ADR-0090). 발로 딛고 선 노드는 방 안을 다 보므로 내용물을
    // 남은 횟수까지 적고 깊이도 규모까지다. 옆방은 위협 유무·그룹 수·모드와 **무엇이 있는지**
    // (보급품·확보 대상·장치의 존재)까지이고, 그것이 무엇인지(등급·역할축·남은 횟수)는 값을
    // 치른 관측이 판다.
    if (nodeId === run.playerNodeId) {
      observations = mergeObservation(observations, nodeId, {
        observedAt: run.time,
        hasThreat: count > 0,
        threatCount: count,
        exitStatus: exit?.kind === 'standard' ? exit.status : undefined,
        detailLevel: CURRENT_NODE_DETAIL_LEVEL,
        contents: nodeContentsAt(run, nodeId),
      });
    } else {
      observations = mergeObservation(observations, nodeId, {
        observedAt: run.time,
        hasThreat: count > 0,
        threatCount: count,
        // 공짜로 얻는 깊이는 Perception과 무관하게 고정이다 — 빌드에 따라 달라지면 "정찰을
        // 할 것인가"라는 결정 자체가 흐려진다. Perception이 늘리는 것은 깊이가 아니라 사거리다.
        detailLevel: FREE_OBSERVATION_DETAIL_LEVEL,
        contents: nodeContentsAt(run, nodeId, 'presence'),
      });
    }
  }
  for (const nodeId of farNodeIds) {
    observations = mergeObservation(observations, nodeId, {
      observedAt: run.time,
      hasThreat: (threatCountByNodeId[nodeId] || 0) > 0,
      detailLevel: FREE_FAR_OBSERVATION_DETAIL_LEVEL,
    });
  }
  return { ...run, observations };
}

/**
 * 지금 인접 노드의 무료 실시간 관측이 끊겨 있는가(대기 중·대기 직후). UI의 fresh/stale 판정과
 * 엔진의 관측 갱신이 같은 하나의 근거를 읽도록 여기서만 답한다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {number} [effectivePerception] Perception 2 이상은 대기 중에도 인접을 계속 본다.
 * @returns {boolean}
 */
export function observationSuspended(run, effectivePerception = 0) {
  if (keepsObservationWhileWaiting(effectivePerception)) return false;
  return run.lastWaitEndedAt != null;
}

/**
 * §신규 지도 임플란트: 현재 구역의 랜드마크(구역 통제실과 같은 노드, graph.landmarks)를
 * 화살표로 가리킬 대상을 계산한다 — 그 노드를 한 번이라도 관측했으면(observations에 기록)
 * 더 이상 화살표가 필요 없으므로 null.
 * @param {import('./types.js').FacilityRunState} run
 * @param {boolean} hasMapImplant
 * @returns {import('./types.js').SectorLandmark|null}
 */
export function getSectorLandmarkArrowTarget(run, hasMapImplant) {
  if (!hasMapImplant || !run.playerNodeId) return null;
  const playerNode = run.graph.nodes.find((n) => n.id === run.playerNodeId);
  if (!playerNode) return null;
  const landmark = run.graph.landmarks.find((l) => l.sectorId === playerNode.sectorId);
  if (!landmark || run.observations[landmark.nodeId]) return null;
  return landmark;
}

/**
 * 도면에 그려진 노드인가. 비인가 통로는 도면에 없다 — 폐기물 처리장의 정체성이라 어떤 난이도
 * 에서도 미리 공개하지 않는다(D16). 나머지 노드와 그 사이의 통로는 처음부터 전부 보인다.
 * 감추는 것은 구조가 아니라 그 안에 무엇이 있는지다.
 * @param {import('./types.js').FacilityNode} node
 */
export function isOnFloorPlan(node) {
  return !node.offPlan;
}

/**
 * 지도에 이 노드가 나타나는가. 도면에 있거나, 직접 가 봤거나, 관측한 적이 있으면 보인다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {import('./types.js').FacilityNode} node
 */
export function isNodeCharted(run, node) {
  return isOnFloorPlan(node) || run.visitedNodeIds.includes(node.id) || !!run.observations[node.id];
}

/** Refresh the nodes watched by an active manual or hacked-camera recon session.
 * @param {import('./types.js').FacilityRunState} run
 * @returns {import('./types.js').FacilityRunState}
 */
export function refreshActiveRecon(run) {
  const recon = run.activeRecon;
  if (!recon) return run;
  if (recon.expiresAt != null && run.time >= recon.expiresAt) return { ...run, activeRecon: null };
  const threatNodeIds = new Set(Object.values(run.threats).map((threat) => threat.nodeId));
  const exitByNodeId = Object.fromEntries(Object.values(run.exits).map((exit) => [exit.nodeId, exit]));
  let observations = { ...run.observations };
  // 정찰 세션이 시작될 때 확정된 깊이다. 나중에 Perception이 올라도 이미 본 것이 소급해
  // 깊어지지 않는다.
  const detailLevel = recon.detailLevel ?? FREE_OBSERVATION_DETAIL_LEVEL;
  for (const nodeId of recon.targetNodeIds) {
    const exit = exitByNodeId[nodeId];
    // 병합이다. 통째로 교체하면 같은 노드에 대해 다른 경로가 적어둔 항목(무료 관측의 출구 상태
    // 등)이 지워진다.
    observations = mergeObservation(observations, nodeId, {
      observedAt: run.time,
      hasThreat: threatNodeIds.has(nodeId),
      exitStatus: exit?.kind === 'standard' ? exit.status : undefined,
      concealment: detailIncludes(detailLevel, 'concealment') ? run.graph.concealmentByNodeId[nodeId] : undefined,
      detailLevel,
      // 내용물은 Perception과 무관하다 — 정찰이 닿은 노드는 무엇이 놓여 있는지 전부 적는다.
      contents: nodeContentsAt(run, nodeId),
      ...observedPrizeGrades(run, nodeId, detailLevel),
    });
  }
  return { ...run, observations };
}

/**
 * 그 노드의 **내용물** — 어떤 현장 기회와 장치가 있는가. 관측(무료 인접·정찰·해킹한 카메라)이
 * 닿기만 하면 Perception과 무관하게 전부 적힌다. Perception이 가르는 것은 그 다음의 **깊이**다:
 * 위협의 상세, 확보 대상의 등급·역할축, 은엄폐 값. "방 안에 무엇이 놓여 있는가"까지 지각 수치로
 * 가리면 정찰이 사는 것이 무엇인지 플레이어가 읽을 수 없다.
 *
 * 장치 상태(status)는 그 시각의 값이다 — 기록이 "마지막으로 확인한 것"이라는 결을 지킨다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {string} nodeId
 * @param {'full'|'presence'} [depth] `presence`는 무료 인접 시야가 읽는 깊이다 — 무엇이 있는지는
 *   적지만 남은 횟수는 적지 않는다(그것은 정찰이 판다).
 * @returns {import('./types.js').NodeContents}
 */
export function nodeContentsAt(run, nodeId, depth = 'full') {
  const opportunities = run.graph.opportunities
    .filter((opportunity) => opportunity.nodeId === nodeId && opportunity.usesRemaining > 0)
    .map((opportunity) => (depth === 'full'
      ? { id: opportunity.id, grade: opportunity.grade, usesRemaining: opportunity.usesRemaining }
      : { id: opportunity.id, grade: opportunity.grade }));
  /** @type {import('./types.js').ObservedDevice[]} */
  const devices = [];
  for (const camera of run.graph.cameras) {
    if (camera.nodeId !== nodeId) continue;
    devices.push({ kind: 'camera', id: camera.id, status: deviceStatus(run, { kind: 'camera', id: camera.id }) });
  }
  for (const entry of run.graph.accessInterfaces) {
    if (entry.nodeId !== nodeId) continue;
    devices.push({ kind: 'interface', id: entry.id, status: deviceStatus(run, { kind: 'interface', id: entry.id }) });
  }
  for (const generator of run.graph.generators || []) {
    if (generator.nodeId !== nodeId) continue;
    devices.push({ kind: 'generator', id: generator.id, status: deviceStatus(run, { kind: 'generator', id: generator.id }) });
  }
  return { opportunities, devices };
}

/**
 * 장치의 **지금** 상태. 존재는 관측 기록이 정하지만 상태는 언제나 지금 값이다 — 해킹·파괴·무력화는
 * 전부 플레이어 자신이 한 일이라, 그 노드를 다시 보지 않았다고 해서 모를 수가 없다. 관측 기록을
 * 만드는 nodeContentsAt과 이미 적힌 기록을 다시 그리는 지도 카드가 같은 함수를 쓴다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {{kind: 'camera'|'interface'|'generator', id: string}} device
 * @returns {'active'|'hacked'|'destroyed'}
 */
export function deviceStatus(run, device) {
  if (device.kind === 'camera') {
    if ((run.disabledCameraIds || []).includes(device.id)) return 'destroyed';
    return isCameraHackActive(run, device.id) ? 'hacked' : 'active';
  }
  if (device.kind === 'interface') return (run.hackedInterfaceIds || []).includes(device.id) ? 'hacked' : 'active';
  return (run.disabledGeneratorIds || []).includes(device.id) ? 'destroyed' : 'active';
}

/**
 * 정찰이 그 노드에서 읽어내는 확보 대상의 등급·역할축. 서 있는 것만으로는 "확보 대상이 있다"
 * 까지만 보이고, 등급과 축은 정찰한 뒤에야 화면에 뜬다(그래서 이 기록이 UI의 유일한 근거다).
 * 보급품은 예전 그대로라 여기 담지 않는다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {string} nodeId
 * @param {number} [detailLevel] 정보 깊이(PERCEPTION_INFO_TABLE의 level). 등급은 1부터, 역할축은 2부터 읽힌다.
 * @returns {{opportunityGrades?: Record<string, {tier: 'normal'|'elite', axis: string|null}>}}
 */
function observedPrizeGrades(run, nodeId, detailLevel = 5) {
  if (!detailIncludes(detailLevel, 'prizeGrade')) return {};
  const withAxis = detailIncludes(detailLevel, 'prizeAxis');
  /** @type {Record<string, {tier: 'normal'|'elite', axis: string|null}>} */
  const grades = {};
  for (const opportunity of run.graph.opportunities) {
    if (opportunity.nodeId !== nodeId || opportunity.grade !== 'prize') continue;
    // Perception 0은 등급까지, 1부터 역할축도 읽는다(정보 깊이 표).
    grades[opportunity.id] = { tier: opportunity.tier || 'normal', axis: withAxis ? (opportunity.axis || 'resource') : null };
  }
  return Object.keys(grades).length > 0 ? { opportunityGrades: grades } : {};
}

/**
 * 그 노드의 확보 대상 등급·축을 이미 정찰로 확인했는가. UI가 "등급 미확인" 표기와 범위 예고를
 * 가르는 유일한 판정이다.
 * @param {import('./types.js').FacilityRunState} run
 * @param {string} opportunityId
 * @param {string} nodeId
 * @returns {boolean}
 */
export function prizeGradeKnown(run, opportunityId, nodeId) {
  return !!run.observations[nodeId]?.opportunityGrades?.[opportunityId];
}

/**
 * §4.2/§5.1.2: 열쇠 탈출구는 요청 절차가 없다 — 열쇠를 보유한 채 그 노드에 있으면 즉시 추출된다.
 * 표준 탈출구(A/B)는 개방(open) 창 동안 그 노드에 있으면 추출된다. 붕괴/멜트다운으로 이미 끝난
 * 런은 호출자(gameReducer.js)가 먼저 걸러낸다 — 여기서는 순수하게 위치/상태만 판정한다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {boolean}
 */
export function isAtOpenExit(state) {
  if (!state.playerNodeId) return false;
  if (state.keyDiscovered && state.exits.key.nodeId === state.playerNodeId) return true;
  return /** @type {const} */ (['A']).some((exitId) => {
    const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
    return exit.status === 'open' && exit.nodeId === state.playerNodeId;
  });
}

/**
 * §CONTEXT.md 탈출구 요청. Throws on an invalid request (spec has no "soft fail" for this — the
 * UI only offers the button when eligible, so an ineligible call here is a caller bug).
 * @param {import('./types.js').FacilityRunState} state
 * @param {'A'} exitId
 * @param {number} effectiveHacking -2..4
 * @returns {import('./types.js').FacilityRunState}
 */
export function requestExtraction(state, exitId, effectiveHacking) {
  const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (exit.status !== 'closed') throw new RuleViolation(`exit ${exitId} is not closed (status=${exit.status})`);
  if (state.time >= exit.disabledAt) throw new RuleViolation(`exit ${exitId} is disabled`);

  // 가동은 하나의 게이지다(ADR-0084) — 옛 "요청 3칸 뒤 개방 대기"를 나누지 않고, 게이지가
  // 차는 그 칸에 문이 열린다. 그래서 두 시각이 같다.
  const activateTime = actionTimeCost('exitActivate', { value: effectiveHacking });
  const interactionEndsAt = state.time + activateTime;
  const opensAt = interactionEndsAt;
  const requestId = freshId(`req_${exitId}`, state.time, 0);
  let next = {
    ...state,
    exits: {
      ...state.exits,
      [exitId]: {
        ...exit, status: /** @type {const} */ ('requesting'), interactionEndsAt, opensAt, requestId, signalStartedAt: state.time,
      },
    },
  };
  // 가동 신호는 **시작 효과**라 위에서 이미 켜졌다(위협이 바로 그쪽으로 움직인다). 가동이
  // 중단되거나(적 접촉) 자리를 뜨면 신호와 가동이 함께 취소된다(TASK_ABORTS.exitActivate).
  // 명세가 말하는 "소음 4"는 NoiseEvent.intensity(1~3 상한)로 표현되지 않는다 — 탈출 신호는 이미
  // ThreatTarget의 'exitSignal' 우선순위(§7.1, 소음과 별도 채널)로 처리되고 있어, "소음 4"가
  // 정확히 어떤 값에 대응하는지 명세만으로는 확정할 수 없다.
  return scheduleTask(next, { kind: 'exitActivate', timeCost: activateTime, params: { exitId } });
}

/**
 * §7.1 소음 사건 생성. `createdAt` defaults to the current time (callers driving a live run don't
 * need to pass it; tests that want to construct a noise event at an arbitrary past time can).
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} sourceNodeId
 * @param {1|2|3} intensity
 * @param {number} [createdAt]
 */
export function reportNoise(state, sourceNodeId, intensity, createdAt = state.time) {
  const event = { id: idForNewEntry(state, state.noiseEvents, 'noise'), sourceNodeId, intensity, createdAt, expiresAt: createdAt + NOISE_DURATION };
  return { ...state, noiseEvents: [...state.noiseEvents, event] };
}

/**
 * §7.1/§4.2 가짜 목표 생성 (전자기 간섭 모듈의 원격 침투 등) — 구조는 소음 사건과 동일하지만
 * `falseTargets`에 들어가고, 조사 실패해도 소음 사건과 별개로 §7.4 구역 경계도를 올린다는 점은
 * 같지만 소음처럼 "실제로 들린 것"은 아니라는 게 유일한 의미 차이다(selectThreatTarget에서는
 * 소음과 함께 §7.1 우선순위 점수로 경쟁한다).
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} sourceNodeId
 * @param {1|2|3} intensity
 * @param {number} duration
 * @param {number} [createdAt]
 */
export function reportFalseTarget(state, sourceNodeId, intensity, duration, createdAt = state.time) {
  const event = { id: idForNewEntry(state, state.falseTargets, 'falseTarget'), sourceNodeId, intensity, createdAt, expiresAt: createdAt + duration };
  return { ...state, falseTargets: [...state.falseTargets, event] };
}

/**
 * Simulates a direct sighting of the player by a threat (the trigger a future combat/field-action
 * layer will call). Puts the threat straight into pursuit — the top priority per CONTEXT.md's
 * "행동 목표 우선순위".
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} threatId
 * @param {string} playerNodeId
 */
export function reportSighting(state, threatId, playerNodeId) {
  const threat = state.threats[threatId];
  return {
    ...state,
    threats: {
      ...state.threats,
      [threatId]: {
        ...threat,
        mode: 'pursuit',
        alert: 3,
        lastKnownPlayerNodeId: playerNodeId,
        pursuitStrength: 3,
        // ADR-0079 감쇠 타이머의 기준점. 목격한 그 칸부터 다시 센다.
        lastObservedPlayerAt: state.time,
        target: { kind: 'player', nodeId: playerNodeId },
      },
    },
  };
}

/**
 * 조우 속이기(D) — 동률 조우에서 회피 대신 고를 수 있다. 위협을 순찰로 되돌리지 않고, 그 위협이
 * 믿고 있는 **마지막 확인 위치**를 인접한 다른 노드로 옮겨 추적 목표를 그리로 돌린다. 회피가
 * "추적을 끊는" 것이라면 이것은 "추적을 다른 곳으로 보내는" 것이다 — 위협은 여전히 켜져 있고,
 * 그래서 0칸이어도 회피의 상위 호환이 아니다.
 *
 * 판정은 결정적이다: Deception이 그 위협의 경계 수치(+ 층계 벌점) 이상이면 성공, 아니면
 * 실패다. 실패하면 동률이 열세로 내려간다 — 속이려다 들킨 셈이다.
 *
 * 요구치 2는 이분 게이트가 아니라 층계다(D8). 0칸짜리 행동이라 시간으로 받을 대가가 없으므로
 * 대가를 판정 자체에 붙인다(ENCOUNTER_DECEIVE_STEP_PENALTY): 무리(Deception 1)는 성공 기준이
 * 1 높아지고, 위태(0)는 거기에 더해 시도 자체가 들통나 그 위협의 경계가 1 오른다. 불가(-1
 * 이하)만 예전처럼 막힌다.
 *
 * 위협당 한 번뿐이다(`deceivedThreatIds`). 그러지 않으면 0칸짜리 무한 재시도가 된다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} threatId
 * @param {number} effectiveDeception
 * @returns {{state: import('./types.js').FacilityRunState, success: boolean}}
 */
export function deceiveThreat(state, threatId, effectiveDeception) {
  const threat = state.threats[threatId];
  if (!threat) throw new RuleViolation(`unknown threat ${threatId}`);
  if ((state.deceivedThreatIds || []).includes(threatId)) throw new RuleViolation('this threat has already been deceived once');
  // 불가 단계면 여기서 던진다 — 사양표를 거치므로 화면의 예고와 같은 판정이다.
  requireActionCost('encounterDeceive', { value: effectiveDeception });
  const penalty = ENCOUNTER_DECEIVE_STEP_PENALTY[capabilityStep(effectiveDeception, ENCOUNTER_DECEIVE_REQUIREMENT)];

  const used = [...(state.deceivedThreatIds || []), threatId];
  const success = effectiveDeception >= threat.alert + penalty.successPenalty;
  // 위태 단계는 성공하든 실패하든 그 위협의 경계가 오른다 — 어설픈 수작은 그 자체로 신호다.
  const alerted = penalty.raisesThreatAlert ? Math.min(3, threat.alert + 1) : threat.alert;

  // 내가 선 자리 말고 인접한 다른 노드 하나로 시선을 던진다. 갈 수 있는 통로로만 던져야
  // 위협이 실제로 그쪽으로 걸어간다.
  const playerNodeId = state.playerNodeId;
  const decoys = state.graph.edges
    .filter((e) => e.from === playerNodeId || e.to === playerNodeId)
    .map((e) => (e.from === playerNodeId ? e.to : e.from))
    .filter((nodeId) => nodeId !== threat.nodeId);
  const decoyNodeId = decoys[0] ?? null;

  // 판정에 졌거나 던질 자리가 없으면 결과는 같다 — 한 번을 쓰고 경계만 남긴다. 실패도 한 번을
  // 쓰는 이유는 실패한 뒤 수치를 바꿀 방법이 런 중에 없어 재시도가 의미 없기 때문이다.
  if (!success || !decoyNodeId) {
    return {
      state: {
        ...state,
        deceivedThreatIds: used,
        threats: { ...state.threats, [threatId]: { ...threat, alert: alerted } },
      },
      success: false,
    };
  }

  return {
    state: {
      ...state,
      deceivedThreatIds: used,
      threats: {
        ...state.threats,
        [threatId]: {
          ...threat,
          alert: alerted,
          mode: 'pursuit',
          lastKnownPlayerNodeId: decoyNodeId,
          // 속인 순간부터 감쇠 타이머가 다시 돈다 — 엉뚱한 자리를 향해 걷다 6칸이면 조사로 내려온다.
          lastObservedPlayerAt: state.time,
          target: { kind: 'player', nodeId: decoyNodeId },
        },
      },
    },
    success: true,
  };
}

/**
 * §신규 조우 시스템: 위협 마커의 perception을 size/alert에서 파생시킨다 — 몬스터 종류와
 * 무관한 마커 단위 값. alert(0~3)에, 그 마커에 속한 몬스터들의 perception 중 최댓값을 더한다
 * (정확한 밸런스 수치는 실측 후 조정 대상 — 관계의 방향만 확정된 부분).
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {number}
 */
export function computeThreatPerception(threat) {
  const rosterPerception = threat.monsterIds.reduce(
    (max, id) => Math.max(max, MONSTER_DEFINITIONS[id]?.perception ?? 0), 0,
  );
  return threat.alert + rosterPerception;
}

/**
 * @param {number} stealth
 * @param {number} perception
 * @returns {'advantage'|'even'|'disadvantage'}
 */
export function computeEncounterTier(stealth, perception) {
  if (stealth > perception) return 'advantage';
  if (stealth === perception) return 'even';
  return 'disadvantage';
}

/** @param {import('./types.js').FacilityRunState} state @param {import('./types.js').FacilitySectorId} sectorId */
function sectorMinAlert(state, sectorId) {
  return /** @type {0|1|2|3} */ (SECTOR_ALERT_MIN_ENEMY_ALERT[state.sectorAlerts[sectorId].level] ?? 0);
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').FacilitySectorId} sectorId
 * @param {string} eventId
 */
function sectorOfNode(nodeId) {
  return /** @type {import('./types.js').FacilitySectorId} */ (nodeId.split('_')[0]);
}

/**
 * 구역 경계 압력을 얹는다(ADR-0082). 한 원인이 곧장 한 단계를 올리는 게 아니라 게이지를
 * 채우고, 가득 차면 단계가 1 오르며 넘친 만큼은 다음 단계로 이월된다 — 큰 사건의 초과분이
 * 버려지면 "이미 찼으니 지금 더 크게 사고 쳐도 같다"가 되어버린다.
 * 최대 단계(3)에서는 채울 것이 없으므로 게이지를 0에 고정한다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').FacilitySectorId} sectorId
 * @param {string} eventId 같은 사건의 중복 상승 방지 키.
 * @param {number} amount ALERT_PRESSURE의 원인별 압력.
 */
export function escalateSectorAlert(state, sectorId, eventId, amount) {
  const current = state.sectorAlerts[sectorId];
  if (current.resolvedEventIds.includes(eventId)) return state.sectorAlerts;
  // 전원 차단(D12) 중인 구역은 경계가 오르지 않는다. 기록도 남기지 않으므로 복구된 뒤에
  // 같은 원인이 다시 발견되면 그때는 오른다 — "막는" 것이 아니라 "멈추는" 것이다.
  if (state.powerCuts.some((cut) => cut.sectorId === sectorId && cut.expiresAt > state.time)) return state.sectorAlerts;
  let level = current.level;
  let pressure = (current.pressure || 0) + amount;
  while (pressure >= ALERT_GAUGE_CAPACITY && level < 3) {
    level = /** @type {0|1|2|3} */ (level + 1);
    pressure -= ALERT_GAUGE_CAPACITY;
  }
  if (level >= 3) pressure = 0;
  return {
    ...state.sectorAlerts,
    [sectorId]: { level, pressure, resolvedEventIds: [...current.resolvedEventIds, eventId] },
  };
}

/**
 * 역장 강화 임시 장벽(module_forcefield)이 걸린 엣지를 뺀 이동 가능 엣지 집합 — "적 이동만
 * 차단, 플레이어는 통과 가능"이므로 위협 목표 선택/이동에만 쓰고 플레이어 이동에는 쓰지 않는다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityEdge[]}
 */
function edgesForThreatMovement(state) {
  const barrierIds = new Set(state.activeBarriers.map((b) => b.edgeId));
  return state.graph.edges.filter((e) => !barrierIds.has(e.id) && isEdgeUnlocked(e, state.openedEdgeIds));
}

/**
 * CONTEXT.md "행동 목표 우선순위": 직접 목격·추적 -> 활성 탈출 신호 -> 가장 크게 들린 소음/가짣
 * 목표 -> 순찰. Re-evaluated every world tick except while already pursuing (pursuit always wins).
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {import('./types.js').ThreatTarget}
 */
function selectThreatTarget(state, threat) {
  if (threat.mode === 'pursuit' && threat.lastKnownPlayerNodeId) {
    return { kind: 'player', nodeId: threat.lastKnownPlayerNodeId };
  }

  // 두 가지 거리를 쓴다. 갈 수 있는 거리는 잠긴 문에 막히지만, 들리는 거리는 막히지 않는다 —
  // 문 너머 소리는 들린다. 그래서 소음이 "들렸는가"는 전체 그래프로, 들은 뒤 "얼마나 가까운
  // 소리인가"는 실제로 걸어갈 수 있는 그래프로 잰다.
  const hopsFromThreat = bfsHopDistances(edgesForThreatMovement(state), threat.nodeId);
  const audibleHops = bfsHopDistances(state.graph.edges, threat.nodeId);

  /** @type {{exitId: 'A', nodeId: string, createdAt: number, hops: number}[]} */
  const activeSignals = [];
  for (const exitId of /** @type {const} */ (['A'])) {
    const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
    if (!exit.signalStartedAt || !['requesting', 'opening', 'open'].includes(exit.status)) continue;
    const hops = hopsFromThreat.get(exit.nodeId);
    if (hops === undefined) continue;
    activeSignals.push({ exitId, nodeId: exit.nodeId, createdAt: exit.signalStartedAt, hops });
  }
  if (activeSignals.length > 0) {
    activeSignals.sort((a, b) => (a.hops - b.hops) || (b.createdAt - a.createdAt));
    const best = activeSignals[0];
    return { kind: 'exitSignal', exitId: best.exitId, nodeId: best.nodeId, createdAt: best.createdAt };
  }

  /** @type {{kind: 'noise'|'falseTarget', eventId: string, nodeId: string, score: number, createdAt: number}[]} */
  const candidates = [];
  /** @param {import('./types.js').NoiseEvent[]} events @param {'noise'|'falseTarget'} kind */
  const considerSources = (events, kind) => {
    for (const event of events) {
      if (state.time >= event.expiresAt) continue;
      // §7.1 조사 기억 — 이미 가 봤다가 허탕친 사건은 기억이 만료되기 전까지 다시 고르지 않는다.
      // 그러지 않으면 소음이 살아 있는 동안 같은 위협이 같은 자리를 왕복한다. 기억은 위협마다
      // 따로이므로 다른 위협은 그 사건을 조사할 수 있다(구역 단위 중복 제거는 별개다).
      const memory = threat.investigationMemory;
      if (memory && memory.eventId === event.id && state.time < memory.expiresAt) continue;
      const heard = audibleHops.get(event.sourceNodeId);
      if (heard === undefined || heard > NOISE_HOP_RANGE[event.intensity]) continue;
      const hops = hopsFromThreat.get(event.sourceNodeId);
      if (hops === undefined) continue;
      candidates.push({ kind, eventId: event.id, nodeId: event.sourceNodeId, score: event.intensity - hops, createdAt: event.createdAt });
    }
  };
  considerSources(state.noiseEvents, 'noise');
  considerSources(state.falseTargets, 'falseTarget');
  if (candidates.length > 0) {
    candidates.sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt));
    const best = candidates[0];
    return { kind: best.kind, eventId: best.eventId, nodeId: best.nodeId, score: best.score, createdAt: best.createdAt };
  }

  const nextIndex = (threat.patrolIndex + 1) % threat.patrolRoute.length;
  return { kind: 'patrol', nodeId: threat.patrolRoute[nextIndex] };
}

/**
 * One edge step from `fromNodeId` toward `toNodeId` along a shortest path. Ties are broken by
 * `rngState` for seed-determined variety. Returns `fromNodeId` unchanged if already there or if
 * the target is unreachable (defensive — the base graph is always fully connected in this phase).
 * @param {import('./types.js').FacilityEdge[]} edges
 * @param {string} fromNodeId
 * @param {string} toNodeId
 * @param {import('./rng.js').RngState} rngState
 */
function stepToward(edges, fromNodeId, toNodeId, rngState) {
  if (fromNodeId === toNodeId) return { nodeId: fromNodeId, rngState };
  const distancesFromTarget = bfsHopDistances(edges, toNodeId);
  const myDistance = distancesFromTarget.get(fromNodeId);
  if (myDistance === undefined) return { nodeId: fromNodeId, rngState };
  const adjacency = buildAdjacency(edges);
  const candidates = [...(adjacency.get(fromNodeId) || [])].filter((n) => distancesFromTarget.get(n) === myDistance - 1);
  if (candidates.length === 0) return { nodeId: fromNodeId, rngState };
  const { value: nodeId, state: nextState } = pick(rngState, candidates);
  return { nodeId, rngState: nextState };
}

/**
 * 위협이 방금 밟은 노드에서 시체와 흔적을 발견한다(§4단계, D12·D13). 발견한 것은 신고되어
 * 사라지고, 그 지점에 조사 소음이 생겨 다른 마커가 몰린다.
 *
 * 흔적은 tier로 가른다. 이동마다 쌓이는 약한 흔적까지 경계도를 올리면 경계도가 즉시 최대로
 * 가버리므로, 약한 흔적은 위협을 끌어들이기만 하고 강한 흔적(Stealth -2 이하로 남긴 것)만
 * 경계도를 올린다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} nodeId
 * @param {import('./types.js').FacilitySectorId} sectorId
 * @returns {import('./types.js').FacilityRunState}
 */
function discoverAtNode(state, nodeId, sectorId) {
  const corpse = state.corpses.find((c) => c.nodeId === nodeId);
  const traces = state.evidence.filter((e) => e.nodeId === nodeId);
  if (!corpse && traces.length === 0) return state;

  let next = state;

  // 시체와 강한 흔적이 한 자리에서 함께 발견되면 압력도 함께 더해진다(6+4=10 — 정확히 한 단계).
  // 두 사건이 따로 기록되므로 중복 방지 키도 따로다.
  if (corpse) {
    next = { ...next, corpses: next.corpses.filter((c) => c.id !== corpse.id) };
    next = { ...next, sectorAlerts: escalateSectorAlert(next, sectorId, corpse.id, ALERT_PRESSURE.corpseFound) };
  }
  if (traces.length > 0) {
    const traceIds = new Set(traces.map((t) => t.id));
    next = { ...next, evidence: next.evidence.filter((e) => !traceIds.has(e.id)) };
    if (traces.some((t) => t.tier >= EVIDENCE_TIER_RAISING_ALERT)) {
      next = { ...next, sectorAlerts: escalateSectorAlert(next, sectorId, `trace_${nodeId}_${next.time}`, ALERT_PRESSURE.strongTraceFound) };
    }
  }

  // 발견 지점으로 조사가 몰린다 — 소음 사건을 재사용한다(D13 "그 지점으로 조사가 몰린다").
  // 단, 이 소음은 경계도를 올리지 않는다. 올리면 발견 하나가 두 번 값을 치른다 — 약한 흔적은
  // 경계도를 올리지 않기로 했는데도 유인된 위협이 허탕을 치면서 결국 올려버려, 실측에서 여덟
  // 구역 중 다섯이 최대치로 갔다. 그 구역의 처리 완료 목록에 미리 넣어 막는다.
  next = reportNoise(next, nodeId, DISCOVERY_NOISE_INTENSITY, next.time);
  const planted = next.noiseEvents[next.noiseEvents.length - 1];
  const alert = next.sectorAlerts[sectorId];
  return {
    ...next,
    sectorAlerts: {
      ...next.sectorAlerts,
      [sectorId]: { ...alert, resolvedEventIds: [...alert.resolvedEventIds, planted.id] },
    },
  };
}

/**
 * 증원(D14) — 그 구역 로스터(graph.threats)에서 전투로 비워진 자리 하나를 다시 채운다.
 * 정원을 넘지 않으므로 "그냥 리스폰"이고, 맵 청소는 원천적으로 불가능해지되 무한 증식도 하지
 * 않는다. 관문에서 나오므로 등 뒤에서 생기지 않는다 — 플레이어에게서 먼 관문을 고른다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').FacilitySectorId} sectorId
 * @returns {import('./types.js').FacilityRunState}
 */
function spawnReinforcement(state, sectorId) {
  const empty = state.graph.threats.find((roster) => roster.sectorId === sectorId && !state.threats[roster.id]);
  if (!empty) return state;

  // 플레이어가 서 있는 관문에는 내보내지 않는다 — 스폰과 동시에 전투가 열리면 "등 뒤에서
  // 생기지 않는다"가 깨진다. 관문이 둘 다 막히면 이번 교대는 건너뛴다.
  const gateways = state.graph.nodes.filter((n) => n.sectorId === sectorId && n.isGateway && n.id !== state.playerNodeId);
  if (gateways.length === 0) return state;
  const playerHops = state.playerNodeId ? bfsHopDistances(edgesForThreatMovement(state), state.playerNodeId) : null;
  const origin = gateways.reduce((best, node) => {
    if (!playerHops) return best;
    return (playerHops.get(node.id) ?? Infinity) > (playerHops.get(best.id) ?? Infinity) ? node : best;
  }, gateways[0]);

  const rolled = pickThreatEncounter(state.rngState, sectorId, empty.size);
  return {
    ...state,
    rngState: rolled.rngState,
    threats: {
      ...state.threats,
      [empty.id]: {
        id: empty.id,
        sectorId,
        size: empty.size,
        monsterIds: rolled.monsterIds,
        patrolRoute: empty.patrolRoute,
        patrolIndex: 0,
        // 출발점에 놓고 순찰 경로를 그대로 주면 stepToward가 알아서 순찰 구역까지 걸어간다.
        nodeId: origin.id,
        mode: 'patrol',
        alert: 0,
        nextMoveAt: state.time + THREAT_MOVE_INTERVAL.patrol,
        lastKnownPlayerNodeId: null,
        lastObservedPlayerAt: null,
        pursuitStrength: 0,
        target: null,
        investigationMemory: null,
      },
    },
  };
}

// ---- 추적자 (ADR-0092) ----
//
// 경계도 3단계가 그 구역에 풀어놓는 개체 하나. 다른 위협과 달리 순찰 경로도 소음도 보지 않고
// 플레이어만 본다. 그래서 이동·목표·관측을 updateThreat의 표가 아니라 여기 따로 둔다 — 그 표에
// 예외를 끼워 넣으면 "이 마커는 왜 여기 서 있나"를 한 자리에서 읽을 수 없게 된다.

/** @param {import('./types.js').ThreatRuntimeState} threat */
export function isHunter(threat) {
  return threat?.kind === 'hunter';
}

/** 그 구역에 지금 살아 있는 추적자. @param {import('./types.js').FacilityRunState} state @param {string} sectorId */
function hunterOfSector(state, sectorId) {
  return Object.values(state.threats).find((t) => isHunter(t) && t.sectorId === sectorId) || null;
}

/**
 * 추적자가 지금 플레이어를 보고 있는가. 일반 위협의 1홉 시야(threatObservesPlayer)와 같은
 * 규칙이되 거리가 HUNTER_SIGHT_HOPS로 넓고, 실효 Stealth가 임계 이상이면 그 안에서도 놓친다 —
 * 은신 빌드가 추적자를 떨어뜨릴 수 있는 유일한 손잡이다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} hunter
 */
function hunterObservesPlayer(state, hunter) {
  const playerNodeId = state.playerNodeId;
  if (!playerNodeId) return false;
  if ((state.playerStealth ?? 0) >= HUNTER_STEALTH_THRESHOLD) return false;
  if (hunter.nodeId === playerNodeId) return true;
  const hops = bfsHopDistances(edgesForThreatMovement(state), hunter.nodeId);
  return (hops.get(playerNodeId) ?? Infinity) <= HUNTER_SIGHT_HOPS;
}

/**
 * 추적자 한 마리의 한 칸. 보면 플레이어 노드를 목표로 최단 경로로 좁히고, 못 보면 마지막으로
 * 본 자리로 가서 그 인접을 순회한다. 이동 간격은 경계도·봉쇄와 무관하게 고정이다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} hunter
 * @param {number} tickTime
 * @returns {{threat: import('./types.js').ThreatRuntimeState, state: import('./types.js').FacilityRunState}}
 */
function updateHunter(state, hunter, tickTime) {
  const sees = hunterObservesPlayer(state, hunter);
  /** @type {import('./types.js').ThreatRuntimeState} */
  let next = sees
    ? {
      ...hunter,
      lostTicks: 0,
      lastObservedPlayerAt: tickTime,
      lastKnownPlayerNodeId: state.playerNodeId,
      target: { kind: /** @type {const} */ ('player'), nodeId: /** @type {string} */ (state.playerNodeId) },
    }
    : { ...hunter, lostTicks: (hunter.lostTicks || 0) + 1 };

  // 못 보는 동안의 목표는 마지막으로 본 자리다. 거기 이미 서 있으면 인접을 한 칸씩 훑는다 —
  // 그 자리에 멈춰 서 있으면 20칸 동안 아무 일도 일어나지 않아 "놓치기까지 M칸"이 그냥 대기가 된다.
  if (!sees) {
    const anchor = next.lastKnownPlayerNodeId;
    if (!anchor) {
      next.target = { kind: /** @type {const} */ ('patrol'), nodeId: next.nodeId };
    } else if (next.nodeId !== anchor) {
      next.target = { kind: /** @type {const} */ ('player'), nodeId: anchor };
    } else {
      const adjacency = buildAdjacency(edgesForThreatMovement(state));
      const ring = [...(adjacency.get(anchor) || [])].sort();
      const sweepIndex = ring.length ? (next.patrolIndex + 1) % ring.length : 0;
      next.patrolIndex = sweepIndex;
      next.target = { kind: /** @type {const} */ ('patrol'), nodeId: ring.length ? ring[sweepIndex] : anchor };
    }
  }

  if (tickTime < next.nextMoveAt) return { threat: next, state };

  const stepped = stepToward(edgesForThreatMovement(state), next.nodeId, next.target.nodeId, state.rngState);
  next.nodeId = stepped.nodeId;
  next.nextMoveAt = tickTime + HUNTER_MOVE_INTERVAL;
  // 순회 중 마지막으로 본 자리를 떠났다면 다음 칸에 다시 그리로 돌아오도록 앵커는 그대로 둔다.
  let nextState = { ...state, rngState: stepped.rngState };
  nextState = discoverAtNode(nextState, next.nodeId, sectorOfNode(next.nodeId));
  return { threat: next, state: nextState };
}

/**
 * 경계도 3단계 도달 시의 스폰과, 세 무력화 조건의 제거를 한 자리에서 본다. 매 칸 경계에서
 * 돌며, 스폰은 **단계가 3으로 올라선 그 순간** 한 번뿐이다(`hunterSpawnedSectorIds`) — 매 칸
 * "3이면 없으면 만든다"로 두면 전투로 쓰러뜨린 다음 칸에 곧바로 새 추적자가 서 있다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} tickTime
 * @returns {import('./types.js').FacilityRunState}
 */
function syncHunters(state, tickTime) {
  let next = state;
  let threats = next.threats;
  let spawned = next.hunterSpawnedSectorIds || [];
  let log = next.hunterLog || [];
  let changed = false;

  for (const sectorId of next.graph.sectorIds) {
    const level = next.sectorAlerts[sectorId]?.level ?? 0;
    const hunter = Object.values(threats).find((t) => isHunter(t) && t.sectorId === sectorId) || null;
    const seized = (next.revealedPatrolRouteSectorIds || []).includes(sectorId);

    if (level < 3) {
      // 단계가 내려가면 이 구역은 다시 "3이 되는 순간"을 가질 수 있다.
      if (spawned.includes(sectorId)) { spawned = spawned.filter((id) => id !== sectorId); changed = true; }
      if (hunter) {
        delete (threats = { ...threats })[hunter.id];
        log = [...log, { at: tickTime, sectorId, reason: /** @type {const} */ ('alertFell'), text: '추적자가 철수했다 — 구역 경계도가 3단계 아래로 내려갔다.' }];
        changed = true;
      }
      continue;
    }

    if (hunter && seized) {
      delete (threats = { ...threats })[hunter.id];
      log = [...log, { at: tickTime, sectorId, reason: /** @type {const} */ ('controlRoom'), text: '추적자가 철수했다 — 구역 통제실을 장악했다.' }];
      changed = true;
      continue;
    }
    if (hunter && (hunter.lostTicks || 0) >= HUNTER_LOSE_TICKS) {
      delete (threats = { ...threats })[hunter.id];
      log = [...log, { at: tickTime, sectorId, reason: /** @type {const} */ ('lost'), text: '추적자가 흔적을 놓쳤다 — 20칸 동안 나를 보지 못했다.' }];
      changed = true;
      continue;
    }
    if (hunter || spawned.includes(sectorId)) continue;
    // 통제실을 이미 장악한 구역에는 애초에 내보내지 않는다.
    if (seized) continue;

    const origin = hunterSpawnNode(next, sectorId);
    if (!origin) continue;
    threats = { ...threats, [`hunter_${sectorId}`]: makeHunter(next, sectorId, origin, tickTime) };
    spawned = [...spawned, sectorId];
    changed = true;
  }

  if (!changed) return next;
  return { ...next, threats, hunterSpawnedSectorIds: spawned, hunterLog: log };
}

/**
 * 랜드마크 노드에서 나온다. 랜드마크가 없는 구역이면 관문.
 *
 * 플레이어가 서 있는 자리에는 내보내지 않는다 — 증원과 같은 규칙이다(등 뒤에서 생기지 않는다).
 * 특히 랜드마크는 통제실을 장악하러 서 있는 그 자리라, 거기 세우면 추적자를 떼는 유일한 능동
 * 수단(통제실 장악)이 시작하는 순간 전투로 끊긴다. 다른 자리도 없으면 이번 칸은 건너뛴다.
 * @param {import('./types.js').FacilityRunState} state @param {string} sectorId
 */
function hunterSpawnNode(state, sectorId) {
  const landmark = state.graph.landmarks.find((l) => l.sectorId === sectorId);
  if (landmark && landmark.nodeId !== state.playerNodeId) return landmark.nodeId;
  const gateway = state.graph.nodes.find((n) => n.sectorId === sectorId && n.isGateway && n.id !== state.playerNodeId);
  return gateway ? gateway.id : null;
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} sectorId
 * @param {string} nodeId
 * @param {number} tickTime
 * @returns {import('./types.js').ThreatRuntimeState}
 */
function makeHunter(state, sectorId, nodeId, tickTime) {
  return {
    id: `hunter_${sectorId}`,
    kind: 'hunter',
    alwaysVisible: true,
    sectorId: /** @type {import('./types.js').FacilitySectorId} */ (sectorId),
    size: 1,
    monsterIds: ['hunter'],
    patrolRoute: [nodeId],
    patrolIndex: 0,
    nodeId,
    mode: 'pursuit',
    alert: 3,
    nextMoveAt: tickTime + HUNTER_MOVE_INTERVAL,
    lastKnownPlayerNodeId: state.playerNodeId || null,
    lastObservedPlayerAt: null,
    pursuitStrength: 3,
    target: null,
    investigationMemory: null,
    lostTicks: 0,
  };
}

/**
 * 위협 패널이 읽는 추적자 한 줄의 재료. 추적자는 관측과 무관하게 항상 보이므로 정보 깊이를
 * 거치지 않는다 — 이 개체를 못 본 척하는 것이 이 규칙의 유일한 예외다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {{id: string, sectorId: string, nodeId: string, hopsFromPlayer: number|null, ticksUntilLost: number}[]}
 */
export function describeHunters(state) {
  const hops = state.playerNodeId
    ? bfsHopDistances(edgesForThreatMovement(state), state.playerNodeId)
    : null;
  return Object.values(state.threats)
    .filter(isHunter)
    .map((hunter) => ({
      id: hunter.id,
      sectorId: hunter.sectorId,
      nodeId: hunter.nodeId,
      hopsFromPlayer: hops ? (hops.get(hunter.nodeId) ?? null) : null,
      ticksUntilLost: Math.max(0, HUNTER_LOSE_TICKS - (hunter.lostTicks || 0)),
    }));
}

/**
 * 구역별 증원 시계(D14). 경계도가 오른 구역은 다음 교대를 현재 시각으로 당긴다 — 경계도
 * 상승이 곧 증원이라는 D14의 계기를, 정원을 넘기지 않으면서 지킨다. 경계도가 올랐는지는
 * sectorAlerts.resolvedEventIds의 길이로 관찰한다(카메라·소음·시체·흔적 어느 경로로 올랐든
 * 여기 한 곳에서 잡힌다).
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} tickTime
 * @returns {import('./types.js').FacilityRunState}
 */
function tickReinforcements(state, tickTime) {
  let next = state;
  for (const sectorId of next.graph.sectorIds) {
    const clock = next.reinforcements[sectorId];
    // 경계 "레벨"을 본다. resolvedEventIds의 길이는 처리 완료로 미리 등록해 둔 사건(발견 소음,
    // 심어둔 미끼)까지 세어버려서, 실제로 경계가 오르지 않았는데도 증원을 앞당긴다.
    const level = next.sectorAlerts[sectorId].level;
    let nextAt = clock.nextAt;
    if (level > (clock.alertSeen || 0)) nextAt = Math.min(nextAt, tickTime);
    if (tickTime >= nextAt) {
      next = spawnReinforcement(next, /** @type {import('./types.js').FacilitySectorId} */ (sectorId));
      // 봉쇄 중에는 교대 주기가 짧아진다(D22) — 목표를 확보한 뒤의 마지막 장이 실제로 조여든다.
      nextAt = tickTime + (next.lockdown ? REINFORCEMENT_LOCKDOWN_INTERVAL : REINFORCEMENT_INTERVAL);
    }
    next = { ...next, reinforcements: { ...next.reinforcements, [sectorId]: { nextAt, alertSeen: level } } };
  }
  return next;
}

/**
 * 위협이 지금 플레이어를 **보고 있는가**. 같은 노드이거나 위협이 실제로 걸어갈 수 있는 통로
 * 하나 건너면 관측이다. 이것은 위협 쪽의 시야이며, 플레이어가 대기 중 주변을 관측하지 못하는
 * 규칙(대기 관측 차단)과는 별개의 방향이다 — 내가 못 본다고 해서 상대도 못 보는 것이 아니다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {boolean}
 */
function threatObservesPlayer(state, threat) {
  const playerNodeId = state.playerNodeId;
  if (!playerNodeId) return false;
  if (threat.nodeId === playerNodeId) return true;
  return edgesForThreatMovement(state).some(
    (e) => (e.from === threat.nodeId && e.to === playerNodeId) || (e.to === threat.nodeId && e.from === playerNodeId),
  );
}

/**
 * ADR-0079 위협 경계 감쇠. 마커 하나가 플레이어를 시야에서 잃은 뒤 추적 → 조사 → 순찰로
 * 내려온다. 관측하면 타이머가 리셋되고 추적이면 마지막 확인 위치도 갱신된다.
 *
 * 구역 경계도는 여기서 내려가지 않는다(ADR-0073) — 내려가는 것은 마커의 `alert`뿐이고,
 * 그것도 구역 경계도가 만든 하한 아래로는 못 간다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @param {number} tickTime
 * @returns {import('./types.js').ThreatRuntimeState}
 */
function applyAlertDecay(state, threat, tickTime) {
  if (threat.mode !== 'pursuit' && threat.mode !== 'investigate') return threat;
  if (threatObservesPlayer(state, threat)) {
    const refreshed = { ...threat, lastObservedPlayerAt: tickTime };
    return threat.mode === 'pursuit'
      ? { ...refreshed, lastKnownPlayerNodeId: state.playerNodeId }
      : refreshed;
  }
  // 소음을 조사하러 가는 중인 마커는 플레이어를 본 적이 없다 — 감쇠 대상이 아니다.
  const since = threat.lastObservedPlayerAt;
  if (since === null || since === undefined) return threat;
  const elapsed = tickTime - since;
  const minAlert = sectorMinAlert(state, threat.sectorId);
  if (threat.mode === 'pursuit' && elapsed >= PURSUIT_DECAY_TICKS) {
    return {
      ...threat,
      mode: 'investigate',
      alert: /** @type {0|1|2|3} */ (Math.max(minAlert, PURSUIT_DECAY_ALERT)),
      pursuitStrength: 0,
      lastKnownPlayerNodeId: null,
      target: null,
    };
  }
  if (threat.mode === 'investigate' && elapsed >= PURSUIT_DECAY_TICKS + INVESTIGATE_DECAY_TICKS) {
    return { ...threat, mode: 'patrol', alert: minAlert, lastObservedPlayerAt: null, target: null };
  }
  return threat;
}

/**
 * 위협 패널이 쓰는 예고: 이 마커가 몇 칸 뒤에 어느 모드로 내려가는가. 감쇠 대상이 아니면 null.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @returns {{nextMode: 'investigate'|'patrol', ticksLeft: number}|null}
 */
export function describeThreatDecay(state, threat) {
  if (threat.mode !== 'pursuit' && threat.mode !== 'investigate') return null;
  const since = threat.lastObservedPlayerAt;
  if (since === null || since === undefined) return null;
  if (threatObservesPlayer(state, threat)) return null;
  const elapsed = state.time - since;
  if (threat.mode === 'pursuit') {
    return { nextMode: 'investigate', ticksLeft: Math.max(0, PURSUIT_DECAY_TICKS - elapsed) };
  }
  return { nextMode: 'patrol', ticksLeft: Math.max(0, PURSUIT_DECAY_TICKS + INVESTIGATE_DECAY_TICKS - elapsed) };
}

/**
 * §5.2 step 2-3 for one threat: pick a target, and — only if `nextMoveAt` is due — take one step
 * toward it, rescheduling the next move per its mode/sector-alert interval. 바뀐 상태를 통째로
 * 돌려주므로(threat만 따로) 호출부가 rngState·경계도·시체·흔적 같은 부수효과를 한꺼번에
 * 이어받는다 — 부수효과가 늘 때마다 반환 튜플을 넓히지 않아도 된다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @param {number} tickTime
 * @returns {{threat: import('./types.js').ThreatRuntimeState, state: import('./types.js').FacilityRunState}}
 */
function updateThreat(state, threat, tickTime) {
  const decayed = applyAlertDecay(state, threat, tickTime);
  const target = selectThreatTarget(state, decayed);
  /** @type {import('./types.js').ThreatRuntimeState} */
  let next = { ...decayed, target };

  // Mode follows the target kind (exit signals hold the marker at "exit_guard" once arrived;
  // that transition happens in resolveArrival, not here).
  if (target.kind === 'player') next.mode = 'pursuit';
  else if (target.kind === 'exitSignal' && next.mode !== 'exit_guard') next.mode = 'alert';
  else if (target.kind === 'noise' || target.kind === 'falseTarget') {
    if (next.mode !== 'exit_guard' && next.mode !== 'pursuit') next.mode = 'investigate';
  } else if (target.kind === 'patrol' && next.mode !== 'exit_guard') {
    next.mode = next.alert > 0 ? next.mode : 'patrol';
  }
  next.alert = /** @type {0|1|2|3} */ (Math.max(sectorMinAlert(state, next.sectorId), next.alert));

  // 상태가 바뀌어 더 빨라졌으면 예약을 당긴다(min 규칙). 느려졌으면 이미 잡아둔 한 번은 그대로
  // 두고 그 다음부터 새 간격을 쓴다. 간격은 항상 1칸 이상이라 상태 변경만으로 지금 당장 한 번
  // 더 움직이는 일은 생기지 않는다.
  next.nextMoveAt = Math.min(next.nextMoveAt, tickTime + resolveMoveInterval(state, next));

  if (tickTime < next.nextMoveAt) return { threat: next, state };

  const stepped = stepToward(edgesForThreatMovement(state), next.nodeId, target.nodeId, state.rngState);
  next.nodeId = stepped.nodeId;

  const interval = resolveMoveInterval(state, next);
  next.nextMoveAt = tickTime + interval;

  let nextState = { ...state, rngState: stepped.rngState };
  // 발견은 도착이 아니라 이동 직후에 판정한다 — 도착 판정은 목표에 닿았을 때만 돌아서,
  // 순찰 중 지나가다 시체·흔적을 밟는 경우를 놓친다(D13).
  // 발견은 **밟은 노드가 속한 구역**에 보고한다. 위협의 본적(threat.sectorId)을 쓰면 옆 구역에서
  // 주운 시체가 자기 구역 경계도를 올리고, 정작 시체가 있던 구역에는 이중계산 방지 등록이 안 돼
  // 조사하러 온 그 구역 위협이 허탕치며 또 올린다 — 시체 하나가 두 구역을 올린다(ADR-0073 위반).
  nextState = discoverAtNode(nextState, next.nodeId, sectorOfNode(next.nodeId));

  if (next.nodeId === target.nodeId) {
    const resolved = resolveArrival(nextState, next, target);
    next = resolved.threat;
    nextState = resolved.state;
  }

  return { threat: next, state: nextState };
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 */
function resolveMoveInterval(state, threat) {
  const alertLevel = state.sectorAlerts[threat.sectorId].level;
  // 봉쇄(D22) — 계약 목표를 확보한 뒤로는 전 구역 위협이 더 빨리 움직인다. 배율이 아니라
  // 고정표다(ADR-0075): 0.6을 곱하면 자투리 칸이 생겨 "몇 칸 뒤에 움직이나"를 셀 수 없다.
  let interval = (state.lockdown ? LOCKDOWN_THREAT_MOVE_INTERVAL : THREAT_MOVE_INTERVAL)[threat.mode];
  // 경계도 2 이상인 구역은 모드를 가리지 않고 빨라진다. 봉쇄와 겹치면 둘 중 작은 값이 이긴다 —
  // 두 가속이 서로를 되돌리면 "깨어난 구역"과 "봉쇄"가 합쳐질 때 오히려 느려지는 자리가 생긴다.
  if (alertLevel >= SECTOR_ALERT_FAST_MOVE_LEVEL) {
    interval = Math.min(interval, SECTOR_ALERT_MOVE_INTERVAL[threat.mode]);
  }
  return interval;
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @param {import('./types.js').ThreatTarget} target
 * @returns {{threat: import('./types.js').ThreatRuntimeState, state: import('./types.js').FacilityRunState}}
 */
function resolveArrival(state, threat, target) {
  if (target.kind === 'patrol') {
    return { threat: { ...threat, patrolIndex: (threat.patrolIndex + 1) % threat.patrolRoute.length }, state };
  }
  if (target.kind === 'exitSignal') {
    return { threat: { ...threat, mode: 'exit_guard' }, state };
  }
  if (target.kind === 'noise' || target.kind === 'falseTarget') {
    // Arrived at the source but the player isn't actually there (a real sighting would have
    // short-circuited to reportSighting/pursuit before this runs) -> §7.4 escalate once.
    // 허탕도 그 자리가 속한 구역에 보고한다 — 소음을 심을 때 처리 완료 목록에 등록하는 구역과
    // 같아야 이중계산 방지가 실제로 걸린다.
    const sectorAlerts = state.playerNodeId !== threat.nodeId
      ? escalateSectorAlert(state, sectorOfNode(threat.nodeId), target.eventId, ALERT_PRESSURE.failedInvestigation)
      : state.sectorAlerts;
    return {
      threat: {
        ...threat,
        mode: 'patrol',
        investigationMemory: { eventId: target.eventId, nodeId: target.nodeId, expiresAt: state.time + INVESTIGATION_MEMORY_DURATION },
      },
      state: { ...state, sectorAlerts },
    };
  }
  if (target.kind === 'player') {
    // §7.3 추적 강도: arrived at the last known position without a fresh sighting -> strength
    // decays; at 0 the marker gives up and returns to patrol.
    // 여기 서서 플레이어를 실제로 보고 있다면 그것은 "허탕"이 아니다 — 강도를 깎지 않는다
    // (ADR-0079). 그러지 않으면 눈앞에 서 있는데도 세 칸 만에 추적이 풀린다.
    if (threatObservesPlayer(state, threat)) return { threat, state };
    const nextStrength = /** @type {0|1|2|3} */ (Math.max(0, threat.pursuitStrength - 1));
    const threatOut = nextStrength === 0
      ? { ...threat, mode: /** @type {const} */ ('patrol'), pursuitStrength: /** @type {const} */ (0), lastKnownPlayerNodeId: null }
      : { ...threat, pursuitStrength: nextStrength };
    return { threat: threatOut, state };
  }
  return { threat, state };
}

/**
 * §5.2: threat target selection + due movement + player-collision check for every threat, once.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} tickTime
 */
function worldTick(state, tickTime) {
  /** @type {Record<string, import('./types.js').ThreatRuntimeState>} */
  const nextThreats = {};
  // Each threat sees the previous threats' already-updated state (sectorAlerts/rngState threaded
  // through workingState) but not their moves within this same tick — §5.2 doesn't require
  // ordering between markers, only that each picks a target and moves at most once per tick.
  // 경계도 3단계의 추적자는 위협 이동보다 **먼저** 정리한다 — 스폰된 추적자는 그 칸에 바로
  // 한 번 판정을 받고, 무력화된 추적자는 그 칸에 더 걷지 않는다(ADR-0092).
  let workingState = syncHunters(state, tickTime);
  for (const threat of Object.values(workingState.threats)) {
    // 교전 중인 위협은 맵에서 멈춘다(planned §8) — 전투의 3칸 동안 외부 위협만 진행한다.
    if (state.engagedThreatId === threat.id) {
      nextThreats[threat.id] = threat;
      continue;
    }
    if (isHunter(threat)) {
      const { threat: hunted, state: afterHunter } = updateHunter(workingState, threat, tickTime);
      nextThreats[threat.id] = hunted;
      workingState = { ...afterHunter, threats: { ...afterHunter.threats, [threat.id]: hunted } };
      continue;
    }
    const { threat: updated, state: afterThreat } = updateThreat(workingState, threat, tickTime);
    nextThreats[threat.id] = updated;
    workingState = { ...afterThreat, threats: { ...afterThreat.threats, [threat.id]: updated } };
  }

  // 증원(D14)은 위협 이동이 끝난 뒤에 판정한다 — 이번 틱에 발견된 시체·흔적이 올린 경계도가
  // 곧바로 다음 교대를 당길 수 있어야 "내 행동의 직접 결과"라는 성격이 유지된다.
  workingState = tickReinforcements({ ...workingState, threats: nextThreats }, tickTime);

  let combatTrigger = state.combatTrigger;
  if (state.playerNodeId) {
    const collisions = Object.values(workingState.threats)
      .filter((t) => t.nodeId === state.playerNodeId && t.id !== state.engagedThreatId);
    // 진행 중인 작업이 이미 무시하기로 한 위협(작업을 시작할 때 같은 노드에 서 있던 것)보다
    // **새로** 도착한 위협을 먼저 고른다. 순서에 따라 무시 대상이 먼저 뽑히면 새 접촉이
    // 통째로 묻혀 작업이 중단되지 않는다.
    const ignored = workingState.pendingTask ? workingState.pendingTask.ignoredThreatIds : [];
    const collided = collisions.find((t) => !ignored.includes(t.id)) || collisions[0];
    if (collided) combatTrigger = { threatId: collided.id, nodeId: collided.nodeId };
  }

  return refreshActiveRecon({ ...workingState, time: tickTime, combatTrigger });
}

/**
 * 1칸 경계의 2단계 — 영구 폐쇄와 기존 효과 만료. 효과는 완료 시각 C부터 `[C, C+D)` 동안
 * 유효하므로 만료 시각 t에 도달한 것은 이 칸에서 이미 없는 것으로 친다(만료되는 장벽이 이 칸의
 * 적 이동을 막지 못하는 것도 이 순서 때문이다 — 적 이동은 4단계다).
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} t
 * @returns {import('./types.js').FacilityRunState}
 */
function applyExpiryBoundary(state, t) {
  let exits = state.exits;
  for (const exitId of /** @type {const} */ (['A'])) {
    let exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (exits[exitId]);
    if (exit.status === 'open' && exit.openEndsAt !== null && t >= exit.openEndsAt) {
      exit = {
        ...exit, status: 'closed', signalStartedAt: null, requestId: null, interactionEndsAt: null, opensAt: null, openEndsAt: null,
      };
    }
    // ADR-0054: 영구 폐쇄 시각 뒤에는 새 요청만 막는다. 이미 시작된 카운트다운과 열린 개방 창은
    // 끝까지 진행되고, 창이 닫히는 순간 폐쇄 시각을 넘겼으면 그때 영구 폐쇄가 된다.
    if (exit.status === 'closed' && t >= exit.disabledAt) {
      exit = { ...exit, status: 'disabled' };
    }
    exits = { ...exits, [exitId]: exit };
  }

  const noiseEvents = state.noiseEvents.filter((e) => e.expiresAt > t);
  const falseTargets = state.falseTargets.filter((e) => e.expiresAt > t);
  const activeBarriers = state.activeBarriers.filter((b) => b.expiresAt > t);
  const hackedCameras = state.hackedCameras.filter((camera) => camera.expiresAt > t);
  // 만료된 전원 차단도 함께 걷어낸다 — 남겨두면 escalateSectorAlert가 매 경계 상승마다
  // 런 내내 쌓인 목록을 전부 훑는다.
  const powerCuts = state.powerCuts.filter((cut) => cut.expiresAt > t);
  const activeRecon = state.activeRecon?.expiresAt != null && state.activeRecon.expiresAt <= t
    ? null
    : state.activeRecon;

  return {
    ...state, time: t, exits, noiseEvents, falseTargets, activeBarriers, hackedCameras, powerCuts, activeRecon,
  };
}

// ---- 현장 작업: 예약 → 칸별 진행 → 완료 적용 (planned §9) ----

/**
 * 작업 종류별 **완료 적용**. 시작 시점에는 아무 효과도 없다 — 명시한 시작 효과(이동 소음,
 * 탈출 요청 신호)만 각자의 자리에서 즉시 발생한다. 여기 들어오는 순간이 곧 완료 시각 C이고,
 * 모든 새 효과와 쿨다운이 C부터 `[C, C+D)` 동안 유효하다.
 *
 * 표로 두는 이유: 행동이 늘 때마다 예약/중단/완료의 뼈대를 각자 다시 쓰면 어느 하나에서
 * "시작 때 효과를 먼저 주는" 예외가 되살아난다. 뼈대는 scheduleTask 하나뿐이고, 종류마다
 * 다른 것은 이 표의 한 줄뿐이어야 한다.
 * @type {Record<string, (state: import('./types.js').FacilityRunState, task: import('./types.js').PendingTask) => import('./types.js').FacilityRunState>}
 */
const TASK_COMPLETIONS = {
  // 기본 정찰 — **완료 시점**의 상태를 관측한다. 시작 때의 적 위치를 완료 정보로 위장하지 않는다.
  recon(state, task) {
    // 사거리와 깊이는 Perception이 정한다(PERCEPTION_INFO_TABLE): −1 이하 1홉, 0~2는 2홉,
    // 3 이상은 3홉. 표준 2홉이 무료 인접 관측(1홉)보다 한 홉 더 보는 것이 4칸을 쓰는 이유다.
    // 소리와 마찬가지로 "보는 거리"는 잠긴 통로에 막히지 않으므로 전체 그래프로 잰다.
    const info = perceptionInfo(task.params?.perception ?? 0);
    const hops = bfsHopDistances(state.graph.edges, task.nodeId);
    const targets = new Set([task.nodeId]);
    for (const [nodeId, hop] of hops) {
      if (hop <= info.reconHops) targets.add(nodeId);
    }
    return {
      ...state,
      activeRecon: {
        source: 'basic', sourceNodeId: task.nodeId, targetNodeIds: [...targets], expiresAt: null, detailLevel: info.level,
      },
    };
  },
  concealment(state, task) {
    return { ...state, activeConcealment: { nodeId: task.nodeId, bonus: task.params.bonus } };
  },
  openEdge(state, task) {
    const { edgeId, evidenceTier } = task.params;
    let next = state.openedEdgeIds.includes(edgeId) ? state : { ...state, openedEdgeIds: [...state.openedEdgeIds, edgeId] };
    if (evidenceTier) {
      next = { ...next, evidence: [...next.evidence, { id: idForNewEntry(next, next.evidence, 'evidence'), nodeId: task.nodeId, tier: evidenceTier, createdBySectorId: sectorOfNode(task.nodeId) }] };
    }
    return next;
  },
  // 인터페이스 장악이 주는 것은 그 구역 카메라의 **원격 접속**뿐이다. 예전에는 Hacking에 따른
  // 홉수 안의 카메라 위치도 함께 드러냈지만, 카메라 위치는 이제 런 시작부터 지도에 보이므로
  // (ADR-0090) 그 보상은 아무것도 드러내지 않는 빈 규칙이 됐다.
  hackInterface(state, task) {
    const ids = state.hackedInterfaceIds || [];
    return ids.includes(task.params.interfaceId) ? state : { ...state, hackedInterfaceIds: [...ids, task.params.interfaceId] };
  },
  hackCamera(state, task) {
    const { cameraId, cameraNodeId, duration } = task.params;
    const expiresAt = state.time + duration;
    const targetNodeIds = new Set([cameraNodeId]);
    for (const edge of state.graph.edges) {
      if (edge.from === cameraNodeId) targetNodeIds.add(edge.to);
      if (edge.to === cameraNodeId) targetNodeIds.add(edge.from);
    }
    return {
      ...state,
      hackedCameras: [...state.hackedCameras.filter((entry) => entry.cameraId !== cameraId), { cameraId, expiresAt }],
      activeRecon: { source: 'camera', sourceNodeId: cameraNodeId, targetNodeIds: [...targetNodeIds], expiresAt },
    };
  },
  destroyCamera(state, task) {
    const ids = state.disabledCameraIds || [];
    return ids.includes(task.params.cameraId) ? state : { ...state, disabledCameraIds: [...ids, task.params.cameraId] };
  },
  disableGenerator(state, task) {
    const id = task.params.generatorId;
    return state.disabledGeneratorIds.includes(id) ? state : { ...state, disabledGeneratorIds: [...state.disabledGeneratorIds, id] };
  },
  controlRoom(state, task) {
    const sectorId = /** @type {import('./types.js').FacilitySectorId} */ (task.params.sectorId);
    const level = /** @type {number} */ (task.params.level);
    let next = state.revealedPatrolRouteSectorIds.includes(sectorId)
      ? state
      : { ...state, revealedPatrolRouteSectorIds: [...state.revealedPatrolRouteSectorIds, sectorId] };
    // 단계를 낮추는 수습은 그 구역의 압력 게이지도 0으로 지운다(ADR-0082). 반쯤 찬 게이지를
    // 남겨두면 장악한 구역이 다음 작은 사건 하나에 곧바로 다시 올라, 수습한 값이 사라진다.
    if (level >= 2) {
      const current = next.sectorAlerts[sectorId];
      next = { ...next, sectorAlerts: { ...next.sectorAlerts, [sectorId]: { ...current, level: /** @type {0|1|2|3} */ (Math.max(0, current.level - (level - 1))), pressure: 0 } } };
    }
    if (level >= 3) {
      let sectorAlerts = next.sectorAlerts;
      for (const neighborId of adjacentSectorIds(next.graph, sectorId)) {
        const neighbor = sectorAlerts[neighborId];
        sectorAlerts = { ...sectorAlerts, [neighborId]: { ...neighbor, level: /** @type {0|1|2|3} */ (Math.max(0, neighbor.level - 1)), pressure: 0 } };
      }
      next = { ...next, sectorAlerts };
    }
    return next;
  },
  corpse(state, task) {
    return { ...state, corpses: state.corpses.filter((c) => c.id !== task.params.corpseId) };
  },
  contract(state, task) {
    const { nextStatus, completes, lockdown } = task.params;
    const contract = state.contract;
    if (!contract) return state;
    /** @type {import('./types.js').FacilityRunState} */
    let next = {
      ...state,
      contract: {
        ...contract,
        status: nextStatus,
        acquiredAt: nextStatus === 'acquired' || (completes && contract.acquiredAt === null) ? state.time : contract.acquiredAt,
        completedAt: completes ? state.time : contract.completedAt,
      },
    };
    if (lockdown) next = activateLockdown(next);
    return next;
  },
  farm(state, task) {
    const { opportunityId, isPrize, tier, axis, keyEligible } = task.params;
    const graph = {
      ...state.graph,
      opportunities: state.graph.opportunities.map((o) => (o.id === opportunityId ? { ...o, usesRemaining: Math.max(0, o.usesRemaining - 1) } : o)),
    };
    let next = { ...state, graph, keyDiscovered: state.keyDiscovered || keyEligible };
    if (isPrize) {
      const rolled = rollFieldLootOptions(axis, tier, next.rngState);
      next = { ...next, rngState: rolled.rngState, pendingFarmChoice: { opportunityId, tier, axis, options: rolled.options } };
    }
    return { ...next, lastActionResult: { kind: 'farm', nodeId: task.nodeId, opportunityId, status: 'completed', completedAt: next.time } };
  },
  cleanTraces(state, task) {
    return { ...state, evidence: state.evidence.filter((e) => e.nodeId !== task.nodeId) };
  },
  cutPower(state, task) {
    const { sectorId, duration } = task.params;
    return { ...state, powerCuts: [...state.powerCuts, { sectorId, expiresAt: state.time + duration }] };
  },
  // 가짜 소음(D) — 진짜 소음 사건과 같은 파이프라인을 그대로 탄다. 위협은 둘을 구별하지 못하고,
  // 허탕치면 그 자리에서 구역 경계도가 오르는 것도 같다. 다른 것은 "내가 그 자리에 없다"뿐이다.
  fakeNoise(state, task) {
    const targetNodeId = /** @type {string} */ (task.params.targetNodeId);
    const intensity = /** @type {1|2|3} */ (task.params.intensity);
    return reportNoise(state, targetNodeId, intensity);
  },
  falseBroadcast(state, task) {
    const sectorId = /** @type {import('./types.js').FacilitySectorId} */ (task.params.sectorId);
    const targetSectorId = /** @type {import('./types.js').FacilitySectorId} */ (task.params.targetSectorId);
    const decoyNodeId = /** @type {string|null} */ (task.params.decoyNodeId);
    const intensity = /** @type {1|2|3} */ (task.params.intensity);
    const duration = /** @type {number} */ (task.params.duration);
    const current = state.sectorAlerts[sectorId];
    const target = state.sectorAlerts[targetSectorId];
    // 예약 때 확인한 두 조건(이 구역에 옮길 경계도가 있다 / 대상 구역이 아직 3이 아니다)을
    // **완료 시각에 다시** 본다. 작업이 걸린 칸들 동안 경계도는 계속 움직이므로, 예약 때의
    // 판정을 그대로 믿고 적용하면 −1이 0에서 잘리거나 +1이 3에서 잘려 총량이 줄어든다
    // (ADR-0073). 성립하지 않으면 경계도 이동만 건너뛴다 — 미끼는 그래도 심는다. 미끼는
    // 시선을 옮길 뿐 총량을 바꾸지 않기 때문이다.
    const movable = current.level > 0 && target.level < 3;
    let next = movable
      ? {
        ...state,
        sectorAlerts: {
          ...state.sectorAlerts,
          // 옮기는 단위는 **단계**다(ADR-0073 총량 보존은 단계 단위로 성립한다). 이쪽은
          // 단계를 내주면서 반쯤 찬 게이지도 지워지고, 받는 쪽 게이지는 건드리지 않는다.
          [sectorId]: { ...current, level: /** @type {0|1|2|3} */ (current.level - 1), pressure: 0 },
          [targetSectorId]: { ...target, level: /** @type {0|1|2|3} */ (target.level + 1) },
        },
      }
      : state;
    if (!decoyNodeId) return next;
    next = reportFalseTarget(next, decoyNodeId, intensity, duration, next.time);
    // 심은 미끼는 위에서 경계도 한 칸으로 이미 값을 치렀다 — 나중에 허탕쳐도 또 올리면
    // "옮긴다"가 아니라 "만든다"가 된다(ADR-0073).
    const planted = next.falseTargets[next.falseTargets.length - 1];
    const targetAlert = next.sectorAlerts[targetSectorId];
    return {
      ...next,
      sectorAlerts: {
        ...next.sectorAlerts,
        [targetSectorId]: { ...targetAlert, resolvedEventIds: [...targetAlert.resolvedEventIds, planted.id] },
      },
    };
  },
  fieldEquipment(state, task) {
    const { instanceId, kind, range, duration, cooldown, targetId } = task.params;
    let next = state;
    if (kind === 'snapshot_scan') {
      const hops = bfsHopDistances(state.graph.edges, task.nodeId);
      const threatNodes = new Set(Object.values(state.threats).map((t) => t.nodeId));
      let observations = { ...next.observations };
      for (const node of state.graph.nodes) {
        const h = hops.get(node.id);
        // 스캔은 "지금 그 자리에 위협이 있는가"만 새로 안다. 정찰이 적어둔 은엄폐·확보 대상
        // 등급까지 지우면 안 되므로 병합한다(리뷰 A6).
        // 값을 치른 관측이므로 내용물도 적는다 — 내용물 없이 남는 관측은 공짜 인접 시야뿐이다.
        if (h !== undefined && h <= range) {
          observations = mergeObservation(observations, node.id, {
            observedAt: state.time, hasThreat: threatNodes.has(node.id), contents: nodeContentsAt(state, node.id),
          });
        }
      }
      next = { ...next, observations };
    } else if (kind === 'remote_intrusion') {
      next = reportFalseTarget(next, targetId, 2, duration ?? 200, next.time);
    } else if (kind === 'temporary_barrier') {
      next = { ...next, activeBarriers: [...next.activeBarriers, { edgeId: targetId, expiresAt: state.time + (duration ?? 0) }] };
    } else if (kind === 'camera_snipe') {
      // 파괴는 영구적이다 — Force 파괴(destroyCamera)와 같은 목록에 넣는다.
      const cameraId = /** @type {string} */ (task.params.cameraId);
      const cameraNodeId = /** @type {string} */ (task.params.cameraNodeId);
      const ids = next.disabledCameraIds || [];
      if (!ids.includes(cameraId)) next = { ...next, disabledCameraIds: [...ids, cameraId] };
      // 파편은 **카메라 자리**에 남는다(강한 흔적). 총성은 쏜 자리에서 나므로(task.cost.noise,
      // applyTaskCost가 task.nodeId에 낸다) 소음과 흔적이 서로 다른 노드를 가리킨다 — 그것이
      // 이 행동의 값이다: 조사하러 오는 곳과 증거가 있는 곳이 갈린다.
      next = {
        ...next,
        evidence: [...next.evidence, {
          id: idForNewEntry(next, next.evidence, 'evidence'),
          nodeId: cameraNodeId,
          tier: /** @type {2} */ (2),
          createdBySectorId: sectorOfNode(cameraNodeId),
        }],
      };
      // 탄약은 커맨드 래퍼가 playerState.inventory에서 정산한다(HP·내구도와 같은 청구서 경로).
      next = { ...next, pendingAmmoSpend: (next.pendingAmmoSpend || 0) + CAMERA_SNIPE_AMMO_COST };
    }
    return { ...next, fieldCooldowns: { ...next.fieldCooldowns, [instanceId]: state.time + cooldown } };
  },
  // 조우 회피 — 1칸을 쓰고 그 위협의 추적을 끊는다(planned §4).
  evade(state, task) {
    const threat = state.threats[task.params.threatId];
    if (!threat) return state;
    return {
      ...state,
      threats: { ...state.threats, [task.params.threatId]: { ...threat, mode: 'patrol', alert: 0, pursuitStrength: 0, lastKnownPlayerNodeId: null, lastObservedPlayerAt: null, target: null } },
    };
  },
  // 시설 상태에 남길 것이 없는 작업들 — 시간만 흐르고, 결과는 호출부가 lastTaskOutcome으로 읽는다.
  exitActivate(state) { return state; },
  equipSwap(state) { return state; },
  mapConsumable(state) { return state; },
  wait(state) { return state; },
};

/**
 * 중단 시 예약 자원을 되돌리고, 중단됐다는 사실을 화면이 읽을 자리에 적는다. 대부분의 작업은
 * 완료 전에 아무것도 바꾸지 않아 되돌릴 것이 없다 — 시작 효과를 낸 탈출구 가동과, 자기 배너를
 * 갖는 파밍만 예외다.
 * @type {Record<string, (state: import('./types.js').FacilityRunState, task: import('./types.js').PendingTask, reason: string) => import('./types.js').FacilityRunState>}
 */
const TASK_ABORTS = {
  // 파밍은 자기 배너를 갖는다(lastActionResult). 붕괴로 끊긴 것을 "매복"이라 적으면 화면이
  // 없는 적을 말하게 되므로, 적 접촉일 때만 매복으로 적는다.
  farm(state, task, reason) {
    if (reason !== 'threatContact') return state;
    /** @type {import('./types.js').FacilityRunState} */
    const next = {
      ...state,
      lastActionResult: {
        kind: /** @type {const} */ ('farm'),
        nodeId: /** @type {string} */ (task.nodeId),
        opportunityId: task.params.opportunityId,
        status: /** @type {const} */ ('ambushed'),
        completedAt: state.time,
      },
    };
    return next;
  },
  exitActivate(state, task) {
    const exitId = /** @type {'A'} */ (task.params.exitId);
    const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
    if (!exit || exit.status !== 'requesting') return state;
    return {
      ...state,
      exits: {
        ...state.exits,
        [exitId]: { ...exit, status: 'closed', interactionEndsAt: null, opensAt: null, requestId: null, signalStartedAt: null },
      },
    };
  },
};

/**
 * Capability 층계가 남긴 대가 중 **시간이 아닌** 것을 완료 시각에 한꺼번에 적용한다.
 * HP와 장비 내구도는 facilityRunState 바깥이라 청구서로 쌓아두고 facilityReducer가 정산한다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {Partial<import('./capabilityCosts.js').CapabilityCost>|null} cost
 * @param {string|null} nodeId
 */
function applyTaskCost(state, cost, nodeId) {
  if (!cost) return state;
  let next = state;
  if (cost.hpCost) next = { ...next, pendingHpLoss: (next.pendingHpLoss || 0) + cost.hpCost };
  if (cost.durabilityLoss) next = { ...next, pendingDurabilityLoss: (next.pendingDurabilityLoss || 0) + cost.durabilityLoss };
  if (nodeId) {
    const sectorId = sectorOfNode(nodeId);
    if (cost.leavesStrongTrace) {
      next = { ...next, evidence: [...next.evidence, { id: idForNewEntry(next, next.evidence, 'evidence'), nodeId, tier: 2, createdBySectorId: sectorId }] };
    }
    if (cost.raisesAlert) {
      next = { ...next, sectorAlerts: escalateSectorAlert(next, sectorId, `botch_${nodeId}_${next.time}`, ALERT_PRESSURE.botchedAction) };
    }
    // 작업 소음은 **완료 시**에 난다. 시작 시각에 내면 작업이 NOISE_DURATION보다 길 때 자기
    // 행동 안에서 만료돼 아무도 듣지 못한다 — 시끄러운 실패가 오히려 조용해지는 뒤집힌 결과다.
    const noise = cost.noise || 0;
    if (noise > 0) next = reportNoise(next, nodeId, /** @type {1|2|3} */ (noise), next.time);
  }
  return next;
}

/** 예약한 작업을 완료 시각 t에 확정한다. @param {import('./types.js').FacilityRunState} state @param {number} t */
function completeTask(state, t) {
  const task = state.pendingTask;
  if (!task) return state;
  /** @type {import('./types.js').FacilityRunState} */
  let next = { ...state, pendingTask: null };
  const handler = TASK_COMPLETIONS[task.kind];
  // 표에 없는 종류를 "시간만 흐르고 아무 일도 없는 작업"으로 조용히 넘기면, 오타 하나가 효과
  // 없는 유료 행동이 되어 테스트까지 통과한다.
  if (!handler) throw new RuleViolation(`unknown task kind ${task.kind}`);
  next = handler(next, task);
  next = applyTaskCost(next, task.cost, task.nodeId);
  // 대기가 끝나면 관측이 끊긴 채로 남고, 다른 유료 행동이 끝나면 그 자리에서 다시 실시간이 된다.
  next = { ...next, lastWaitEndedAt: task.kind === 'wait' ? t : null };
  return {
    ...next,
    lastTaskOutcome: {
      kind: task.kind, status: /** @type {const} */ ('completed'), reason: null, startedAt: task.startedAt, completedAt: t, params: task.params,
    },
  };
}

/**
 * 작업을 중단한다 — 경과한 칸만 소모되고 미완료 효과는 하나도 적용되지 않는다. 중단 사유는
 * 적 접촉('threatContact'), 런 붕괴('collapsed'), 그리고 자리를 떠서 포기한 것('abandoned')
 * 셋이며, 호출부가 결과 문구를 가르는 데 쓰도록 `lastTaskOutcome.reason`에 남긴다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {'threatContact'|'collapsed'|'abandoned'} [reason]
 * @returns {import('./types.js').FacilityRunState}
 */
function abortTask(state, reason = 'threatContact') {
  const task = state.pendingTask;
  if (!task) return state;
  const handler = TASK_ABORTS[task.kind];
  let next = handler ? handler(state, task, reason) : state;
  if (task.kind === 'wait') next = { ...next, lastWaitEndedAt: next.time };
  return {
    ...next,
    pendingTask: null,
    lastTaskOutcome: {
      kind: task.kind,
      status: /** @type {const} */ ('interrupted'),
      reason: /** @type {'threatContact'|'collapsed'|'abandoned'} */ (reason),
      startedAt: task.startedAt,
      completedAt: next.time,
      params: task.params,
    },
  };
}

/**
 * 현장 작업 하나를 **가동**한다(ADR-0084). 가동에 드는 것은 언제나 1칸이고, 그 1칸 안에 끝나지
 * 않는 작업은 `pendingTask`로 남아 게이지가 된다 — 남은 칸은 플레이어가 그 자리에서 **대기**로
 * 채운다. 시작 칸이 게이지의 첫 칸이므로 총 경과는 예전과 같은 `timeCost`다.
 *
 * 임의 취소는 없지만 자리를 뜨면 포기가 된다(moveToAdjacentNode). 그 밖의 강제 중단 사유는 적
 * 접촉과 런 종료다. 작업을 시작한 순간 같은 노드에 이미 서 있던 위협은 새 접촉이 아니므로
 * (그 조우는 이미 열려 있고, 열세의 행동권 1회가 바로 이 작업이다) 중단시키지 않는다.
 *
 * @param {import('./types.js').FacilityRunState} state
 * @param {{kind: string, timeCost: number, nodeId?: string|null, cost?: object|null, params?: object|null}} task
 * @returns {import('./types.js').FacilityRunState}
 */
export function scheduleTask(state, task) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  // 한 번에 하나다 — 진행 중인 게이지를 둔 채 다른 작업을 걸면 "어느 것이 끝나는가"를 시간으로
  // 읽을 수 없게 된다. 끝내거나(대기) 떠나거나(포기) 둘 중 하나를 먼저 해야 한다.
  if (state.pendingTask) throw new RuleViolation(`a task is already in progress (${state.pendingTask.kind})`);
  // 완료 적용이 게이지 끝으로 미뤄지면서(ADR-0084), 오타 난 종류는 예약 시점이 아니라 몇 칸 뒤에야
  // 드러난다 — 그때는 이미 시간을 쓴 뒤다. 그래서 가동하는 자리에서 먼저 막는다.
  if (!TASK_COMPLETIONS[task.kind]) throw new RuleViolation(`unknown task kind ${task.kind}`);
  const timeCost = Math.max(0, task.timeCost || 0);
  const nodeId = task.nodeId === undefined ? state.playerNodeId : task.nodeId;
  const ignoredThreatIds = state.playerNodeId
    ? Object.values(state.threats).filter((t) => t.nodeId === state.playerNodeId).map((t) => t.id)
    : [];
  const pending = {
    kind: task.kind,
    nodeId: nodeId || null,
    cost: task.cost || null,
    params: task.params || null,
    startedAt: state.time,
    completesAt: state.time + timeCost,
    ignoredThreatIds,
  };
  const reserved = { ...state, pendingTask: pending, lastTaskOutcome: null };
  // 0칸 작업은 시작과 완료가 같은 순간이다 — 진행할 칸이 없으므로 그 자리에서 확정한다.
  if (timeCost === 0) return completeTask(reserved, reserved.time);
  // 가동은 딱 1칸이다. 1칸짜리 작업은 그 칸 경계에서 바로 완료되고, 더 긴 작업은 게이지로 남는다.
  return advanceTime(reserved, state.time + 1);
}

/**
 * 진행 중인 작업을 포기한다(ADR-0084) — 자리를 뜨는 것이 유일한 경로다. 중단과 같은 처리를
 * 받는다: 효과도 쿨다운도 청구되지 않고, 시작 효과를 낸 작업만 TASK_ABORTS가 되돌린다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function abandonTask(state) {
  return state.pendingTask ? abortTask(state, 'abandoned') : state;
}

/**
 * 방금 끝난 작업이 완료됐는지(중단이 아닌지). 호출부가 들고 있는 것은 대개 nullable한
 * `snapshot.facilityRunState`라 그대로 받는다.
 * @param {import('./types.js').FacilityRunState|null|undefined} state
 * @returns {boolean}
 */
export function taskCompleted(state) {
  return state?.lastTaskOutcome?.status === 'completed';
}

/**
 * 대기 1칸(planned §4). 아무것도 회복시키지 않고 시계만 1칸 민다 — 개방·쿨다운·적 위치를
 * 기다리는 용도다. 묶음 대기는 호출부가 이 함수를 반복하며 사건이 나면 멈춘다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function waitOneTick(state) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  // 게이지가 걸려 있으면 대기는 그 게이지를 채우는 1칸이다 — 경쟁하는 'wait' 작업을 따로 걸면
  // 진행 중인 작업을 밀어내게 된다(ADR-0084).
  if (state.pendingTask) return advanceTime({ ...state, lastTaskOutcome: null }, state.time + 1);
  return scheduleTask(state, { kind: 'wait', timeCost: actionTimeCost('wait') });
}

/**
 * 조우 회피(planned §4) — 1칸을 쓰고 그 위협의 추적을 해제한다. 회피 처리 자체로 같은 위협의
 * 조우 창을 다시 열지 않는다(그러면 시간만 쓰고 제자리다). 다음 유료 행동이 끝날 때 정상적으로
 * 재판정되고, 다른 위협과 붕괴는 이 1칸 동안에도 그대로 판정된다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} threatId
 * @returns {import('./types.js').FacilityRunState}
 */
export function evadeThreat(state, threatId) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.threats[threatId]) throw new RuleViolation(`unknown threat ${threatId}`);
  const next = scheduleTask({ ...state, encounter: null }, {
    kind: 'evade', timeCost: actionTimeCost('evade'), params: { threatId },
  });
  if (next.combatTrigger?.threatId === threatId) return { ...next, combatTrigger: null };
  return next;
}

/**
 * 1칸 경계의 3단계 — 완료된 작업의 적용과 예약해 둔 개방.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} t
 * @returns {import('./types.js').FacilityRunState}
 */
function applyCompletionBoundary(state, t) {
  let current = { ...state, time: t };
  if (current.pendingTask && current.pendingTask.completesAt <= t) current = completeTask(current, t);
  let exits = current.exits;
  for (const exitId of /** @type {const} */ (['A'])) {
    let exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (exits[exitId]);
    if (exit.status === 'requesting' && exit.interactionEndsAt !== null && t >= exit.interactionEndsAt) {
      exit = { ...exit, status: 'opening' };
    }
    if (exit.status === 'opening' && exit.opensAt !== null && t >= exit.opensAt) {
      exit = { ...exit, status: 'open', openEndsAt: t + EXIT_OPEN_WINDOW };
    }
    exits = { ...exits, [exitId]: exit };
  }
  return refreshActiveRecon({ ...current, exits });
}

/**
 * 맵 시간을 `targetTime`까지 **1칸씩** 전진시킨다(ADR-0075). 모든 시간 값은 정수 칸이고, 매
 * 칸 경계에서 planned §9.3의 순서를 그대로 밟는다:
 *   1. 붕괴 → 2. 영구 폐쇄·기존 효과 만료 → 3. 완료 작업 적용·예약 개방 →
 *   4. 적 이동·증원 → 5. 조우
 * 자동 탈출은 칸 경계의 한 단계가 아니다 — 인벤토리/보상을 봐야 해서 호출부(facilityReducer)가
 * **유료 행동이 끝나는 칸에 한 번** `isAtOpenExit`으로 판정한다. 여기서는 조우(combatTrigger)만
 * 확정해 두고 넘기며, 그 칸에 탈출 조건이 성립하면 호출부가 도착 조우보다 탈출을 먼저
 * 성립시킨다. 그래서 열린 출구 위에서 여러 칸짜리 작업을 시작하면 작업 중에 개방 창이 닫힐 수
 * 있다 — 창을 기다릴 때는 1칸씩 판정되는 대기를 쓴다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} targetTime 정수 칸.
 * @returns {import('./types.js').FacilityRunState}
 */
export function advanceTime(state, targetTime) {
  let current = state;
  while (current.time < targetTime && current.phase === 'active') {
    const t = current.time + 1;
    // 무시 목록은 "작업을 시작할 때 이미 여기 서 있던 위협"이지 영구 면제가 아니다. 그 위협이
    // 자리를 뜨면 면제도 끝난다 — 그러지 않으면 같은 위협이 나갔다 되돌아와도 새 접촉으로
    // 치지 않아, 위협이 왕복하는 동안 긴 작업이 무한히 안전해진다. 매 칸 경계에서 현재
    // 플레이어 노드에 없는 무시 대상을 목록에서 뺀다.
    current = pruneIgnoredThreats(current);
    // 1. 붕괴는 다른 모든 사건보다 우선한다. 마감과 같은 시각 도착은 늦은 것이다.
    if (t >= RUN_COLLAPSE_TIME) {
      // 붕괴로 끝난 런에 예약만 걸린 작업을 남겨두면 호출부가 그 pendingTask를 "아직 진행 중"
      // 으로 읽는다. 여기서 중단으로 확정하고 사유를 남긴다 — 매복과 구분되어야 파밍 같은
      // 호출부가 "적에게 당했다"고 오표기하지 않는다.
      return abortTask({ ...current, time: RUN_COLLAPSE_TIME, phase: /** @type {const} */ ('collapsed') }, 'collapsed');
    }
    current = applyExpiryBoundary(current, t); // 2
    current = applyCompletionBoundary(current, t); // 3
    current = worldTick(current, t); // 4~5
    // 5단계에서 새 적 접촉이 확정되면 진행 중인 작업은 거기서 끝난다 — 경과한 칸만 소모하고
    // 미완료 보상·개방·효과·쿨다운·대가는 하나도 적용하지 않는다(planned §9.4).
    // 중단 판정은 **집합**으로 한다. 플레이어 노드의 위협에서 이 작업이 무시하기로 한 것을 뺀
    // 나머지가 하나라도 있으면 새 접촉이다 — 대표로 뽑힌 하나가 무시 대상인지로 묻지 않는다.
    if (current.pendingTask && current.playerNodeId) {
      const ignored = current.pendingTask.ignoredThreatIds;
      const arrived = Object.values(current.threats)
        .some((t) => t.nodeId === current.playerNodeId && t.id !== current.engagedThreatId && !ignored.includes(t.id));
      if (arrived) return abortTask(current, 'threatContact');
    }
  }
  return current;
}

/**
 * 진행 중인 작업의 무시 목록에서 더 이상 플레이어 노드에 없는 위협을 뺀다(advanceTime의 칸
 * 경계 전용). 목록이 그대로면 같은 객체를 돌려주어 불필요한 복사를 만들지 않는다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
function pruneIgnoredThreats(state) {
  const pending = state.pendingTask;
  if (!pending || pending.ignoredThreatIds.length === 0 || !state.playerNodeId) return state;
  const stillHere = pending.ignoredThreatIds.filter((id) => state.threats[id]?.nodeId === state.playerNodeId);
  if (stillHere.length === pending.ignoredThreatIds.length) return state;
  return { ...state, pendingTask: { ...pending, ignoredThreatIds: stillHere } };
}

/**
 * Whether `edge` can currently be walked from `fromId` to its other end: 'oneWay' special edges
 * only go the direction they were generated in (§4.2's vents/drop shafts), and 'blocked' special
 * edges (locked doors/barricades) need `openBlockedEdge` first unless already in
 * `state.openedEdgeIds`. Plain corridors and 'electronic'-only edges (cameras/checkpoints don't
 * physically stop you, just watch) are always walkable.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').FacilityEdge} edge
 * @param {string} fromId
 */
function isEdgeTraversable(state, edge, fromId, effectiveMobility = 0) {
  if (edge.features.includes('oneWay') && edge.from !== fromId) return false;
  if (!isEdgeUnlocked(edge, state.openedEdgeIds)) return false;
  // 고지대도 다른 요구치와 같은 층계다(D8) — 모자란 채로 넘을 수 있고 대신 HP를 치른다.
  // 정말 막히는 것은 불가 단계(요구치 3에 대해 0 이하)뿐이다.
  if (edge.features.includes('highGround') && !canClimbHighGround(effectiveMobility)) return false;
  return true;
}

/**
 * 그 Mobility로 고지대를 넘을 수 있는가. 층계의 불가 구간(요구치 3에 대해 유효 0 이하)만
 * 막는다 — 엔진의 통행 판정과 화면·측정 도구가 같은 한 함수를 보게 하려는 것이다.
 * @param {number} effectiveMobility 원시 실효 Mobility(-2~4). 지형 하한은 안에서 적용한다.
 * @returns {boolean}
 */
export function canClimbHighGround(effectiveMobility) {
  return capabilityStep(highGroundMobility(effectiveMobility), HIGH_GROUND_MOBILITY_REQUIREMENT) !== 'impossible';
}

/**
 * 고지대 층계 판정에 쓰는 실효 Mobility. 지형 판정은 구현 명세 §3.2의 0 하한을 그대로 쓰므로
 * Capability 하한(-2)까지 내려간 빌드도 0과 같은 취급을 받는다 — 어느 쪽이든 요구치 3에서는
 * 불가지만, 화면이 적는 "현재 값"과 엔진의 판정값이 갈라지지 않도록 한 곳에서만 자른다.
 * @param {number} effectiveMobility
 * @returns {number}
 */
export function highGroundMobility(effectiveMobility) {
  return effectiveForRequirement(effectiveMobility);
}

/** Public UI/test predicate for an edge from the player's current node. */
export function canTraverseEdge(state, edge, effectiveMobility = 0) {
  return !!state.playerNodeId
    && (edge.from === state.playerNodeId || edge.to === state.playerNodeId)
    && isEdgeTraversable(state, edge, state.playerNodeId, effectiveMobility);
}

/** Public UI predicate: is this camera currently under an active (unexpired) hack? Destroyed
 * cameras are a separate state (disabledCameraIds) — callers that need "won't detect me right
 * now" should check both, as cameraIsHacked below does. */
export function isCameraHackActive(state, cameraId) {
  return state.hackedCameras.some((entry) => entry.cameraId === cameraId && entry.expiresAt > state.time);
}

function cameraIsHacked(state, cameraId) {
  return state.disabledCameraIds?.includes(cameraId) || isCameraHackActive(state, cameraId);
}

function applyCameraDetection(state, nodeId, effectiveStealth) {
  const camera = state.graph.cameras.find((entry) => entry.nodeId === nodeId && !cameraIsHacked(state, entry.id));
  if (!camera || effectiveStealth >= CAMERA_STEALTH_THRESHOLD) return state;
  // 경보를 듣고 실제로 달려올 수 있는 위협만 추격에 들어간다 — 잠긴 문 너머는 반경 안이어도
  // 오지 못한다.
  const hops = bfsHopDistances(edgesForThreatMovement(state), nodeId);
  const threats = { ...state.threats };
  for (const threat of Object.values(state.threats)) {
    const hop = hops.get(threat.nodeId);
    if (hop === undefined || hop > CAMERA_ALERT_RANGE) continue;
    threats[threat.id] = {
      ...threat,
      mode: 'pursuit', alert: 3, lastKnownPlayerNodeId: nodeId, pursuitStrength: 3,
      lastObservedPlayerAt: state.time,
      target: { kind: 'player', nodeId },
    };
  }
  // 카메라에 걸리는 것도 경계도가 오르는 원인이다(§4단계) — 예전에는 주변 위협을 추격으로
  // 바꾸기만 해서 "왜 경계도가 올랐는지" 말할 수 있는 원인이 소음 하나뿐이었다.
  const sectorId = /** @type {import('./types.js').FacilitySectorId} */ (nodeId.split('_')[0]);
  const detectionId = `camera_${camera.id}_${state.time}`;
  const withThreats = { ...state, threats, lastCameraDetection: { cameraId: camera.id, nodeId, detectedAt: state.time } };
  return { ...withThreats, sectorAlerts: escalateSectorAlert(withThreats, sectorId, detectionId, ALERT_PRESSURE.cameraDetection) };
}

// 이동 비용은 비용 사양표(actionCosts.js)가 들고 있다 — UI 예고와 엔진 청구가 같은 함수를
// 쓰도록. 기존 호출부(MapScreen·테스트)가 runEngine에서 가져가고 있으므로 그대로 재수출한다.
export { moveTimeCost };

/**
 * Minimal player movement for the §10 map UI, ahead of the real Capability-costed action system
 * (phase 4). Uses the traversed edge's own Mobility-0 corridor cost (§6.2, geometry-derived —
 * see facilityGraph.js) regardless of loadout — every baseline's effective Mobility changes only
 * the *cost*, never whether movement
 * is possible, so this stays a faithful (if unoptimized) preview of the real thing. Movement is
 * treated as atomic rather than a `MovementAction` with mid-edge occupancy (§5.1.1) — that
 * distinction only matters for interrupting a move partway through, which doesn't exist yet
 * either. `playerNodeId` moves to the destination immediately and `advanceTime` runs the cost, so
 * arrival-collision detection (via `combatTrigger`) reuses the same per-tick check `worldTick`
 * already does against `state.playerNodeId`.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} destinationNodeId
 * @returns {import('./types.js').FacilityRunState}
 */
export function moveToAdjacentNode(state, destinationNodeId, effectiveMobility = 0, effectiveStealth = 0) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.playerNodeId) throw new RuleViolation('player is not at a node');
  const traversedEdge = state.graph.edges.find((e) => {
    const connects = (e.from === state.playerNodeId && e.to === destinationNodeId) || (e.to === state.playerNodeId && e.from === destinationNodeId);
    return connects && isEdgeTraversable(state, e, /** @type {string} */ (state.playerNodeId), effectiveMobility);
  });
  if (!traversedEdge) throw new RuleViolation(`${destinationNodeId} is not currently reachable from ${state.playerNodeId}`);

  // 자리를 뜨면 진행 중이던 작업은 포기된다(ADR-0084) — 게이지는 그 노드에 매여 있다.
  // 포기는 떠나기 **전에**, 아직 그 노드에 서 있는 상태에서 확정한다(시작 효과를 되돌리는
  // TASK_ABORTS가 옛 자리를 봐야 한다).
  state = abandonTask(state);

  // 고지대는 요구치 3짜리 층계 행동이다(D8). 시간은 이동의 전용 규칙이 이미 청구하므로
  // 여기서 받는 것은 Mobility의 통화인 HP뿐이다. 불가면 위 isEdgeTraversable이 이미 걸렀다.
  const highGroundCost = traversedEdge.features.includes('highGround')
    ? requireActionCost('traverseHighGround', { edge: traversedEdge, value: highGroundMobility(effectiveMobility) })
    : null;

  const visitedNodeIds = state.visitedNodeIds.includes(destinationNodeId)
    ? state.visitedNodeIds
    : [...state.visitedNodeIds, destinationNodeId];
  // 자리를 뜨면 고르지 않은 확보 대상 후보는 사라진다 — 파밍한 자리에서 결정하지 않으면
  // 가져갈 수 없다. 열린 채로 남겨두면 4단계의 "떠난 조우가 남아 소프트락"과 같은 모양이 된다.
  let moved = { ...state, playerNodeId: destinationNodeId, visitedNodeIds, combatTrigger: null, activeRecon: null, activeConcealment: null, encounter: null, pendingFarmChoice: null, lastWaitEndedAt: /** @type {number|null} */ (null) };
  // 다른 층계 대가와 같은 자리로 보낸다 — facilityReducer의 공통 래퍼가 playerState에서 정산한다.
  if (highGroundCost?.hpCost) moved = { ...moved, pendingHpLoss: (moved.pendingHpLoss || 0) + highGroundCost.hpCost };
  moved = applyCameraDetection(moved, destinationNodeId, effectiveStealth);
  const stealthIndex = Math.max(-2, Math.min(4, effectiveStealth)) + 2;
  const movementNoise = [3, 2, 1, 0, 0, 0, 0][stealthIndex];
  if (movementNoise > 0) moved = reportNoise(moved, destinationNodeId, /** @type {1|2|3} */ (movementNoise), state.time);
  if (effectiveStealth <= 2) {
    const tier = /** @type {1|2} */ (effectiveStealth <= -2 ? 2 : 1);
    moved = { ...moved, evidence: [...moved.evidence, { id: idForNewEntry(state, moved.evidence, 'evidence'), nodeId: destinationNodeId, tier, createdBySectorId: destinationNodeId.split('_')[0] }] };
  }
  // 통로 하나는 언제나 1칸이다(ADR-0084). 시간은 이동이 아니라 작업에서 나간다.
  return advanceTime(moved, moved.time + moveTimeCost(traversedEdge, effectiveMobility));
}

/**
 * Capability 층계(§5단계, D8)가 정한 비용으로 현장 작업 하나를 **예약**한다. 시간은 1칸씩
 * 흐르고, 층계의 대가(HP·내구도·흔적·경계도)와 소음은 완료 시각에 한 번에 확정된다.
 * 완료 전에 적이 접촉하면 경과한 칸만 소모되고 대가는 하나도 청구되지 않는다.
 *
 * HP와 장비 내구도는 `playerState`에 있어 여기서 건드릴 수 없다. 그래서 상태에 청구서만 쌓아
 * 두고(`pendingHpLoss`/`pendingDurabilityLoss`), facilityReducer의 공통 래퍼가 액션을 마칠 때
 * 함께 정산한다 — 대가를 치르는 자리가 행동마다 흩어지면 빠뜨린 곳이 생긴다.
 *
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./capabilityCosts.js').CapabilityCost} cost
 * @param {string|undefined} atNodeId 소음·흔적이 남는 자리. `undefined`면 플레이어의 현재 노드.
 * @param {string} taskKind TASK_COMPLETIONS의 키 — 완료 시 적용할 종류별 효과. 기본값을 두지
 *   않는다: 종류를 빠뜨린 호출이 "아무 효과도 없는 유료 행동"으로 조용히 성립하면 안 된다.
 * @param {object|null} [params] 그 완료 적용에 필요한 파라미터.
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyCapabilityCost(state, cost, atNodeId, taskKind, params = null) {
  if (!taskKind) throw new RuleViolation('applyCapabilityCost requires a taskKind');
  return scheduleTask(state, {
    kind: taskKind, timeCost: cost.timeCost, nodeId: atNodeId ?? state.playerNodeId, cost, params,
  });
}

/**
 * 층계 판정에서 불가가 나오면 던진다 — 던지는 문구는 행동마다 달라야 UI가 이유를 말할 수 있다.
 * @param {import('./capabilityCosts.js').CapabilityKind} kind
 * @param {number} effectiveValue
 * @param {number} required
 * @param {import('./capabilityCosts.js').CapabilityCostBase} base
 * @returns {import('./capabilityCosts.js').CapabilityCost}
 */
export function requireCapability(kind, effectiveValue, required, base) {
  const cost = resolveCapabilityCost(kind, effectiveValue, required, base);
  if (cost.step === 'impossible') throw new RuleViolation(`${kind} too low (needs ${required}, have ${effectiveValue})`);
  return cost;
}

/**
 * §6.3 tier-1 Force/Hacking approach to open a 'blocked' or 'electronic' special edge. MVP scope:
 * only tier 1 ("약한 잠금·잔해" / "현재 노드 잠금·단말") is modeled — bigger tiers (barricades,
 * structural collapse, remote device chains) are future work. `capabilityKind` picks which of the
 * edge's feature tags to satisfy; the caller must hold effective Capability >=1 in that kind.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} edgeId
 * @param {'force'|'hacking'} capabilityKind
 * @param {number} effectiveCapability -2..4
 * @param {'safe'|'normal'|'rush'} mode
 * @returns {import('./types.js').FacilityRunState}
 */
export function openSpecialEdge(state, edgeId, capabilityKind, effectiveCapability, mode) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.playerNodeId) throw new RuleViolation('player is not at a node');
  const playerNodeId = state.playerNodeId;
  const edge = state.graph.edges.find((e) => e.id === edgeId);
  if (!edge) throw new RuleViolation(`unknown edge ${edgeId}`);
  if (edge.from !== playerNodeId && edge.to !== playerNodeId) throw new RuleViolation(`edge ${edgeId} is not adjacent to the current node`);
  if (state.openedEdgeIds.includes(edgeId)) return state;
  const requiredFeature = capabilityKind === 'force' ? 'blocked' : 'electronic';
  if (!edge.features.includes(requiredFeature)) throw new RuleViolation(`edge ${edgeId} has no '${requiredFeature}' approach`);
  // 전원 차단(D12)의 대가 — 전원이 없으면 전자식 자물쇠에는 잡을 제어가 없다. 문을 뜯는
  // Force는 여전히 되므로, 해킹 빌드가 스스로 통로를 닫는 선택이 된다.
  if (capabilityKind === 'hacking') {
    const sectorId = playerNodeId.split('_')[0];
    if (state.powerCuts.some((cut) => cut.sectorId === sectorId && cut.expiresAt > state.time)) {
      throw new RuleViolation(`power is cut in ${sectorId} — electronic locks cannot be hacked`);
    }
  }
  // 대부분의 특수 엣지는 Capability 1이면 열 수 있지만, 배치 원형이 구조적으로 두는 통로는
  // 더 높은 값을 요구한다(통신·관제탑 승강기는 3). 요구치는 접근 수단을 가리지 않는다 —
  // 위에서 고른 태그로 여는 이상 Force든 Hacking이든 같은 값이 필요하다.
  const requiredLevel = edge.requiredCapability ?? 1;

  // 모자란 채로도 시도할 수 있고, 대신 그 Capability의 통화로 값을 치른다(D8). 요구치보다 3
  // 이상 낮을 때만 예전처럼 아예 막힌다. 기본 비용·접근 가감·층계 가감의 적용 순서는
  // actionCosts.js의 사양표가 지킨다 — UI 예고도 같은 표를 읽는다.
  const cost = requireActionCost('openEdge', {
    value: effectiveCapability, capabilityKind, required: requiredLevel, edge, mode,
  });

  // §6.3 "Force... 기본 소음 2와 흔적을 남기며" — safe Force downgrades strong evidence to
  // normal but never removes it entirely (§6.1); MVP always leaves a normal trace unless safe.
  const evidenceTier = capabilityKind !== 'hacking' && mode !== 'safe' ? (mode === 'rush' ? 2 : 1) : null;
  return applyCapabilityCost(state, cost, playerNodeId, 'openEdge', { edgeId, evidenceTier });
}

/**
 * §6.2 기본 정찰: Perception 요구 없음, 시간 80, 소음 0, 항상 성공. 현재/인접 노드에 위협이
 * 있는지 없는지만 확정한다 — 정확한 수·경계 상태는 상세 정찰(미구현) 몫이다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function basicRecon(state, effectivePerception = 0) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.playerNodeId) throw new RuleViolation('player is not at a node');
  // 비용은 Perception과 무관하게 4칸 고정이다 — Perception이 사는 것은 사거리와 깊이다.
  return scheduleTask(state, { kind: 'recon', timeCost: actionTimeCost('recon'), params: { perception: effectivePerception } });
}

/**
 * §신규 은엄폐: 현재 노드에 배치된 은엄폐를 사용해 그 노드에 머무는 동안 임시로 Stealth를
 * 올린다(다른 노드로 이동하면 moveToAdjacentNode가 activeConcealment를 지운다). 이 노드에
 * 은엄폐가 없으면 던진다(§다른 시설맵 액션과 같은 실패 관례).
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function useConcealment(state) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.playerNodeId) throw new RuleViolation('player is not at a node');
  const bonus = state.graph.concealmentByNodeId[state.playerNodeId];
  if (!bonus) throw new RuleViolation(`no concealment at ${state.playerNodeId}`);
  // 은엄폐 1칸은 완료 경계(3단계)에서 적용되므로 그 칸의 조우(5단계)보다 앞선다 — 마지막 순간
  // 방어 행동으로 쓸 수 있다(planned §9).
  return scheduleTask(state, { kind: 'concealment', timeCost: actionTimeCost('concealment'), params: { bonus } });
}

/**
 * 현재 노드에서의 실효 Stealth를 **분해해서** 돌려준다(ADR-0079). 장비 합(기본)에 서 있는
 * 자리와 시설의 현재 상태가 같은 자리에서 더해진다:
 *
 * - 은엄폐(+1~3): 이 노드에서 사용 중일 때만.
 * - 대공간(−1): D7 격납고. 대공간에는 은엄폐가 배치되지 않으므로(NODE_TYPE_CONCEALMENT_WEIGHTS)
 *   두 보정이 서로 상쇄되는 일은 없다.
 * - 카메라(−1): 이 노드에 해킹·파괴되지 않은 카메라가 살아 있을 때.
 * - 전원 차단(+1): 이 노드가 속한 구역의 전원이 끊겨 있을 때(어둠).
 * - 봉쇄(−1): 봉쇄가 켜져 있는 동안 맵 어디서나.
 *
 * 조우 패널과 노드 툴팁은 `parts`를 그대로 읽어 `내 은신 2 = 기본 1 + 은엄폐 2 − 카메라 1`로
 * 적는다 — 합계만 보여주면 플레이어가 무엇을 바꿔야 판정이 뒤집히는지 알 수 없다.
 *
 * @param {number} baseEffectiveStealth
 * @param {import('./types.js').FacilityRunState} state
 * @returns {{total: number, base: number, parts: {label: string, delta: number}[]}}
 */
export function explainEffectiveStealth(baseEffectiveStealth, state) {
  const nodeId = state.playerNodeId;
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  /** @type {{label: string, delta: number}[]} */
  const parts = [];

  const active = state.activeConcealment;
  if (active && active.nodeId === nodeId) parts.push({ label: '은엄폐', delta: active.bonus });
  if (node && node.type === 'hall') parts.push({ label: '대공간', delta: -HALL_STEALTH_PENALTY });
  const liveCamera = nodeId
    && state.graph.cameras.some((entry) => entry.nodeId === nodeId && !cameraIsHacked(state, entry.id));
  if (liveCamera) parts.push({ label: '카메라', delta: STEALTH_CONTEXT_CAMERA });
  const inPowerCut = nodeId
    && (state.powerCuts || []).some((cut) => cut.sectorId === sectorOfNode(nodeId) && cut.expiresAt > state.time);
  if (inPowerCut) parts.push({ label: '전원 차단', delta: STEALTH_CONTEXT_POWER_CUT });
  if (state.lockdown) parts.push({ label: '봉쇄', delta: STEALTH_CONTEXT_LOCKDOWN });

  const total = parts.reduce((sum, part) => sum + part.delta, baseEffectiveStealth);
  return { total, base: baseEffectiveStealth, parts };
}

/**
 * 조우 판정에 실제로 쓰이는 실효 Stealth 합계. 분해가 필요하면 explainEffectiveStealth를 쓴다 —
 * 이 함수는 그 함수의 `total`이며, 두 값이 갈라질 수 없도록 같은 계산을 다시 쓰지 않는다.
 * @param {number} baseEffectiveStealth
 * @param {import('./types.js').FacilityRunState} state
 * @returns {number}
 */
export function effectiveStealthWithConcealment(baseEffectiveStealth, state) {
  return explainEffectiveStealth(baseEffectiveStealth, state).total;
}

/** Effective Hacking -> direct hacking range in graph hops. */
export function cameraHackRange(effectiveHacking) {
  return CAMERA_HACK_RANGE_BY_HACKING[Math.max(-2, Math.min(4, effectiveHacking)) + 2];
}

/**
 * 카메라 저격의 "시야" — 현재 노드에서 실제로 총알이 지나갈 수 있는 통로만 따라 센 홉수다.
 * 해킹 사거리(canReachHackingTarget)가 무향 그래프를 그대로 쓰는 것과 다르다: 총알은 신호와
 * 달리 문을 돌아가지 못하므로, 아직 열지 않은 잠긴 통로(차단·전자)는 시야를 끊고 일방통행은
 * 생성 방향으로만 지난다. 이미 연 통로는 열린 문이므로 시야가 통한다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} fromNodeId
 * @returns {Map<string, number>}
 */
function lineOfSightHops(state, fromNodeId) {
  /** @type {{from: string, to: string}[]} */
  const arcs = [];
  for (const edge of state.graph.edges) {
    if (!isEdgeUnlocked(edge, state.openedEdgeIds)) continue;
    arcs.push({ from: edge.from, to: edge.to });
    if (!edge.features.includes('oneWay')) arcs.push({ from: edge.to, to: edge.from });
  }
  return bfsHopDistancesOverArcs(arcs, fromNodeId);
}

/** Whether a hacking target is reachable directly, or through the hacked interface at this node. */
function canReachHackingTarget(state, targetNodeId, effectiveHacking) {
  if (capabilityStep(effectiveHacking) === 'impossible') return false;
  const playerNode = state.graph.nodes.find((node) => node.id === state.playerNodeId);
  const targetNode = state.graph.nodes.find((node) => node.id === targetNodeId);
  if (!playerNode || !targetNode) return false;
  const currentInterface = state.graph.accessInterfaces.find((entry) => entry.nodeId === state.playerNodeId);
  const hackedInterfaceIds = state.hackedInterfaceIds || [];
  if (currentInterface && hackedInterfaceIds.includes(currentInterface.id) && playerNode.sectorId === targetNode.sectorId) return true;
  const hop = bfsHopDistances(state.graph.edges, state.playerNodeId).get(targetNodeId);
  return hop !== undefined && hop <= cameraHackRange(effectiveHacking);
}

/** Hack the access interface installed at the player's current node. */
export function hackAccessInterface(state, interfaceId, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('access interface hacking unavailable');
  const accessInterface = state.graph.accessInterfaces.find((entry) => entry.id === interfaceId);
  if (!accessInterface) throw new RuleViolation(`unknown access interface ${interfaceId}`);
  if (accessInterface.nodeId !== state.playerNodeId) throw new RuleViolation('access interface must be hacked at its node');
  if ((state.hackedInterfaceIds || []).includes(interfaceId)) return state;
  const cost = requireActionCost('hackInterface', { value: effectiveHacking });
  // 정찰과 같이, 완료 시각에 쓸 유효 수치를 작업에 박아 둔다 — 그 사이에 장비가 바뀌어도
  // 시작할 때 예고한 반경 그대로 드러나야 한다.
  return applyCapabilityCost(state, cost, undefined, 'hackInterface', { interfaceId, hacking: effectiveHacking });
}

/** Hack a camera at the current/nearby node, or anywhere in this sector through a hacked interface. */
export function hackCamera(state, cameraId, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('camera hacking unavailable');
  const camera = state.graph.cameras.find((entry) => entry.id === cameraId);
  if (!camera) throw new RuleViolation(`unknown camera ${cameraId}`);
  if ((state.disabledCameraIds || []).includes(cameraId)) throw new RuleViolation('camera is already destroyed');
  if (!canReachHackingTarget(state, camera.nodeId, effectiveHacking)) throw new RuleViolation(`camera ${cameraId} is out of range`);

  const cost = requireActionCost('hackCamera', { value: effectiveHacking });
  return refreshActiveRecon(applyCapabilityCost(state, cost, undefined, 'hackCamera', {
    cameraId, cameraNodeId: camera.nodeId, duration: CAMERA_HACK_DURATION,
  }));
}

/** Permanently destroy a camera from its node. This is a loud Force action. */
export function destroyCamera(state, cameraId, effectiveForce) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('camera destruction unavailable');
  const camera = state.graph.cameras.find((entry) => entry.id === cameraId);
  if (!camera) throw new RuleViolation(`unknown camera ${cameraId}`);
  if (camera.nodeId !== state.playerNodeId) throw new RuleViolation('Force requires standing at the camera');
  if ((state.disabledCameraIds || []).includes(cameraId)) return state;
  const cost = requireActionCost('destroyCamera', { value: effectiveForce });
  return applyCapabilityCost(state, cost, undefined, 'destroyCamera', { cameraId });
}

/** Disable a sector battery generator. Hacking follows the normal direct/interface access rule;
 * Force is loud and requires physically standing on the generator node. */
export function disableGenerator(state, generatorId, capabilityKind, effectiveCapability) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('generator control unavailable');
  const generator = state.graph.generators?.find((entry) => entry.id === generatorId);
  if (!generator) throw new RuleViolation(`unknown generator ${generatorId}`);
  if (state.disabledGeneratorIds.includes(generatorId)) return state;
  if (capabilityKind === 'hacking') {
    if (!canReachHackingTarget(state, generator.nodeId, effectiveCapability)) throw new RuleViolation('generator is out of hacking range');
    const cost = requireActionCost('disableGeneratorHack', { value: effectiveCapability });
    return applyCapabilityCost(state, cost, undefined, 'disableGenerator', { generatorId });
  }
  if (capabilityKind !== 'force' || state.playerNodeId !== generator.nodeId) throw new RuleViolation('Force requires standing at the generator');
  const cost = requireActionCost('disableGeneratorForce', { value: effectiveCapability });
  return applyCapabilityCost(state, cost, undefined, 'disableGenerator', { generatorId });
}

/**
 * §신규 구역 통제실 해킹: 그 구역의 랜드마크 노드(graph.landmarks)에서만 시도할 수 있고,
 * 기존 hackAccessInterface/hackCamera와 별개의 상호작용이다(그것들로는 통제실에 닿을 수
 * 없다). 해킹 수치별로 누적 언락 — 상위 레벨은 하위 효과를 전부 포함한다:
 *   1: 이 구역 위협들의 순찰경로를 영구 공개.
 *   2: 이 구역 경계도를 (해킹 수치 - 1)만큼 감소(최소 0).
 *   3: 맵 전체 위협을 전부 patrol 모드로 되돌린다(추적 해제).
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} effectiveHacking
 * @returns {import('./types.js').FacilityRunState}
 */
export function hackControlRoom(state, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('control room hacking unavailable');
  const landmark = state.graph.landmarks.find((l) => l.nodeId === state.playerNodeId);
  if (!landmark) throw new RuleViolation('not at a sector control room');
  // 장악은 구역당 한 번뿐이다(C3, ADR-0067). 반복해서 누르면 경계도를 시간만 들여 무한히
  // 0으로 되돌릴 수 있고, 그러면 소음을 낼지 말지가 더 이상 결정이 아니게 된다.
  // 이미 장악한 구역인지는 순찰경로가 공개됐는지로 안다 — 1단계 효과가 반드시 따라오므로
  // 그 자체가 "이 구역을 장악했다"의 기록이다.
  if (state.revealedPatrolRouteSectorIds.includes(landmark.sectorId)) {
    throw new RuleViolation(`control room in ${landmark.sectorId} is already seized`);
  }
  const cost = requireActionCost('controlRoom', { value: effectiveHacking });
  // 모자란 채로 뚫고 들어가도 얻는 것은 1단계(순찰 경로 공개)까지다 — 상위 해제는 여전히 수치를
  // 실제로 들고 와야 열린다. 대가만 치르면 전부 열린다면 Capability에 투자할 이유가 없어진다.
  // D12: 예전의 "맵 전체 위협 patrol 전환"은 삭제했다 — 전 구역을 한 번에 되돌리는 버튼이라
  // 다른 수습 수단이 존재할 이유를 없앴다. 대신 인접 구역까지 경계도를 낮춘다(완료 시 적용).
  const level = Math.max(1, effectiveHacking);
  return applyCapabilityCost(state, cost, undefined, 'controlRoom', { sectorId: landmark.sectorId, level });
}

/**
 * 시체 처리(D13) — 전투에서 이긴 자리에 남은 시체를 없앤다. Capability 요구는 없고 시간만
 * 든다. 기본은 그냥 두고 가는 것이고, 이 행동은 "지금 시간을 쓸지, 나중에 신고당할지"를
 * 고르는 자리다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function disposeCorpse(state) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('corpse disposal unavailable');
  const corpse = state.corpses.find((c) => c.nodeId === state.playerNodeId);
  if (!corpse) throw new RuleViolation('no corpse at this node');
  return scheduleTask(state, { kind: 'corpse', timeCost: actionTimeCost('corpse'), params: { corpseId: corpse.id } });
}

/**
 * 봉쇄(D22)를 켠다. 계약 목표를 확보한 세 액션(회수 확보·파괴·정보 확보)이 공유한다. 이미
 * 봉쇄 중이면 아무것도 하지 않는다 — 정보 계약은 확보에서 한 번 켜진 뒤 송출까지 그대로
 * 유지되어야 하므로 재기동하지 않는다.
 *
 * 봉쇄는 **출구를 앞당겨 닫지 않는다**(ADR-0083). 하는 일은 위협 가속뿐이다 — 위협 이동 간격이
 * 봉쇄 고정표로 줄고, 각 구역의 다음 증원이 당겨지고, 상황 보정 Stealth −1이 걸린다. 표준
 * 출구는 A 하나뿐이라 그것까지 앞당겨 닫으면 "봉쇄=실패"가 되어 선택이 사라진다.
 * @param {import('./types.js').FacilityRunState} run
 * @returns {import('./types.js').FacilityRunState}
 */
function activateLockdown(run) {
  if (run.lockdown) return run;
  // 봉쇄에 들어가는 순간 각 구역의 다음 교대를 min(기존, 현재+45)으로 당긴다 — 이미 90칸
  // 주기의 끝자락에 있던 구역이 봉쇄 때문에 오히려 늦게 채워지는 일이 없게 한다.
  const reinforcements = { ...run.reinforcements };
  for (const sectorId of run.graph.sectorIds) {
    const clock = reinforcements[sectorId];
    reinforcements[sectorId] = { ...clock, nextAt: Math.min(clock.nextAt, run.time + REINFORCEMENT_LOCKDOWN_INTERVAL) };
  }
  return { ...run, lockdown: { startedAt: run.time }, reinforcements };
}

/** @param {import('./types.js').FacilityRunState} run @returns {import('../data/contracts.js').ContractDef | undefined} */
function contractLandmark(run) {
  if (!run.contract) return undefined;
  return run.graph.landmarks.find((l) => l.sectorId === run.contract.sectorId);
}

/**
 * 회수 계약(D4·D21) 확보 — 목표부에서 물건을 집는다. Stealth 또는 Mobility 둘 중 하나만
 * 있으면 된다(특수 엣지의 이중 태그와 같은 "둘 중 하나" 판정). 확보만으로는 완료가 아니다 —
 * 이 물건을 들고 탈출해야 완료되며, 그 판정은 facilityReducer.js의 withFacilityRunState가
 * 한다(인벤토리를 봐야 하는데 이 함수는 facilityRunState만 다루므로).
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} effectiveStealth
 * @param {number} effectiveMobility
 * @returns {import('./types.js').FacilityRunState}
 */
export function acquireContractGoods(state, effectiveStealth, effectiveMobility) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('contract action unavailable');
  const contract = state.contract;
  if (!contract || contract.type !== 'retrieval' || contract.status !== 'accepted') {
    throw new RuleViolation('no retrieval contract to acquire');
  }
  const landmark = contractLandmark(state);
  if (!landmark || landmark.nodeId !== state.playerNodeId) throw new RuleViolation('not at the contract objective');
  // 요구는 "조용히든 빠르게든 들고 나오는 것"이라 둘 중 높은 쪽으로 친다 — 그러면 대가도
  // 실제로 쓴 수단의 통화로 나간다(Stealth면 흔적, Mobility면 HP).
  const kind = effectiveMobility > effectiveStealth ? 'mobility' : 'stealth';
  const cost = requireActionCost('contractRetrieve', { value: Math.max(effectiveStealth, effectiveMobility), capabilityKind: kind });
  return applyCapabilityCost(state, cost, undefined, 'contract', { nextStatus: 'acquired', completes: false, lockdown: true });
}

/**
 * 파괴 계약(D4·D21, C5) 1단계 — 목표부에 폭약을 **설치**한다. 여기서는 아직 완료가 아니다:
 * 봉쇄만 켜지고(유예 125칸은 이 시각부터), 계약은 'acquired'가 된다.
 *
 * 설치와 완료가 같은 순간이던 시절에는 목표부가 곧 종점이라 "터뜨리고 빠져나오는" 구간이
 * 아예 없었다. 이제 그 구간이 이 계약의 값이다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} effectiveForce
 * @returns {import('./types.js').FacilityRunState}
 */
export function destroyContractTarget(state, effectiveForce) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('contract action unavailable');
  const contract = state.contract;
  if (!contract || contract.type !== 'destroy' || contract.status !== 'accepted') {
    throw new RuleViolation('no destroy contract to plant charges for');
  }
  const landmark = contractLandmark(state);
  if (!landmark || landmark.nodeId !== state.playerNodeId) throw new RuleViolation('not at the contract objective');
  const cost = requireActionCost('contractDestroy', { value: effectiveForce });
  return applyCapabilityCost(state, cost, undefined, 'contract', { nextStatus: 'acquired', completes: false, lockdown: true });
}

/**
 * 설치한 폭약을 터뜨릴 수 있는 자리인가 — 목표부에서 CONTRACT_DETONATE_MIN_HOPS 이상 떨어져
 * 있어야 한다. 화면(버튼 활성/사유)과 엔진(거절)이 같은 판정을 쓰도록 여기 한 자리에만 둔다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {{ok: boolean, hops: number|null, requiredHops: number}}
 */
export function contractDetonationRange(state) {
  const landmark = contractLandmark(state);
  if (!landmark || !state.playerNodeId) return { ok: false, hops: null, requiredHops: CONTRACT_DETONATE_MIN_HOPS };
  const hops = bfsHopDistances(state.graph.edges, landmark.nodeId).get(state.playerNodeId);
  if (hops === undefined) return { ok: true, hops: null, requiredHops: CONTRACT_DETONATE_MIN_HOPS };
  return { ok: hops >= CONTRACT_DETONATE_MIN_HOPS, hops, requiredHops: CONTRACT_DETONATE_MIN_HOPS };
}

/**
 * 파괴 계약(C5) 2단계 — 기폭. 목표부에서 2홉 이상 떨어진 자리에서만 누를 수 있고, 여기서
 * 계약이 완료된다. Capability 요구는 없고 2칸만 든다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function detonateContractCharge(state) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('contract action unavailable');
  const contract = state.contract;
  if (!contract || contract.type !== 'destroy' || contract.status !== 'acquired') {
    throw new RuleViolation('no planted charge to detonate');
  }
  const range = contractDetonationRange(state);
  if (!range.ok) throw new RuleViolation(`too close to the charge (${range.hops} hops, need ${range.requiredHops})`);
  // Capability 요구가 없는 고정 비용 행동이라 시체 처리와 같은 경로를 쓴다(층계 비용 없음).
  return scheduleTask(state, {
    kind: 'contract',
    timeCost: actionTimeCost('contractDetonate'),
    nodeId: state.playerNodeId,
    params: { nextStatus: 'completed', completes: true, lockdown: false },
  });
}

/**
 * 정보 계약(D4·D21) 확보 — 목표부에서 데이터를 딴다. 완료하려면 이후 목표부 구역에 인접한
 * 구역의 랜드마크에서 transmitContractIntel을 해야 한다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} effectiveHacking
 * @returns {import('./types.js').FacilityRunState}
 */
export function acquireContractIntel(state, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('contract action unavailable');
  const contract = state.contract;
  if (!contract || contract.type !== 'intel' || contract.status !== 'accepted') {
    throw new RuleViolation('no intel contract to acquire');
  }
  const landmark = contractLandmark(state);
  if (!landmark || landmark.nodeId !== state.playerNodeId) throw new RuleViolation('not at the contract objective');
  const cost = requireActionCost('contractIntel', { value: effectiveHacking });
  return applyCapabilityCost(state, cost, undefined, 'contract', { nextStatus: 'acquired', completes: false, lockdown: true });
}

/**
 * 정보 계약(D4·D21, C5) 송출 — 확보한 데이터를 **목표부 구역에 인접한 구역**의 랜드마크에서
 * 내보내야 완료다.
 *
 * 예전에는 목표부에서 딴 자리에서 바로 송출할 수 있었다. 그러면 확보와 완료가 한 노드에서
 * 끝나 계약의 마지막 장이 통째로 사라진다 — 확보한 뒤 봉쇄가 켜진 시설을 가로질러 이웃
 * 구역 통제실까지 가는 그 구간이 이 계약의 값이다.
 *
 * 그 다음 규칙은 "목표부가 아닌 아무 구역"이었다. 거기서 인접 구역으로 좁혀도 최단 왕복은
 * 사실상 그대로다 — 최단을 고르면 이미 대부분 이웃 랜드마크였기 때문이다(실측 Mobility 0
 * 중앙 왕복: 기록 열람 200.5 -> 202.5, 관제 침투 342.0 -> 345.0, 신호 도청 348.0 -> 348.0).
 * 좁히는 값은 거리가 아니라 읽힘이다 — 송출 지점이 링의 좌우 이웃 둘로 고정돼, 목표부를 받는
 * 순간 마지막 장의 경로를 계획할 수 있고 어느 랜드마크가 싼지 전 구역을 재보지 않아도 된다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} effectiveHacking
 * @returns {import('./types.js').FacilityRunState}
 */
export function transmitContractIntel(state, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new RuleViolation('contract action unavailable');
  const contract = state.contract;
  if (!contract || contract.type !== 'intel' || contract.status !== 'acquired') {
    throw new RuleViolation('no acquired intel to transmit');
  }
  const landmark = state.graph.landmarks.find((l) => l.nodeId === state.playerNodeId);
  if (!landmark) throw new RuleViolation('not at a sector control room');
  if (!isContractIntelTransmitSector(state.graph, contract.sectorId, landmark.sectorId)) {
    throw new RuleViolation('intel must be transmitted from a landmark in a sector adjacent to the objective');
  }
  const cost = requireActionCost('contractTransmit', { value: effectiveHacking });
  return applyCapabilityCost(state, cost, undefined, 'contract', { nextStatus: 'completed', completes: true, lockdown: false });
}

/** 목표부 구역이 objectiveSectorId인 정보 계약을 sectorId의 랜드마크에서 송출할 수 있는가.
 * 인접 정의는 이 런의 구역 링(facilityGraph.js adjacentSectorIds) 하나뿐이라 가짜 목표 송출·
 * 통제실 해킹과 같은 이웃을 쓴다.
 * @param {{sectorIds: readonly string[]}} graph
 * @param {import('./types.js').FacilitySectorId} objectiveSectorId
 * @param {import('./types.js').FacilitySectorId} sectorId
 * @returns {boolean} */
export function isContractIntelTransmitSector(graph, objectiveSectorId, sectorId) {
  return adjacentSectorIds(graph, objectiveSectorId).includes(sectorId);
}

/** 지금 서 있는 자리가 정보 송출이 가능한 랜드마크인가 — 화면과 엔진이 같은 판정을 쓴다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {boolean} */
export function canTransmitContractIntelHere(state) {
  const contract = state.contract;
  if (!contract || contract.type !== 'intel' || contract.status !== 'acquired' || !state.playerNodeId) return false;
  const landmark = state.graph.landmarks.find((l) => l.nodeId === state.playerNodeId);
  return !!landmark && isContractIntelTransmitSector(state.graph, contract.sectorId, landmark.sectorId);
}

/**
 * §6.2 파밍: 현재 노드의 소진되지 않은(usesRemaining > 0) 현장 기회 하나를 1회 소모한다 —
 * usesRemaining은 맵 생성 때 1~3회로 고정되어(OPPORTUNITY_USES_WEIGHTS) 더 이상 "1회용"이
 * 기본이 아니다. 열쇠 대상 여부도 맵 생성 때 이미 고정돼 있으므로(§5.1.1) 여기서는 그 값을
 * 그대로 반영만 한다 — 실제 보상 지급/인벤토리 반영은 아직 없다(현장 기회 보상 콘텐츠는
 * 이후 단계 과제).
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} opportunityId
 * @param {'safe'|'normal'|'rush'} mode
 * @returns {{state: import('./types.js').FacilityRunState, keyGranted: boolean}}
 */
export function useOpportunity(state, opportunityId, mode) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  const opportunity = state.graph.opportunities.find((o) => o.id === opportunityId);
  if (!opportunity) throw new RuleViolation(`unknown opportunity ${opportunityId}`);
  if (opportunity.nodeId !== state.playerNodeId) throw new RuleViolation(`opportunity ${opportunityId} is not at the current node`);
  if (opportunity.usesRemaining <= 0) throw new RuleViolation(`opportunity ${opportunityId} already consumed`);
  // 아직 고르지 않은 후보가 서 있는데 또 확보 대상을 파면 앞선 후보가 조용히 덮여, 이미 치른
  // 시간과 소음이 아무 보상 없이 사라진다. 보급품은 후보를 세우지 않으므로 그대로 허용한다.
  if (state.pendingFarmChoice && opportunity.grade === 'prize') throw new RuleViolation('pick the pending farm reward first');

  // 등급이 비용을 가른다(§5단계, D10). 보급품은 짧고 조용하게 즉시 끝나고, 확보 대상은 길고
  // 시끄러우며 등급이 높을수록 더하다 — 그 대가가 "저기까지 갈 만한가"를 묻는 장치다.
  const isPrize = opportunity.grade === 'prize';
  const tier = opportunity.tier || 'normal';
  // 등급·접근이 정하는 시간과 소음은 사양표가 들고 있다 — UI가 파밍 계획에서 보여주는 값과
  // 여기서 청구하는 값이 같은 함수에서 나온다.
  const forecast = forecastAction('farm', { isPrize, tier, mode });
  const time = forecast.timeCost;
  const noise = forecast.noise;
  // 파밍은 예약해 두고 완료 시각에 한 번에 확정된다 — 기회 소모, 열쇠 확정, 소음, 그리고
  // 확보 대상의 후보 셋(D11)이 전부 그때 생긴다. 도중에 적이 접촉하면 아무것도 남지 않는다.
  let next = scheduleTask(state, {
    kind: 'farm',
    timeCost: time,
    cost: { noise, timeCost: time },
    params: { opportunityId, isPrize, tier, axis: opportunity.axis || 'resource', keyEligible: opportunity.keyEligible },
  });
  // 매복 배너는 중단이 실제로 일어나는 자리에서 적는다(TASK_ABORTS.farm) — 파밍은 이제 가동한
  // 커맨드가 아니라 게이지를 채우는 대기에서 끝날 수 있기 때문이다(ADR-0084).
  return { state: next, keyGranted: taskCompleted(next) && opportunity.keyEligible };
}

/**
 * 확보 대상의 후보 중 하나를 고른다(D11). 실제 아이템 지급은 인벤토리를 만지는 일이라
 * facilityReducer의 커맨드가 하고, 여기서는 고른 것을 확정하고 대기 상태를 지운다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} optionIndex
 * @returns {{state: import('./types.js').FacilityRunState, option: import('./types.js').FarmChoiceOption}}
 */
export function selectFarmReward(state, optionIndex) {
  const pending = state.pendingFarmChoice;
  if (!pending) throw new RuleViolation('no farm choice is pending');
  const option = pending.options[optionIndex];
  if (!option) throw new RuleViolation(`unknown farm option ${optionIndex}`);
  return { state: { ...state, pendingFarmChoice: null }, option };
}

/**
 * §11.1/docs/map-equipment-capability-mapping.md 능동 현장 효과. `contract`는 caller가
 * capabilityEngine.listFieldActiveEquipment(loadout)에서 골라 넘긴다 — 안전/신속/강행 접근을
 * 적용하지 않으며(§6.3 매핑 문서 note) 표의 시간·지속시간이 최종값이다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} instanceId 장비 인스턴스 id — 쿨다운 키.
 * @param {import('../data/facilityEquipmentCapabilities.js').MapEquipmentContract['fieldAction']} contract
 * @param {string} [targetId] snapshot_scan은 불필요, remote_intrusion은 대상 노드,
 *   temporary_barrier는 대상 엣지, camera_snipe는 대상 카메라 id.
 * @param {{effectivePerception?: number, usableAmmo?: number}} [opts] 카메라 저격처럼 플레이어 쪽
 *   자원(Perception 층계·탄약)을 보는 행동이 쓰는 값. 커맨드 래퍼가 채운다.
 * @returns {import('./types.js').FacilityRunState}
 */
export function useFieldEquipment(state, instanceId, contract, targetId, opts = {}) {
  if (state.phase !== 'active') throw new RuleViolation('run already ended');
  if (!state.playerNodeId) throw new RuleViolation('player is not at a node');
  if (!contract) throw new RuleViolation(`${instanceId} has no active field effect`);
  const readyAt = state.fieldCooldowns[instanceId] || 0;
  if (state.time < readyAt) throw new RuleViolation(`${instanceId} is on cooldown until ${readyAt}`);

  // 대상·사거리는 **시작 전에** 확정한다(불가 요청은 0칸). 실제 효과와 쿨다운은 전부
  // 완료 시각에 생긴다 — 중단되면 아무것도 남지 않고 쿨다운도 돌지 않는다.
  if (contract.kind === 'camera_snipe') {
    if (!targetId) throw new RuleViolation('camera_snipe requires a target camera');
    const camera = state.graph.cameras.find((entry) => entry.id === targetId);
    if (!camera) throw new RuleViolation(`unknown camera ${targetId}`);
    if ((state.disabledCameraIds || []).includes(camera.id)) throw new RuleViolation(`camera ${camera.id} is already destroyed`);
    const hop = lineOfSightHops(state, state.playerNodeId).get(camera.nodeId);
    if (hop === undefined || hop > contract.range) throw new RuleViolation(`camera ${camera.id} is out of line of sight for camera_snipe`);
    if (opts.usableAmmo !== undefined && opts.usableAmmo < CAMERA_SNIPE_AMMO_COST) {
      throw new RuleViolation('camera_snipe needs a round to fire');
    }
    // 층계 판정과 시간·소음은 cameraSnipe 사양이 낸다 — 불가(Perception -1 이하)는 여기서 던진다.
    const cost = requireActionCost('cameraSnipe', { value: opts.effectivePerception ?? 0 });
    return scheduleTask(state, {
      kind: 'fieldEquipment',
      timeCost: cost.timeCost,
      cost,
      params: {
        instanceId, kind: contract.kind, range: contract.range, duration: contract.duration,
        cooldown: contract.cooldown, targetId, cameraId: camera.id, cameraNodeId: camera.nodeId,
      },
    });
  }
  if (contract.kind === 'remote_intrusion') {
    if (!targetId) throw new RuleViolation('remote_intrusion requires a target node');
    if (!state.graph.nodes.some((n) => n.id === targetId)) throw new RuleViolation(`unknown node ${targetId}`);
    const hop = bfsHopDistances(state.graph.edges, state.playerNodeId).get(targetId);
    if (hop === undefined || hop === 0 || hop > contract.range) throw new RuleViolation(`node ${targetId} is out of range for remote_intrusion`);
  } else if (contract.kind === 'temporary_barrier') {
    if (!targetId) throw new RuleViolation('temporary_barrier requires a target edge');
    const targetEdge = state.graph.edges.find((e) => e.id === targetId);
    if (!targetEdge) throw new RuleViolation(`unknown edge ${targetId}`);
    const hops = bfsHopDistances(state.graph.edges, state.playerNodeId);
    const hopFrom = hops.get(targetEdge.from);
    const hopTo = hops.get(targetEdge.to);
    const inRange = (hopFrom !== undefined && hopFrom <= contract.range) || (hopTo !== undefined && hopTo <= contract.range);
    if (!inRange) throw new RuleViolation(`edge ${targetId} is out of range for temporary_barrier`);
  }

  return scheduleTask(state, {
    kind: 'fieldEquipment',
    timeCost: actionTimeCost('fieldEquipment', { contract }),
    cost: { timeCost: contract.timeCost },
    params: {
      instanceId, kind: contract.kind, range: contract.range, duration: contract.duration, cooldown: contract.cooldown, targetId,
    },
  });
}
