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
import { gainOverload, reduceOverload, isLethalOverload } from './overloadEngine.js';
import { effectiveForRequirement } from './capabilityEngine.js';
import {
  RUN_COLLAPSE_TIME, WORLD_TICK_INTERVAL, EXIT_A_DISABLED_AT, EXIT_B_DISABLED_AT,
  EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW, EXIT_OPEN_WAIT_BY_HACKING, NOISE_DURATION,
  INVESTIGATION_MEMORY_DURATION, THREAT_MOVE_INTERVAL, SECTOR_ALERT_INVESTIGATE_INTERVAL,
  SECTOR_ALERT_MIN_ENEMY_ALERT, NOISE_HOP_RANGE, SECTOR_IDS, STANDARD_EDGE_TIME_COST,
  APPROACH_TIME_DELTA, APPROACH_NOISE_DELTA, APPROACH_MIN_TIME, BASIC_RECON_TIME, FARM_TIME,
  FARM_NOISE, FORCE_TIER1_TIME, FORCE_BASE_NOISE, HACKING_TIER1_TIME, HACKING_BASE_NOISE,
  HACKING_TIER1_OVERLOAD_GAIN, RUSH_OVERLOAD_GAIN,
} from '../data/facilityLayout.js';

let seq = 0;
/** @param {string} prefix */
function freshId(prefix) { return `${prefix}${seq++}`; }

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

  /** @type {Record<string, import('./types.js').ThreatRuntimeState>} */
  const threats = {};
  for (const roster of graph.threats) {
    threats[roster.id] = {
      id: roster.id,
      sectorId: roster.sectorId,
      size: roster.size,
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
    rngState: createRngState(seed),
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
    exits: /** @type {any} */ (exits),
    threats,
    noiseEvents: [],
    falseTargets: [],
    evidence: [],
    sectorAlerts,
    combatTrigger: null,
  };
}

/**
 * §8: apply an Overload change (positive = gain, respects the multiplier and rounds; negative =
 * reduction, clamped to the equipped floor — see overloadEngine.js, the same rules combat uses).
 * Reaching >=100 ends the run immediately regardless of HP (§8.1).
 * @param {import('./types.js').FacilityRunState} state
 * @param {number} amount
 * @returns {import('./types.js').FacilityRunState}
 */
export function applyOverloadDelta(state, amount) {
  const overload = amount >= 0
    ? gainOverload(state.overload, amount, state.overloadGainMultiplier)
    : reduceOverload(state.overload, -amount, state.overloadFloor);
  const phase = isLethalOverload(overload) ? 'meltdown' : state.phase;
  return { ...state, overload, phase };
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
  const requestId = freshId('req');
  return {
    ...state,
    exits: {
      ...state.exits,
      [exitId]: {
        ...exit, status: 'requesting', interactionEndsAt, opensAt, requestId, signalStartedAt: state.time,
      },
    },
  };
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
  const event = { id: freshId('noise'), sourceNodeId, intensity, createdAt, expiresAt: createdAt + NOISE_DURATION };
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
  const event = { id: freshId('falseTarget'), sourceNodeId, intensity, createdAt, expiresAt: createdAt + duration };
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

  return { ...workingState, threats: nextThreats, combatTrigger };
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

  return {
    ...state, time: t, exits, noiseEvents, falseTargets, activeBarriers,
  };
}

/**
 * §5.1/§5.1.2/§5.2: advance `state.time` to `targetTime`, processing every 10-point boundary's
 * timer events and (on that same boundary) one round of threat target-selection/movement. Stops
 * early if the run collapses at 4000.
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
function isEdgeTraversable(state, edge, fromId) {
  if (edge.features.includes('oneWay') && edge.from !== fromId) return false;
  if (edge.features.includes('blocked') && !state.openedEdgeIds.includes(edge.id)) return false;
  return true;
}

/**
 * Minimal player movement for the §10 map UI, ahead of the real Capability-costed action system
 * (phase 4). Uses the flat Mobility-0 corridor cost (§6.2, STANDARD_EDGE_TIME_COST) regardless of
 * loadout — every baseline's effective Mobility changes only the *cost*, never whether movement
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
export function moveToAdjacentNode(state, destinationNodeId) {
  if (state.phase !== 'active') throw new Error('run already ended');
  if (!state.playerNodeId) throw new Error('player is not at a node');
  const usable = state.graph.edges.some((e) => {
    const connects = (e.from === state.playerNodeId && e.to === destinationNodeId) || (e.to === state.playerNodeId && e.from === destinationNodeId);
    return connects && isEdgeTraversable(state, e, /** @type {string} */ (state.playerNodeId));
  });
  if (!usable) throw new Error(`${destinationNodeId} is not currently reachable from ${state.playerNodeId}`);

  const visitedNodeIds = state.visitedNodeIds.includes(destinationNodeId)
    ? state.visitedNodeIds
    : [...state.visitedNodeIds, destinationNodeId];
  const moved = { ...state, playerNodeId: destinationNodeId, visitedNodeIds, combatTrigger: null };
  return advanceTime(moved, moved.time + STANDARD_EDGE_TIME_COST);
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
    next = { ...next, evidence: [...next.evidence, { id: freshId('evidence'), nodeId: playerNodeId, tier, createdBySectorId: edge.from.split('_')[0] }] };
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
  const threatNodes = new Set(Object.values(state.threats).map((t) => t.nodeId));
  const observations = { ...state.observations };
  for (const nodeId of targets) observations[nodeId] = { observedAt: state.time, hasThreat: threatNodes.has(nodeId) };
  return advanceTime({ ...state, observations }, state.time + BASIC_RECON_TIME);
}

/**
 * §6.2 파밍: 현재 노드의 소진되지 않은 현장 기회 하나를 소진한다. 열쇠 대상 여부는 맵 생성 때
 * 이미 고정돼 있으므로(§5.1.1) 여기서는 그 값을 그대로 반영만 한다 — 실제 보상 지급/인벤토리
 * 반영은 아직 없다(현장 기회 보상 콘텐츠는 이후 단계 과제).
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
  if (opportunity.consumed) throw new Error(`opportunity ${opportunityId} already consumed`);

  const { time, noise } = applyApproachMode(FARM_TIME, FARM_NOISE, mode);
  const graph = { ...state.graph, opportunities: state.graph.opportunities.map((o) => (o.id === opportunityId ? { ...o, consumed: true } : o)) };
  let next = { ...state, graph };
  if (noise > 0 && state.playerNodeId) next = reportNoise(next, state.playerNodeId, /** @type {1|2|3} */ (noise), state.time);
  next = advanceTime(next, state.time + time);
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
    next = reportFalseTarget(next, targetId, 2, contract.duration ?? 200, completesAt);
  } else if (contract.kind === 'temporary_barrier') {
    if (!targetId) throw new Error('temporary_barrier requires a target edge');
    if (!state.graph.edges.some((e) => e.id === targetId)) throw new Error(`unknown edge ${targetId}`);
    next = { ...next, activeBarriers: [...next.activeBarriers, { edgeId: targetId, expiresAt: completesAt + (contract.duration ?? 0) }] };
  }

  next = { ...next, fieldCooldowns: { ...next.fieldCooldowns, [instanceId]: completesAt + contract.cooldown } };
  return advanceTime(next, completesAt);
}
