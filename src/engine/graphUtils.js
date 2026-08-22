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
 * Dijkstra weighted-shortest-path distances from `fromId`, summing each edge's `timeCost` — used
 * instead of bfsHopDistances once edges no longer have a uniform cost (see facilityGraph.js's
 * geometry-based edge time costs). O(V^2), fine at this graph's scale (no priority queue needed).
 * @param {{from: string, to: string, timeCost: number}[]} edges
 * @param {string} fromId
 * @returns {Map<string, number>} nodeId -> total weighted distance (fromId itself is 0)
 */
export function dijkstraDistances(edges, fromId) {
  const adjacency = new Map();
  /** @param {string} u @param {string} v @param {number} cost */
  const link = (u, v, cost) => {
    if (!adjacency.has(u)) adjacency.set(u, []);
    adjacency.get(u).push({ to: v, cost });
  };
  for (const edge of edges) {
    link(edge.from, edge.to, edge.timeCost);
    link(edge.to, edge.from, edge.timeCost);
  }

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
    for (const { to, cost } of adjacency.get(current) || []) {
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
 * @param {{from: string, to: string}[]} edges
 * @param {string} fromId
 * @param {string} toId
 * @param {number} [maxPaths]
 * @returns {number}
 */
export function countEdgeDisjointPaths(edges, fromId, toId, maxPaths = 2) {
  if (fromId === toId) return maxPaths;
  const capacity = new Map();
  const adjacency = new Map();
  /** @param {string} u @param {string} v */
  const addArc = (u, v) => {
    const key = `${u}->${v}`;
    capacity.set(key, (capacity.get(key) || 0) + 1);
    if (!adjacency.has(u)) adjacency.set(u, new Set());
    adjacency.get(u).add(v);
  };
  for (const edge of edges) {
    addArc(edge.from, edge.to);
    addArc(edge.to, edge.from);
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
