// 240-node extraction facility graph generation (docs/extraction-map-implementation-spec.md §4).
// Pure and deterministic: every function threads rngState explicitly (see rng.js), never calls
// Math.random(). This module is standalone — it does not touch mapEngine.js/gameReducer.js/
// MapScreen.js, which keep running the existing 8-floor map until a later phase swaps them over.
//
// Topology design (geometric, not chain-based): each of the 8 sectors (facilityLayout.js
// SECTOR_IDS) gets a center on one big ring, and its 20 nodes are scattered by uniform-in-disk
// sampling around that center ("뿌리듯이" placement) — see buildBaseGraph. Regular (non-special)
// edges are then built purely from 2D proximity: sort every node pair by distance, greedily add
// edges to whichever pair is closest while nobody exceeds BASE_EDGE_DEGREE_SOFT_CAP (2), then a
// second pass over the same sorted list merges any still-disconnected components using the
// closest available cross-component pair, allowing up to BASE_EDGE_DEGREE_HARD_CAP (4) — this is
// essentially a degree-capped Kruskal's MST pass, followed by a third pass (see the bridge-repair
// comment in buildBaseGraph) that specifically hunts down and patches remaining bridges. The cap
// was raised from an earlier max-3 design once that constant proved too tight here: a real
// geometric proximity graph needs more slack to eliminate bridges than the old single-cycle
// 48-node topology did, or exit placement fails almost every attempt (see buildBaseGraph's
// comment). Because closer pairs are always tried first,
// "only fairly nearby nodes connect" falls out for free, and because sector circles don't overlap
// (SECTOR_NODE_RADIUS well under half the ring spacing), regular edges practically never cross a
// sector boundary — within-sector pairs are almost always closer and get claimed first. Ordinary
// movement between sectors is therefore only possible through the special edges below.
//
// Each edge's timeCost is derived from its actual 2D length (EDGE_TIME_PER_LENGTH_UNIT, clamped to
// [EDGE_TIME_MIN, EDGE_TIME_MAX]) instead of a flat constant — shorter corridors are faster,
// longer ones slower. Weighted-distance calculations (exit placement, computeWeightedDistance)
// therefore use Dijkstra (graphUtils.js dijkstraDistances) rather than hop-count * constant.
//
// Special edges (§4.2) are additional edges layered on top of the base graph, in three flavors:
// "within-sector" (both endpoints from one sector's pool), "cross-sector" (one endpoint from each
// of a SECTOR_ADJACENCY — ring-neighbor — pair's pools), and a very small number of "long-range"
// edges connecting two sectors that are NOT ring-adjacent (LONG_RANGE_SPECIAL_EDGES_MIN/MAX,
// deliberately rare — these are a gamble shortcut, not a normal route). Within/cross-sector edges
// are the only way to move between adjacent sectors on the regular graph; long-range edges are the
// only way to skip across the ring directly. All three share the same BASE_EDGE_DEGREE_HARD_CAP
// (4) per node used by the base graph, tracked the same way (skip a candidate node once it's
// already at cap). Because the degree cap is enforced everywhere edges are added — base graph
// included — no
// single node can ever end up above that cap, but this is no longer a structurally *proven*
// bridge-free guarantee like the old single-cycle base graph was; connectivity and the "2
// edge-disjoint paths to every exit" requirement (§4.1 step 5) are validated empirically instead,
// via generateFacilityGraph's existing retry (GENERATION_MAX_ATTEMPTS) + fallback-seed safety net.

