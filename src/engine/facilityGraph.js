// Extraction facility graph generation (docs/extraction-map-implementation-spec.md §4).
// Pure and deterministic: every function threads rngState explicitly (see rng.js), never calls
// Math.random().
//
// A run does not use all eight sector definitions. selectRunSectorIds draws RUN_SECTOR_COUNT (4)
// of them — entrance always, the contract's objective sector always, plus two others
// (ADR-0081, ADR-0083). The draw runs once per *offered* contract, at offer time, so the contract
// screen can show the facility it is selling (ADR-0089); accepting only carries that list over.
// Every step below takes that ordered list as a parameter. The list is
// the ring order and is stored on the finished graph as `graph.sectorIds`; nothing outside this
// module may assume which sectors a run has.
//
// Topology design (floor plans on a ring). Each of the run's sectors (facilityLayout.js
// SECTOR_LAYOUTS) gets a center on one big ring, and its interior is drawn by layoutArchetypes.js as an actual
// floor plan — a corridor skeleton whose shape comes from that sector's archetype (grid, chain,
// radial, tower, hall, dual) with rooms hung off it. Sector node counts differ (SECTOR_LAYOUTS):
// the hangar is 14 big rooms while the residential block is 32 mostly-corridor nodes, so a
// sector's size is itself information. Every node carries a type (FacilityNodeType) that decides
// its concealment and opportunity density.
//
// Regular edges come from two places and two places only: the floor plan's own doors and
// corridors, and one gateway edge per ring-adjacent sector pair. There is no global
// nearest-neighbor pass any more — an edge exists because the building has a door there. Because
// the run's sectors form a ring, no gateway edge is a bridge, and a route can go around the ring
// either way.
//
// Edges carry no time cost of their own any more (ADR-0084): every corridor is one 칸. Distance
// metrics — including the exit placement's "farthest from the start" — are therefore plain hop
// counts over the walkable subgraph (graphUtils.js baselineWalkDistances).
//
// Special edges (§4.2) are additional edges layered on top of the base graph, in three flavors:
// "within-sector" (both endpoints from one sector's pool), "cross-sector" (one endpoint from each
// of a ring-neighbor pair's pools), and a very small number of "long-range"
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
import { baselineWalkDistances, baselineWalkArcs, bfsHopDistances, countEdgeDisjointPaths, reachableSet, isEdgeUnlocked } from './graphUtils.js';
import { generateSectorLayout } from './layoutArchetypes.js';
import {
  ALL_SECTOR_IDS, RUN_SECTOR_COUNT, START_SECTOR_ID, DEEPEST_SECTOR_ID,
  SECTOR_RING_RADIUS, SECTOR_NODE_RADIUS,
  BASE_EDGE_DEGREE_HARD_CAP, EXIT_PLACEMENT_MAX_ATTEMPTS,
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

/**
 * 이 런이 쓸 구역을 뽑는다(ADR-0081, ADR-0083, ADR-0089). 추첨은 **계약 제안을 만들 때 제안마다
 * 한 번씩** 돈다 — 제안은 여덟 구역 전부에서 나오고(contractReducer.offerContracts), 각 제안의
 * 목표 구역이 그 제안의 추첨에 무조건 포함된다. 결과는 제안의 `sectorIds`에 담겨 계약 화면에
 * 그대로 보이고, 수락은 그것을 옮겨 담을 뿐 다시 굴리지 않는다. 그래서 "가지 않을 구역의
 * 계약"도, "제안이 한 장뿐인 조합"도, "수락하고 나서야 알게 되는 시설"도 없다.
 *
 * 구성은 entrance(시작점이자 격자 허브 — 빼면 런이 성립하지 않는다) + 계약 목표 구역 + 나머지
 * 구역에서 균등하게 뽑은 둘이다. 목표 구역이 entrance면(정보 계약 record_review) 이미
 * 포함되어 있으므로 나머지 셋을 뽑는다.
 *
 * 반환 순서가 곧 링 순서다. entrance가 0번이고, 2번(링에서 entrance의 정반대, 가장 깊은 자리)은
 * 다음 우선순위로 채운다:
 *   1. power가 뽑혔다면 power — "가장 깊고 위험한 구역이 시작점에서 가장 멀다".
 *   2. 아니면 계약 목표 구역 — 목표가 얕은 자리에 오면 계약이 곧바로 끝나 버린다.
 * 나머지는 뽑힌 순서 그대로 들어간다.
 * @param {import('./rng.js').RngState} rngState
 * @param {string} [contractSectorId] 이 제안의 목표 구역. 생략하면 옛 방식대로 셋을 뽑는다
 *   (측정 스크립트와 테스트가 계약 없이 한 런을 재현할 때 쓴다).
 * @returns {{sectorIds: import('./types.js').FacilitySectorId[], rngState: import('./rng.js').RngState}}
 */
export function selectRunSectorIds(rngState, contractSectorId = undefined) {
  const guaranteed = contractSectorId && contractSectorId !== START_SECTOR_ID ? [contractSectorId] : [];
  const pool = ALL_SECTOR_IDS.filter((id) => id !== START_SECTOR_ID && !guaranteed.includes(id));
  const { value: shuffled, state } = shuffle(rngState, pool);
  const drawn = [...guaranteed, ...shuffled.slice(0, RUN_SECTOR_COUNT - 1 - guaranteed.length)];
  const deepest = drawn.includes(DEEPEST_SECTOR_ID) ? DEEPEST_SECTOR_ID
    : (guaranteed.length > 0 ? guaranteed[0] : null);
  const rest = drawn.filter((id) => id !== deepest);
  const sectorIds = deepest === null
    ? [START_SECTOR_ID, ...drawn]
    : [START_SECTOR_ID, rest[0], deepest, ...rest.slice(1)];
  return { sectorIds: /** @type {import('./types.js').FacilitySectorId[]} */ (sectorIds), rngState: state };
}

/**
 * 링에서 맞닿은 구역 쌍 — 관문 엣지와 구역 간 특수 엣지가 여기에만 놓인다.
 * @param {readonly string[]} sectorIds 링 순서
 * @returns {[string, string][]}
 */
export function sectorRingPairs(sectorIds) {
  return sectorIds.map((s, i) => /** @type {[string, string]} */ ([s, sectorIds[(i + 1) % sectorIds.length]]));
}

/**
 * 런 전체가 쓰는 유일한 구역 인접 정의 — 링에서 이 구역과 맞닿은 구역들이다. 구역이 넷이면
 * 이웃은 둘이고 맞은편 하나는 이웃이 아니다. 경계도 이동(D12 가짜 목표 송출), 통제실 해킹
 * 3단계의 이웃 구역 완화, 정보 계약의 송출 구역 판정이 전부 이것을 본다.
 * @param {{sectorIds: readonly string[]}} graph
 * @param {string} sectorId
 * @returns {import('./types.js').FacilitySectorId[]}
 */
export function adjacentSectorIds(graph, sectorId) {
  const sectorIds = graph.sectorIds;
  const i = sectorIds.indexOf(sectorId);
  if (i < 0) return [];
  const n = sectorIds.length;
  return /** @type {import('./types.js').FacilitySectorId[]} */ (
    [...new Set([sectorIds[(i + n - 1) % n], sectorIds[(i + 1) % n]])]
  );
}

// Derived from endpoints rather than a mutable counter — a module-level counter would make the
// `id` field depend on how many graphs were generated before this call, breaking the "same seed
// -> byte-identical graph" guarantee across repeated calls within one process.
/** @param {string} from @param {string} to */
function edgeId(from, to) { return `edge_${from}_${to}`; }

/** @param {{x: number, y: number}} a @param {{x: number, y: number}} b */
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/**
 * @typedef {Object} Topology
 * @property {string[]} sectorIds 이 런의 구역 — 링 순서.
 * @property {import('./types.js').FacilityNode[]} nodes
 * @property {import('./types.js').FacilityEdge[]} edges 특수 엣지까지 얹은 완성 간선 목록.
 * @property {Record<string, string[]>} nodeIdsBySector
 * @property {Record<string, string[]>} landmarkIdsBySector 표지가 놓일 수 있는 노드. 배치 원형이
 *   정한다(D16) — 도면만 보고 후보를 좁힐 수 있게 하려는 것이다.
 * @property {string} startNodeId
 * @property {import('./types.js').ExitPlacement[]} exits
 * @property {import('./types.js').ExitPlacementMeta} exitPlacement
 */

/**
 * Steps 1-3 of §4.1. Each of the run's sectors gets a center on one big ring (SECTOR_RING_RADIUS
 * from the global origin, evenly spaced by `sectorIds` order — see selectRunSectorIds for why
 * entrance sits at index 0 and power, when drawn, opposite it). Inside that center layoutArchetypes.js draws the sector's
 * floor plan: a corridor skeleton whose shape depends on the sector's archetype, with rooms hung
 * off it. The generator returns local coordinates normalized to radius 1, which we scale by
 * SECTOR_NODE_RADIUS and translate onto the ring — so sector-to-sector distance is decided purely
 * by the ring and is unaffected by which archetype a sector uses. That matters because the exit
 * distance ranges and the whole time budget are calibrated against this coordinate scale.
 *
 * Sectors are joined only by gateway edges: for each ring-adjacent pair, the node in each sector
 * closest to the other sector's center becomes a gateway, and one regular edge links them. The
 * run's sectors therefore form a ring, so no gateway edge is a bridge and the route around the
 * ring stays open in both directions.
 * @param {import('./rng.js').RngState} rngState
 * @param {readonly string[]} sectorIds 이 런의 구역 — 링 순서.
 */
export function buildBaseGraph(rngState, sectorIds) {
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
    /** @type {import('./types.js').FacilityEdge} */
    const edge = { id: edgeId(a, b), from: a, to: b, bidirectional: true, features };
    if (requiredCapability !== undefined) edge.requiredCapability = requiredCapability;
    edges.push(edge);
    existing.add(key);
    degree.set(a, /** @type {number} */ (degree.get(a)) + 1);
    degree.set(b, /** @type {number} */ (degree.get(b)) + 1);
  };

  sectorIds.forEach((sectorId, sectorIndex) => {
    const angle = (sectorIndex / sectorIds.length) * Math.PI * 2 - Math.PI / 2;
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
  for (const [fromSector, toSector] of sectorRingPairs(sectorIds)) {
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
 * Step 4-5 of §4.1: place start + the two exits on the **finished** graph — special edges
 * included (ADR-0076의 "완성 그래프에서 판정" 부분은 유효하다). 표준 출구는 A 하나뿐이고
 * 열쇠 출구가 유일한 대안 경로다(ADR-0083 — 출구 B는 없앴다).
 *
 * 출구 A의 자리는 더 이상 무작위가 아니다. 시작 구역(입구·관리동)도, **이번 계약의 목표 구역**도
 * 아닌 구역 중에서, 시작점에서 걸어서 가장 먼 노드가 A다 — 거리는 Capability 0이 아무것도 열지
 * 않고 지날 수 있는 간선만으로 잰다(baselineWalkDistances). 목표 구역을 빼는 이유는 "목표를
 * 집은 자리가 곧 탈출구"인 런을 없애기 위해서다: 계약의 마지막 장은 언제나 목표부에서 다른
 * 구역으로 건너가는 구간이어야 한다. 계약 구역이 시작 구역이면(정보 계약 record_review) 뺄
 * 구역이 없으므로 시작 구역만 빠진다.
 *
 * 열쇠 출구는 A와 다른 구역이면 어디든 좋다 — 목표 구역도 허용한다. 무작위로 뽑되
 * EXIT_PLACEMENT_MAX_ATTEMPTS번 안에 2-edge-disjoint 조건을 만족하는 노드를 찾는다.
 * 어느 쪽도 못 놓으면 null을 돌려 호출부의 재시도 신호가 된다.
 * @param {import('./types.js').FacilityNode[]} nodes
 * @param {import('./types.js').FacilityEdge[]} edges 특수 엣지까지 얹은 완성 그래프.
 * @param {import('./rng.js').RngState} rngState
 * @param {readonly string[]} sectorIds
 * @param {string} [contractSectorId] 이번 계약의 목표 구역. 출구 A는 여기 놓이지 않는다.
 */
function placeStartAndExits(nodes, edges, rngState, sectorIds, contractSectorId = undefined) {
  const entranceNodes = nodes.filter((n) => n.sectorId === START_SECTOR_ID).map((n) => n.id);
  const { value: startNodeId, state: afterStart } = pick(rngState, entranceNodes);
  let state = afterStart;

  /** @type {Record<string, string[]>} */
  const poolBySector = {};
  for (const node of nodes) {
    if (node.sectorId === START_SECTOR_ID) continue;
    (poolBySector[node.sectorId] ||= []).push(node.id);
  }
  const exitSectors = sectorIds.filter((sectorId) => (poolBySector[sectorId] || []).length > 0);
  if (exitSectors.length < 2) return null;

  // 방을 복도 하나에만 매단 평면도에서는 잎 노드가 많고, 잎으로 가는 길은 하나뿐이라 §4.1 step 5의
  // 2-edge-disjoint 요구를 만족하지 못한다. 후보 노드 하나당 한 번만 검사하고 캐시한다.
  // 잠긴 통로는 우회로로 치지 않는다 — 배치 원형이 구조적으로 두는 특수 엣지(탑 승강기)를 두 번째
  // 경로로 인정하면 "열지 못하면 퇴로가 없는" 탈출구가 생긴다. 같은 이유로 고지대(유효
  // Mobility 3 필요)도 빼고 환풍구(일방통행)는 생성 방향으로만 센다 — 시작점부터의 거리를 재는
  // baselineWalkDistances와 같은 기준이다(baselineWalkArcs). 무향으로 세면 되돌아올 수 없는
  // 통로가 두 번째 퇴로로 인정돼, 실제 보행 가능 간선만으로는 퇴로가 하나뿐인 출구가 나온다.
  const redundancyArcs = baselineWalkArcs(edges);
  /** @type {Map<string, boolean>} */
  const twoPathCache = new Map();
  /** @param {string} nodeId */
  const hasTwoPaths = (nodeId) => {
    const cached = twoPathCache.get(nodeId);
    if (cached !== undefined) return cached;
    const ok = countEdgeDisjointPaths(redundancyArcs, startNodeId, nodeId, 2, { directed: true }) >= 2;
    twoPathCache.set(nodeId, ok);
    return ok;
  };

  const walkFromStart = baselineWalkDistances(edges, startNodeId);

  /** 한 구역에서 탈출구가 될 수 있는 노드 하나. 전부 잎이면 null. @param {string} sectorId */
  const pickExitNode = (sectorId) => {
    const pool = poolBySector[sectorId];
    for (let i = 0; i < 8; i++) {
      const { value: candidate, state: next } = pick(state, pool);
      state = next;
      if (hasTwoPaths(candidate)) return candidate;
    }
    return null;
  };

  // 출구 A — 시작 구역도 목표 구역도 아닌 구역에서, 시작점에서 걸어서 가장 먼 노드. 동점은
  // 노드 id로 가른다(시드가 같으면 언제나 같은 그래프여야 한다). 도달 불가(Infinity)는 뺀다.
  const aSectors = exitSectors.filter((sectorId) => sectorId !== contractSectorId);
  if (aSectors.length === 0) return null;
  /** @type {{nodeId: string, sectorId: string, distance: number} | null} */
  let exitA = null;
  for (const sectorId of aSectors) {
    for (const nodeId of poolBySector[sectorId]) {
      const distance = walkFromStart.get(nodeId) ?? Infinity;
      if (!Number.isFinite(distance)) continue;
      if (exitA && !(distance > exitA.distance || (distance === exitA.distance && nodeId < exitA.nodeId))) continue;
      if (!hasTwoPaths(nodeId)) continue;
      exitA = { nodeId, sectorId, distance };
    }
  }
  if (!exitA) return null;

  // 열쇠 출구 — A와 다른 구역이면 목표 구역이어도 좋다.
  const keySectors = exitSectors.filter((sectorId) => sectorId !== exitA.sectorId);
  if (keySectors.length === 0) return null;
  /** @type {{nodeId: string, sectorId: string} | null} */
  let exitKey = null;
  for (let attempt = 0; attempt < EXIT_PLACEMENT_MAX_ATTEMPTS && !exitKey; attempt++) {
    const { value: sectorId, state: afterPick } = pick(state, keySectors);
    state = afterPick;
    const nodeId = pickExitNode(sectorId);
    if (nodeId) exitKey = { nodeId, sectorId };
  }
  if (!exitKey) return null;

  /** @type {import('./types.js').ExitPlacement[]} */
  const exits = [
    { exitId: 'A', nodeId: exitA.nodeId, sectorId: /** @type {any} */ (exitA.sectorId) },
    { exitId: 'key', nodeId: exitKey.nodeId, sectorId: /** @type {any} */ (exitKey.sectorId) },
  ];
  /** @type {import('./types.js').ExitPlacementMeta} */
  const exitPlacement = { exitAWalkDistance: exitA.distance };
  return { startNodeId, exits, exitPlacement, rngState: state };
}

/**
 * §4.1 steps 1-5+8 as a single attempt. Special edges are layered on **before** the exits are
 * placed (ADR-0076) so the exit distance is judged on the graph the player actually walks;
 * a guarantee proven on the base graph alone did not survive the special edges.
 * Returns `{ok:false}` if this rngState's graph can't satisfy the connectivity/path requirements —
 * caller retries with the returned rngState.
 * @param {import('./rng.js').RngState} rngState
 * @param {readonly string[]} sectorIds
 * @param {string} [contractSectorId]
 * @returns {{ok: false, rngState: import('./rng.js').RngState} | {ok: true, topology: Topology, rngState: import('./rng.js').RngState}}
 */
function tryBuildTopology(rngState, sectorIds, contractSectorId = undefined) {
  const base = buildBaseGraph(rngState, sectorIds);

  // Step 7: every node reachable — the floor plans plus gateway edges are *usually* enough to fully
  // connect the graph, but it isn't structurally guaranteed, so this check is load-bearing. Run it
  // before the expensive steps; undirected reachability is symmetric, so any node works as a root
  // (the start node isn't chosen until placeStartAndExits).
  const reachable = reachableSet(base.edges, base.nodes[0].id);
  if (reachable.size !== base.nodes.length) return { ok: false, rngState: base.rngState };

  const { byId, existing, degree } = deriveGraphMeta(base.nodes, base.edges);
  const special = placeSpecialEdges(
    base.nodes, base.edges, base.nodeIdsBySector, base.externalIdsBySector, base.groupByNodeId,
    byId, existing, degree, base.rngState, sectorIds,
  );
  const edges = [...base.edges, ...special.specialEdges];

  const placement = placeStartAndExits(base.nodes, edges, special.rngState, sectorIds, contractSectorId);
  if (!placement) return { ok: false, rngState: special.rngState };

  return {
    ok: true,
    topology: {
      sectorIds: [...sectorIds],
      nodes: base.nodes,
      edges,
      nodeIdsBySector: base.nodeIdsBySector,
      landmarkIdsBySector: base.landmarkIdsBySector,
      startNodeId: placement.startNodeId,
      exits: placement.exits,
      exitPlacement: placement.exitPlacement,
    },
    rngState: placement.rngState,
  };
}

// 구역 조합마다 fallback 도면이 다르므로 조합을 키로 캐싱한다.
/** @type {Map<string, Topology>} */
const cachedFallbackTopologies = new Map();
/** @param {readonly string[]} sectorIds @param {string} [contractSectorId] */
function getFallbackTopology(sectorIds, contractSectorId = undefined) {
  // 출구 A의 자리가 계약 구역에 따라 달라지므로 캐시 키에도 계약 구역이 들어간다.
  const key = [...sectorIds, contractSectorId ?? '-'].join('|');
  const cached = cachedFallbackTopologies.get(key);
  if (cached) return cached;
  for (let seed = 0; seed < FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT; seed++) {
    const result = tryBuildTopology(createRngState(seed), sectorIds, contractSectorId);
    if (result.ok) {
      cachedFallbackTopologies.set(key, result.topology);
      return result.topology;
    }
  }
  throw new Error(`no valid fallback facility topology found within ${FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT} attempts`);
}

/**
 * §4.2 special edges: additional edges layered on top of the base graph, never replacing one, in
 * three flavors — "within-sector" (both endpoints from one sector's pool), "cross-sector" (one
 * endpoint from each sector in a ring-neighbor pair's pool), and a handful of
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
 * @param {readonly string[]} sectorIds
 */
function placeSpecialEdges(nodes, baseEdges, nodeIdsBySector, externalIdsBySector, groupByNodeId, byId, existingPairs, baseDegree, rngState, sectorIds) {
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
    specialEdges.push({
      id: edgeId(a, b), from: a, to: b, bidirectional: category !== 'oneWay', features,
    });
    existing.add(key);
    degree.set(a, /** @type {number} */ (degree.get(a)) + 1);
    degree.set(b, /** @type {number} */ (degree.get(b)) + 1);
    return true;
  };

  // 구역 중심(노드 평균) — 구역 간 특수 엣지를 서로 마주 보는 쪽에 놓기 위해 쓴다.
  /** @type {Record<string, {x: number, y: number}>} */
  const sectorCentroids = {};
  for (const sectorId of sectorIds) {
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
  for (const sectorId of sectorIds) {
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

  const ringPairs = sectorRingPairs(sectorIds);
  for (const [sectorA, sectorB] of ringPairs) {
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

  // 원거리 지름길 — 링에서 인접하지 않은 구역 쌍을 잇는 아주 소수의
  // 특수 엣지. 전체 그래프에 걸쳐 LONG_RANGE_SPECIAL_EDGES_MIN~MAX개만 두므로, 매 시도마다
  // 무작위 비인접 쌍을 하나 골라 시도한다(특정 쌍에 몰아주지 않기 위해).
  const adjacentKeys = new Set(ringPairs.map(([a, b]) => [a, b].sort().join('|')));
  /** @type {[string, string][]} */
  const nonAdjacentSectorPairs = [];
  for (let i = 0; i < sectorIds.length; i++) {
    for (let j = i + 1; j < sectorIds.length; j++) {
      const key = [sectorIds[i], sectorIds[j]].sort().join('|');
      if (!adjacentKeys.has(key)) nonAdjacentSectorPairs.push([sectorIds[i], sectorIds[j]]);
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
 * @param {readonly string[]} sectorIds
 */
function placeLandmarks(landmarkIdsBySector, nodeIdsBySector, excludeNodeIds, rngState, sectorIds) {
  let state = rngState;
  const excluded = new Set(excludeNodeIds);
  const landmarks = [];
  for (const sectorId of sectorIds) {
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
 * @param {readonly string[]} sectorIds
 */
function placeSecurityDevices(nodes, rngState, sectorIds) {
  let state = rngState;
  const cameras = [];
  const accessInterfaces = [];
  for (const node of nodes) {
    const cameraRoll = nextFloat(state); state = cameraRoll.state;
    const interfaceRoll = nextFloat(state); state = interfaceRoll.state;
    if (cameraRoll.value < CAMERA_NODE_CHANCE) cameras.push({ id: `camera_${node.id}`, nodeId: node.id });
    if (interfaceRoll.value < ACCESS_INTERFACE_NODE_CHANCE) accessInterfaces.push({ id: `interface_${node.id}`, nodeId: node.id });
  }
  for (const sectorId of sectorIds) {
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

/** One battery generator is installed in each powered sector the run actually drew — a run that
 * drew neither 동력동 nor 실험동 has no generator to cut, and 전원 차단 is simply off the table. */
function placeGenerators(nodeIdsBySector, rngState, sectorIds) {
  let state = rngState;
  const generators = [];
  for (const sectorId of GENERATOR_SECTOR_IDS.filter((id) => sectorIds.includes(id))) {
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
 * @param {readonly string[]} sectorIds
 */
function placeThreats(allEdges, nodeIdsBySector, startNodeId, rngState, sectorIds) {
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

  for (const sectorId of sectorIds) {
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
      if (sectorId === START_SECTOR_ID) sizeWeights = THREAT_GROUP_SIZE_WEIGHTS.filter((w) => w.value <= ENTRANCE_THREAT_MAX_GROUP_SIZE);
      const { value: size, state: sSize } = weightedPick(state, sizeWeights);
      state = sSize;

      threats.push({ id: `threat${seq++}`, sectorId, size, patrolRoute });
    }
  }
  return { threats, rngState: state };
}

/**
 * §4.1 step 6: landmarks, opportunities, security devices, threats, concealment. Always succeeds —
 * no failure mode here, unlike the topology step. Special edges are already in topology.edges: they
 * are placed in tryBuildTopology, before the exits (ADR-0076).
 * @param {Topology} topology
 * @param {import('./rng.js').RngState} rngState
 */
function placeContent(topology, rngState) {
  let state = rngState;

  const reserved = [topology.startNodeId, ...topology.exits.map((e) => e.nodeId)];
  const landmarkResult = placeLandmarks(topology.landmarkIdsBySector, topology.nodeIdsBySector, reserved, state, topology.sectorIds);
  state = landmarkResult.rngState;

  const opportunityResult = placeOpportunities(topology.nodes, state);
  state = opportunityResult.rngState;

  const securityResult = placeSecurityDevices(topology.nodes, state, topology.sectorIds);
  state = securityResult.rngState;

  const generatorResult = placeGenerators(topology.nodeIdsBySector, state, topology.sectorIds);
  state = generatorResult.rngState;

  const threatResult = placeThreats(topology.edges, topology.nodeIdsBySector, topology.startNodeId, state, topology.sectorIds);
  state = threatResult.rngState;

  // 은엄폐는 맨 마지막에 뽑는다 — 다른 콘텐츠(특히 위협 배치/경로)보다 나중 draw여야 이 기능을
  // 추가하기 전 시드의 위협 배치가 그대로 보존된다(회귀 테스트가 그 결정성에 기대고 있었음).
  const concealmentResult = placeConcealment(topology.nodes, state);
  state = concealmentResult.rngState;

  return {
    content: {
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
 * §4.1: generate the full facility graph for a seed. Deterministic — the same seed and the same
 * sector list always produce the same graph, threats, opportunities, and key-eligible rolls.
 * @param {number} seed
 * @param {readonly string[]} [sectorIds] 이 런의 구역(링 순서). 생략하면 같은 시드에서
 *   selectRunSectorIds로 뽑는다 — 측정 스크립트와 테스트가 시드 하나만으로 한 런을 그대로
 *   재현할 수 있게 하려는 것이다. 실제 플레이 경로는 ACCEPT_CONTRACT가 뽑아 스냅샷에 담아 둔 목록을 넘긴다.
 * @param {string} [contractSectorId] 수락한 계약의 목표 구역 — 출구 A가 여기 놓이지 않게 한다(ADR-0083).
 * @returns {{graph: import('./types.js').FacilityGraph, rngState: import('./rng.js').RngState, usedFallback: boolean}}
 */
export function generateFacilityGraph(seed, sectorIds = undefined, contractSectorId = undefined) {
  const runSectorIds = sectorIds || selectRunSectorIds(createRngState(seed), contractSectorId).sectorIds;
  let rngState = createRngState(seed);
  /** @type {Topology | null} */
  let topology = null;
  let usedFallback = false;
  for (let attempt = 0; attempt < GENERATION_MAX_ATTEMPTS; attempt++) {
    const result = tryBuildTopology(rngState, runSectorIds, contractSectorId);
    rngState = result.rngState;
    if (result.ok) { topology = result.topology; break; }
  }
  if (!topology) {
    topology = getFallbackTopology(runSectorIds, contractSectorId);
    usedFallback = true;
  }

  const contentResult = placeContent(topology, rngState);
  return {
    graph: {
      sectorIds: topology.sectorIds,
      nodes: topology.nodes,
      edges: topology.edges,
      startNodeId: topology.startNodeId,
      exits: topology.exits,
      exitPlacement: topology.exitPlacement,
      landmarks: contentResult.content.landmarks,
      opportunities: contentResult.content.opportunities,
      concealmentByNodeId: contentResult.content.concealmentByNodeId,
      cameras: contentResult.content.cameras,
      accessInterfaces: contentResult.content.accessInterfaces,
      generators: contentResult.content.generators,
      threats: contentResult.content.threats,
    },
    rngState: contentResult.rngState,
    usedFallback,
  };
}
