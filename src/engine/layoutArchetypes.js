// 구역별 평면도 생성기 (docs/proposals/map-redesign-decisions.md D6·D18·D20).
//
// 예전 생성기는 구역 원판 안에 노드를 무작위로 흩뿌리고 전역 최근접 쌍부터 이어 붙였다. 결과가
// 평면도가 아니라 점 구름이었고, 구역마다 다른 공략이 성립하지 않았다. 이 모듈은 그 자리를
// 대신한다.
//
// 모든 배치 원형은 같은 두 단계로 만들어진다.
//
//   1. **골격**: 복도로 이루어진 뼈대를 놓는다. 원형마다 뼈대의 모양이 다르다 — 격자, 사슬,
//      방사, 탑, 대공간, 이중층.
//   2. **방 붙이기**: 뼈대의 각 마디에 방을 매단다. 방은 복도의 진행 방향에 수직으로 뻗어
//      나가며, 같은 마디에 여러 개가 붙으면 양옆으로 번갈아 부채꼴로 퍼진다.
//
// 이 구조 덕분에 새 원형을 추가하는 비용이 골격 함수 하나뿐이고, "복도는 지나가는 곳이고 방은
// 무언가 있는 곳"이라는 읽는 법이 여덟 구역에서 똑같이 통한다.
//
// 좌표는 로컬 단위이며 마지막에 중심을 원점으로 옮기고 최대 반지름이 1이 되도록 정규화한다.
// 호출부(facilityGraph.js)가 SECTOR_NODE_RADIUS를 곱하고 구역 중심으로 평행이동한다. 그래서
// 구역 간 거리는 배치 원형과 무관하게 링 배치가 그대로 결정한다 — 탈출구 거리 범위와 시간
// 예산이 좌표 스케일에 캘리브레이션되어 있으므로 이 성질이 중요하다.
//
// 순수하고 결정론적이다. 모든 함수가 rngState를 명시적으로 전달한다(rng.js 참고).

import { nextFloat, nextInt, shuffle, weightedPick } from './rng.js';
import { SECTOR_LAYOUTS, NODE_MIN_SEPARATION, NODE_SEPARATION_PASSES, TOWER_ELEVATOR_REQUIREMENT, TOWER_LOBBY_ROOMS, TOWER_LOBBY_RING_RADIUS, LANDMARK_CANDIDATE_MIN, LANDMARK_CANDIDATE_MAX } from '../data/facilityLayout.js';

/**
 * @typedef {Object} LocalNode
 * @property {number} x 로컬 좌표. 정규화 후 원점 기준 반지름 1 이내.
 * @property {number} y
 * @property {import('./types.js').FacilityNodeType} type
 */

/**
 * @typedef {Object} SpecialLayoutEdge
 * @property {number} from 골격 인덱스.
 * @property {number} to
 * @property {import('./types.js').SpecialEdgeFeature[]} features
 * @property {number} [requiredCapability] 여는 데 필요한 Capability 수치. 없으면 1.
 */

/**
 * @typedef {Object} Skeleton
 * @property {{x: number, y: number}[]} points
 * @property {[number, number][]} edges 골격 내부 인덱스 쌍.
 * @property {import('./types.js').FacilityNodeType[]} types 골격 마디의 유형. 보통 corridor.
 * @property {SpecialLayoutEdge[]} [specialEdges] 배치 원형이 구조적으로 항상 놓는 특수 엣지.
 */

/** 복도 한 칸의 기준 간격. 모든 골격이 이 단위로 그려지고 마지막에 함께 정규화된다. */
const SPACING = 1;

// 방이 자기 복도 마디에서 떨어지는 거리. 같은 마디에 여러 방이 붙으면 양옆으로 번갈아 퍼지고
// 두 개마다 한 겹씩 바깥으로 나간다. 겹이 무한정 멀어지면 그 방의 문이 도면을 가로지르는 긴
// 평범한 통로가 되므로(ADR-0097), 겹은 ROOM_MAX_LAYER에서 멈추고 나머지는 각도로만 흩어진다 —
// 끝에서 밀어내기(separate)가 겹친 방을 떼어 놓는다.
const ROOM_FIRST_LAYER = 0.78;
const ROOM_LAYER_STEP = 0.52;
const ROOM_MAX_LAYER = 2;

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 골격 마디에 붙는 흔들림. 완전한 격자는 기계 도면처럼 보이고, 너무 흔들면 다시 점 구름이 된다.
 * @param {import('./types.js').RngState} state
 * @param {number} amount
 */
