// 206-node extraction facility graph generation (docs/extraction-map-implementation-spec.md §4).
// Pure and deterministic: every function threads rngState explicitly (see rng.js), never calls
// Math.random().
//
// Topology design (floor plans on a ring). Each of the 8 sectors (facilityLayout.js SECTOR_IDS)
// gets a center on one big ring, and its interior is drawn by layoutArchetypes.js as an actual
// floor plan — a corridor skeleton whose shape comes from that sector's archetype (grid, chain,
// radial, tower, hall, dual) with rooms hung off it. Sector node counts differ (SECTOR_LAYOUTS):
// the hangar is 14 big rooms while the residential block is 32 mostly-corridor nodes, so a
// sector's size is itself information. Every node carries a type (FacilityNodeType) that decides
// its concealment and opportunity density.
//
// Regular edges come from two places and two places only: the floor plan's own doors and
// corridors, and one gateway edge per ring-adjacent sector pair. There is no global
// nearest-neighbor pass any more — an edge exists because the building has a door there. Because
// the eight sectors form a ring, no gateway edge is a bridge, and a route can go around the ring
// either way.
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
// deliberately rare — these are a gamble shortcut, not a normal route). They share the
// BASE_EDGE_DEGREE_HARD_CAP (4) per-node budget with the base graph, so a node already busy with
// corridors and doors will not sprout more.
//
// A room hung off a single corridor is a leaf, and its edge is a bridge — an exit cannot go there
// because §4.1 step 5 needs two edge-disjoint paths. layoutArchetypes.js therefore adds
// connecting doors between nearby rooms, and every archetype except the tower carries at least one
// cycle in its skeleton. Connectivity and the two-path requirement are still validated empirically
// per attempt, via generateFacilityGraph's retry (GENERATION_MAX_ATTEMPTS) + fallback-seed net.

