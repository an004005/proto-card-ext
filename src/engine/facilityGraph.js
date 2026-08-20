// 48-node extraction facility graph generation (docs/extraction-map-implementation-spec.md §4).
// Pure and deterministic: every function threads rngState explicitly (see rng.js), never calls
// Math.random(). This module is standalone — it does not touch mapEngine.js/gameReducer.js/
// MapScreen.js, which keep running the existing 8-floor map until a later phase swaps them over.
//
// Topology design: all 48 nodes sit on one long chain ordered by sector (entrance/labs/security/
// power — see the GLOBAL_SKIP_STEP comment in facilityLayout.js). Two edge families cover the
// chain: `spine` (position i to i+1) and `skip` (position i to i+2). This gives every position
// degree ~4 (2~4 including the chain ends), a large, predictable diameter (shortest path between
// two positions p positions apart is ceil(p/2) hops), and 2-edge-connectivity everywhere — a
// plain per-sector-cycle-plus-bridges topology was tried first and its diameter never exceeded
// ~12 hops (spec needs ~18-22 for exit B), so it could never hit the exit distance ranges at all.
// This is what makes the exit distance targets (§2.2) and the "2 edge-disjoint paths to every
// exit" requirement (§4.1 step 5) actually achievable by search rather than by luck.
//
// Special edges (§4.2) are always ADDITIONAL edges layered on top of this base graph, never a
// replacement of an existing edge. That is a deliberate simplification: it guarantees the base
// graph's connectivity/edge-disjoint-path invariants can never be broken by special-edge
// placement, which is exactly what §4.1 step 8 (disconnection recovery) requires.

import { createRngState, nextFloat, nextInt, pick, shuffle, weightedPick } from './rng.js';
import { bfsHopDistances, countEdgeDisjointPaths, reachableSet } from './graphUtils.js';
import {
  SECTOR_IDS, NODES_PER_SECTOR, STANDARD_EDGE_TIME_COST, GLOBAL_SKIP_STEP, EXIT_DISTANCE_RANGES,
  SPECIAL_EDGES_PER_SECTOR_MIN, SPECIAL_EDGES_PER_SECTOR_MAX, SPECIAL_EDGE_CATEGORY_WEIGHTS,
  SPECIAL_EDGE_SECOND_TAG_CHANCE, LANDMARKS_BY_SECTOR, OPPORTUNITY_COUNT_WEIGHTS,
  KEY_DROP_CHANCE, THREAT_COUNT_BY_SECTOR, THREAT_MIN_HOPS_FROM_START,
  THREAT_MIN_HOPS_BETWEEN_MARKERS, THREAT_PATROL_ROUTE_MIN, THREAT_PATROL_ROUTE_MAX,
  THREAT_GROUP_SIZE_WEIGHTS, ENTRANCE_THREAT_MAX_GROUP_SIZE, GENERATION_MAX_ATTEMPTS,
  FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT,
} from '../data/facilityLayout.js';

// Derived from endpoints rather than a mutable counter — a module-level counter would make the
// `id` field depend on how many graphs were generated before this call, breaking the "same seed
// -> byte-identical graph" guarantee across repeated calls within one process.
/** @param {string} from @param {string} to */
function edgeId(from, to) { return `edge_${from}_${to}`; }

/**
 * @typedef {Object} Topology
 * @property {import('./types.js').FacilityNode[]} nodes
 * @property {import('./types.js').FacilityEdge[]} edges
 * @property {Record<string, string[]>} nodeIdsBySector
 * @property {string} startNodeId
 * @property {import('./types.js').ExitPlacement[]} exits
 */

/**
 * Steps 1-3 of §4.1. All 48 nodes sit on one long chain, ordered by sector (entrance, labs,
 * security, power — see GLOBAL_SKIP_STEP's comment in facilityLayout.js for why). Within each
 * sector the 12 nodes are placed along the chain in a random order (that's where seed variety
 * comes from); the sector order itself is fixed so "power is the deep sector" always holds.
 * Two edge families cover the whole chain: `spine` (position i to i+1) and `skip` (position i to
 * i+GLOBAL_SKIP_STEP). Every position has at least one spine + one skip neighbor on each side it
 * isn't a chain endpoint on, which is what keeps every node 2-edge-connected to every other node
 * without a separate per-sector cycle/bridge scheme.
 * @param {import('./rng.js').RngState} rngState
 */
