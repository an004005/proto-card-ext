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
 * Capability 0이 아무것도 열지 않고 실제로 걸어갈 수 있는 간선만으로 잰 최단 **홉수**. 통로
 * 하나는 언제나 1칸이므로(ADR-0084) 거리와 칸이 같은 값이다. 판정은
 * runEngine.isEdgeTraversable(개방 없음, 유효 Mobility 0)과 같다 — 잠긴 통로(차단·전자)와
 * 고지대(유효 Mobility 3 필요)는 없는 길로 치고, 일방통행은 생성 방향으로만 지난다. 방향에 따라
 * 값이 달라지므로 결과도 방향성이다.
 * @param {{id: string, from: string, to: string, features: string[]}[]} edges
 * @param {string} fromId
 * @returns {Map<string, number>}
 */
export function baselineWalkDistances(edges, fromId) {
  const arcs = new Map();
  for (const arc of baselineWalkArcs(edges)) link(arcs, arc.from, arc.to, 1);
  return dijkstraOverArcs(arcs, fromId);
}

/**
 * baselineWalkDistances가 거리를 재는 그 길들을 방향 호의 목록으로 그대로 내놓는다 — 거리
 * 판정과 퇴로(2경로) 판정이 같은 "걸을 수 있는 길"을 쓰게 하려고 기준을 여기 한 곳에 둔다.
 * 두 판정이 갈리면 환풍구(일방통행)나 고지대가 한쪽에서만 길로 인정돼, 실제로는 되돌아올 수
 * 없는 자리가 "퇴로 2개"로 통과한다.
 * 옵션 없이 부르면 "아무것도 열지 않고 고지대도 못 넘는" 기준(생성 단계)이다. 지도 화면처럼
 * 지금 열린 문과 현재 Mobility를 반영해야 하는 호출부는 옵션으로 같은 함수를 쓴다 — 무엇이
 * 지나갈 수 있는 길인지의 규칙을 두 벌 두지 않기 위해서다.
 * @param {{id: string, from: string, to: string, features: string[]}[]} edges
 * @param {{openedEdgeIds?: string[], allowHighGround?: boolean, withEdgeIds?: boolean}} [options]
 *   openedEdgeIds: 이미 연 잠금 엣지. allowHighGround: 고지대를 넘을 수 있는가(runEngine의
 *   canClimbHighGround 판정 결과). withEdgeIds: 호에 원래 엣지 id를 실을지(경로를 그릴 때).
 * @returns {{from: string, to: string, edgeId?: string}[]}
 */
export function baselineWalkArcs(edges, { openedEdgeIds = [], allowHighGround = false, withEdgeIds = false } = {}) {
  /** @type {{from: string, to: string, edgeId?: string}[]} */
  const arcs = [];
  for (const edge of edges) {
    if (!isEdgeUnlocked(edge, openedEdgeIds)) continue;
    if (edge.features.includes('highGround') && !allowHighGround) continue;
    const tag = withEdgeIds ? { edgeId: edge.id } : {};
    arcs.push({ from: edge.from, to: edge.to, ...tag });
    if (!edge.features.includes('oneWay')) arcs.push({ from: edge.to, to: edge.from, ...tag });
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

/**
 * 방향 호 목록 위의 최단 경로(BFS, 홉수 기준). 지도에서 노드를 클릭했을 때 "거기까지 어떻게
 * 가는가"를 보여 주는 용도라, 호출부가 지금 실제로 지날 수 있는 호만 넘긴다(잠긴 문 제외,
 * 일방통행은 생성 방향만). 도달할 수 없으면 null.
 * @param {{from: string, to: string, edgeId?: string}[]} arcs
 * @param {string} fromId
 * @param {string} toId
 * @returns {{nodeIds: string[], edgeIds: string[]} | null} nodeIds는 fromId부터 toId까지(양 끝 포함)
 */
export function shortestPathOverArcs(arcs, fromId, toId) {
  if (fromId === toId) return { nodeIds: [fromId], edgeIds: [] };
  /** @type {Map<string, {from: string, to: string, edgeId?: string}[]>} */
  const outgoing = new Map();
  for (const arc of arcs) {
    if (!outgoing.has(arc.from)) outgoing.set(arc.from, []);
    /** @type {{from: string, to: string, edgeId?: string}[]} */ (outgoing.get(arc.from)).push(arc);
  }
  /** @type {Map<string, {from: string, to: string, edgeId?: string} | null>} */
  const cameFrom = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    if (current === toId) break;
    for (const arc of outgoing.get(current) || []) {
      if (cameFrom.has(arc.to)) continue;
      cameFrom.set(arc.to, arc);
      queue.push(arc.to);
    }
  }
  if (!cameFrom.has(toId)) return null;
  const nodeIds = [toId];
  const edgeIds = [];
  let cursor = toId;
  for (;;) {
    const arc = cameFrom.get(cursor);
    if (!arc) break;
    if (arc.edgeId !== undefined) edgeIds.unshift(arc.edgeId);
    cursor = arc.from;
    nodeIds.unshift(cursor);
  }
  return { nodeIds, edgeIds };
}