function jitter(state, amount) {
  const { value, state: next } = nextFloat(state);
  return { value: (value - 0.5) * 2 * amount, state: next };
}

// ---- 골격 생성기 여섯 종 ----

/**
 * 격자 허브. 가로세로로 이어진 복도 격자라 갈림길이 많고 우회로가 항상 있다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function gridSkeleton(rngState, count) {
  let state = rngState;
  const cols = Math.max(2, Math.round(Math.sqrt(count * 1.25)));
  const rows = Math.max(2, Math.ceil(count / cols));
  /** @type {{x: number, y: number}[]} */
  const points = [];
  /** @type {number[][]} */
  const indexAt = [];
  for (let r = 0; r < rows; r++) {
    indexAt.push([]);
    for (let c = 0; c < cols; c++) {
      if (points.length >= count) { indexAt[r].push(-1); continue; }
      const jx = jitter(state, 0.09); state = jx.state;
      const jy = jitter(state, 0.09); state = jy.state;
      indexAt[r].push(points.length);
      points.push({ x: c * SPACING + jx.value, y: r * SPACING + jy.value });
    }
  }
  /** @type {[number, number][]} */
  const edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = indexAt[r][c];
      if (here < 0) continue;
      const right = c + 1 < cols ? indexAt[r][c + 1] : -1;
      const down = r + 1 < rows ? indexAt[r + 1][c] : -1;
      if (right >= 0) edges.push([here, right]);
      if (down >= 0) edges.push([here, down]);
    }
  }
  return { skeleton: { points, edges, types: points.map(() => /** @type {const} */ ('corridor')) }, rngState: state };
}

/**
 * 선형 사슬. 복도가 뱀처럼 길게 이어져 병목이 많다. 우회로는 서비스 통로 한두 개뿐이다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function chainSkeleton(rngState, count) {
  let state = rngState;
  const perRow = Math.max(3, Math.round(Math.sqrt(count * 1.9)));
  /** @type {{x: number, y: number}[]} */
  const points = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const rawCol = i % perRow;
    const col = row % 2 === 0 ? rawCol : perRow - 1 - rawCol;
    const jx = jitter(state, 0.12); state = jx.state;
    const jy = jitter(state, 0.08); state = jy.state;
    points.push({ x: col * SPACING + jx.value, y: row * SPACING * 1.5 + jy.value });
  }
  /** @type {[number, number][]} */
  const edges = [];
  for (let i = 0; i + 1 < count; i++) edges.push([i, i + 1]);

  // 서비스 통로: 사슬을 접어 만든 고리. 없으면 구역 전체가 트리가 되어 탈출구가 요구하는
  // 2-edge-disjoint 경로를 만족할 수 없다. 그래서 최소 하나는 반드시 놓는다.
  const shortcutCount = count >= perRow * 2 ? 2 : 1;
  const candidates = [];
  for (let i = 0; i + perRow < count; i++) {
    const a = points[i];
    const b = points[i + perRow];
    if (Math.abs(a.x - b.x) < SPACING * 0.75) candidates.push(i);
  }
  if (candidates.length > 0) {
    const sh = shuffle(state, candidates); state = sh.state;
    for (const i of sh.value.slice(0, shortcutCount)) edges.push([i, i + perRow]);
  }
  return { skeleton: { points, edges, types: points.map(() => /** @type {const} */ ('corridor')) }, rngState: state };
}

