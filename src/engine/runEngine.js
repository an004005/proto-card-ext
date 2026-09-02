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
import { bfsHopDistances, buildAdjacency } from './graphUtils.js';
import { gainOverload, reduceOverload } from './overloadEngine.js';
import { effectiveForRequirement } from './capabilityEngine.js';
import { pickThreatEncounter } from '../data/dropTables.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import {
  RUN_COLLAPSE_TIME, WORLD_TICK_INTERVAL, EXIT_A_DISABLED_AT, EXIT_B_DISABLED_AT,
  EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW, EXIT_OPEN_WAIT_BY_HACKING, NOISE_DURATION,
  INVESTIGATION_MEMORY_DURATION, THREAT_MOVE_INTERVAL, SECTOR_ALERT_INVESTIGATE_INTERVAL,
  SECTOR_ALERT_MIN_ENEMY_ALERT, SECTOR_ALERT_DECAY_INTERVAL, NOISE_HOP_RANGE, SECTOR_IDS,
  APPROACH_TIME_DELTA, APPROACH_NOISE_DELTA, APPROACH_MIN_TIME, BASIC_RECON_TIME, FARM_TIME,
  FARM_NOISE, FORCE_TIER1_TIME, FORCE_BASE_NOISE, HACKING_TIER1_TIME, HACKING_BASE_NOISE,
  HACKING_TIER1_OVERLOAD_GAIN, RUSH_OVERLOAD_GAIN,
  CAMERA_STEALTH_THRESHOLD, CAMERA_ALERT_RANGE, CAMERA_HACK_TIME, CAMERA_HACK_OVERLOAD,
  CAMERA_HACK_DURATION, CAMERA_HACK_RANGE_BY_HACKING, CAMERA_FORCE_TIME, CAMERA_FORCE_NOISE,
  MOBILITY_MOVE_TIME_MULTIPLIER,
  GENERATOR_HACK_TIME, GENERATOR_HACK_OVERLOAD, GENERATOR_FORCE_TIME, GENERATOR_FORCE_NOISE,
  CONCEALMENT_ACTION_TIME_COST, CONTROL_ROOM_HACK_TIME, CONTROL_ROOM_HACK_OVERLOAD,
} from '../data/facilityLayout.js';

// 모듈 레벨 카운터는 같은 프로세스에서 같은 seed로 여러 번 플레이하면(예: 헤드리스 테스트가
// playSeed(seed)를 두 번 호출) 잔여 카운터 상태 때문에 재현성이 깨진다 — 항상 state에서
// 결정론적으로 파생시킨다.
/** @param {string} prefix @param {number} time @param {number} count */
function freshId(prefix, time, count) { return `${prefix}_${time}_${count}`; }

/** id for a new entry appended to a state-derived list — dedup key is that list's own length, so it stays deterministic without a separate counter. @param {import('./types.js').FacilityRunState} state @param {unknown[]} list @param {string} prefix */
function idForNewEntry(state, list, prefix) { return freshId(prefix, state.time, list.length); }

/**
 * @param {number} effectiveHacking -2..4
 */
function exitOpenWaitFor(effectiveHacking) {
  const clamped = Math.max(-2, Math.min(4, effectiveHacking));
  return EXIT_OPEN_WAIT_BY_HACKING[clamped + 2];
}

/**
 * @param {import('./types.js').FacilityGraph} graph
 * @param {number} seed
 * @param {{overloadFloor?: number, overloadGainMultiplier?: number}} [overloadConfig] loadout-derived (equipmentEngine.computeFloorOverload/computeOverloadGainMultiplier) — Overload is a run-wide resource shared with combat, not map-specific.
 * @returns {import('./types.js').FacilityRunState}
 */
export function createRunState(graph, seed, overloadConfig = {}) {
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
        disabledAt: placement.exitId === 'A' ? EXIT_A_DISABLED_AT : EXIT_B_DISABLED_AT,
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
      pursuitStrength: 0,
      target: null,
      investigationMemory: null,
    };
  }

  /** @type {Record<string, import('./types.js').SectorAlertState>} */
  const sectorAlerts = {};
  for (const sectorId of SECTOR_IDS) sectorAlerts[sectorId] = { level: 0, resolvedEventIds: [] };

  const overloadFloor = overloadConfig.overloadFloor ?? 0;
  return {
    graph,
    time: 0,
    rngState,
    phase: 'active',
    playerNodeId: graph.startNodeId,
    visitedNodeIds: [graph.startNodeId],
    openedEdgeIds: [],
    overload: overloadFloor,
    overloadFloor,
    overloadGainMultiplier: overloadConfig.overloadGainMultiplier ?? 1,
    observations: {},
    fieldCooldowns: {},
    activeBarriers: [],
    hackedCameras: [],
    disabledCameraIds: [],
    hackedInterfaceIds: [],
    disabledGeneratorIds: [],
    activeRecon: null,
    lastCameraDetection: null,
    lastActionResult: null,
    exits: /** @type {any} */ (exits),
    threats,
    noiseEvents: [],
    falseTargets: [],
    evidence: [],
    sectorAlerts,
    combatTrigger: null,
    keyDiscovered: false,
    activeConcealment: null,
    revealedPatrolRouteSectorIds: [],
    encounter: null,
  };
}