import { createRngState, nextFloat, nextInt, pick, shuffle, weightedPick } from './rng.js';
import { dijkstraDistances, bfsHopDistances, countEdgeDisjointPaths, reachableSet } from './graphUtils.js';
import {
  SECTOR_IDS, NODES_PER_SECTOR, SECTOR_RING_RADIUS, SECTOR_NODE_RADIUS,
  NODE_MIN_SEPARATION, NODE_PLACEMENT_MAX_ATTEMPTS,
  EDGE_TIME_PER_LENGTH_UNIT, EDGE_TIME_MIN, EDGE_TIME_MAX,
  BASE_EDGE_DEGREE_SOFT_CAP, BASE_EDGE_DEGREE_HARD_CAP, EXIT_DISTANCE_RANGES, SECTOR_ADJACENCY,
  SPECIAL_EDGES_PER_SECTOR_MIN, SPECIAL_EDGES_PER_SECTOR_MAX,
  CROSS_SECTOR_SPECIAL_EDGES_MIN, CROSS_SECTOR_SPECIAL_EDGES_MAX,
  LONG_RANGE_SPECIAL_EDGES_MIN, LONG_RANGE_SPECIAL_EDGES_MAX, SPECIAL_EDGE_CATEGORY_WEIGHTS,
  SPECIAL_EDGE_SECOND_TAG_CHANCE, LANDMARKS_BY_SECTOR, OPPORTUNITY_COUNT_WEIGHTS,
  OPPORTUNITY_USES_WEIGHTS, KEY_DROP_CHANCE, CAMERA_NODE_CHANCE, ACCESS_INTERFACE_NODE_CHANCE,
  CONCEALMENT_NODE_WEIGHTS,
  THREAT_COUNT_BY_SECTOR, THREAT_MIN_HOPS_FROM_START,
  THREAT_MIN_HOPS_BETWEEN_MARKERS, THREAT_PATROL_ROUTE_MIN, THREAT_PATROL_ROUTE_MAX,
  THREAT_GROUP_SIZE_WEIGHTS, ENTRANCE_THREAT_MAX_GROUP_SIZE, GENERATION_MAX_ATTEMPTS, GENERATOR_SECTOR_IDS,
  FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT,
} from '../data/facilityLayout.js';

// Derived from endpoints rather than a mutable counter — a module-level counter would make the
// `id` field depend on how many graphs were generated before this call, breaking the "same seed
// -> byte-identical graph" guarantee across repeated calls within one process.
/** @param {string} from @param {string} to */
function edgeId(from, to) { return `edge_${from}_${to}`; }

/** @param {{x: number, y: number}} a @param {{x: number, y: number}} b */
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** @param {number} length */
function edgeTimeCostForLength(length) {
  return Math.max(EDGE_TIME_MIN, Math.min(EDGE_TIME_MAX, Math.round(length * EDGE_TIME_PER_LENGTH_UNIT)));
}

/**
 * @typedef {Object} Topology
 * @property {import('./types.js').FacilityNode[]} nodes
 * @property {import('./types.js').FacilityEdge[]} edges
 * @property {Record<string, string[]>} nodeIdsBySector
 * @property {string} startNodeId
 * @property {import('./types.js').ExitPlacement[]} exits
 */

/**
 * Tarjan's bridge-finding algorithm — returns the indices (into `edges`) of every bridge (an edge
 * whose removal disconnects the graph). Used by buildBaseGraph's pass 3 to hunt down and patch up
 * the weak points a degree-capped nearest-neighbor mesh tends to leave behind.
 * @param {string[]} nodeIds
 * @param {{from: string, to: string}[]} edges
 * @returns {number[]}
 */
function findBridges(nodeIds, edges) {
  /** @type {Map<string, {to: string, idx: number}[]>} */
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  edges.forEach((e, idx) => {
    /** @type {{to: string, idx: number}[]} */ (adjacency.get(e.from)).push({ to: e.to, idx });
    /** @type {{to: string, idx: number}[]} */ (adjacency.get(e.to)).push({ to: e.from, idx });
  });
  const disc = new Map();
  const low = new Map();
  /** @type {number[]} */
  const bridges = [];
  let timer = 0;

  /** @param {string} start */
  function dfsFrom(start) {
    // Explicit stack (not recursion) — 240 nodes is small enough that recursion would be fine
    // too, but this keeps it independent of any call-stack depth assumptions.
    /** @type {[string, number, number][]} */
    const stack = [[start, -1, 0]]; // [node, parentEdgeIdx, nextChildIndex]
    disc.set(start, timer); low.set(start, timer); timer += 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [u, parentEdgeIdx, childIndex] = frame;
      const neighbors = /** @type {{to: string, idx: number}[]} */ (adjacency.get(u));
      if (childIndex < neighbors.length) {
        frame[2] += 1;
        const { to: v, idx } = neighbors[childIndex];
        if (idx === parentEdgeIdx) continue;
        if (!disc.has(v)) {
          disc.set(v, timer); low.set(v, timer); timer += 1;
          stack.push([v, idx, 0]);
        } else {
          low.set(u, Math.min(/** @type {number} */ (low.get(u)), /** @type {number} */ (disc.get(v))));
        }
      } else {
        stack.pop();
        if (stack.length > 0) {
          const parent = stack[stack.length - 1];
          const parentU = parent[0];
          low.set(parentU, Math.min(/** @type {number} */ (low.get(parentU)), /** @type {number} */ (low.get(u))));
          if (/** @type {number} */ (low.get(u)) > /** @type {number} */ (disc.get(parentU))) bridges.push(parentEdgeIdx);
        }
      }
    }
  }

  for (const id of nodeIds) if (!disc.has(id)) dfsFrom(id);
  return bridges;
}