/**
 * 방사형. 중심에서 회랑이 뻗는다. 바깥 고리는 일부 구간만 이어져 있어 중심을 지나지 않는
 * 우회로가 드물다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function radialSkeleton(rngState, count) {
  let state = rngState;
  const spokePick = nextInt(state, 2); state = spokePick.state;
  const spokes = clamp(4 + spokePick.value, 3, Math.max(3, count - 1));
  const armLength = Math.max(1, Math.floor((count - 1) / spokes));
  /** @type {{x: number, y: number}[]} */
  const points = [{ x: 0, y: 0 }];
  /** @type {[number, number][]} */
  const edges = [];
  /** @type {number[][]} */
  const arms = [];
  const baseAngle = nextFloat(state); state = baseAngle.state;
  for (let k = 0; k < spokes && points.length < count; k++) {
    const angle = (k / spokes) * Math.PI * 2 + baseAngle.value * Math.PI * 2;
    /** @type {number[]} */
    const arm = [];
    for (let i = 1; i <= armLength && points.length < count; i++) {
      const ja = jitter(state, 0.10); state = ja.state;
      const r = i * SPACING * 1.15;
      const a = angle + ja.value * 0.25;
      const index = points.length;
      points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      edges.push([arm.length === 0 ? 0 : arm[arm.length - 1], index]);
      arm.push(index);
    }
    if (arm.length > 0) arms.push(arm);
  }
  // 남은 노드는 가장 짧은 회랑 끝에 이어 붙인다.
  while (points.length < count && arms.length > 0) {
    const arm = arms.reduce((shortest, a) => (a.length < shortest.length ? a : shortest), arms[0]);
    const tail = points[arm[arm.length - 1]];
    const scale = 1 + SPACING * 1.15 / Math.max(0.001, Math.hypot(tail.x, tail.y));
    const index = points.length;
    points.push({ x: tail.x * scale, y: tail.y * scale });
    edges.push([arm[arm.length - 1], index]);
    arm.push(index);
  }
  // 바깥 고리는 인접한 회랑 쌍의 절반만 잇는다 — 전부 이으면 방사형이 아니라 격자가 된다.
  if (arms.length >= 3) {
    const pairs = arms.map((_, k) => k).filter((k) => arms[k].length > 0);
    const sh = shuffle(state, pairs); state = sh.state;
    for (const k of sh.value.slice(0, Math.max(1, Math.floor(arms.length / 2)))) {
      const next = (k + 1) % arms.length;
      if (arms[next].length === 0) continue;
      edges.push([arms[k][arms[k].length - 1], arms[next][arms[next].length - 1]]);
    }
  }
  return { skeleton: { points, edges, types: points.map(() => /** @type {const} */ ('corridor')) }, rngState: state };
}

/**
 * 탑 구조. 복도가 1층부터 꼭대기까지 한 줄로 곧게 이어지고, 각 층에서 방이 옆으로 뻗는다.
 * 층과 층은 계단 하나로만 이어져 퇴로가 하나다. 여기에 1층과 꼭대기를 바로 잇는 승강기를
 * 특수 엣지로 놓는다 — 잠겨 있고 Force나 Hacking으로 여는, 탑의 유일한 지름길이다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function towerSkeleton(rngState, count) {
  let state = rngState;
  /** @type {{x: number, y: number}[]} */
  const points = [];
  /** @type {[number, number][]} */
  const edges = [];
  for (let f = 0; f < count; f++) {
    const jx = jitter(state, 0.05); state = jx.state;
    points.push({ x: jx.value, y: -f * SPACING * 1.5 });
    if (f > 0) edges.push([f - 1, f]);
  }
  /** @type {SpecialLayoutEdge[]} */
  const specialEdges = count >= 3
    ? [{ from: 0, to: count - 1, features: ['blocked', 'electronic'], requiredCapability: TOWER_ELEVATOR_REQUIREMENT }]
    : [];
  return {
    skeleton: { points, edges, types: points.map(() => /** @type {const} */ ('corridor')), specialEdges },
    rngState: state,
  };
}