/**
 * §8: apply an Overload change (positive = gain, respects the multiplier and rounds; negative =
 * reduction, clamped to the equipped floor — see overloadEngine.js, the same rules combat uses).
 * 100 초과는 런을 끝내지 않는다. 전투에서는 초과분이 상태이상 카드로 전환된다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} amount
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyOverloadDelta(state, amount) {
  const overload = amount >= 0
    ? gainOverload(state.overload, amount, state.overloadGainMultiplier)
    : reduceOverload(state.overload, -amount, state.overloadFloor);
  return { ...state, overload };
}

/**
 * §10.2 설계: 안개는 노드/엣지의 "존재"를 가리지 않는다(항상 전체 지도가 보인다) — 대신
 * 현재 노드+인접 노드의 위협 존재 여부만 매 행동 끝에 observations로 스냅샷해 둔다. 시야
 * 밖으로 벗어나도 그 스냅샷은 지워지지 않고 "마지막으로 확인한 정보"로 남는다(MapScreen.js가
 * observations 유무로 fresh/stale/unknown을 구분한다). gameReducer.js의 loadout/facility/combat
 * 커맨드 모듈이 모두 공통으로 호출하므로(맵 진입 시·시설 액션 후·전투 라운드 종료 후) 순수
 * FacilityRunState 함수로서 이 engine 레벨에 둔다 — 어느 커맨드 모듈에도 종속시키지 않기 위해서.
 * @param {import('./types.js').FacilityRunState} run
 * @returns {import('./types.js').FacilityRunState}
 */
export function refreshLocalObservations(run) {
  if (!run.playerNodeId) return run;
  const nearNodeIds = new Set([run.playerNodeId]);
  for (const e of run.graph.edges) {
    if (e.from === run.playerNodeId) nearNodeIds.add(e.to);
    else if (e.to === run.playerNodeId) nearNodeIds.add(e.from);
  }
  const threatNodeIds = new Set(Object.values(run.threats).map((t) => t.nodeId));
  /** @type {Record<string, import('./types.js').ExitRuntimeState>} */
  const exitByNodeId = {};
  for (const exit of Object.values(run.exits)) exitByNodeId[exit.nodeId] = exit;
  const observations = { ...run.observations };
  for (const nodeId of nearNodeIds) {
    const exit = exitByNodeId[nodeId];
    observations[nodeId] = { observedAt: run.time, hasThreat: threatNodeIds.has(nodeId), exitStatus: exit?.kind === 'standard' ? exit.status : undefined };
  }
  return { ...run, observations };
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

/** Refresh the nodes watched by an active manual or hacked-camera recon session. */
export function refreshActiveRecon(run) {
  const recon = run.activeRecon;
  if (!recon) return run;
  if (recon.expiresAt != null && run.time >= recon.expiresAt) return { ...run, activeRecon: null };
  const threatNodeIds = new Set(Object.values(run.threats).map((threat) => threat.nodeId));
  const exitByNodeId = Object.fromEntries(Object.values(run.exits).map((exit) => [exit.nodeId, exit]));
  const observations = { ...run.observations };
  for (const nodeId of recon.targetNodeIds) {
    const exit = exitByNodeId[nodeId];
    observations[nodeId] = {
      observedAt: run.time,
      hasThreat: threatNodeIds.has(nodeId),
      exitStatus: exit?.kind === 'standard' ? exit.status : undefined,
      concealment: run.graph.concealmentByNodeId[nodeId],
    };
  }
  return { ...run, observations };
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
  return /** @type {const} */ (['A', 'B']).some((exitId) => {
    const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
    return exit.status === 'open' && exit.nodeId === state.playerNodeId;
  });
}

/**
 * §CONTEXT.md 탈출구 요청. Throws on an invalid request (spec has no "soft fail" for this — the
 * UI only offers the button when eligible, so an ineligible call here is a caller bug).
 * @param {import('./types.js').FacilityRunState} state
 * @param {'A'|'B'} exitId
 * @param {number} effectiveHacking -2..4
 * @returns {import('./types.js').FacilityRunState}
 */
export function requestExtraction(state, exitId, effectiveHacking) {
  const exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (state.exits[exitId]);
  if (state.phase !== 'active') throw new Error('run already ended');
  if (exit.status !== 'closed') throw new Error(`exit ${exitId} is not closed (status=${exit.status})`);
  if (state.time >= exit.disabledAt) throw new Error(`exit ${exitId} is disabled`);

  const interactionEndsAt = state.time + EXIT_REQUEST_TIME;
  const opensAt = interactionEndsAt + exitOpenWaitFor(effectiveHacking);
  const requestId = freshId(`req_${exitId}`, state.time, 0);
  let next = {
    ...state,
    exits: {
      ...state.exits,
      [exitId]: {
        ...exit, status: 'requesting', interactionEndsAt, opensAt, requestId, signalStartedAt: state.time,
      },
    },
  };
  // §6.2 일반 탈출구 요청: 시간 50 소요(붕괴/타 사건과의 순서 판정을 위해 그만큼 시간을 흘려보낸다).
  // 명세가 말하는 "소음 4"는 NoiseEvent.intensity(1~3 상한)로 표현되지 않는다 — 탈출 신호는 이미
  // ThreatTarget의 'exitSignal' 우선순위(§7.1, 소음과 별도 채널)로 처리되고 있어, "소음 4"가
  // 정확히 어떤 값에 대응하는지 명세만으로는 확정할 수 없다. 잘못 추측해 끼워 넣기보다 시간
  // 비용만 우선 반영하고 이 갭은 별도로 확인이 필요하다.
  return advanceTime(next, interactionEndsAt);
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
        target: { kind: 'player', nodeId: playerNodeId },
      },
    },
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
function escalateSectorAlert(state, sectorId, eventId) {
  const current = state.sectorAlerts[sectorId];
  if (current.resolvedEventIds.includes(eventId)) return state.sectorAlerts;
  return {
    ...state.sectorAlerts,
    [sectorId]: { level: /** @type {0|1|2|3} */ (Math.min(3, current.level + 1)), resolvedEventIds: [...current.resolvedEventIds, eventId] },
  };
}

