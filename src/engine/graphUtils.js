// Small undirected-graph helpers used by facilityGraph.js. Pure, no RNG, no game state.

/**
 * @param {{from: string, to: string}[]} edges
 * @returns {Map<string, Set<string>>}
 */
export function buildAdjacency(edges) {
  const adjacency = new Map();
  /** @param {string} u @param {string} v */
  const link = (u, v) => {
    if (!adjacency.has(u)) adjacency.set(u, new Set());
    adjacency.get(u).add(v);
  };
  for (const edge of edges) {
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }
  return adjacency;
}

/**
 * 여는 절차 없이 지나갈 수 있는 엣지인가. 차단(물리 잠금)과 전자(전자 잠금)는 둘 다 잠금이며,
 * 태그는 무엇으로 여는지를 정할 뿐이다 — 차단은 Force, 전자는 Hacking. 잠긴 문은 소리는
 * 통과시키지만 사람은 통과시키지 않는다. 무엇이 "지나갈 수 있는 길"인지는 플레이어와 위협이
 * 같은 기준을 써야 하므로(runEngine의 isEdgeTraversable) 판정을 여기 한 곳에 둔다. 생성
 * 단계처럼 아직 아무것도 열리지 않은 시점에서는 openedEdgeIds 없이 부른다.
 * @param {{id: string, features: string[]}} edge
 * @param {string[]} [openedEdgeIds]
 */
export function isEdgeUnlocked(edge, openedEdgeIds = []) {
  const locked = edge.features.includes('blocked') || edge.features.includes('electronic');
  if (!locked) return true;
  return openedEdgeIds.includes(edge.id);
}

/**
 * BFS hop-count distances from `fromId` over undirected edges.
 * @param {{from: string, to: string}[]} edges
 * @param {string} fromId
 * @returns {Map<string, number>} nodeId -> hop count (fromId itself is 0)
 */
