// 지도 캔버스 위 노드 좌표. 엔진이 준 평면도 좌표(layoutArchetypes)를 캔버스에 맞춰 축척한 뒤,
// 노드가 남의 통로 위에 얹히거나 서로 포개지지 않도록 조금씩 밀어내는 정리를 한다.
// 순수 함수이며 RNG를 쓰지 않는다 — 같은 그래프는 언제나 같은 그림이 된다.

import { PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR } from '../data/facilityLayout.js';

// 구역마다 노드가 두 배가 되면서(ADR-0088) 캔버스도 면적 두 배, 즉 변으로 √2배 키웠다.
// 엔진 좌표는 여기서 캔버스에 꽉 차게 축척되므로(fitToCanvas), 노드 사이 px 간격을 예전과
// 비슷하게 유지하는 것은 엔진 쪽 반경이 아니라 이 두 값이다.
export const CANVAS_WIDTH = 1980;
export const CANVAS_HEIGHT = 1980;
export const CANVAS_PADDING = 50;
export const NODE_RADIUS = 8;

/** 노드 중심과 남의 통로 사이에 확보하려는 거리(px). 노드 원(8) + 표식 글자 + 여유. */
const EDGE_CLEARANCE = NODE_RADIUS + 16;
/** 노드 중심끼리 확보하려는 거리(px). 두 노드의 원과 그 주변 표식이 겹치지 않을 만큼. */
const NODE_CLEARANCE = NODE_RADIUS * 2 + 20;
/** 한 노드가 원래 자리에서 벗어날 수 있는 상한(px). 배치 원형(격자·사슬·방사·탑)의 모양은
 * 구역 성격을 읽는 단서라, 정리는 그 모양을 깨지 않는 범위 안에서만 한다. */
const MAX_DISPLACEMENT = 40;
const RELAX_ITERATIONS = 120;
/** 한 반복에서 가장 많이 움직인 노드의 이동량이 이보다 작으면 수렴한 것으로 보고 멈춘다(px). */
const RELAX_SETTLE_EPSILON = 0.5;
/** 밀어낼 때는 목표 거리보다 조금 더 멀리 민다(px). 수렴이 목표 바로 아래 1px에서 멎으면
 * 측정으로는 여전히 "붙어 있음"으로 세어지므로, 그 여유를 미리 준다. */
const RELAX_OVERSHOOT = 3;
/** 상한을 넘은 평범한 통로를 당기는 세기. 밀어내는 힘과 같은 반복 안에서 겨루므로, 겹침을
 * 되살릴 만큼 세면 안 된다. */
const PLAIN_EDGE_PULL_GAIN = 0.9;
/** 당긴 뒤 남겨 둘 여유(px) — 상한 바로 위에서 멎어 측정에 걸리지 않도록 조금 더 당긴다. */
const PLAIN_EDGE_PULL_UNDERSHOOT = 12;

/**
 * 그래프별 배치 결과 캐시. 배치는 그래프만의 순수 함수인데 구역이 두 배가 된 뒤로는 한 번
 * 도는 데 0.4초가 걸린다 — 화면이 다시 마운트될 때마다(전투·인벤토리 팝업마다) 그 값을 다시
 * 만들면 지도가 열릴 때마다 눈에 띄게 멈춘다. 그래프 객체는 런 동안 바뀌지 않으므로 그것을
 * 키로 기억해 두고, 런이 끝나 그래프가 버려지면 캐시도 함께 사라진다(WeakMap).
 * @type {WeakMap<object, Record<string, {x: number, y: number}>>}
 */
const layoutCache = new WeakMap();

/**
 * @param {{nodes: {id: string, x: number, y: number}[], edges: {from: string, to: string}[]}} graph
 * @returns {Record<string, {x: number, y: number}>}
 */