/**
 * 역장 강화 임시 장벽(module_forcefield)이 걸린 엣지를 뺀 이동 가능 엣지 집합 — "적 이동만
 * 차단, 플레이어는 통과 가능"이므로 위협 목표 선택/이동에만 쓰고 플레이어 이동에는 쓰지 않는다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityEdge[]}
 */
function edgesForThreatMovement(state) {
  if (state.activeBarriers.length === 0) return state.graph.edges;
  const barrierIds = new Set(state.activeBarriers.map((b) => b.edgeId));
  return state.graph.edges.filter((e) => !barrierIds.has(e.id));
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

  const hopsFromThreat = bfsHopDistances(edgesForThreatMovement(state), threat.nodeId);

  /** @type {{exitId: 'A'|'B', nodeId: string, createdAt: number, hops: number}[]} */
  const activeSignals = [];
  for (const exitId of /** @type {const} */ (['A', 'B'])) {
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
      const hops = hopsFromThreat.get(event.sourceNodeId);
      if (hops === undefined) continue;
      const range = NOISE_HOP_RANGE[event.intensity];
      if (hops > range) continue;
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
 * §5.2 step 2-3 for one threat: pick a target, and — only if `nextMoveAt` is due — take one step
 * toward it, rescheduling the next move per its mode/sector-alert interval. Returns the pieces
 * that changed rather than mutating `state`, so the caller can thread rngState/sectorAlerts
 * across all threats in a tick explicitly.
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @param {number} tickTime
 * @returns {{threat: import('./types.js').ThreatRuntimeState, rngState: import('./rng.js').RngState, sectorAlerts: Record<string, import('./types.js').SectorAlertState>}}
 */
function updateThreat(state, threat, tickTime) {
  const target = selectThreatTarget(state, threat);
  /** @type {import('./types.js').ThreatRuntimeState} */
  let next = { ...threat, target };

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

  if (tickTime < next.nextMoveAt) return { threat: next, rngState: state.rngState, sectorAlerts: state.sectorAlerts };

  const stepped = stepToward(edgesForThreatMovement(state), next.nodeId, target.nodeId, state.rngState);
  next.nodeId = stepped.nodeId;

  const interval = resolveMoveInterval(state, next);
  next.nextMoveAt = tickTime + interval;

  let sectorAlerts = state.sectorAlerts;
  if (next.nodeId === target.nodeId) {
    const resolved = resolveArrival(state, next, target);
    next = resolved.threat;
    sectorAlerts = resolved.sectorAlerts;
  }

  return { threat: next, rngState: stepped.rngState, sectorAlerts };
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 */
function resolveMoveInterval(state, threat) {
  const alertLevel = state.sectorAlerts[threat.sectorId].level;
  if ((threat.mode === 'investigate' || threat.mode === 'alert') && SECTOR_ALERT_INVESTIGATE_INTERVAL[alertLevel]) {
    return SECTOR_ALERT_INVESTIGATE_INTERVAL[alertLevel];
  }
  return THREAT_MOVE_INTERVAL[threat.mode];
}

/**
 * @param {import('./types.js').FacilityRunState} state
 * @param {import('./types.js').ThreatRuntimeState} threat
 * @param {import('./types.js').ThreatTarget} target
 * @returns {{threat: import('./types.js').ThreatRuntimeState, sectorAlerts: Record<string, import('./types.js').SectorAlertState>}}
 */
function resolveArrival(state, threat, target) {
  if (target.kind === 'patrol') {
    return { threat: { ...threat, patrolIndex: (threat.patrolIndex + 1) % threat.patrolRoute.length }, sectorAlerts: state.sectorAlerts };
  }
  if (target.kind === 'exitSignal') {
    return { threat: { ...threat, mode: 'exit_guard' }, sectorAlerts: state.sectorAlerts };
  }
  if (target.kind === 'noise' || target.kind === 'falseTarget') {
    // Arrived at the source but the player isn't actually there (a real sighting would have
    // short-circuited to reportSighting/pursuit before this runs) -> §7.4 escalate once.
    const sectorAlerts = state.playerNodeId !== threat.nodeId
      ? escalateSectorAlert(state, threat.sectorId, target.eventId)
      : state.sectorAlerts;
    return {
      threat: {
        ...threat,
        mode: 'patrol',
        investigationMemory: { eventId: target.eventId, nodeId: target.nodeId, expiresAt: state.time + INVESTIGATION_MEMORY_DURATION },
      },
      sectorAlerts,
    };
  }
  if (target.kind === 'player') {
    // §7.3 추적 강도: arrived at the last known position without a fresh sighting -> strength
    // decays; at 0 the marker gives up and returns to patrol.
    const nextStrength = /** @type {0|1|2|3} */ (Math.max(0, threat.pursuitStrength - 1));
    const threatOut = nextStrength === 0
      ? { ...threat, mode: /** @type {const} */ ('patrol'), pursuitStrength: /** @type {const} */ (0), lastKnownPlayerNodeId: null }
      : { ...threat, pursuitStrength: nextStrength };
    return { threat: threatOut, sectorAlerts: state.sectorAlerts };
  }
  return { threat, sectorAlerts: state.sectorAlerts };
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
  let workingState = state;
  if (tickTime > 0 && tickTime % SECTOR_ALERT_DECAY_INTERVAL === 0) {
    const decayedAlerts = {};
    for (const sectorId of SECTOR_IDS) {
      const current = workingState.sectorAlerts[sectorId];
      decayedAlerts[sectorId] = { ...current, level: /** @type {0|1|2|3} */ (Math.max(0, current.level - 1)) };
    }
    workingState = { ...workingState, sectorAlerts: decayedAlerts };
  }
  for (const threat of Object.values(state.threats)) {
    const { threat: updated, rngState, sectorAlerts } = updateThreat(workingState, threat, tickTime);
    nextThreats[threat.id] = updated;
    workingState = { ...workingState, rngState, sectorAlerts, threats: { ...workingState.threats, [threat.id]: updated } };
  }

  let combatTrigger = state.combatTrigger;
  if (state.playerNodeId) {
    const collided = Object.values(nextThreats).find((t) => t.nodeId === state.playerNodeId);
    if (collided) combatTrigger = { threatId: collided.id, nodeId: collided.nodeId };
  }

  return refreshActiveRecon({ ...workingState, time: tickTime, threats: nextThreats, combatTrigger });
}

/**
 * §5.1.2 steps 1-6 at a single instant `t`: collapse, exit timers, noise/false-target expiry.
 * World-tick threat logic (step 7) is handled separately by the caller, only on 10-point
 * boundaries.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} t
 * @returns {import('./types.js').FacilityRunState}
 */
function applyTimerBoundary(state, t) {
  if (t >= RUN_COLLAPSE_TIME) return { ...state, time: RUN_COLLAPSE_TIME, phase: /** @type {const} */ ('collapsed') };

  let exits = state.exits;
  for (const exitId of /** @type {const} */ (['A', 'B'])) {
    let exit = /** @type {import('./types.js').StandardExitRuntimeState} */ (exits[exitId]);
    if (exit.status === 'requesting' && exit.interactionEndsAt === t) {
      exit = { ...exit, status: 'opening' };
    }
    if (exit.status === 'opening' && exit.opensAt === t) {
      exit = { ...exit, status: 'open', openEndsAt: t + EXIT_OPEN_WINDOW };
    }
    if (exit.status === 'open' && exit.openEndsAt === t) {
      const disabled = t >= exit.disabledAt;
      exit = {
        ...exit, status: disabled ? 'disabled' : 'closed', signalStartedAt: null, requestId: null, interactionEndsAt: null, opensAt: null, openEndsAt: null,
      };
    }
    if (exit.status === 'closed' && exit.disabledAt === t) {
      exit = { ...exit, status: 'disabled' };
    }
    exits = { ...exits, [exitId]: exit };
  }

  const noiseEvents = state.noiseEvents.filter((e) => e.expiresAt !== t);
  const falseTargets = state.falseTargets.filter((e) => e.expiresAt !== t);
  const activeBarriers = state.activeBarriers.filter((b) => b.expiresAt !== t);
  const hackedCameras = state.hackedCameras.filter((camera) => camera.expiresAt > t);
  const activeRecon = state.activeRecon?.expiresAt != null && state.activeRecon.expiresAt <= t
    ? null
    : state.activeRecon;

  return refreshActiveRecon({
    ...state, time: t, exits, noiseEvents, falseTargets, activeBarriers, hackedCameras, activeRecon,
  });
}

/**
 * §5.1/§5.1.2/§5.2: advance `state.time` to `targetTime`, processing every 10-point boundary's
 * timer events and (on that same boundary) one round of threat target-selection/movement. Stops
 * early if the run reaches RUN_COLLAPSE_TIME.
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} targetTime
 * @returns {import('./types.js').FacilityRunState}
 */
export function advanceTime(state, targetTime) {
  let current = state;
  let t = current.time;
  while (t < targetTime && current.phase === 'active') {
    const nextBoundary = Math.min(targetTime, Math.ceil((t + 1) / WORLD_TICK_INTERVAL) * WORLD_TICK_INTERVAL, RUN_COLLAPSE_TIME);
    current = applyTimerBoundary(current, nextBoundary);
    if (current.phase !== 'active') break;
    if (nextBoundary % WORLD_TICK_INTERVAL === 0) current = worldTick(current, nextBoundary);
    t = nextBoundary;
  }
  return current;
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
  if (edge.features.includes('blocked') && !state.openedEdgeIds.includes(edge.id)) return false;
  if (edge.features.includes('highGround') && effectiveForRequirement(effectiveMobility) < 3) return false;
  return true;
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
  const hops = bfsHopDistances(state.graph.edges, nodeId);
  const threats = { ...state.threats };
  for (const threat of Object.values(state.threats)) {
    const hop = hops.get(threat.nodeId);
    if (hop === undefined || hop > CAMERA_ALERT_RANGE) continue;
    threats[threat.id] = {
      ...threat,
      mode: 'pursuit', alert: 3, lastKnownPlayerNodeId: nodeId, pursuitStrength: 3,
      target: { kind: 'player', nodeId },
    };
  }
  return {
    ...state,
    threats,
    lastCameraDetection: { cameraId: camera.id, nodeId, detectedAt: state.time },
  };
}

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
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  const traversedEdge = state.graph.edges.find((e) => {
    const connects = (e.from === state.playerNodeId && e.to === destinationNodeId) || (e.to === state.playerNodeId && e.from === destinationNodeId);
    return connects && isEdgeTraversable(state, e, /** @type {string} */ (state.playerNodeId), effectiveMobility);
  });
  if (!traversedEdge) throw new Error(`${destinationNodeId} is not currently reachable from ${state.playerNodeId}`);

  const visitedNodeIds = state.visitedNodeIds.includes(destinationNodeId)
    ? state.visitedNodeIds
    : [...state.visitedNodeIds, destinationNodeId];
  let moved = { ...state, playerNodeId: destinationNodeId, visitedNodeIds, combatTrigger: null, activeRecon: null, activeConcealment: null, encounter: null };
  moved = applyCameraDetection(moved, destinationNodeId, effectiveStealth);
  const stealthIndex = Math.max(-2, Math.min(4, effectiveStealth)) + 2;
  const movementNoise = [3, 2, 1, 0, 0, 0, 0][stealthIndex];
  if (movementNoise > 0) moved = reportNoise(moved, destinationNodeId, /** @type {1|2|3} */ (movementNoise), state.time);
  if (effectiveStealth <= 2) {
    const tier = /** @type {1|2} */ (effectiveStealth <= -2 ? 2 : 1);
    moved = { ...moved, evidence: [...moved.evidence, { id: idForNewEntry(state, moved.evidence, 'evidence'), nodeId: destinationNodeId, tier, createdBySectorId: destinationNodeId.split('_')[0] }] };
  }
  // 엣지마다 기하학적 길이에 따라 다른 시간 비용을 갖는다(facilityGraph.js 참고) — 더 이상
  // 모든 이동이 균일한 STANDARD_EDGE_TIME_COST가 아니다.
  const mobilityIndex = Math.max(-2, Math.min(4, effectiveMobility)) + 2;
  const timeCost = Math.max(10, Math.round(traversedEdge.timeCost * MOBILITY_MOVE_TIME_MULTIPLIER[mobilityIndex]));
  return advanceTime(moved, moved.time + timeCost);
}

/**
 * §6.1 공통 접근 모드: safe/+40 time,-1 noise(min 0), rush/-40 time(min 20),+1 noise(max 3).
 * @param {number} baseTime @param {number} baseNoise @param {'safe'|'normal'|'rush'} mode
 */
function applyApproachMode(baseTime, baseNoise, mode) {
  const time = Math.max(APPROACH_MIN_TIME, baseTime + APPROACH_TIME_DELTA[mode]);
  const noise = Math.max(0, Math.min(3, baseNoise + APPROACH_NOISE_DELTA[mode]));
  return { time, noise };
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
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  const playerNodeId = state.playerNodeId;
  const edge = state.graph.edges.find((e) => e.id === edgeId);
  if (!edge) throw new Error(`unknown edge ${edgeId}`);
  if (edge.from !== playerNodeId && edge.to !== playerNodeId) throw new Error(`edge ${edgeId} is not adjacent to the current node`);
  if (state.openedEdgeIds.includes(edgeId)) return state;
  const requiredFeature = capabilityKind === 'force' ? 'blocked' : 'electronic';
  if (!edge.features.includes(requiredFeature)) throw new Error(`edge ${edgeId} has no '${requiredFeature}' approach`);
  if (effectiveForRequirement(effectiveCapability) < 1) throw new Error(`${capabilityKind} too low to attempt edge ${edgeId}`);

  const baseTime = capabilityKind === 'force' ? FORCE_TIER1_TIME : HACKING_TIER1_TIME;
  const baseNoise = capabilityKind === 'force' ? FORCE_BASE_NOISE : HACKING_BASE_NOISE;
  const { time, noise } = applyApproachMode(baseTime, baseNoise, mode);

  let next = { ...state, openedEdgeIds: [...state.openedEdgeIds, edgeId] };
  if (capabilityKind === 'hacking') {
    const overloadGain = HACKING_TIER1_OVERLOAD_GAIN + (mode === 'rush' ? RUSH_OVERLOAD_GAIN : 0) - (mode === 'safe' ? 3 : 0);
    next = applyOverloadDelta(next, Math.max(0, overloadGain));
  } else if (mode !== 'safe') {
    // §6.3 "Force... 기본 소음 2와 흔적을 남기며" — safe Force downgrades strong evidence to
    // normal but never removes it entirely (§6.1); MVP always leaves a normal trace unless safe.
    const tier = /** @type {1|2} */ (mode === 'rush' ? 2 : 1);
    next = { ...next, evidence: [...next.evidence, { id: idForNewEntry(state, next.evidence, 'evidence'), nodeId: playerNodeId, tier, createdBySectorId: edge.from.split('_')[0] }] };
  }
  if (noise > 0) next = reportNoise(next, playerNodeId, /** @type {1|2|3} */ (noise), state.time);

  return advanceTime(next, state.time + time);
}

/**
 * §6.2 기본 정찰: Perception 요구 없음, 시간 80, 소음 0, 항상 성공. 현재/인접 노드에 위협이
 * 있는지 없는지만 확정한다 — 정확한 수·경계 상태는 상세 정찰(미구현) 몫이다.
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function basicRecon(state) {
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  const targets = new Set([state.playerNodeId]);
  for (const e of state.graph.edges) {
    if (e.from === state.playerNodeId) targets.add(e.to);
    if (e.to === state.playerNodeId) targets.add(e.from);
  }
  const activeRecon = { source: /** @type {const} */ ('basic'), sourceNodeId: state.playerNodeId, targetNodeIds: [...targets], expiresAt: null };
  return advanceTime(refreshActiveRecon({ ...state, activeRecon }), state.time + BASIC_RECON_TIME);
}