import { createRngState, nextFloat, nextInt, pick, shuffle, weightedPick } from './rng.js';
import { dijkstraDistances, bfsHopDistances, countEdgeDisjointPaths, reachableSet, isEdgeUnlocked } from './graphUtils.js';
import { generateSectorLayout } from './layoutArchetypes.js';
import {
  SECTOR_IDS, SECTOR_RING_RADIUS, SECTOR_NODE_RADIUS,
  EDGE_TIME_PER_LENGTH_UNIT, EDGE_TIME_MIN, EDGE_TIME_MAX,
  BASE_EDGE_DEGREE_HARD_CAP, EXIT_DISTANCE_RANGES, SECTOR_ADJACENCY,
  SPECIAL_EDGES_PER_SECTOR_MIN, SPECIAL_EDGES_PER_SECTOR_MAX,
  CROSS_SECTOR_SPECIAL_EDGES_MIN, CROSS_SECTOR_SPECIAL_EDGES_MAX,
  LONG_RANGE_SPECIAL_EDGES_MIN, LONG_RANGE_SPECIAL_EDGES_MAX, SPECIAL_EDGE_CATEGORY_WEIGHTS,
  SPECIAL_EDGE_SECOND_TAG_CHANCE, LANDMARKS_BY_SECTOR, NODE_TYPE_OPPORTUNITY_WEIGHTS,
  OPPORTUNITY_USES_WEIGHTS, KEY_DROP_CHANCE, CAMERA_NODE_CHANCE, ACCESS_INTERFACE_NODE_CHANCE,
  PRIZE_PROMOTION_CHANCE_BY_NODE_TYPE, PRIZE_TIER_WEIGHTS, PRIZE_AXIS_WEIGHTS,
  NODE_TYPE_CONCEALMENT_WEIGHTS,
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
 * @property {Record<string, string[]>} externalIdsBySector 그 구역에서 바깥과 이어질 수 있는 노드.
 *   보통은 구역 전체지만, 탑 구조(통신·관제탑)는 1층 로비만 들어간다.
 * @property {Record<string, number>} groupByNodeId 층처럼 구역을 더 잘게 나눈 덩어리. 여기 실린
 *   노드끼리는 같은 덩어리 안에서만 특수 엣지가 난다. 나뉘지 않는 구역의 노드는 빠져 있다.
 * @property {Record<string, string[]>} landmarkIdsBySector 표지가 놓일 수 있는 노드. 배치 원형이
 *   정한다(D16) — 도면만 보고 후보를 좁힐 수 있게 하려는 것이다.
 * @property {string} startNodeId
 * @property {import('./types.js').ExitPlacement[]} exits
 */

/**
 * Steps 1-3 of §4.1. Each sector gets a center on one big ring (SECTOR_RING_RADIUS from the
 * global origin, evenly spaced by SECTOR_IDS order — see that array's comment for why entrance
 * and power sit opposite each other). Inside that center layoutArchetypes.js draws the sector's
 * floor plan: a corridor skeleton whose shape depends on the sector's archetype, with rooms hung
 * off it. The generator returns local coordinates normalized to radius 1, which we scale by
 * SECTOR_NODE_RADIUS and translate onto the ring — so sector-to-sector distance is decided purely
 * by the ring and is unaffected by which archetype a sector uses. That matters because the exit
 * distance ranges and the whole time budget are calibrated against this coordinate scale.
 *
 * Sectors are joined only by gateway edges: for each ring-adjacent pair, the node in each sector
 * closest to the other sector's center becomes a gateway, and one regular edge links them. The
 * eight sectors therefore form a ring, so no gateway edge is a bridge and the route around the
 * ring stays open in both directions.
 * @param {import('./rng.js').RngState} rngState
 */
export function buildBaseGraph(rngState) {
  let state = rngState;
  /** @type {import('./types.js').FacilityNode[]} */
  const nodes = [];
  /** @type {Record<string, string[]>} */
  const nodeIdsBySector = {};
  /** @type {Record<string, string[]>} */
  const externalIdsBySector = {};
  /** @type {Record<string, number>} */
  const groupByNodeId = {};
  /** @type {Record<string, string[]>} */
  const landmarkIdsBySector = {};
  /** @type {Record<string, {x: number, y: number}>} */
  const sectorCenters = {};
  /** @type {import('./types.js').FacilityEdge[]} */
  const edges = [];
  const existing = new Set();
  /** @type {Map<string, number>} */
  const degree = new Map();
  /** @type {Map<string, import('./types.js').FacilityNode>} */
  const byId = new Map();

  /**
   * @param {string} a @param {string} b
   * @param {import('./types.js').SpecialEdgeFeature[]} [features] 배치 원형이 구조적으로 두는 특수 통로.
   * @param {number} [requiredCapability]
   */
  const addEdge = (a, b, features = [], requiredCapability = undefined) => {
    const key = [a, b].sort().join('|');
    if (existing.has(key)) return;
    const nodeA = /** @type {import('./types.js').FacilityNode} */ (byId.get(a));
    const nodeB = /** @type {import('./types.js').FacilityNode} */ (byId.get(b));
    /** @type {import('./types.js').FacilityEdge} */
    const edge = { id: edgeId(a, b), from: a, to: b, bidirectional: true, timeCost: edgeTimeCostForLength(distance(nodeA, nodeB)), features };
    if (requiredCapability !== undefined) edge.requiredCapability = requiredCapability;
    edges.push(edge);
    existing.add(key);
    degree.set(a, /** @type {number} */ (degree.get(a)) + 1);
    degree.set(b, /** @type {number} */ (degree.get(b)) + 1);
  };

  SECTOR_IDS.forEach((sectorId, sectorIndex) => {
    const angle = (sectorIndex / SECTOR_IDS.length) * Math.PI * 2 - Math.PI / 2;
    const center = { x: Math.cos(angle) * SECTOR_RING_RADIUS, y: Math.sin(angle) * SECTOR_RING_RADIUS };
    sectorCenters[sectorId] = center;

    const layout = generateSectorLayout(state, sectorId);
    state = layout.rngState;

    const offPlan = new Set(layout.offPlanIndices);
    const sectorNodeIds = layout.nodes.map((local, i) => {
      const id = `${sectorId}_${i}`;
      const node = {
        id,
        sectorId: /** @type {import('./types.js').FacilitySectorId} */ (sectorId),
        type: local.type,
        ...(offPlan.has(i) ? { offPlan: true } : {}),
        x: center.x + local.x * SECTOR_NODE_RADIUS,
        y: center.y + local.y * SECTOR_NODE_RADIUS,
      };
      nodes.push(node);
      byId.set(id, node);
      degree.set(id, 0);
      return id;
    });
    nodeIdsBySector[sectorId] = sectorNodeIds;
    externalIdsBySector[sectorId] = layout.externalIndices
      ? layout.externalIndices.map((i) => sectorNodeIds[i])
      : sectorNodeIds;
    if (layout.groups) layout.groups.forEach((g, i) => { groupByNodeId[sectorNodeIds[i]] = g; });
    landmarkIdsBySector[sectorId] = layout.landmarkIndices.map((i) => sectorNodeIds[i]);

    for (const [a, b] of layout.edges) addEdge(sectorNodeIds[a], sectorNodeIds[b]);
    // 배치 원형이 구조적으로 두는 특수 통로(통신·관제탑 승강기 등). 무작위 특수 엣지와 달리
    // 시드와 무관하게 항상 존재하며, 기저 그래프의 일부라 차수 계산에도 그대로 들어간다.
    for (const special of layout.specialEdges) {
      addEdge(sectorNodeIds[special.from], sectorNodeIds[special.to], [...special.features], special.requiredCapability);
    }
  });

  // 관문: 링에서 인접한 구역 쌍마다 서로에게 가장 가까운 노드를 하나씩 골라 잇는다. 한 노드가
  // 양쪽 관문을 겸하면 그 구역의 두 출입구가 겹쳐 병목이 과해지므로 이미 관문인 노드는 뺀다.
  /** @type {Set<string>} */
  const gatewayIds = new Set();
  /** @param {string} ownSector @param {{x: number, y: number}} targetCenter */
  const nearestTo = (ownSector, targetCenter) => {
    const open = externalIdsBySector[ownSector];
    const free = open.filter((id) => !gatewayIds.has(id));
    const pool = free.length > 0 ? free : open;
    return pool.reduce((best, id) => (
      distance(/** @type {import('./types.js').FacilityNode} */ (byId.get(id)), targetCenter)
        < distance(/** @type {import('./types.js').FacilityNode} */ (byId.get(best)), targetCenter) ? id : best
    ), pool[0]);
  };
  for (const [fromSector, toSector] of SECTOR_ADJACENCY) {
    const a = nearestTo(fromSector, sectorCenters[toSector]);
    const b = nearestTo(toSector, sectorCenters[fromSector]);
    gatewayIds.add(a);
    gatewayIds.add(b);
    addEdge(a, b);
  }
  for (const node of nodes) if (gatewayIds.has(node.id)) node.isGateway = true;

  return { nodes, edges, nodeIdsBySector, externalIdsBySector, groupByNodeId, landmarkIdsBySector, rngState: state };
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

  // 방을 복도 하나에만 매단 평면도에서는 잎 노드가 많고, 잎으로 가는 길은 하나뿐이라 §4.1 step 5의
  // 2-edge-disjoint 요구를 만족하지 못한다. 이 검사는 탈출구마다 독립이므로 후보 노드 하나당 한 번만
  // 하고 캐시한다 — 삼중 루프 안에서 매 조합마다 다시 하면 같은 노드를 수백 번 검사하게 된다.
  /** @type {Map<string, boolean>} */
  const twoPathCache = new Map();
  // 잠긴 통로는 우회로로 치지 않는다. 배치 원형이 구조적으로 두는 특수 엣지(탑 승강기)가 base
  // 그래프에 이미 들어 있는데, 그걸 두 번째 경로로 인정하면 "열지 못하면 퇴로가 없는" 탈출구가
  // 생긴다. 여는 절차가 필요 없는 엣지만으로 우회로가 있어야 한다.
  const redundancyEdges = edges.filter((e) => isEdgeUnlocked(e));
  /** @param {string} nodeId */
  const hasTwoPaths = (nodeId) => {
    const cached = twoPathCache.get(nodeId);
    if (cached !== undefined) return cached;
    const ok = countEdgeDisjointPaths(redundancyEdges, startNodeId, nodeId, 2) >= 2;
    twoPathCache.set(nodeId, ok);
    return ok;
  };

  let state = afterStart;
  const { value: sectorOrder, state: afterShuffle } = shuffle(state, SECTOR_IDS);
  state = afterShuffle;

  for (const sectorA of sectorOrder) {
    const aPool = inRange(candidatesBySector[sectorA] || [], EXIT_DISTANCE_RANGES.A).filter((c) => hasTwoPaths(c.id));
    if (aPool.length === 0) continue;
    for (const nodeA of aPool) {
      for (const sectorKey of sectorOrder) {
        if (sectorKey === sectorA) continue;
        const keyPool = inRange(candidatesBySector[sectorKey] || [], EXIT_DISTANCE_RANGES.key)
          .filter((c) => c.weightedDistance > nodeA.weightedDistance && hasTwoPaths(c.id));
        if (keyPool.length === 0) continue;
        for (const nodeKey of keyPool) {
          for (const sectorB of sectorOrder) {
            if (sectorB === sectorA || sectorB === sectorKey) continue;
            const bPool = inRange(candidatesBySector[sectorB] || [], EXIT_DISTANCE_RANGES.B)
              .filter((c) => c.weightedDistance > nodeKey.weightedDistance && hasTwoPaths(c.id));
            if (bPool.length === 0) continue;
            const nodeB = bPool[0];
            /** @type {import('./types.js').ExitPlacement[]} */
            const exits = [
              { exitId: 'A', nodeId: nodeA.id, sectorId: sectorA, weightedDistanceFromStart: nodeA.weightedDistance },
              { exitId: 'key', nodeId: nodeKey.id, sectorId: sectorKey, weightedDistanceFromStart: nodeKey.weightedDistance },
              { exitId: 'B', nodeId: nodeB.id, sectorId: sectorB, weightedDistanceFromStart: nodeB.weightedDistance },
            ];
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
      externalIdsBySector: base.externalIdsBySector,
      groupByNodeId: base.groupByNodeId,
      landmarkIdsBySector: base.landmarkIdsBySector,
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
 * All three share the same per-node degree cap tracking, building on whatever degree each node
 * already has from the base graph — so a node the floor plan already loaded up (a grid junction,
 * the tower lobby) takes no special edges at all. The cap does *not* bound the base graph itself;
 * see BASE_EDGE_DEGREE_HARD_CAP.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} baseEdges
 * @param {Record<string, string[]>} nodeIdsBySector
 * @param {Record<string, string[]>} externalIdsBySector 구역 밖으로 이어질 수 있는 노드만 담은 풀.
 * @param {Record<string, number>} groupByNodeId 구역을 더 잘게 나눈 덩어리(탑의 층).
 * @param {Map<string, {x: number, y: number}>} byId
 * @param {Set<string>} existingPairs
 * @param {Map<string, number>} baseDegree
 * @param {import('./rng.js').RngState} rngState
 */
function placeSpecialEdges(nodes, baseEdges, nodeIdsBySector, externalIdsBySector, groupByNodeId, byId, existingPairs, baseDegree, rngState) {
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
    // 막힌 통로에만 자물쇠 종류가 붙는다. 일방통행과 고지대는 잠긴 것이 아니라 지형이다.
    if (category === 'blocked') {
      const { value: roll, state: sRoll } = nextFloat(state);
      state = sRoll;
      if (roll < SPECIAL_EDGE_SECOND_TAG_CHANCE) features.push('electronic');
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

  // 구역 중심(노드 평균) — 구역 간 특수 엣지를 서로 마주 보는 쪽에 놓기 위해 쓴다.
  /** @type {Record<string, {x: number, y: number}>} */
  const sectorCentroids = {};
  for (const sectorId of SECTOR_IDS) {
    const pool = nodeIdsBySector[sectorId];
    const points = pool.map((id) => /** @type {{x:number,y:number}} */ (byId.get(id)));
    sectorCentroids[sectorId] = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
  }
  /** 기준점에 가까운 순으로 후보 k개. @param {string[]} pool @param {{x: number, y: number}} origin */
  const nearest = (pool, origin, k, exclude) => pool
    .filter((id) => id !== exclude)
    .map((id) => ({ id, d: distance(/** @type {{x:number,y:number}} */ (byId.get(id)), origin) }))
    .sort((p, q) => p.d - q.d || (p.id < q.id ? -1 : 1))
    .slice(0, k)
    .map((c) => c.id);

  // 구역 안 특수 엣지는 서로 가까운 방끼리만 잇는다. 무작위 쌍을 고르면 평면도를 가로지르는
  // 긴 줄이 생겨 도면이 안 읽힌다 — 잠긴 문이나 전자문은 옆방으로 나는 것이 자연스럽다.
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
      state = sa;
      // 층이 나뉜 구역(탑)에서는 같은 층 안에서만 고른다. 층과 층은 계단과 승강기로만 이어진다.
      const group = groupByNodeId[a];
      const reachable = group === undefined ? pool : pool.filter((id) => groupByNodeId[id] === group);
      const neighbours = nearest(reachable, /** @type {{x:number,y:number}} */ (byId.get(a)), 6, a);
      if (neighbours.length === 0) continue;
      const { value: b, state: sb } = pick(state, neighbours);
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
    // 구역과 구역을 잇는 특수 엣지는 서로 마주 본 경계 쪽에서만 난다 — 반대편 끝까지
    // 가로지르는 줄이 생기지 않도록 상대 구역에 가까운 노드 여덟 개 안에서 고른다.
    const frontA = nearest(externalIdsBySector[sectorA] || poolA, sectorCentroids[sectorB], 8, '');
    const frontB = nearest(externalIdsBySector[sectorB] || poolB, sectorCentroids[sectorA], 8, '');
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < 60) {
      attempts += 1;
      const { value: a, state: sa } = pick(state, frontA);
      const { value: b, state: sb } = pick(sa, frontB);
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
      const { value: a, state: sa } = pick(sPair, externalIdsBySector[pair[0]] || nodeIdsBySector[pair[0]]);
      const { value: b, state: sb } = pick(sa, externalIdsBySector[pair[1]] || nodeIdsBySector[pair[1]]);
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
function placeLandmarks(landmarkIdsBySector, nodeIdsBySector, excludeNodeIds, rngState) {
  let state = rngState;
  const excluded = new Set(excludeNodeIds);
  const landmarks = [];
  for (const sectorId of SECTOR_IDS) {
    const def = LANDMARKS_BY_SECTOR[sectorId];
    // 후보는 배치 원형이 정한 방들뿐이다(D16). 시작점·탈출구와 겹치면 그것만 뺀다.
    const candidates = landmarkIdsBySector[sectorId] || nodeIdsBySector[sectorId];
    const pool = candidates.filter((id) => !excluded.has(id));
    const { value: nodeId, state: next } = pick(state, pool.length > 0 ? pool : candidates);
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
    const { value: count, state: sCount } = weightedPick(state, NODE_TYPE_OPPORTUNITY_WEIGHTS[node.type]);
    state = sCount;
    for (let i = 0; i < count; i++) {
      const { value: roll, state: sRoll } = nextFloat(state);
      state = sRoll;
      const { value: uses, state: sUses } = weightedPick(state, OPPORTUNITY_USES_WEIGHTS);
      state = sUses;
      /** @type {import('./types.js').Opportunity} */
      const opportunity = { id: `opp${seq++}`, nodeId: node.id, keyEligible: roll < KEY_DROP_CHANCE, usesRemaining: uses, grade: 'supply' };

      // 확보 대상 승격(§5단계, D10) — 중요한 방일수록 확률이 높다. 지점마다 독립적으로
      // 굴리므로 한 구역의 확보 대상이 전부 같은 축일 수도 있고, 그러면 그 구역은 그만큼
      // 갈 이유가 줄어든다(축은 정찰로 보인다).
      const { value: prizeRoll, state: sPrize } = nextFloat(state);
      state = sPrize;
      if (prizeRoll < PRIZE_PROMOTION_CHANCE_BY_NODE_TYPE[node.type]) {
        const { value: tier, state: sTier } = weightedPick(state, PRIZE_TIER_WEIGHTS);
        state = sTier;
        const { value: axis, state: sAxis } = weightedPick(state, PRIZE_AXIS_WEIGHTS);
        state = sAxis;
        opportunity.grade = 'prize';
        opportunity.tier = tier;
        opportunity.axis = axis;
      }
      opportunities.push(opportunity);
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
    const { value, state: sValue } = weightedPick(state, NODE_TYPE_CONCEALMENT_WEIGHTS[node.type]);
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
  // 순찰은 실제로 걸어 다니는 것이므로 잠긴 통로는 길로 치지 않는다. 배치 시점에는 아직 아무
  // 엣지도 열려 있지 않으므로 구조적으로 열린 엣지만 남긴다 — 이렇게 하지 않으면 순찰 경로에
  // 자기가 열 수 없는 문(탑 승강기 등)이 끼어 위협이 층을 건너뛴다.
  const patrolEdges = allEdges.filter((edge) => isEdgeUnlocked(edge));
  // Hop count (not weighted Dijkstra distance) is the right notion of "closeness" here — it's
  // cheap (O(V+E) vs O(V^2)) and this only needs a coarse topological proximity check, not a
  // time-accurate one.
  const startHops = bfsHopDistances(patrolEdges, startNodeId);
  const threats = [];
  let seq = 0;
  /** @type {string[]} */
  const placedAnchors = [];

  for (const sectorId of SECTOR_IDS) {
    const count = THREAT_COUNT_BY_SECTOR[sectorId];
    /** @type {Map<string, string[]>} */
    const sectorAdjacency = new Map();
    for (const edge of patrolEdges) {
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
        const tooClose = placedAnchors.some((other) => (bfsHopDistances(patrolEdges, other).get(candidate) ?? Infinity) < THREAT_MIN_HOPS_BETWEEN_MARKERS);
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

  const special = placeSpecialEdges(topology.nodes, topology.edges, topology.nodeIdsBySector, topology.externalIdsBySector, topology.groupByNodeId, byId, existingPairs, baseDegree, state);
  state = special.rngState;

  const reserved = [topology.startNodeId, ...topology.exits.map((e) => e.nodeId)];
  const landmarkResult = placeLandmarks(topology.landmarkIdsBySector, topology.nodeIdsBySector, reserved, state);
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
 * §4.1: generate the full facility graph for a seed (TOTAL_NODES nodes). Deterministic — same seed always
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