export function layoutPositions(graph) {
  const cached = layoutCache.get(graph);
  if (cached) return cached;
  const positions = relaxPositions(graph, inflateSectors(graph, shortenPlainEdges(graph, rehangRooms(graph, scaledPositions(graph)))));
  layoutCache.set(graph, positions);
  return positions;
}

/** 지나가기 위한 노드 — 이들끼리 잇는 엣지가 구역 평면도의 복도 뼈대다. */
export const PASSAGE_TYPES = new Set(['corridor', 'hall', 'crawlway']);

/**
 * 방을 복도 마디에서 "복도도 방도 뻗지 않은 가장 넓은 각도 틈"의 한가운데로 다시 매단다.
 * 엔진의 평면도는 방을 이웃 방향 합의 수직으로 뻗는데, 격자 안쪽 마디처럼 이웃이 사방에
 * 있으면 합이 0이 되어 방이 복도 선 위에 떨어진다. 마디까지의 거리는 그대로 두고 방향만
 * 바꾸므로 겹(1겹·2겹)과 구역 모양은 유지된다. 엔진 좌표는 관문 선정 같은 구조 결정에 쓰이므로
 * 엔진이 아니라 여기(그리기 직전)에서 고친다. 난수 없이 결정적이다.
 * @param {{nodes: {id: string, type?: string, sectorId?: string}[], edges: {from: string, to: string, features?: string[]}[]}} graph
 * @param {Record<string, {x: number, y: number}>} positions
 */
function rehangRooms(graph, positions) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const isPassage = (id) => PASSAGE_TYPES.has(byId[id]?.type);
  /** 방의 호스트 마디: 특수하지 않은 엣지로 이어진 같은 구역의 통로 노드 중 가장 가까운 것. */
  const hostOf = (room) => {
    let best = null; let bestDistance = Infinity;
    for (const e of graph.edges) {
      if ((e.features || []).length > 0) continue;
      const other = e.from === room.id ? e.to : e.to === room.id ? e.from : null;
      if (!other || !isPassage(other) || byId[other].sectorId !== room.sectorId) continue;
      const d = Math.hypot(positions[other].x - positions[room.id].x, positions[other].y - positions[room.id].y);
      if (d < bestDistance) { best = other; bestDistance = d; }
    }
    return best;
  };
  /** @type {Record<string, string[]>} 호스트별 방 목록 */
  const roomsByHost = {};
  for (const node of graph.nodes) {
    if (isPassage(node.id)) continue;
    const host = hostOf(node);
    if (host) (roomsByHost[host] ??= []).push(node.id);
  }

  const result = { ...positions };
  // 호스트 순서는 id 순으로 고정한다 — 앞서 매단 방의 새 자리를 뒤의 호스트가 보므로 순서가
  // 결과에 영향을 주고, 그 순서가 결정적이어야 같은 그래프가 같은 그림이 된다.
  const hosts = Object.keys(roomsByHost).sort();
  for (const host of hosts) {
    const rooms = roomsByHost[host];
    const h = result[host];
    const angleTo = (id) => Math.atan2(result[id].y - h.y, result[id].x - h.x);
    const distanceOf = (id) => Math.hypot(result[id].x - h.x, result[id].y - h.y);
    // 이미 차지된 방향: 이 마디의 방이 아니면서 매단 거리의 2배 안에 있는 모든 노드 —
    // 복도 이웃뿐 아니라 다른 마디의 방·특수 엣지 상대도 포함해야 그 위로 방을 옮기지 않는다.
    // 이미 옮긴 방은 옮긴 자리(result)로 본다.
    const roomSet = new Set(rooms);
    // 방이 호스트와 같은 자리에 있으면 반경이 0이 되어 아무것도 피하지 않으므로 하한을 둔다.
    const reach = Math.max(NODE_CLEARANCE, Math.max(...rooms.map(distanceOf)) * 2);
    const taken = graph.nodes
      .filter((n) => n.id !== host && !roomSet.has(n.id) && distanceOf(n.id) <= reach)
      .map((n) => angleTo(n.id));
    // 가까운 방부터(1겹 → 2겹) 자리를 잡는다. 같은 겹 안에서는 원래 각도 순으로 안정되게.
    const ordered = rooms.slice().sort((a, b) => distanceOf(a) - distanceOf(b) || angleTo(a) - angleTo(b) || (a < b ? -1 : 1));
    for (const room of ordered) {
      const distance = distanceOf(room);
      const angle = widestAngularGap(taken).middle;
      taken.push(angle);
      result[room] = { x: h.x + Math.cos(angle) * distance, y: h.y + Math.sin(angle) * distance };
    }
  }
  return result;
}