/**
 * 대공간. 큰 방 몇 개가 서로 맞닿아 있고 복도가 거의 없다. 시야가 트여 숨을 데가 없다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function hallSkeleton(rngState, count) {
  let state = rngState;
  const halls = Math.max(2, count);
  /** @type {{x: number, y: number}[]} */
  const points = [];
  for (let i = 0; i < halls; i++) {
    const angle = (i / halls) * Math.PI * 2;
    const ja = jitter(state, 0.12); state = ja.state;
    const r = halls === 2 ? SPACING * 1.2 : SPACING * 1.6;
    points.push({ x: Math.cos(angle + ja.value) * r, y: Math.sin(angle + ja.value) * r * 0.8 });
  }
  /** @type {[number, number][]} */
  const edges = [];
  for (let i = 0; i + 1 < halls; i++) edges.push([i, i + 1]);
  if (halls >= 3) edges.push([halls - 1, 0]);
  return { skeleton: { points, edges, types: points.map(() => /** @type {const} */ ('hall')) }, rngState: state };
}

/**
 * 이중층. 정규 통로 위에 비인가 통로가 겹쳐 있고 몇 군데서만 오르내릴 수 있다.
 * @param {import('./types.js').RngState} rngState
 * @param {number} count
 * @returns {{skeleton: Skeleton, rngState: import('./types.js').RngState}}
 */
function dualSkeleton(rngState, count) {
  let state = rngState;
  const upperCount = Math.max(2, Math.ceil(count / 2));
  const lowerCount = Math.max(2, count - upperCount);
  /** @type {{x: number, y: number}[]} */
  const points = [];
  /** @type {import('./types.js').FacilityNodeType[]} */
  const types = [];
  /** @type {[number, number][]} */
  const edges = [];
  /** @type {number[]} */
  const upper = [];
  /** @type {number[]} */
  const lower = [];
  for (let i = 0; i < upperCount; i++) {
    const jy = jitter(state, 0.10); state = jy.state;
    const index = points.length;
    points.push({ x: i * SPACING, y: SPACING * 0.9 + jy.value });
    types.push('corridor');
    if (upper.length > 0) edges.push([upper[upper.length - 1], index]);
    upper.push(index);
  }
  for (let i = 0; i < lowerCount; i++) {
    const jy = jitter(state, 0.10); state = jy.state;
    const index = points.length;
    points.push({ x: (i + 0.5) * SPACING * (upperCount / lowerCount), y: -SPACING * 0.9 + jy.value });
    types.push('crawlway');
    if (lower.length > 0) edges.push([lower[lower.length - 1], index]);
    lower.push(index);
  }
  // 층을 잇는 사다리는 두세 군데뿐이다.
  const ladderPick = nextInt(state, 2); state = ladderPick.state;
  const ladders = 2 + ladderPick.value;
  const slots = upper.map((_, i) => i);
  const sh = shuffle(state, slots); state = sh.state;
  for (const u of sh.value.slice(0, Math.min(ladders, lower.length))) {
    const target = clamp(Math.round((u / Math.max(1, upperCount - 1)) * (lowerCount - 1)), 0, lowerCount - 1);
    edges.push([upper[u], lower[target]]);
  }
  return { skeleton: { points, edges, types }, rngState: state };
}

/**
 * 표지 노드(구역 랜드마크·통제실)가 놓일 수 있는 골격 마디. 배치 원형마다 고정이라, 도면만
 * 보면 후보를 두세 방으로 좁힐 수 있고 확정하려면 정찰하거나 가 봐야 한다
 * (docs/proposals/map-redesign-decisions.md D16). 시설을 반복해 털수록 플레이어가 이 규칙을
 * 익히는 것이 노림수다.
 *
 * - 격자 허브: 중앙 구획 — 격자 한가운데 마디들
 * - 선형 사슬: 양 끝단 — 사슬의 첫 마디와 끝 마디
 * - 방사형: 중심부 — 회랑이 모이는 허브
 * - 탑 구조: 최상층
 * - 대공간: 부속실 — 대공간 자체가 아니라 거기 붙은 방
 * - 이중층: 정규층의 양 끝 — 비인가층은 도면에 없으므로 표지도 없다
 * @param {string} archetype
 * @param {Skeleton} skeleton
 * @returns {number[]} 골격 인덱스
 */