/**
 * §신규 은엄폐: 현재 노드에 배치된 은엄폐를 사용해 그 노드에 머무는 동안 임시로 Stealth를
 * 올린다(다른 노드로 이동하면 moveToAdjacentNode가 activeConcealment를 지운다). 이 노드에
 * 은엄폐가 없으면 던진다(§다른 시설맵 액션과 같은 실패 관례).
 * @param {import('./types.js').FacilityRunState} state
 * @returns {import('./types.js').FacilityRunState}
 */
export function useConcealment(state) {
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  const bonus = state.graph.concealmentByNodeId[state.playerNodeId];
  if (!bonus) throw new Error(`no concealment at ${state.playerNodeId}`);
  const activeConcealment = { nodeId: state.playerNodeId, bonus };
  return advanceTime({ ...state, activeConcealment }, state.time + CONCEALMENT_ACTION_TIME_COST);
}

/**
 * @param {number} baseEffectiveStealth
 * @param {import('./types.js').FacilityRunState} state
 * @returns {number}
 */
export function effectiveStealthWithConcealment(baseEffectiveStealth, state) {
  const active = state.activeConcealment;
  if (!active || active.nodeId !== state.playerNodeId) return baseEffectiveStealth;
  return baseEffectiveStealth + active.bonus;
}