/**
 * 주어진 방향들 사이에서 가장 넓은 빈 각도 구간. 방향이 하나도 없으면 온 둘레가 빈 틈이다.
 * @param {number[]} angles 라디안
 * @returns {{middle: number, width: number}}
 */
function widestAngularGap(angles) {
  if (angles.length === 0) return { middle: 0, width: Math.PI * 2 };
  const twoPi = Math.PI * 2;
  const sorted = angles.map((a) => ((a % twoPi) + twoPi) % twoPi).sort((a, b) => a - b);
  let best = { middle: 0, width: -1 };
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + twoPi;
    const width = end - start;
    if (width > best.width) best = { middle: start + width / 2, width };
  }
  return best;
}

/** 구역 확대의 상한. 이 이상 벌리면 구역 사이 통로가 짧아져 구역 경계가 잘 안 읽힌다. */
const SECTOR_INFLATE_MAX = 2.4;
/** 확대 후 이웃 구역과 남겨 둘 최소 틈(px) — 구역 라벨과 배경 다각형의 여백 몫. */
const SECTOR_GAP = 150;

/**
 * 구역마다 좌표를 그 구역 중심 기준으로 같은 배율만큼 확대한다. 엔진의 평면도는 구역을 링으로
 * 놓으면서 구역끼리 넓게 띄우므로, 캔버스에 맞춰 축척하면 구역 내부 노드는 서로 30px 남짓으로
 * 몰린다. 구역 사이 빈 공간을 구역 내부에 나눠 주는 것이 이 단계다 — 구역 간 상대 위치와
 * 배치 원형의 모양은 그대로다(각 구역이 자기 자리에서 같은 비율로 커질 뿐).
 * 배율은 어떤 구역 쌍도 SECTOR_GAP보다 가까워지지 않고 캔버스 밖으로 나가지 않는 최대값이다.
 * @param {{nodes: {id: string, sectorId?: string}[], sectorIds?: string[]}} graph
 * @param {Record<string, {x: number, y: number}>} positions
 */
function inflateSectors(graph, positions) {
  const sectorIds = graph.sectorIds || Array.from(new Set(graph.nodes.map((n) => n.sectorId)));
  /** @type {{id: string, cx: number, cy: number, r: number, nodes: {id: string}[]}[]} */
  const sectors = [];
  for (const sectorId of sectorIds) {
    const nodes = graph.nodes.filter((n) => n.sectorId === sectorId);
    if (nodes.length === 0) continue;
    const cx = nodes.reduce((sum, n) => sum + positions[n.id].x, 0) / nodes.length;
    const cy = nodes.reduce((sum, n) => sum + positions[n.id].y, 0) / nodes.length;
    const r = Math.max(1, ...nodes.map((n) => Math.hypot(positions[n.id].x - cx, positions[n.id].y - cy)));
    sectors.push({ id: sectorId, cx, cy, r, nodes });
  }
  if (sectors.length === 0) return positions;

  let factor = SECTOR_INFLATE_MAX;
  // 이웃 구역과의 틈
  for (let i = 0; i < sectors.length; i++) {
    for (let j = i + 1; j < sectors.length; j++) {
      const a = sectors[i]; const b = sectors[j];
      const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      factor = Math.min(factor, (distance - SECTOR_GAP) / (a.r + b.r));
    }
  }
  // 확대할 여지가 없어도 재맞춤은 한다 — 앞 단계(rehangRooms)가 여백 밖에 둔 노드를 눌러 붙이지
  // 않고 비율대로 안으로 들인다.
  if (!(factor > 1)) return fitToCanvas(positions);

  /** @type {Record<string, {x: number, y: number}>} */
  const inflated = { ...positions };
  for (const sector of sectors) {
    for (const n of sector.nodes) {
      inflated[n.id] = {
        x: sector.cx + (positions[n.id].x - sector.cx) * factor,
        y: sector.cy + (positions[n.id].y - sector.cy) * factor,
      };
    }
  }
  // 바깥쪽 구역은 확대되며 캔버스를 넘으므로 전체를 다시 캔버스에 맞춘다. 구역 사이 빈 공간이
  // 줄어든 만큼만 축소되므로 구역 내부 간격은 확대 전보다 넓다.
  return fitToCanvas(inflated);
}