function landmarkHosts(archetype, skeleton) {
  const size = skeleton.points.length;
  const last = size - 1;
  if (archetype === 'chain') return [0, last];
  if (archetype === 'radial') return [0];
  if (archetype === 'tower') return [last, last - 1];
  if (archetype === 'hall') return skeleton.points.map((_, i) => i);
  if (archetype === 'dual') {
    // 이중층의 골격은 정규층(corridor)이 앞, 비인가층(crawlway)이 뒤에 놓인다.
    const upper = skeleton.points.map((_, i) => i).filter((i) => skeleton.types[i] === 'corridor');
    return upper.length > 0 ? [upper[0], upper[upper.length - 1]] : [0];
  }
  // 격자: 중심에 가장 가까운 마디 세 개.
  const cx = skeleton.points.reduce((sum, p) => sum + p.x, 0) / size;
  const cy = skeleton.points.reduce((sum, p) => sum + p.y, 0) / size;
  return skeleton.points
    .map((p, i) => ({ i, d: Math.hypot(p.x - cx, p.y - cy) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, 3)
    .map((c) => c.i);
}

/** @type {Record<string, (state: import('./types.js').RngState, count: number) => {skeleton: Skeleton, rngState: import('./types.js').RngState}>} */
const SKELETON_BUILDERS = {
  grid: gridSkeleton,
  chain: chainSkeleton,
  radial: radialSkeleton,
  tower: towerSkeleton,
  hall: hallSkeleton,
  dual: dualSkeleton,
};

// ---- 방 붙이기 ----

/**
 * 골격 마디마다 방을 매단다. 방은 그 마디를 지나는 복도의 수직 방향으로 뻗고, 같은 마디에
 * 여러 개가 붙으면 양옆으로 번갈아 가며 점점 멀리 퍼진다. 평면도에서 복도 양쪽으로 방이 늘어선
 * 모양이 이렇게 나온다.
 * @param {import('./types.js').RngState} rngState
 * @param {Skeleton} skeleton
 * @param {number} roomCount
 * @param {{value: import('./types.js').FacilityNodeType, weight: number}[]} roomTypes
 * @param {number[]} [forcedHosts] 앞쪽 방들을 반드시 매달 골격 마디. 탑 1층 로비처럼 특정
 *   마디에 방이 모여야 하는 배치 원형이 쓴다. 나머지 방은 평소대로 골고루 퍼진다.
 * @param {Record<number, {radius: number, count: number}>} [hostRing] 이 마디의 방은 부채꼴이 아니라
 *   반지름이 같은 고리 위에 고르게 놓는다. 방이 한 마디에 여러 개 몰리는 배치 원형(탑 1층
 *   로비)이 쓴다 — 겹겹이 멀어지는 대신 거리가 전부 같아, 그 문들이 전부 짧은 평범한 통로로
 *   남는다(ADR-0097).
 */
function attachRooms(rngState, skeleton, roomCount, roomTypes, forcedHosts = [], hostRing = {}) {
  let state = rngState;
  const skeletonSize = skeleton.points.length;
  /** @type {number[][]} */
  const adjacency = skeleton.points.map(() => []);
  for (const [a, b] of skeleton.edges) { adjacency[a].push(b); adjacency[b].push(a); }

  const hostOrder = shuffle(state, skeleton.points.map((_, i) => i));
  state = hostOrder.state;
  /** @type {number[]} */
  const roomsPerHost = skeleton.points.map(() => 0);

  /** @type {LocalNode[]} */
  const rooms = [];
  /** @type {[number, number][]} */
  const edges = [];

  for (let r = 0; r < roomCount; r++) {
    const hostIndex = r < forcedHosts.length
      ? forcedHosts[r]
      : hostOrder.value[(r - forcedHosts.length) % Math.max(1, hostOrder.value.length)];
    const host = skeleton.points[hostIndex];
    const k = roomsPerHost[hostIndex];
    roomsPerHost[hostIndex] += 1;

    // 복도 진행 방향의 수직이 방이 뻗는 기본 방향이다. 이웃이 없으면 아무 방향이나 쓴다.
    let dx = 0;
    let dy = 0;
    for (const n of adjacency[hostIndex]) {
      dx += skeleton.points[n].x - host.x;
      dy += skeleton.points[n].y - host.y;
    }
    const len = Math.hypot(dx, dy);
    const perpendicular = len < 1e-6 ? 0 : Math.atan2(dx, -dy);
    const ja = jitter(state, 0.22); state = ja.state;
    // 고리는 정원만큼만 받는다. 그 마디에 방이 더 붙으면(hostOrder가 한 바퀴 돌아 다시 고른
    // 경우) 평소대로 부채꼴로 매달아 고리 위 방과 겹치지 않게 한다.
    const ringDef = hostRing[hostIndex];
    const ring = ringDef && k < ringDef.count ? ringDef : null;
    const angle = ring
      ? perpendicular + (Math.PI * 2 * k) / Math.max(1, ring.count) + ja.value * 0.3
      : perpendicular + (k % 2 === 0 ? 0 : Math.PI) + ja.value;
    const distance = ring
      ? SPACING * ring.radius
      : SPACING * (ROOM_FIRST_LAYER + ROOM_LAYER_STEP * Math.min(Math.floor(k / 2), ROOM_MAX_LAYER));

    const typeResult = weightedPick(state, roomTypes); state = typeResult.state;
    const index = skeletonSize + rooms.length;
    rooms.push({ x: host.x + Math.cos(angle) * distance, y: host.y + Math.sin(angle) * distance, type: typeResult.value });
    edges.push([hostIndex, index]);
  }

  // 서명 유형 보장: 그 구역을 대표하는 방이 한 번도 안 나오는 판을 막는다.
  if (rooms.length > 0) {
    const signature = roomTypes.reduce((best, item) => (item.weight > best.weight ? item : best), roomTypes[0]).value;
    if (!rooms.some((room) => room.type === signature)) rooms[rooms.length - 1].type = signature;
  }

  return { rooms, edges, rngState: state };
}

/**
 * 방 하나가 복도 하나에만 붙어 있으면 그 엣지는 브릿지이고, 그런 노드에는 탈출구를 놓을 수
 * 없다(2-edge-disjoint 경로가 안 나온다). 그래서 일부 방을 가까운 다른 방이나 복도에 한 번 더
 * 잇는다. 실제 건물의 연결문에 해당한다.
 * @param {import('./types.js').RngState} rngState
 * @param {LocalNode[]} allNodes
 * @param {[number, number][]} edges
 * @param {number} skeletonSize
 */
function addConnectingDoors(rngState, allNodes, edges, skeletonSize) {
  let state = rngState;
  const existing = new Set(edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  const degree = allNodes.map(() => 0);
  for (const [a, b] of edges) { degree[a] += 1; degree[b] += 1; }
  /** @type {[number, number][]} */
  const added = [];

  for (let i = skeletonSize; i < allNodes.length; i++) {
    const roll = nextFloat(state); state = roll.state;
    if (roll.value > 0.45) continue;
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < allNodes.length; j++) {
      if (j === i) continue;
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (existing.has(key)) continue;
      if (degree[j] >= 4 || degree[i] >= 4) continue;
      const d = Math.hypot(allNodes[i].x - allNodes[j].x, allNodes[i].y - allNodes[j].y);
      if (d < bestDistance) { bestDistance = d; bestIndex = j; }
    }
    if (bestIndex < 0 || bestDistance > SPACING * 1.45) continue;
    const key = i < bestIndex ? `${i}|${bestIndex}` : `${bestIndex}|${i}`;
    existing.add(key);
    degree[i] += 1;
    degree[bestIndex] += 1;
    added.push([i, bestIndex]);
  }
  return { added, rngState: state };
}

/**
 * 중심을 원점으로 옮기고 최대 반지름이 1이 되도록 맞춘다. 구역 간 거리는 링 배치가 결정하므로,
 * 이 정규화가 배치 원형과 무관하게 좌표 스케일을 고정해 준다.
 * @param {LocalNode[]} nodes
 * @returns {LocalNode[]}
 */
function normalize(nodes) {
  const cx = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
  const cy = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
  let maxRadius = 0;
  for (const n of nodes) maxRadius = Math.max(maxRadius, Math.hypot(n.x - cx, n.y - cy));
  const scale = maxRadius < 1e-6 ? 1 : 1 / maxRadius;
  return nodes.map((n) => ({ x: (n.x - cx) * scale, y: (n.y - cy) * scale, type: n.type }));
}

/**
 * 너무 가까운 노드를 서로 밀어내 겹치지 않게 한다. 방을 복도에 부채꼴로 매달다 보면 서로 다른
 * 복도에 붙은 방끼리 같은 자리에 오는 경우가 생기는데, 그러면 지도에서 노드가 포개져 읽히지
 * 않는다. 밀어낸 뒤에는 반지름이 1을 넘을 수 있으므로 다시 정규화한다(정규화가 다시 간격을
 * 줄이므로 몇 번 반복한다). 난수를 쓰지 않아 같은 입력에는 같은 결과가 나온다.
 * @param {LocalNode[]} nodes
 * @returns {LocalNode[]}
 */
function separate(nodes) {
  let current = nodes.map((n) => ({ ...n }));
  for (let pass = 0; pass < NODE_SEPARATION_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= NODE_MIN_SEPARATION) continue;
        if (d < 1e-6) {
          // 완전히 겹친 경우엔 방향이 없으므로 인덱스로 정해진 방향으로 갈라놓는다.
          dx = Math.cos(i * 2.399963);
          dy = Math.sin(i * 2.399963);
          d = 1;
        }
        const push = ((NODE_MIN_SEPARATION - d) / d) * 0.5;
        current[i] = { ...a, x: a.x - dx * push, y: a.y - dy * push };
        current[j] = { ...b, x: b.x + dx * push, y: b.y + dy * push };
        moved = true;
      }
    }
    if (!moved) break;
    current = normalize(current);
  }
  return current;
}