export function buildBaseGraph(rngState) {
  let state = rngState;
  /** @type {import('./types.js').FacilityNode[]} */
  const nodes = [];
  const chain = [];
  /** @type {Record<string, string[]>} */
  const nodeIdsBySector = {};
  for (const sectorId of SECTOR_IDS) {
    const sectorNodeIds = Array.from({ length: NODES_PER_SECTOR }, (_, i) => `${sectorId}_${i}`);
    const { value: order, state: next } = shuffle(state, sectorNodeIds);
    state = next;
    for (const id of order) nodes.push({ id, sectorId });
    chain.push(...order);
    nodeIdsBySector[sectorId] = sectorNodeIds;
  }

  /** @type {import('./types.js').FacilityEdge[]} */
  const edges = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({ id: edgeId(chain[i], chain[i + 1]), from: chain[i], to: chain[i + 1], bidirectional: true, timeCost: STANDARD_EDGE_TIME_COST, features: [] });
  }
  for (let i = 0; i + GLOBAL_SKIP_STEP < chain.length; i++) {
    edges.push({ id: edgeId(chain[i], chain[i + GLOBAL_SKIP_STEP]), from: chain[i], to: chain[i + GLOBAL_SKIP_STEP], bidirectional: true, timeCost: STANDARD_EDGE_TIME_COST, features: [] });
  }

  return { nodes, edges, nodeIdsBySector, rngState: state };
}

/**
 * Step 4-5 of §4.1: place start + the three exits and verify distance/path requirements.
 * Returns null (caller retries) if no valid combination exists in this graph instance.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} edges
 * @param {import('./rng.js').RngState} rngState
 */
function placeStartAndExits(nodes, edges, rngState) {
  const entranceNodes = nodes.filter((n) => n.sectorId === 'entrance').map((n) => n.id);
  const { value: startNodeId, state: afterStart } = pick(rngState, entranceNodes);

  const hops = bfsHopDistances(edges, startNodeId);
  /** @type {Record<string, {id: string, weightedDistance: number}[]>} */
  const candidatesBySector = {};
  for (const node of nodes) {
    const hopCount = hops.get(node.id);
    if (hopCount === undefined) continue;
    (candidatesBySector[node.sectorId] ||= []).push({ id: node.id, weightedDistance: hopCount * STANDARD_EDGE_TIME_COST });
  }

  /**
   * @param {{id: string, weightedDistance: number}[]} candidates
   * @param {{min: number, max: number}} range
   */
  const inRange = (candidates, range) => candidates.filter((c) => c.weightedDistance >= range.min && c.weightedDistance <= range.max);

  let state = afterStart;
  const { value: sectorOrder, state: afterShuffle } = shuffle(state, SECTOR_IDS);
  state = afterShuffle;

  for (const sectorA of sectorOrder) {
    const aPool = inRange(candidatesBySector[sectorA] || [], EXIT_DISTANCE_RANGES.A);
    if (aPool.length === 0) continue;
    for (const nodeA of aPool) {
      for (const sectorKey of sectorOrder) {
        if (sectorKey === sectorA) continue;
        const keyPool = inRange(candidatesBySector[sectorKey] || [], EXIT_DISTANCE_RANGES.key)
          .filter((c) => c.weightedDistance > nodeA.weightedDistance);
        if (keyPool.length === 0) continue;
        for (const nodeKey of keyPool) {
          for (const sectorB of sectorOrder) {
            if (sectorB === sectorA || sectorB === sectorKey) continue;
            const bPool = inRange(candidatesBySector[sectorB] || [], EXIT_DISTANCE_RANGES.B)
              .filter((c) => c.weightedDistance > nodeKey.weightedDistance);
            if (bPool.length === 0) continue;
            const nodeB = bPool[0];
            /** @type {import('./types.js').ExitPlacement[]} */
            const exits = [
              { exitId: 'A', nodeId: nodeA.id, sectorId: sectorA, weightedDistanceFromStart: nodeA.weightedDistance },
              { exitId: 'key', nodeId: nodeKey.id, sectorId: sectorKey, weightedDistanceFromStart: nodeKey.weightedDistance },
              { exitId: 'B', nodeId: nodeB.id, sectorId: sectorB, weightedDistanceFromStart: nodeB.weightedDistance },
            ];
            const pathsOk = exits.every((exit) => countEdgeDisjointPaths(edges, startNodeId, exit.nodeId, 2) >= 2);
            if (!pathsOk) continue;
            return { startNodeId, exits, rngState: state };
          }
        }
      }
    }
  }
  return null;
}