/**
 * Tiny union-find for the connectivity-repair pass in buildBaseGraph.
 * @param {string[]} ids
 */
function createUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  /** @param {string} id @returns {string} */
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
    let cur = id;
    while (parent.get(cur) !== root) { const next = /** @type {string} */ (parent.get(cur)); parent.set(cur, root); cur = next; }
    return root;
  };
  /** @param {string} a @param {string} b */
  const union = (a, b) => parent.set(find(a), find(b));
  return { find, union };
}

/**
 * Steps 1-3 of §4.1. Each sector gets a center on one big ring (SECTOR_RING_RADIUS from the
 * global origin, evenly spaced by SECTOR_IDS order — see that array's comment for why entrance
 * and power sit opposite each other), and its NODES_PER_SECTOR nodes are scattered by
 * uniform-in-disk sampling (r = R*sqrt(u), theta = 2*pi*u) within SECTOR_NODE_RADIUS of that
 * center. Regular edges are then a degree-capped nearest-neighbor graph over ALL nodes (see the
 * module header for the two-pass algorithm) — sector circles don't overlap, so in practice this
 * only ever connects nodes within the same sector.
 * @param {import('./rng.js').RngState} rngState
 */
export function buildBaseGraph(rngState) {
  let state = rngState;
  /** @type {import('./types.js').FacilityNode[]} */
  const nodes = [];
  /** @type {Record<string, string[]>} */
  const nodeIdsBySector = {};

  SECTOR_IDS.forEach((sectorId, sectorIndex) => {
    const angle = (sectorIndex / SECTOR_IDS.length) * Math.PI * 2 - Math.PI / 2;
    const center = { x: Math.cos(angle) * SECTOR_RING_RADIUS, y: Math.sin(angle) * SECTOR_RING_RADIUS };
    const sectorNodeIds = [];
    /** @type {{x: number, y: number}[]} */
    const placedInSector = [];
    for (let i = 0; i < NODES_PER_SECTOR; i++) {
      // 거부 샘플링: NODE_MIN_SEPARATION을 만족하는 후보가 나올 때까지 다시 뽑는다. 못 찾으면
      // (구역이 노드로 꽉 차가는 막바지에 흔함) 지금까지 시도한 후보 중 가장 널찍은 것으로
      // 타협한다 — 무한 루프 없이 항상 종료를 보장하면서 겹침은 최대한 줄인다.
      let best = null;
      let bestMinDist = -Infinity;
      for (let attempt = 0; attempt < NODE_PLACEMENT_MAX_ATTEMPTS; attempt++) {
        const { value: uR, state: sR } = nextFloat(state);
        const { value: uTheta, state: sTheta } = nextFloat(sR);
        state = sTheta;
        const r = SECTOR_NODE_RADIUS * Math.sqrt(uR);
        const theta = uTheta * Math.PI * 2;
        const candidate = { x: center.x + Math.cos(theta) * r, y: center.y + Math.sin(theta) * r };
        const minDist = placedInSector.length === 0 ? Infinity : Math.min(...placedInSector.map((p) => distance(p, candidate)));
        if (minDist >= NODE_MIN_SEPARATION) { best = candidate; break; }
        if (minDist > bestMinDist) { bestMinDist = minDist; best = candidate; }
      }
      const point = /** @type {{x: number, y: number}} */ (best);
      placedInSector.push(point);
      const id = `${sectorId}_${i}`;
      nodes.push({ id, sectorId, x: point.x, y: point.y });
      sectorNodeIds.push(id);
    }
    nodeIdsBySector[sectorId] = sectorNodeIds;
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** @type {{a: string, b: string, dist: number}[]} */
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) pairs.push({ a: nodes[i].id, b: nodes[j].id, dist: distance(nodes[i], nodes[j]) });
  }
  pairs.sort((p, q) => p.dist - q.dist);

  const degree = new Map(nodes.map((n) => [n.id, 0]));
  const uf = createUnionFind(nodes.map((n) => n.id));
  /** @type {import('./types.js').FacilityEdge[]} */
  const edges = [];
  const existing = new Set();
  /** @param {string} a @param {string} b @param {number} dist */
  const addEdge = (a, b, dist) => {
    edges.push({ id: edgeId(a, b), from: a, to: b, bidirectional: true, timeCost: edgeTimeCostForLength(dist), features: [] });
    existing.add([a, b].sort().join('|'));
    degree.set(a, /** @type {number} */ (degree.get(a)) + 1);
    degree.set(b, /** @type {number} */ (degree.get(b)) + 1);
    uf.union(a, b);
  };

  // Pass 1: dense local mesh, capped at BASE_EDGE_DEGREE_SOFT_CAP so every node keeps at least
  // one free slot for the repair pass below.
  for (const { a, b, dist } of pairs) {
    if (/** @type {number} */ (degree.get(a)) >= BASE_EDGE_DEGREE_SOFT_CAP) continue;
    if (/** @type {number} */ (degree.get(b)) >= BASE_EDGE_DEGREE_SOFT_CAP) continue;
    addEdge(a, b, dist);
  }

  // Pass 2: connectivity repair — degree-capped Kruskal over the same sorted pairs, only adding
  // an edge when it merges two still-separate components.
  for (const { a, b, dist } of pairs) {
    if (uf.find(a) === uf.find(b)) continue;
    if (/** @type {number} */ (degree.get(a)) >= BASE_EDGE_DEGREE_HARD_CAP) continue;
    if (/** @type {number} */ (degree.get(b)) >= BASE_EDGE_DEGREE_HARD_CAP) continue;
    addEdge(a, b, dist);
  }

  // Pass 3: bridge repair. A degree-capped nearest-neighbor mesh is connected (pass 2 guarantees
  // that) but often still full of bridges — edges that, if cut, split the graph. For real
  // 2-edge-disjoint-path coverage (what exit placement needs), patch each bridge found by adding
  // the closest still-affordable cross-side edge, then re-scan (fixing one bridge can reveal or
  // resolve others) until none remain or the degree cap genuinely can't afford any more.
  for (let sweep = 0; sweep < 25; sweep++) {
    const bridgeIdxs = findBridges(nodes.map((n) => n.id), edges);
    if (bridgeIdxs.length === 0) break;
    let repairedAny = false;
    for (const idx of bridgeIdxs) {
      const bridge = edges[idx];
      const edgesWithoutBridge = edges.filter((_, i) => i !== idx);
      const sideA = reachableSet(edgesWithoutBridge, bridge.from);
      // sideB is everything else — since pass 2 guaranteed single-component connectivity and
      // this edge is a genuine bridge, "everything not in sideA" is exactly the other side.
      const found = pairs.find(({ a, b }) => sideA.has(a) !== sideA.has(b)
        && /** @type {number} */ (degree.get(a)) < BASE_EDGE_DEGREE_HARD_CAP
        && /** @type {number} */ (degree.get(b)) < BASE_EDGE_DEGREE_HARD_CAP
        && !existing.has([a, b].sort().join('|')));
      if (!found) continue;
      addEdge(found.a, found.b, found.dist);
      repairedAny = true;
    }
    if (!repairedAny) break;
  }

  return { nodes, edges, nodeIdsBySector, rngState: state };
}