/** Effective Hacking -> direct hacking range in graph hops. */
export function cameraHackRange(effectiveHacking) {
  return CAMERA_HACK_RANGE_BY_HACKING[Math.max(-2, Math.min(4, effectiveHacking)) + 2];
}

/** Whether a hacking target is reachable directly, or through the hacked interface at this node. */
function canReachHackingTarget(state, targetNodeId, effectiveHacking) {
  if (effectiveForRequirement(effectiveHacking) < 1) return false;
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
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('access interface hacking unavailable');
  if (effectiveForRequirement(effectiveHacking) < 1) throw new Error('Hacking 1+ required');
  const accessInterface = state.graph.accessInterfaces.find((entry) => entry.id === interfaceId);
  if (!accessInterface) throw new Error(`unknown access interface ${interfaceId}`);
  if (accessInterface.nodeId !== state.playerNodeId) throw new Error('access interface must be hacked at its node');
  if ((state.hackedInterfaceIds || []).includes(interfaceId)) return state;
  let next = applyOverloadDelta(state, CAMERA_HACK_OVERLOAD);
  next = { ...next, hackedInterfaceIds: [...(next.hackedInterfaceIds || []), interfaceId] };
  return advanceTime(next, state.time + CAMERA_HACK_TIME);
}

/** Hack a camera at the current/nearby node, or anywhere in this sector through a hacked interface. */
export function hackCamera(state, cameraId, effectiveHacking) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('camera hacking unavailable');
  const camera = state.graph.cameras.find((entry) => entry.id === cameraId);
  if (!camera) throw new Error(`unknown camera ${cameraId}`);
  if ((state.disabledCameraIds || []).includes(cameraId)) throw new Error('camera is already destroyed');
  if (effectiveForRequirement(effectiveHacking) < 1) throw new Error('Hacking 1+ required');
  if (!canReachHackingTarget(state, camera.nodeId, effectiveHacking)) throw new Error(`camera ${cameraId} is out of range`);

  const completesAt = state.time + CAMERA_HACK_TIME;
  const expiresAt = completesAt + CAMERA_HACK_DURATION;
  const targetNodeIds = new Set([camera.nodeId]);
  for (const edge of state.graph.edges) {
    if (edge.from === camera.nodeId) targetNodeIds.add(edge.to);
    if (edge.to === camera.nodeId) targetNodeIds.add(edge.from);
  }
  let next = applyOverloadDelta(state, CAMERA_HACK_OVERLOAD);
  next = {
    ...next,
    hackedCameras: [...next.hackedCameras.filter((entry) => entry.cameraId !== cameraId), { cameraId, expiresAt }],
    activeRecon: { source: 'camera', sourceNodeId: camera.nodeId, targetNodeIds: [...targetNodeIds], expiresAt },
  };
  return advanceTime(refreshActiveRecon(next), completesAt);
}