/**
 * §4.1 steps 1-5+8 as a single attempt. Returns `{ok:false}` if this rngState's graph can't
 * satisfy the exit/path requirements — caller retries with the returned rngState.
 * @param {import('./rng.js').RngState} rngState
 * @returns {{ok: false, rngState: import('./rng.js').RngState} | {ok: true, topology: Topology, rngState: import('./rng.js').RngState}}
 */
function tryBuildTopology(rngState) {
  const base = buildBaseGraph(rngState);
  const placement = placeStartAndExits(base.nodes, base.edges, base.rngState);
  if (!placement) return { ok: false, rngState: base.rngState };

  // Step 7: every node reachable from start (guaranteed by construction — each sector is a
  // connected cycle and every adjacent pair is bridged — but assert it defensively since a
  // future change to buildBaseGraph could silently break this).
  const reachable = reachableSet(base.edges, placement.startNodeId);
  if (reachable.size !== base.nodes.length) return { ok: false, rngState: placement.rngState };

  return {
    ok: true,
    topology: {
      nodes: base.nodes,
      edges: base.edges,
      nodeIdsBySector: base.nodeIdsBySector,
      startNodeId: placement.startNodeId,
      exits: placement.exits,
    },
    rngState: placement.rngState,
  };
}

/** @type {Topology | null} */
let cachedFallbackTopology = null;
function getFallbackTopology() {
  if (cachedFallbackTopology) return cachedFallbackTopology;
  for (let seed = 0; seed < FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT; seed++) {
    const result = tryBuildTopology(createRngState(seed));
    if (result.ok) {
      cachedFallbackTopology = result.topology;
      return cachedFallbackTopology;
    }
  }
  throw new Error(`no valid fallback facility topology found within ${FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT} attempts`);
}

/**
 * §4.2 special edges: additional edges layered on top of the base graph, never replacing one.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} baseEdges
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {import('./rng.js').RngState} rngState
 */
function placeSpecialEdges(nodes, baseEdges, nodeIdsBySector, rngState) {
  let state = rngState;
  const existing = new Set(baseEdges.map((e) => [e.from, e.to].sort().join('|')));
  const specialEdges = [];

  for (const sectorId of SECTOR_IDS) {
    const pool = nodeIdsBySector[sectorId];
    const { value: count, state: sCount } = nextInt(state, SPECIAL_EDGES_PER_SECTOR_MAX - SPECIAL_EDGES_PER_SECTOR_MIN + 1);
    state = sCount;
    const target = count + SPECIAL_EDGES_PER_SECTOR_MIN;
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < 50) {
      attempts += 1;
      const { value: a, state: sa } = pick(state, pool);
      const { value: b, state: sb } = pick(sa, pool);
      state = sb;
      if (a === b) continue;
      const key = [a, b].sort().join('|');
      if (existing.has(key)) continue;
      existing.add(key);

      const { value: category, state: sCat } = weightedPick(state, SPECIAL_EDGE_CATEGORY_WEIGHTS);
      state = sCat;
      const features = [category];
      if (category !== 'oneWay') {
        const { value: roll, state: sRoll } = nextFloat(state);
        state = sRoll;
        if (roll < SPECIAL_EDGE_SECOND_TAG_CHANCE) {
          const other = category === 'blocked' ? 'electronic' : 'blocked';
          features.push(other);
        }
      }
      specialEdges.push({
        id: edgeId(a, b),
        from: a,
        to: b,
        bidirectional: category !== 'oneWay',
        timeCost: STANDARD_EDGE_TIME_COST,
        features,
      });
      placed += 1;
    }
  }
  return { specialEdges, rngState: state };
}