/**
 * Re-derives per-node coordinates, existing-pair keys, and degree counts from any topology's
 * nodes/edges — used to feed placeSpecialEdges regardless of whether the topology came fresh out
 * of buildBaseGraph or from the cached fallback (which only stores nodes/edges, not this).
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} edges
 */
function deriveGraphMeta(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const existing = new Set(edges.map((e) => [e.from, e.to].sort().join('|')));
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    degree.set(e.from, /** @type {number} */ (degree.get(e.from)) + 1);
    degree.set(e.to, /** @type {number} */ (degree.get(e.to)) + 1);
  }
  return { byId, existing, degree };
}

/**
 * Step 4-5 of §4.1: place start + the three exits and verify distance/path requirements. Weighted
 * distance now comes from Dijkstra over each edge's geometry-derived timeCost (see module header)
 * rather than hop-count * a flat constant.
 * Returns null (caller retries) if no valid combination exists in this graph instance.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} edges
 * @param {import('./rng.js').RngState} rngState
 */
function placeStartAndExits(nodes, edges, rngState) {
  const entranceNodes = nodes.filter((n) => n.sectorId === 'entrance').map((n) => n.id);
  const { value: startNodeId, state: afterStart } = pick(rngState, entranceNodes);

  const distances = dijkstraDistances(edges, startNodeId);
  /** @type {Record<string, {id: string, weightedDistance: number}[]>} */
  const candidatesBySector = {};
  for (const node of nodes) {
    const weightedDistance = distances.get(node.id);
    if (weightedDistance === undefined) continue;
    (candidatesBySector[node.sectorId] ||= []).push({ id: node.id, weightedDistance });
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

  // Step 7: every node reachable from start — the degree-capped Kruskal repair pass in
  // buildBaseGraph is *usually* enough to fully connect the graph, but isn't structurally
  // guaranteed the way the old single-cycle base graph was, so this check is load-bearing now,
  // not just defensive. A failure here is caught by generateFacilityGraph's retry/fallback loop.
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
 * §4.2 special edges: additional edges layered on top of the base graph, never replacing one, in
 * three flavors — "within-sector" (both endpoints from one sector's pool), "cross-sector" (one
 * endpoint from each sector in a SECTOR_ADJACENCY — ring-neighbor — pair's pool), and a handful of
 * "long-range" edges between non-adjacent sectors (LONG_RANGE_SPECIAL_EDGES_MIN/MAX, deliberately
 * rare). Within/cross-sector edges are the only way regular movement can cross into a *neighboring*
 * sector; long-range edges are the only way to skip across the ring directly (see module header).
 * All three share the same per-node degree cap tracking so the whole graph never exceeds
 * BASE_EDGE_DEGREE_HARD_CAP, building on whatever degree each node already has from the base graph.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} baseEdges
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {Map<string, {x: number, y: number}>} byId
 * @param {Set<string>} existingPairs
 * @param {Map<string, number>} baseDegree
 * @param {import('./rng.js').RngState} rngState
 */
function placeSpecialEdges(nodes, baseEdges, nodeIdsBySector, byId, existingPairs, baseDegree, rngState) {
  let state = rngState;
  const existing = new Set(existingPairs);
  const degree = new Map(baseDegree);
  /** @type {import('./types.js').FacilityEdge[]} */
  const specialEdges = [];

  /** @param {string} a @param {string} b */
  const tryPlace = (a, b) => {
    if (a === b) return false;
    if (/** @type {number} */ (degree.get(a)) >= BASE_EDGE_DEGREE_HARD_CAP) return false;
    if (/** @type {number} */ (degree.get(b)) >= BASE_EDGE_DEGREE_HARD_CAP) return false;
    const key = [a, b].sort().join('|');
    if (existing.has(key)) return false;

    const { value: category, state: sCat } = weightedPick(state, SPECIAL_EDGE_CATEGORY_WEIGHTS);
    state = sCat;
    const features = [category];
    if (category !== 'oneWay' && category !== 'highGround') {
      const { value: roll, state: sRoll } = nextFloat(state);
      state = sRoll;
      if (roll < SPECIAL_EDGE_SECOND_TAG_CHANCE) {
        const other = category === 'blocked' ? 'electronic' : 'blocked';
        features.push(other);
      }
    }
    const dist = distance(/** @type {{x:number,y:number}} */ (byId.get(a)), /** @type {{x:number,y:number}} */ (byId.get(b)));
    specialEdges.push({
      id: edgeId(a, b), from: a, to: b, bidirectional: category !== 'oneWay',
      timeCost: edgeTimeCostForLength(dist), features,
    });
    existing.add(key);
    degree.set(a, /** @type {number} */ (degree.get(a)) + 1);
    degree.set(b, /** @type {number} */ (degree.get(b)) + 1);
    return true;
  };

  for (const sectorId of SECTOR_IDS) {
    const pool = nodeIdsBySector[sectorId];
    const { value: count, state: sCount } = nextInt(state, SPECIAL_EDGES_PER_SECTOR_MAX - SPECIAL_EDGES_PER_SECTOR_MIN + 1);
    state = sCount;
    const target = count + SPECIAL_EDGES_PER_SECTOR_MIN;
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < 60) {
      attempts += 1;
      const { value: a, state: sa } = pick(state, pool);
      const { value: b, state: sb } = pick(sa, pool);
      state = sb;
      if (tryPlace(a, b)) placed += 1;
    }
  }

  for (const [sectorA, sectorB] of SECTOR_ADJACENCY) {
    const poolA = nodeIdsBySector[sectorA];
    const poolB = nodeIdsBySector[sectorB];
    const { value: count, state: sCount } = nextInt(state, CROSS_SECTOR_SPECIAL_EDGES_MAX - CROSS_SECTOR_SPECIAL_EDGES_MIN + 1);
    state = sCount;
    const target = count + CROSS_SECTOR_SPECIAL_EDGES_MIN;
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < 60) {
      attempts += 1;
      const { value: a, state: sa } = pick(state, poolA);
      const { value: b, state: sb } = pick(sa, poolB);
      state = sb;
      if (tryPlace(a, b)) placed += 1;
    }
  }

  // 원거리 지름길 — 링에서 인접하지 않은(SECTOR_ADJACENCY에 없는) 구역 쌍을 잇는 아주 소수의
  // 특수 엣지. 전체 그래프에 걸쳐 LONG_RANGE_SPECIAL_EDGES_MIN~MAX개만 두므로, 매 시도마다
  // 무작위 비인접 쌍을 하나 골라 시도한다(특정 쌍에 몰아주지 않기 위해).
  const adjacentKeys = new Set(SECTOR_ADJACENCY.map(([a, b]) => [a, b].sort().join('|')));
  /** @type {[string, string][]} */
  const nonAdjacentSectorPairs = [];
  for (let i = 0; i < SECTOR_IDS.length; i++) {
    for (let j = i + 1; j < SECTOR_IDS.length; j++) {
      const key = [SECTOR_IDS[i], SECTOR_IDS[j]].sort().join('|');
      if (!adjacentKeys.has(key)) nonAdjacentSectorPairs.push([SECTOR_IDS[i], SECTOR_IDS[j]]);
    }
  }
  if (nonAdjacentSectorPairs.length > 0) {
    const { value: longRangeCount, state: sLongCount } = nextInt(state, LONG_RANGE_SPECIAL_EDGES_MAX - LONG_RANGE_SPECIAL_EDGES_MIN + 1);
    state = sLongCount;
    const longRangeTarget = longRangeCount + LONG_RANGE_SPECIAL_EDGES_MIN;
    let placed = 0;
    let attempts = 0;
    while (placed < longRangeTarget && attempts < 60) {
      attempts += 1;
      const { value: pair, state: sPair } = pick(state, nonAdjacentSectorPairs);
      const { value: a, state: sa } = pick(sPair, nodeIdsBySector[pair[0]]);
      const { value: b, state: sb } = pick(sa, nodeIdsBySector[pair[1]]);
      state = sb;
      if (tryPlace(a, b)) placed += 1;
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
 * §4.2/§5.1.1: 0-2 opportunities per node, each with a fixed keyEligible roll and a fixed
 * usesRemaining count (1-3, OPPORTUNITY_USES_WEIGHTS) made now — farming one is no longer always
 * a single use.
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
      const { value: uses, state: sUses } = weightedPick(state, OPPORTUNITY_USES_WEIGHTS);
      state = sUses;
      opportunities.push({ id: `opp${seq++}`, nodeId: node.id, keyEligible: roll < KEY_DROP_CHANCE, usesRemaining: uses });
    }
  }
  return { opportunities, rngState: state };
}