/** Permanently destroy a camera from its node. This is a loud Force action. */
export function destroyCamera(state, cameraId, effectiveForce) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('camera destruction unavailable');
  if (effectiveForRequirement(effectiveForce) < 1) throw new Error('Force 1+ required');
  const camera = state.graph.cameras.find((entry) => entry.id === cameraId);
  if (!camera) throw new Error(`unknown camera ${cameraId}`);
  if (camera.nodeId !== state.playerNodeId) throw new Error('Force requires standing at the camera');
  if ((state.disabledCameraIds || []).includes(cameraId)) return state;
  let next = reportNoise(state, state.playerNodeId, /** @type {1|2|3} */ (CAMERA_FORCE_NOISE), state.time);
  next = { ...next, disabledCameraIds: [...(next.disabledCameraIds || []), cameraId] };
  return advanceTime(next, state.time + CAMERA_FORCE_TIME);
}

/** Disable a sector battery generator. Hacking follows the normal direct/interface access rule;
 * Force is loud and requires physically standing on the generator node. */
export function disableGenerator(state, generatorId, capabilityKind, effectiveCapability) {
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('generator control unavailable');
  const generator = state.graph.generators?.find((entry) => entry.id === generatorId);
  if (!generator) throw new Error(`unknown generator ${generatorId}`);
  if (state.disabledGeneratorIds.includes(generatorId)) return state;
  if (effectiveForRequirement(effectiveCapability) < 1) throw new Error(`${capabilityKind} 1+ required`);

  let next = state;
  if (capabilityKind === 'hacking') {
    if (!canReachHackingTarget(state, generator.nodeId, effectiveCapability)) throw new Error('generator is out of hacking range');
    next = applyOverloadDelta(next, GENERATOR_HACK_OVERLOAD);
    next = { ...next, disabledGeneratorIds: [...next.disabledGeneratorIds, generatorId] };
    return advanceTime(next, state.time + GENERATOR_HACK_TIME);
  }
  if (capabilityKind !== 'force' || state.playerNodeId !== generator.nodeId) throw new Error('Force requires standing at the generator');
  next = reportNoise(next, state.playerNodeId, /** @type {1|2|3} */ (GENERATOR_FORCE_NOISE), state.time);
  next = { ...next, disabledGeneratorIds: [...next.disabledGeneratorIds, generatorId] };
  return advanceTime(next, state.time + GENERATOR_FORCE_TIME);
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
  if (state.phase !== 'active' || !state.playerNodeId) throw new Error('control room hacking unavailable');
  const landmark = state.graph.landmarks.find((l) => l.nodeId === state.playerNodeId);
  if (!landmark) throw new Error('not at a sector control room');
  const level = effectiveForRequirement(effectiveHacking);
  if (level < 1) throw new Error('Hacking 1+ required');

  let next = applyOverloadDelta(state, CONTROL_ROOM_HACK_OVERLOAD);

  const revealedPatrolRouteSectorIds = next.revealedPatrolRouteSectorIds.includes(landmark.sectorId)
    ? next.revealedPatrolRouteSectorIds
    : [...next.revealedPatrolRouteSectorIds, landmark.sectorId];
  next = { ...next, revealedPatrolRouteSectorIds };

  if (level >= 2) {
    const current = next.sectorAlerts[landmark.sectorId];
    const decreased = /** @type {0|1|2|3} */ (Math.max(0, current.level - (level - 1)));
    next = { ...next, sectorAlerts: { ...next.sectorAlerts, [landmark.sectorId]: { ...current, level: decreased } } };
  }

  if (level >= 3) {
    const threats = {};
    for (const [id, threat] of Object.entries(next.threats)) {
      threats[id] = { ...threat, mode: 'patrol', pursuitStrength: 0, lastKnownPlayerNodeId: null, target: null };
    }
    next = { ...next, threats };
  }

  return advanceTime(next, state.time + CONTROL_ROOM_HACK_TIME);
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
  if (state.phase !== 'active') throw new Error('run already ended');
  const opportunity = state.graph.opportunities.find((o) => o.id === opportunityId);
  if (!opportunity) throw new Error(`unknown opportunity ${opportunityId}`);
  if (opportunity.nodeId !== state.playerNodeId) throw new Error(`opportunity ${opportunityId} is not at the current node`);
  if (opportunity.usesRemaining <= 0) throw new Error(`opportunity ${opportunityId} already consumed`);

  const { time, noise } = applyApproachMode(FARM_TIME, FARM_NOISE, mode);
  const graph = { ...state.graph, opportunities: state.graph.opportunities.map((o) => (o.id === opportunityId ? { ...o, usesRemaining: o.usesRemaining - 1 } : o)) };
  let next = { ...state, graph, keyDiscovered: state.keyDiscovered || opportunity.keyEligible };
  if (noise > 0 && state.playerNodeId) next = reportNoise(next, state.playerNodeId, /** @type {1|2|3} */ (noise), state.time);
  next = advanceTime(next, state.time + time);
  next = { ...next, lastActionResult: { kind: 'farm', nodeId: opportunity.nodeId, opportunityId, status: next.combatTrigger ? 'ambushed' : 'completed', completedAt: next.time } };
  return { state: next, keyGranted: opportunity.keyEligible };
}