/**
 * 한 구역의 평면도를 만든다. 좌표는 중심이 원점이고 최대 반지름이 1인 로컬 단위다.
 * @param {import('./types.js').RngState} rngState
 * @param {string} sectorId
 * @returns {{nodes: LocalNode[], edges: [number, number][], specialEdges: SpecialLayoutEdge[], externalIndices: number[] | null, groups: number[] | null, landmarkIndices: number[], offPlanIndices: number[], rngState: import('./types.js').RngState}}
 */
export function generateSectorLayout(rngState, sectorId) {
  const layout = SECTOR_LAYOUTS[sectorId];
  if (!layout) throw new Error(`unknown sector ${sectorId}`);
  let state = rngState;

  const skeletonCount = clamp(Math.round(layout.nodeCount * layout.corridorRatio), 2, layout.nodeCount - 1);
  const builder = SKELETON_BUILDERS[layout.archetype];
  const built = builder(state, skeletonCount);
  state = built.rngState;
  const skeleton = built.skeleton;

  const isTower = layout.archetype === 'tower';
  const roomCount = layout.nodeCount - skeleton.points.length;
  // 탑은 1층이 유일한 출입층이라 로비에 방을 먼저 몰아 붙인다.
  const lobbyHosts = isTower ? new Array(Math.min(TOWER_LOBBY_ROOMS, roomCount)).fill(0) : [];
  // 표지 후보 마디가 최소 개수보다 적으면(방사형의 허브처럼 한 곳뿐이면) 그 마디에 방을 미리
  // 붙여 후보를 채운다. 그러지 않으면 후보가 하나뿐이라 정찰할 이유가 없어진다.
  const hosts = landmarkHosts(layout.archetype, skeleton);
  const landmarkForced = hosts.length < LANDMARK_CANDIDATE_MIN
    ? hosts.flatMap((h) => new Array(LANDMARK_CANDIDATE_MIN).fill(h))
    : [];
  const forcedHosts = [...lobbyHosts, ...landmarkForced].slice(0, roomCount);
  const attached = attachRooms(
    state, skeleton, roomCount, layout.roomTypes, forcedHosts,
    isTower && lobbyHosts.length > 0 ? { 0: { radius: TOWER_LOBBY_RING_RADIUS, count: lobbyHosts.length } } : {},
  );
  state = attached.rngState;

  /** @type {LocalNode[]} */
  const nodes = [
    ...skeleton.points.map((p, i) => ({ x: p.x, y: p.y, type: skeleton.types[i] })),
    ...attached.rooms,
  ];
  /** @type {[number, number][]} */
  const edges = [...skeleton.edges, ...attached.edges];

  // 탑에는 연결문을 놓지 않는다. 층과 층은 계단 하나로만 이어지고 방은 자기 층에만 붙어야
  // 탑이라는 구조가 성립한다 — 방끼리 지름길이 나면 그냥 좁은 격자가 된다.
  if (!isTower) {
    const doors = addConnectingDoors(state, nodes, edges, skeleton.points.length);
    state = doors.rngState;
    edges.push(...doors.added);
  }

  const normalized = separate(normalize(nodes));

  // 바깥으로 열린 노드. null이면 구역 전체가 열려 있다는 뜻이다. 탑은 1층 복도와 거기 붙은
  // 로비 방만 열려 있어서, 다른 구역으로 나가는 관문도 구역 간 특수 엣지도 전부 여기서만 난다.
  const externalIndices = isTower
    ? [0, ...attached.edges.filter(([host]) => host === 0).map(([, index]) => index)]
    : null;

  // 층 구분. null이면 구역 전체가 한 덩어리라는 뜻이다. 탑에서는 복도 마디가 곧 층이고 방은
  // 자기 층에 속한다 — 특수 엣지도 같은 층 안에서만 나야 층이 층으로 읽힌다.
  /** @type {number[] | null} */
  let groups = null;
  if (isTower) {
    groups = nodes.map((_, i) => (i < skeleton.points.length ? i : -1));
    for (const [host, index] of attached.edges) groups[index] = host;
  }

  // 표지 후보. 원형이 정한 마디에 붙은 방들이다. 후보가 너무 많으면 도면에서 좁혀지지 않고,
  // 하나뿐이면 정찰할 이유가 없다 — 둘 다 D16이 원하는 상태가 아니다. 그래서 많으면 마디마다
  // 가장 먼저 붙은 방 하나씩만 남기고, 그래도 하나뿐이면 마디 자체를 후보에 넣는다.
  const hostSet = new Set(hosts);
  let landmarkIndices = attached.edges.filter(([host]) => hostSet.has(host)).map(([, index]) => index);
  if (landmarkIndices.length > LANDMARK_CANDIDATE_MAX) {
    const firstRoomOf = new Map();
    for (const [host, index] of attached.edges) {
      if (hostSet.has(host) && !firstRoomOf.has(host)) firstRoomOf.set(host, index);
    }
    landmarkIndices = hosts.filter((h) => firstRoomOf.has(h)).slice(0, LANDMARK_CANDIDATE_MAX).map((h) => firstRoomOf.get(h));
  }
  if (landmarkIndices.length < LANDMARK_CANDIDATE_MIN) landmarkIndices = [...new Set([...landmarkIndices, ...hosts])];

  // 도면에 없는 층. 비인가 통로와 거기 매달린 방까지 한 덩어리로 감춘다 — 통로만 감추면 방이
  // 연결선 없이 떠 있어 그림이 깨지고, 애초에 "겹쳐 있는 비인가층"이라는 구조가 안 읽힌다.
  const offPlanHosts = new Set(
    skeleton.points.map((_, i) => i).filter((i) => skeleton.types[i] === 'crawlway'),
  );
  const offPlanIndices = [
    ...offPlanHosts,
    ...attached.edges.filter(([host]) => offPlanHosts.has(host)).map(([, index]) => index),
  ];

  return {
    nodes: normalized,
    edges,
    specialEdges: (skeleton.specialEdges || []).map((e) => ({ ...e })),
    externalIndices,
    groups,
    landmarkIndices,
    offPlanIndices,
    rngState: state,
  };
}