/**
 * §신규 은엄폐: some nodes get a fixed 1-3 concealment value (temporary Stealth bonus while
 * standing there), most get none (0, omitted from the map).
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./rng.js').RngState} rngState
 * @returns {{concealmentByNodeId: Record<string, 1|2|3>, rngState: import('./rng.js').RngState}}
 */
function placeConcealment(nodes, rngState) {
  let state = rngState;
  /** @type {Record<string, 1|2|3>} */
  const concealmentByNodeId = {};
  for (const node of nodes) {
    const { value, state: sValue } = weightedPick(state, CONCEALMENT_NODE_WEIGHTS);
    state = sValue;
    if (value > 0) concealmentByNodeId[node.id] = /** @type {1|2|3} */ (value);
  }
  return { concealmentByNodeId, rngState: state };
}

/**
 * Roll cameras and access interfaces independently. Deterministic sector fallbacks guarantee at
 * least one of each device without preventing both devices from sharing a node.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./rng.js').RngState} rngState
 */
function placeSecurityDevices(nodes, rngState) {
  let state = rngState;
  const cameras = [];
  const accessInterfaces = [];
  for (const node of nodes) {
    const cameraRoll = nextFloat(state); state = cameraRoll.state;
    const interfaceRoll = nextFloat(state); state = interfaceRoll.state;
    if (cameraRoll.value < CAMERA_NODE_CHANCE) cameras.push({ id: `camera_${node.id}`, nodeId: node.id });
    if (interfaceRoll.value < ACCESS_INTERFACE_NODE_CHANCE) accessInterfaces.push({ id: `interface_${node.id}`, nodeId: node.id });
  }
  for (const sectorId of SECTOR_IDS) {
    const sectorNodes = nodes.filter((node) => node.sectorId === sectorId);
    if (!cameras.some((device) => device.nodeId.startsWith(`${sectorId}_`))) {
      const chosen = pick(state, sectorNodes); state = chosen.state;
      cameras.push({ id: `camera_${chosen.value.id}`, nodeId: chosen.value.id });
    }
    if (!accessInterfaces.some((device) => device.nodeId.startsWith(`${sectorId}_`))) {
      const chosen = pick(state, sectorNodes); state = chosen.state;
      accessInterfaces.push({ id: `interface_${chosen.value.id}`, nodeId: chosen.value.id });
    }
  }
  return { cameras, accessInterfaces, rngState: state };
}