/**
 * §11.1/docs/map-equipment-capability-mapping.md 능동 현장 효과. `contract`는 caller가
 * capabilityEngine.listFieldActiveEquipment(loadout)에서 골라 넘긴다 — 안전/신속/강행 접근을
 * 적용하지 않으며(§6.3 매핑 문서 note) 표의 시간·Overload·지속시간이 최종값이다.
 * @param {import('./types.js').FacilityRunState} state
 * @param {string} instanceId 장비 인스턴스 id — 쿨다운 키.
 * @param {import('../data/facilityEquipmentCapabilities.js').MapEquipmentContract['fieldAction']} contract
 * @param {string} [targetId] snapshot_scan은 불필요, remote_intrusion은 대상 노드, temporary_barrier는 대상 엣지.
 * @returns {import('./types.js').FacilityRunState}
 */
export function useFieldEquipment(state, instanceId, contract, targetId) {
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  if (!contract) throw new Error(`${instanceId} has no active field effect`);
  const readyAt = state.fieldCooldowns[instanceId] || 0;
  if (state.time < readyAt) throw new Error(`${instanceId} is on cooldown until ${readyAt}`);

  let next = applyOverloadDelta(state, contract.overloadGain);
  const completesAt = state.time + contract.timeCost;

  if (contract.kind === 'snapshot_scan') {
    const hops = bfsHopDistances(state.graph.edges, state.playerNodeId);
    const threatNodes = new Set(Object.values(state.threats).map((t) => t.nodeId));
    const observations = { ...next.observations };
    for (const node of state.graph.nodes) {
      const h = hops.get(node.id);
      if (h !== undefined && h <= contract.range) observations[node.id] = { observedAt: completesAt, hasThreat: threatNodes.has(node.id) };
    }
    next = { ...next, observations };
  } else if (contract.kind === 'remote_intrusion') {
    if (!targetId) throw new Error('remote_intrusion requires a target node');
    if (!state.graph.nodes.some((n) => n.id === targetId)) throw new Error(`unknown node ${targetId}`);
    const hops = bfsHopDistances(state.graph.edges, state.playerNodeId);
    const hop = hops.get(targetId);
    if (hop === undefined || hop === 0 || hop > contract.range) throw new Error(`node ${targetId} is out of range for remote_intrusion`);
    next = reportFalseTarget(next, targetId, 2, contract.duration ?? 200, completesAt);
  } else if (contract.kind === 'temporary_barrier') {
    if (!targetId) throw new Error('temporary_barrier requires a target edge');
    const targetEdge = state.graph.edges.find((e) => e.id === targetId);
    if (!targetEdge) throw new Error(`unknown edge ${targetId}`);
    const hops = bfsHopDistances(state.graph.edges, state.playerNodeId);
    const hopFrom = hops.get(targetEdge.from);
    const hopTo = hops.get(targetEdge.to);
    const inRange = (hopFrom !== undefined && hopFrom <= contract.range) || (hopTo !== undefined && hopTo <= contract.range);
    if (!inRange) throw new Error(`edge ${targetId} is out of range for temporary_barrier`);
    next = { ...next, activeBarriers: [...next.activeBarriers, { edgeId: targetId, expiresAt: completesAt + (contract.duration ?? 0) }] };
  }

  next = { ...next, fieldCooldowns: { ...next.fieldCooldowns, [instanceId]: completesAt + contract.cooldown } };
  return advanceTime(next, completesAt);
}