export function bfsHopDistances(edges, fromId) {
  const adjacency = buildAdjacency(edges);
  const distances = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    const currentDistance = /** @type {number} */ (distances.get(current));
    for (const neighbor of adjacency.get(current) || []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

/**
 * 방향 호 목록 위의 BFS 홉수. bfsHopDistances와 달리 호가 방향을 가지므로, 일방통행을 역방향으로
 * 세지 않는 판정(카메라 저격의 시야)이 쓴다.
 * @param {{from: string, to: string}[]} arcs
 * @param {string} fromId
 * @returns {Map<string, number>} nodeId -> hop count
 */
export function bfsHopDistancesOverArcs(arcs, fromId) {
  /** @type {Map<string, string[]>} */
  const adjacency = new Map();
  for (const arc of arcs) {
    if (!adjacency.has(arc.from)) adjacency.set(arc.from, []);
    /** @type {string[]} */ (adjacency.get(arc.from)).push(arc.to);
  }
  const distances = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    const currentDistance = /** @type {number} */ (distances.get(current));
    for (const neighbor of adjacency.get(current) || []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

/**
 * Capability 0이 아무것도 열지 않고 실제로 걸어갈 수 있는 간선만으로 잰 가중 최단거리. 판정은
 * runEngine.isEdgeTraversable(개방 없음, 유효 Mobility 0)과 같다 — 잠긴 통로(차단·전자)와
 * 고지대(유효 Mobility 3 필요)는 없는 길로 치고, 일방통행은 생성 방향으로만 지난다. 방향에 따라
 * 값이 달라지므로 결과도 방향성이다.
 * @param {{id: string, from: string, to: string, timeCost: number, features: string[]}[]} edges
 * @param {string} fromId
 * @returns {Map<string, number>}
 */
export function baselineWalkDistances(edges, fromId) {
  const arcs = new Map();
  for (const arc of baselineWalkArcs(edges)) link(arcs, arc.from, arc.to, arc.timeCost);
  return dijkstraOverArcs(arcs, fromId);
}

/**
 * baselineWalkDistances가 거리를 재는 그 길들을 방향 호의 목록으로 그대로 내놓는다 — 거리
 * 판정과 퇴로(2경로) 판정이 같은 "걸을 수 있는 길"을 쓰게 하려고 기준을 여기 한 곳에 둔다.
 * 두 판정이 갈리면 환풍구(일방통행)나 고지대가 한쪽에서만 길로 인정돼, 실제로는 되돌아올 수
 * 없는 자리가 "퇴로 2개"로 통과한다.
 * @param {{id: string, from: string, to: string, timeCost: number, features: string[]}[]} edges
 * @returns {{from: string, to: string, timeCost: number}[]}
 */
export function baselineWalkArcs(edges) {
  /** @type {{from: string, to: string, timeCost: number}[]} */
  const arcs = [];
  for (const edge of edges) {
    if (!isEdgeUnlocked(edge)) continue;
    if (edge.features.includes('highGround')) continue;
    arcs.push({ from: edge.from, to: edge.to, timeCost: edge.timeCost });
    if (!edge.features.includes('oneWay')) arcs.push({ from: edge.to, to: edge.from, timeCost: edge.timeCost });
  }
  return arcs;
}

/** @param {Map<string, {to: string, cost: number}[]>} arcs @param {string} u @param {string} v @param {number} cost */
function link(arcs, u, v, cost) {
  if (!arcs.has(u)) arcs.set(u, []);
  /** @type {{to: string, cost: number}[]} */ (arcs.get(u)).push({ to: v, cost });
}

/**
 * @param {Map<string, {to: string, cost: number}[]>} arcs
 * @param {string} fromId
 * @returns {Map<string, number>}
 */
function dijkstraOverArcs(arcs, fromId) {
  const distances = new Map([[fromId, 0]]);
  const visited = new Set();
  for (;;) {
    let current = null;
    let currentDist = Infinity;
    for (const [nodeId, dist] of distances) {
      if (!visited.has(nodeId) && dist < currentDist) { current = nodeId; currentDist = dist; }
    }
    if (current === null) break;
    visited.add(current);
    for (const { to, cost } of arcs.get(current) || []) {
      const candidate = currentDist + cost;
      if (candidate < (distances.get(to) ?? Infinity)) distances.set(to, candidate);
    }
  }
  return distances;
}

/**
 * Counts edge-disjoint paths between two nodes over undirected unit-capacity edges, up to
 * `maxPaths`, via repeated BFS augmenting paths (Edmonds-Karp, capped). By Menger's theorem this
 * equals min(edge connectivity, maxPaths).
 *
 * With `{directed: true}` each entry of `edges` is a one-way arc from→to instead of an undirected
 * edge — the caller lists both directions itself for two-way passages. That is the mode to use
 * when "can I walk it" is direction-dependent (일방통행), so the answer matches
 * baselineWalkDistances rather than a more generous undirected reading of the same graph.
 * @param {{from: string, to: string}[]} edges
 * @param {string} fromId
 * @param {string} toId
 * @param {number} [maxPaths]
 * @param {{directed?: boolean}} [options]
 * @returns {number}
 */
export function countEdgeDisjointPaths(edges, fromId, toId, maxPaths = 2, options = {}) {
  if (fromId === toId) return maxPaths;
  const directed = options.directed === true;
  const capacity = new Map();
  const adjacency = new Map();
  // 용량 0으로도 인접에 등록한다 — 잔여 그래프(residual)에서 되돌아가는 호가 있어야
  // 증가 경로 탐색이 올바르다. 방향 모드의 역방향은 용량 0인 잔여 호일 뿐이다.
  /** @param {string} u @param {string} v @param {number} cap */
  const addArc = (u, v, cap) => {
    const key = `${u}->${v}`;
    capacity.set(key, (capacity.get(key) || 0) + cap);
    if (!adjacency.has(u)) adjacency.set(u, new Set());
    adjacency.get(u).add(v);
  };
  for (const edge of edges) {
    addArc(edge.from, edge.to, 1);
    addArc(edge.to, edge.from, directed ? 0 : 1);
  }

  let pathsFound = 0;
  while (pathsFound < maxPaths) {
    const prev = new Map();
    const visited = new Set([fromId]);
    const queue = [fromId];
    let reached = false;
    while (queue.length > 0 && !reached) {
      const u = queue.shift();
      for (const v of adjacency.get(u) || []) {
        if (visited.has(v)) continue;
        if ((capacity.get(`${u}->${v}`) || 0) <= 0) continue;
        visited.add(v);
        prev.set(v, u);
        if (v === toId) { reached = true; break; }
        queue.push(v);
      }
    }
    if (!reached) break;
    let v = toId;
    while (v !== fromId) {
      const u = prev.get(v);
      capacity.set(`${u}->${v}`, (capacity.get(`${u}->${v}`) || 0) - 1);
      capacity.set(`${v}->${u}`, (capacity.get(`${v}->${u}`) || 0) + 1);
      v = u;
    }
    pathsFound += 1;
  }
  return pathsFound;
}

/**
 * @param {{from: string, to: string}[]} edges
 * @param {string} fromId
 * @returns {Set<string>} every node reachable from fromId, including fromId itself
 */
export function reachableSet(edges, fromId) {
  return new Set(bfsHopDistances(edges, fromId).keys());
}