/** One battery generator is installed in each powered sector. */
function placeGenerators(nodeIdsBySector, rngState) {
  let state = rngState;
  const generators = [];
  for (const sectorId of GENERATOR_SECTOR_IDS) {
    const chosen = pick(state, nodeIdsBySector[sectorId]);
    state = chosen.state;
    generators.push({ id: `generator_${sectorId}`, nodeId: chosen.value, sectorId });
  }
  return { generators, rngState: state };
}

/**
 * §4.2: initial threat markers, kept away from the start and each other (THREAT_COUNT_BY_SECTOR).
 * @param {import('./types.js').FacilityEdge[]} allEdges
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {string} startNodeId
 * @param {import('./rng.js').RngState} rngState
 */
function placeThreats(allEdges, nodeIdsBySector, startNodeId, rngState) {
  let state = rngState;
  // Hop count (not weighted Dijkstra distance) is the right notion of "closeness" here — it's
  // cheap (O(V+E) vs O(V^2)) and this only needs a coarse topological proximity check, not a
  // time-accurate one.
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

    // 대다수 노드는 지리적으로 가까운 같은 구역 이웃을 갖지만(모듈 헤더 참고), 드물게 어떤
    // 노드의 그래프 엣지가 전부 다른 구역으로만 이어지는 경우가 있다(브릿지 복구·원거리
    // 지름길 특수 엣지가 하필 그 노드를 골랐을 때) — 그런 노드를 순찰 앵커로 뽑으면 patrolRoute를
    // 한 걸음도 확장할 수 없어 THREAT_PATROL_ROUTE_MIN을 못 지킨다. 앵커 후보는 항상 같은
    // 구역 이웃이 최소 1개 있는 노드로 제한한다.
    const patrolCapableNodeIds = nodeIdsBySector[sectorId].filter((id) => (sectorAdjacency.get(id) || []).length > 0);
    const anchorPool = patrolCapableNodeIds.length > 0 ? patrolCapableNodeIds : nodeIdsBySector[sectorId];

    for (let i = 0; i < count; i++) {
      let anchor = null;
      let attempts = 0;
      while (!anchor && attempts < 100) {
        attempts += 1;
        const { value: candidate, state: sCand } = pick(state, anchorPool);
        state = sCand;
        const hopsFromStart = startHops.get(candidate) ?? Infinity;
        if (hopsFromStart < THREAT_MIN_HOPS_FROM_START) continue;
        const tooClose = placedAnchors.some((other) => (bfsHopDistances(allEdges, other).get(candidate) ?? Infinity) < THREAT_MIN_HOPS_BETWEEN_MARKERS);
        if (tooClose) continue;
        anchor = candidate;
      }
      if (!anchor) {
        const { value: fallback, state: sFallback } = pick(state, anchorPool);
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
 * @param {Map<string, {x:number,y:number}>} byId
 * @param {Set<string>} existingPairs
 * @param {Map<string, number>} baseDegree
 * @param {import('./rng.js').RngState} rngState
 */
function placeContent(topology, byId, existingPairs, baseDegree, rngState) {
  let state = rngState;

  const special = placeSpecialEdges(topology.nodes, topology.edges, topology.nodeIdsBySector, byId, existingPairs, baseDegree, state);
  state = special.rngState;

  const reserved = [topology.startNodeId, ...topology.exits.map((e) => e.nodeId)];
  const landmarkResult = placeLandmarks(topology.nodeIdsBySector, reserved, state);
  state = landmarkResult.rngState;

  const opportunityResult = placeOpportunities(topology.nodes, state);
  state = opportunityResult.rngState;

  const securityResult = placeSecurityDevices(topology.nodes, state);
  state = securityResult.rngState;

  const generatorResult = placeGenerators(topology.nodeIdsBySector, state);
  state = generatorResult.rngState;

  const allEdges = [...topology.edges, ...special.specialEdges];
  const threatResult = placeThreats(allEdges, topology.nodeIdsBySector, topology.startNodeId, state);
  state = threatResult.rngState;

  // 은엄폐는 맨 마지막에 뽑는다 — 다른 콘텐츠(특히 위협 배치/경로)보다 나중 draw여야 이 기능을
  // 추가하기 전 시드의 위협 배치가 그대로 보존된다(회귀 테스트가 그 결정성에 기대고 있었음).
  const concealmentResult = placeConcealment(topology.nodes, state);
  state = concealmentResult.rngState;

  return {
    content: {
      edges: allEdges,
      landmarks: landmarkResult.landmarks,
      opportunities: opportunityResult.opportunities,
      concealmentByNodeId: concealmentResult.concealmentByNodeId,
      cameras: securityResult.cameras,
      accessInterfaces: securityResult.accessInterfaces,
      generators: generatorResult.generators,
      threats: threatResult.threats,
    },
    rngState: state,
  };
}

/**
 * §4.1: generate the full 240-node facility graph for a seed. Deterministic — same seed always
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
      const { byId, existing, degree } = deriveGraphMeta(result.topology.nodes, result.topology.edges);
      const contentResult = placeContent(result.topology, byId, existing, degree, rngState);
      return {
        graph: {
          nodes: result.topology.nodes,
          edges: contentResult.content.edges,
          startNodeId: result.topology.startNodeId,
          exits: result.topology.exits,
          landmarks: contentResult.content.landmarks,
          opportunities: contentResult.content.opportunities,
          concealmentByNodeId: contentResult.content.concealmentByNodeId,
          cameras: contentResult.content.cameras,
          accessInterfaces: contentResult.content.accessInterfaces,
          generators: contentResult.content.generators,
          threats: contentResult.content.threats,
        },
        rngState: contentResult.rngState,
        usedFallback: false,
      };
    }
  }

  const fallbackTopology = getFallbackTopology();
  const { byId, existing, degree } = deriveGraphMeta(fallbackTopology.nodes, fallbackTopology.edges);
  const contentResult = placeContent(fallbackTopology, byId, existing, degree, rngState);
  return {
    graph: {
      nodes: fallbackTopology.nodes,
      edges: contentResult.content.edges,
      startNodeId: fallbackTopology.startNodeId,
      exits: fallbackTopology.exits,
      landmarks: contentResult.content.landmarks,
      opportunities: contentResult.content.opportunities,
          concealmentByNodeId: contentResult.content.concealmentByNodeId,
      cameras: contentResult.content.cameras,
      accessInterfaces: contentResult.content.accessInterfaces,
      generators: contentResult.content.generators,
      threats: contentResult.content.threats,
    },
    rngState: contentResult.rngState,
    usedFallback: true,
  };
}

/**
 * Mobility 0 기준 가중 이동비용 (§2.2 검증용 헬퍼). 특수 엣지 포함 그래프 위에서 Dijkstra로
 * 계산한다(엣지 시간이 더 이상 균일하지 않으므로).
 * @param {import('./types.js').FacilityEdge[]} edges
 * @param {string} fromNodeId
 * @param {string} toNodeId
 */
export function computeWeightedDistance(edges, fromNodeId, toNodeId) {
  const dist = dijkstraDistances(edges, fromNodeId).get(toNodeId);
  return dist === undefined ? Infinity : dist;
}