/**
 * 좌표 전체를 비율을 지켜 캔버스(여백 안쪽)에 맞춘다.
 * @param {Record<string, {x: number, y: number}>} positions
 */
function fitToCanvas(positions) {
  const points = Object.values(positions);
  const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)); const maxY = Math.max(...points.map((p) => p.y));
  const scale = Math.min(
    (CANVAS_WIDTH - CANVAS_PADDING * 2) / (maxX - minX || 1),
    (CANVAS_HEIGHT - CANVAS_PADDING * 2) / (maxY - minY || 1),
  );
  /** @type {Record<string, {x: number, y: number}>} */
  const fitted = {};
  for (const [id, p] of Object.entries(positions)) {
    fitted[id] = { x: CANVAS_PADDING + (p.x - minX) * scale, y: CANVAS_PADDING + (p.y - minY) * scale };
  }
  return fitted;
}

/**
 * 정리 전의 순수 축척 좌표. 평면도 좌표계를 캔버스 안에 비율을 지켜 넣는다.
 * @param {{nodes: {id: string, x: number, y: number}[]}} graph
 * @returns {Record<string, {x: number, y: number}>}
 */
export function scaledPositions(graph) {
  return fitToCanvas(Object.fromEntries(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }])));
}

/** 이 길이(캔버스 px)를 넘는 엣지는 직선 대신 곡선으로 그린다. */
const CURVED_EDGE_MIN_LENGTH = 150;

/**
 * 엣지를 그릴 경로. 짧은 엣지는 직선이지만, 구역을 가로지르거나 링을 건너뛰는 긴 엣지는
 * 곡선으로 그린다 — 직선으로 그으면 평면도 위를 그대로 관통해 어느 노드에 붙은 줄인지
 * 읽히지 않는다. 일방통행 화살표가 놓일 중점과 그 지점의 접선 각도도 함께 돌려준다.
 * 배치 정리(relaxPositions)도 같은 곡선을 보고 노드를 피하게 하므로 그리기와 한 함수를 쓴다.
 * @param {{x: number, y: number}} from @param {{x: number, y: number}} to
 */