/**
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {string[]} excludeNodeIds
 * @param {import('./rng.js').RngState} rngState
 */
function placeLandmarks(nodeIdsBySector, excludeNodeIds, rngState) {
  let state = rngState;
  const excluded = new Set(excludeNodeIds);
  const landmarks = [];
  for (const sectorId of SECTOR_IDS) {
    const def = LANDMARKS_BY_SECTOR[sectorId];
    const pool = nodeIdsBySector[sectorId].filter((id) => !excluded.has(id));
    const { value: nodeId, state: next } = pick(state, pool.length > 0 ? pool : nodeIdsBySector[sectorId]);
    state = next;
    landmarks.push({ id: def.id, nodeId, sectorId, approaches: def.approaches });
  }
  return { landmarks, rngState: state };
}

/**
 * §4.2/§5.1.1: 0-2 opportunities per node, each with a fixed keyEligible roll made now.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./rng.js').RngState} rngState
 */
function placeOpportunities(nodes, rngState) {
  let state = rngState;
  const opportunities = [];
  let seq = 0;
  for (const node of nodes) {
    const { value: count, state: sCount } = weightedPick(state, OPPORTUNITY_COUNT_WEIGHTS);
    state = sCount;
    for (let i = 0; i < count; i++) {
      const { value: roll, state: sRoll } = nextFloat(state);
      state = sRoll;
      opportunities.push({ id: `opp${seq++}`, nodeId: node.id, keyEligible: roll < KEY_DROP_CHANCE, consumed: false });
    }
  }
  return { opportunities, rngState: state };
}

/**
 * §4.2: initial threat markers, 2/3/4/3 across sectors, kept away from the start and each other.
 * @param {import('./types.js').FacilityEdge[]} allEdges
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {string} startNodeId
 * @param {import('./rng.js').RngState} rngState
 */
function placeThreats(allEdges, nodeIdsBySector, startNodeId, rngState) {
  let state = rngState;
  const startHops = bfsHopDistances(allEdges, startNodeId);
  const threats = [];
  let seq = 0;
  /** @type {string[]} */
  const placedAnchors = [];

  for (const sectorId of SECTOR_IDS) {
    const count = THREAT_COUNT_BY_SECTOR[sectorId];
    /** @type {Map<string, string[]>} */
    const sectorAdjacency = new Map();
    for (const edge of allEdges) {
      const fromSector = edge.from.startsWith(`${sectorId}_`);
      const toSector = edge.to.startsWith(`${sectorId}_`);
      if (!fromSector || !toSector) continue;
      if (!sectorAdjacency.has(edge.from)) sectorAdjacency.set(edge.from, []);
      if (!sectorAdjacency.has(edge.to)) sectorAdjacency.set(edge.to, []);
      /** @type {string[]} */ (sectorAdjacency.get(edge.from)).push(edge.to);
      /** @type {string[]} */ (sectorAdjacency.get(edge.to)).push(edge.from);
    }

    for (let i = 0; i < count; i++) {
      let anchor = null;
      let attempts = 0;
      while (!anchor && attempts < 100) {
        attempts += 1;
        const { value: candidate, state: sCand } = pick(state, nodeIdsBySector[sectorId]);
        state = sCand;
        const hopsFromStart = startHops.get(candidate) ?? Infinity;
        if (hopsFromStart < THREAT_MIN_HOPS_FROM_START) continue;
        const tooClose = placedAnchors.some((other) => (bfsHopDistances(allEdges, other).get(candidate) ?? Infinity) < THREAT_MIN_HOPS_BETWEEN_MARKERS);
        if (tooClose) continue;
        anchor = candidate;
      }
      if (!anchor) {
        const { value: fallback, state: sFallback } = pick(state, nodeIdsBySector[sectorId]);
        state = sFallback;
        anchor = fallback;
      }
      placedAnchors.push(anchor);

      const { value: routeLength, state: sLen } = nextInt(state, THREAT_PATROL_ROUTE_MAX - THREAT_PATROL_ROUTE_MIN + 1);
      state = sLen;
      const patrolRoute = [anchor];
      let current = anchor;
      for (let step = 1; step < routeLength + THREAT_PATROL_ROUTE_MIN; step++) {
        const neighbors = (sectorAdjacency.get(current) || []).filter((id) => !patrolRoute.includes(id));
        if (neighbors.length === 0) break;
        const { value: next, state: sNext } = pick(state, neighbors);
        state = sNext;
        patrolRoute.push(next);
        current = next;
      }

      let sizeWeights = THREAT_GROUP_SIZE_WEIGHTS;
      if (sectorId === 'entrance') sizeWeights = THREAT_GROUP_SIZE_WEIGHTS.filter((w) => w.value <= ENTRANCE_THREAT_MAX_GROUP_SIZE);
      const { value: size, state: sSize } = weightedPick(state, sizeWeights);
      state = sSize;

      threats.push({ id: `threat${seq++}`, sectorId, size, patrolRoute });
    }
  }
  return { threats, rngState: state };
}