export function edgePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < CURVED_EDGE_MIN_LENGTH) {
    return {
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
      angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
    };
  }
  const { x: cx, y: cy } = /** @type {{x: number, y: number}} */ (bezierControl(from, to));
  return {
    d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`,
    // t=0.5 지점과 그 접선(베지어 미분).
    midX: (from.x + 2 * cx + to.x) / 4,
    midY: (from.y + 2 * cy + to.y) / 4,
    angleDeg: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI,
  };
}

/**
 * 곡선 엣지의 2차 베지어 제어점. 제어점을 중점에서 수직으로 밀어 활처럼 휜다. 직선으로 그리는
 * 짧은 엣지면 null. 그리기(edgePath)와 배치 정리(edgePolyline)가 같은 제어점을 쓰되, 정리는
 * SVG 문자열을 만들 필요가 없어 이 함수만 부른다.
 * @param {{x: number, y: number}} from @param {{x: number, y: number}} to
 */
function bezierControl(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < CURVED_EDGE_MIN_LENGTH) return null;
  const bulge = Math.min(length * 0.16, 90);
  const nx = -dy / length;
  const ny = dx / length;
  return { x: (from.x + to.x) / 2 + nx * bulge * 2, y: (from.y + to.y) / 2 + ny * bulge * 2 };
}

const CURVE_SAMPLES = 8;

/**
 * 엣지가 실제로 그려지는 선을 꺾은선으로 근사한 점열. 직선 엣지는 두 점, 곡선 엣지는 베지어를
 * CURVE_SAMPLES 구간으로 나눈 점들.
 * @param {{x: number, y: number}} a @param {{x: number, y: number}} b
 * @returns {{x: number, y: number}[]}
 */
function edgePolyline(a, b) {
  const control = bezierControl(a, b);
  if (!control) return [a, b];
  const points = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES; const u = 1 - t;
    points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
  }
  return points;
}

/**
 * 점 p에서 꺾은선까지의 최단 거리와 가장 가까운 점. t는 전체 길이 기준 0~1 위치.
 * @param {{x: number, y: number}} p @param {{x: number, y: number}[]} polyline
 */
function closestPointOnPolyline(p, polyline) {
  let best = null;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const hit = closestPointOnSegment(p, polyline[i], polyline[i + 1]);
    if (!best || hit.distance < best.distance) best = { ...hit, t: (i + hit.t) / (polyline.length - 1) };
  }
  return /** @type {{x: number, y: number, t: number, distance: number}} */ (best);
}

/**
 * 점 p에서 선분 ab까지의 최단 거리와, 선분 위 가장 가까운 점.
 * @param {{x: number, y: number}} p @param {{x: number, y: number}} a @param {{x: number, y: number}} b
 */
function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x; const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  const qx = a.x + abx * t; const qy = a.y + aby * t;
  return { x: qx, y: qy, t, distance: Math.hypot(p.x - qx, p.y - qy) };
}

/**
 * 화면에서 길이를 재는 대상 — 구역 안 평범한 통로(관문은 구역을 잇는 구조라 빠진다).
 * 엔진에서 인접한 노드만 잇도록 정규화한 통로들이며(ADR-0097), 화면 정리가 그것을 다시
 * 늘여 놓으면 플레이어에게는 여전히 도면을 가로지르는 긴 줄이다.
 * @param {{nodes: {id: string, sectorId?: string}[], edges: {from: string, to: string, features?: string[]}[]}} graph
 */
export function plainSectorEdges(graph) {
  const sectorOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.sectorId]));
  return graph.edges.filter((e) => (e.features || []).length === 0
    && sectorOf[e.from] !== undefined && sectorOf[e.from] === sectorOf[e.to]);
}

/**
 * 구역별 "화면상 평범한 통로 길이 중앙값 × PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR" 상한.
 * @param {{nodes: {id: string, sectorId?: string}[], edges: {from: string, to: string, features?: string[]}[]}} graph
 * @param {Record<string, {x: number, y: number}>} positions
 * @returns {Record<string, number>}
 */
export function plainEdgeScreenLimits(graph, positions) {
  const sectorOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.sectorId]));
  /** @type {Record<string, number[]>} */
  const lengths = {};
  for (const edge of plainSectorEdges(graph)) {
    const sectorId = /** @type {string} */ (sectorOf[edge.from]);
    (lengths[sectorId] ??= []).push(Math.hypot(
      positions[edge.from].x - positions[edge.to].x, positions[edge.from].y - positions[edge.to].y,
    ));
  }
  /** @type {Record<string, number>} */
  const limits = {};
  for (const [sectorId, values] of Object.entries(lengths)) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    limits[sectorId] = median * PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR;
  }
  return limits;
}

/** 평범한 통로 줄이기 패스의 반복 횟수와 한 번에 당기는 비율. */
const SHORTEN_ITERATIONS = 120;
const SHORTEN_GAIN = 0.5;
/** 상한보다 이만큼 아래까지 당겨 둔다 — 뒤따르는 정리(relaxPositions)가 겹침을 풀며 조금 늘이므로
 * 그 몫을 미리 비워 둔다. */
const SHORTEN_TARGET_FACTOR = 0.85;

/**
 * 상한을 넘은 구역 안 평범한 통로의 두 끝을 서로에게 당긴다. 엔진은 인접한 노드만 평범한
 * 통로로 잇지만(ADR-0097), 방을 다시 매다는 단계(rehangRooms)가 방끼리 난 연결문의 두 끝을
 * 서로 반대쪽 각도로 보내 버리면 화면에서는 다시 도면을 가로지르는 줄이 된다. 그래서 정리
 * 직전에 그 줄만 당겨 둔다 — 겹침은 뒤따르는 relaxPositions가 푼다. 난수 없이 결정적이다.
 * @param {{nodes: {id: string, sectorId?: string}[], edges: {from: string, to: string, features?: string[]}[]}} graph
 * @param {Record<string, {x: number, y: number}>} positions
 */
function shortenPlainEdges(graph, positions) {
  const sectorOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.sectorId]));
  const plainEdges = plainSectorEdges(graph).filter((e) => positions[e.from] && positions[e.to] && e.from !== e.to);
  if (plainEdges.length === 0) return positions;
  /** @type {Record<string, {x: number, y: number}>} */
  const current = Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, { ...p }]));

  for (let iteration = 0; iteration < SHORTEN_ITERATIONS; iteration++) {
    const limits = plainEdgeScreenLimits(graph, current);
    let moved = false;
    for (const edge of plainEdges) {
      const limit = limits[/** @type {string} */ (sectorOf[edge.from])] * SHORTEN_TARGET_FACTOR;
      const p = current[edge.from]; const q = current[edge.to];
      const dx = q.x - p.x; const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (!(dist > limit) || dist < 1e-6) continue;
      const pull = (dist - limit) * SHORTEN_GAIN * 0.5;
      p.x += (dx / dist) * pull; p.y += (dy / dist) * pull;
      q.x -= (dx / dist) * pull; q.y -= (dy / dist) * pull;
      moved = true;
    }
    if (!moved) break;
  }
  return current;
}

/**
 * 노드를 남의 통로와 이웃 노드로부터 밀어내는 반복 정리. 힘은 두 가지뿐이다 —
 * (1) 노드가 자기 것이 아닌 통로에 EDGE_CLEARANCE보다 가까우면 통로의 수직 방향으로 밀고,
 * (2) 노드끼리 NODE_CLEARANCE보다 가까우면 서로 밀어낸다. 그리고 (3) 구역 안 평범한 통로가
 * 그 구역 중앙값의 PLAIN_EDGE_SCREEN_MAX_LENGTH_FACTOR배보다 길어지면 두 끝을 서로에게
 * 당긴다 — 엔진에서 인접한 노드만 잇도록 정리한 통로를(ADR-0097) 화면 정리가 도로 늘이지
 * 않게 하는 힘이다. 원래 자리에서 MAX_DISPLACEMENT 안에 묶고 캔버스 밖으로 나가지 않게 한다.
 * @param {{nodes: {id: string, sectorId?: string}[], edges: {from: string, to: string, features?: string[]}[]}} graph
 * @param {Record<string, {x: number, y: number}>} initial
 */
function relaxPositions(graph, initial) {
  const ids = graph.nodes.map((n) => n.id);
  const origin = Object.fromEntries(ids.map((id) => [id, { ...initial[id] }]));
  const current = Object.fromEntries(ids.map((id) => [id, { ...initial[id] }]));
  const edges = graph.edges.filter((e) => current[e.from] && current[e.to] && e.from !== e.to);
  const sectorOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.sectorId]));
  const plainEdges = plainSectorEdges(graph).filter((e) => current[e.from] && current[e.to] && e.from !== e.to);
  const lo = CANVAS_PADDING; const hiX = CANVAS_WIDTH - CANVAS_PADDING; const hiY = CANVAS_HEIGHT - CANVAS_PADDING;

  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    /** @type {Record<string, {x: number, y: number}>} */
    const force = Object.fromEntries(ids.map((id) => [id, { x: 0, y: 0 }]));
    let moved = false;

    // (1) 노드 ↔ 남의 통로
    for (const edge of edges) {
      const a = current[edge.from]; const b = current[edge.to];
      const polyline = edgePolyline(a, b);
      // 폴리라인 거리 계산은 비싸므로, 엣지의 경계 상자(여유 포함) 밖에 있는 노드는 먼저 거른다.
      // 곡선 엣지의 볼록한 부분까지 상자에 넣기 위해 폴리라인 점 전체로 상자를 잡는다.
      let boxMinX = Infinity; let boxMinY = Infinity; let boxMaxX = -Infinity; let boxMaxY = -Infinity;
      for (const point of polyline) {
        boxMinX = Math.min(boxMinX, point.x); boxMaxX = Math.max(boxMaxX, point.x);
        boxMinY = Math.min(boxMinY, point.y); boxMaxY = Math.max(boxMaxY, point.y);
      }
      const margin = EDGE_CLEARANCE + RELAX_OVERSHOOT;
      for (const id of ids) {
        if (id === edge.from || id === edge.to) continue;
        const p = current[id];
        if (p.x < boxMinX - margin || p.x > boxMaxX + margin || p.y < boxMinY - margin || p.y > boxMaxY + margin) continue;
        const nearest = closestPointOnPolyline(p, polyline);
        if (nearest.distance >= EDGE_CLEARANCE + RELAX_OVERSHOOT) continue;
        let nx = p.x - nearest.x; let ny = p.y - nearest.y;
        const len = Math.hypot(nx, ny);
        if (len < 1e-6) {
          // 정확히 선 위에 있으면 통로의 수직 방향 중 원래 자리에 가까운 쪽으로 민다.
          const abx = b.x - a.x; const aby = b.y - a.y; const abLen = Math.hypot(abx, aby) || 1;
          nx = -aby / abLen; ny = abx / abLen;
          const o = origin[id];
          if ((o.x - p.x) * nx + (o.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
        } else {
          nx /= len; ny /= len;
        }
        const push = (EDGE_CLEARANCE + RELAX_OVERSHOOT - nearest.distance) * 0.5;
        force[id].x += nx * push;
        force[id].y += ny * push;
        // 통로 끝점도 반대 방향으로 조금 밀어 양쪽이 나눠 움직이게 한다(t에 따라 가중).
        force[edge.from].x -= nx * push * 0.25 * (1 - nearest.t);
        force[edge.from].y -= ny * push * 0.25 * (1 - nearest.t);
        force[edge.to].x -= nx * push * 0.25 * nearest.t;
        force[edge.to].y -= ny * push * 0.25 * nearest.t;
        moved = true;
      }
    }

    // (2) 노드 ↔ 노드
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = current[ids[i]]; const q = current[ids[j]];
        let dx = p.x - q.x; let dy = p.y - q.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= NODE_CLEARANCE + RELAX_OVERSHOOT) continue;
        if (dist < 1e-6) { dx = 1; dy = 0; dist = 1; }
        const push = (NODE_CLEARANCE + RELAX_OVERSHOOT - dist) * 0.5;
        force[ids[i]].x += (dx / dist) * push; force[ids[i]].y += (dy / dist) * push;
        force[ids[j]].x -= (dx / dist) * push; force[ids[j]].y -= (dy / dist) * push;
        moved = true;
      }
    }

    // (3) 너무 길어진 평범한 통로 ↔ 그 두 끝. 상한은 매 반복 지금 좌표에서 다시 잰다 —
    // 당기면서 중앙값도 함께 내려가므로, 한 번 잰 값으로 고정하면 상한만 남고 기준이 어긋난다.
    const limits = plainEdgeScreenLimits(graph, current);
    for (const edge of plainEdges) {
      const limit = limits[/** @type {string} */ (sectorOf[edge.from])] - PLAIN_EDGE_PULL_UNDERSHOOT;
      const p = current[edge.from]; const q = current[edge.to];
      const dx = q.x - p.x; const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (!(dist > limit) || dist < 1e-6) continue;
      const pull = (dist - limit) * PLAIN_EDGE_PULL_GAIN * 0.5;
      force[edge.from].x += (dx / dist) * pull; force[edge.from].y += (dy / dist) * pull;
      force[edge.to].x -= (dx / dist) * pull; force[edge.to].y -= (dy / dist) * pull;
      moved = true;
    }

    if (!moved) break;
    let largestStep = 0;
    for (const id of ids) {
      const p = current[id]; const o = origin[id];
      let x = p.x + force[id].x; let y = p.y + force[id].y;
      // 원래 자리에서 너무 멀어지지 않게 — 배치 원형의 모양을 지킨다.
      const ox = x - o.x; const oy = y - o.y; const drift = Math.hypot(ox, oy);
      if (drift > MAX_DISPLACEMENT) { x = o.x + (ox / drift) * MAX_DISPLACEMENT; y = o.y + (oy / drift) * MAX_DISPLACEMENT; }
      x = Math.max(lo, Math.min(hiX, x));
      y = Math.max(lo, Math.min(hiY, y));
      largestStep = Math.max(largestStep, Math.hypot(x - p.x, y - p.y));
      p.x = x; p.y = y;
    }
    // 이동 상한과 서로 상충하는 힘 때문에 남는 근접은 더 돌아도 안 풀린다 — 실제로 움직임이
    // 멎었으면 반복 횟수를 다 채우지 않고 끝낸다(첫 화면의 정지 시간).
    if (largestStep < RELAX_SETTLE_EPSILON) break;
  }
  // 겹침이 없어 한 번도 못 움직였거나 앞 단계(rehangRooms)가 여백 밖에 둔 노드가 있어도
  // "캔버스 안"이라는 약속은 여기서 무조건 지킨다.
  for (const id of ids) {
    current[id].x = Math.max(lo, Math.min(hiX, current[id].x));
    current[id].y = Math.max(lo, Math.min(hiY, current[id].y));
  }
  return current;
}

/**
 * 배치 품질 측정(테스트·튜닝용): 남의 통로에 EDGE_CLEARANCE보다 가까운 노드 수와,
 * NODE_CLEARANCE보다 가까운 노드 쌍 수.
 * @param {{nodes: {id: string}[], edges: {from: string, to: string}[]}} graph
 * @param {Record<string, {x: number, y: number}>} positions
 */
export function countLayoutOverlaps(graph, positions) {
  let nodeOnEdge = 0;
  for (const node of graph.nodes) {
    const p = positions[node.id];
    const hit = graph.edges.some((e) => e.from !== node.id && e.to !== node.id
      && closestPointOnPolyline(p, edgePolyline(positions[e.from], positions[e.to])).distance < EDGE_CLEARANCE);
    if (hit) nodeOnEdge++;
  }
  let nodePairs = 0;
  const ids = graph.nodes.map((n) => n.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (Math.hypot(positions[ids[i]].x - positions[ids[j]].x, positions[ids[i]].y - positions[ids[j]].y) < NODE_CLEARANCE) nodePairs++;
    }
  }
  return { nodeOnEdge, nodePairs };
}