/**
 * §4.1 step 6: special edges, landmarks, opportunities, threats. Always succeeds — no failure
 * mode here, unlike the topology step.
 * @param {Topology} topology
 * @param {import('./rng.js').RngState} rngState
 */
function placeContent(topology, rngState) {
  let state = rngState;

  const special = placeSpecialEdges(topology.nodes, topology.edges, topology.nodeIdsBySector, state);
  state = special.rngState;

  const reserved = [topology.startNodeId, ...topology.exits.map((e) => e.nodeId)];
  const landmarkResult = placeLandmarks(topology.nodeIdsBySector, reserved, state);
  state = landmarkResult.rngState;

  const opportunityResult = placeOpportunities(topology.nodes, state);
  state = opportunityResult.rngState;

  const allEdges = [...topology.edges, ...special.specialEdges];
  const threatResult = placeThreats(allEdges, topology.nodeIdsBySector, topology.startNodeId, state);
  state = threatResult.rngState;

  return {
    content: {
      edges: allEdges,
      landmarks: landmarkResult.landmarks,
      opportunities: opportunityResult.opportunities,
      threats: threatResult.threats,
    },
    rngState: state,
  };
}

/**
 * §4.1: generate the full 48-node facility graph for a seed. Deterministic — same seed always
 * produces the same graph, threats, opportunities, and key-eligible rolls.
 * @param {number} seed
 * @returns {{graph: import('./types.js').FacilityGraph, rngState: import('./rng.js').RngState, usedFallback: boolean}}
 */
export function generateFacilityGraph(seed) {
  let rngState = createRngState(seed);
  for (let attempt = 0; attempt < GENERATION_MAX_ATTEMPTS; attempt++) {
    const result = tryBuildTopology(rngState);
    rngState = result.rngState;
    if (result.ok) {
      const contentResult = placeContent(result.topology, rngState);
      return {
        graph: {
          nodes: result.topology.nodes,
          edges: contentResult.content.edges,
          startNodeId: result.topology.startNodeId,
          exits: result.topology.exits,
          landmarks: contentResult.content.landmarks,
          opportunities: contentResult.content.opportunities,
          threats: contentResult.content.threats,
        },
        rngState: contentResult.rngState,
        usedFallback: false,
      };
    }
  }

  const fallbackTopology = getFallbackTopology();
  const contentResult = placeContent(fallbackTopology, rngState);
  return {
    graph: {
      nodes: fallbackTopology.nodes,
      edges: contentResult.content.edges,
      startNodeId: fallbackTopology.startNodeId,
      exits: fallbackTopology.exits,
      landmarks: contentResult.content.landmarks,
      opportunities: contentResult.content.opportunities,
      threats: contentResult.content.threats,
    },
    rngState: contentResult.rngState,
    usedFallback: true,
  };
}

/**
 * Mobility 0 기준 가중 이동비용 (§2.2 검증용 헬퍼). 특수 엣지 포함 그래프 위에서 계산한다.
 * @param {import('./types.js').FacilityEdge[]} edges
 * @param {string} fromNodeId
 * @param {string} toNodeId
 */
export function computeWeightedDistance(edges, fromNodeId, toNodeId) {
  const hops = bfsHopDistances(edges, fromNodeId).get(toNodeId);
  return hops === undefined ? Infinity : hops * STANDARD_EDGE_TIME_COST;
}
