// 맵 정수 시간(ADR-0075) 전환 뒤 마감 상수(붕괴 490 / A 폐쇄 300)가
// 실제 시드에서 얼마나 빡빡한지 재는 측정 도구다. 아무 상수도 바꾸지 않고 읽기만 한다 —
// 결과 요약은 docs/proposals/map-time-balance-measurement.md.
//
// 측정은 전부 "사후 최단"이다. 실제 플레이어는 출구 위치도 통로 비용도 모른 채 탐색하므로,
// 여기서 나오는 여유는 도달 가능한 상한이고 체감 여유는 이보다 작다. 어느 정보가 시작 시점에
// 알려지는지는 아래 KNOWN_AT_START가 항목마다 표시한다.
//
// 실행: node scripts/measure-map-balance.mjs [--seeds 1..50] [--json [경로]]

import fs from 'node:fs';
import process from 'node:process';

import { generateFacilityGraph, adjacentSectorIds } from '../src/engine/facilityGraph.js';
import { moveTimeCost, forecastAction, actionTimeCost } from '../src/engine/actionCosts.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { canClimbHighGround } from '../src/engine/runEngine.js';
import {
  RUN_COLLAPSE_TIME, EXIT_A_DISABLED_AT,
  EXIT_REQUEST_TIME, EXIT_OPEN_WAIT_BY_HACKING, EXIT_OPEN_WINDOW,
  EDGE_TIME_MIN, EDGE_TIME_MAX, BASIC_RECON_TIME, SUPPLY_FARM_TIME, PRIZE_FARM_TIME,
  CORPSE_DISPOSAL_TIME,
  COMBAT_ROUND_TIME_COST, THREAT_MOVE_INTERVAL, REINFORCEMENT_INTERVAL,
  FORCE_TIER1_TIME, HACKING_TIER1_TIME,
} from '../src/data/facilityLayout.js';

/** 측정에 쓰는 Mobility 값. 이동 비용이 바뀌고, 고지대는 층계 불가 구간(유효 0 이하)에서만 길이 끊긴다. */
export const MOBILITY_VALUES = [-2, 0, 2, 4];

/** 기본 로드아웃 = 모든 Capability 0. 문 개방·계약 행동 비용은 전부 이 값으로 계산한다. */
const BASE_CAPABILITY = 0;

/** 시작 시점에 플레이어가 아는 정보인가 — 표에 그대로 찍는다. */
const KNOWN_AT_START = {
  objective: true,   // 계약 목표부 랜드마크는 수락 시 공개된다(createRunState revealLandmarkSectorIds).
  exits: true,       // A는 런 시작부터 지도에 보인다(ADR-0025). 열쇠 출구만 비공개다.
  keyExit: false,    // 열쇠 출구는 열쇠를 확보해야 지도에 나타난다.
  edgeCosts: false,  // 통로 비용은 그 통로를 볼 때까지 모른다.
  threats: false,
};

/** 옛 포인트 체계(HEAD 기준) — 반올림 편향 비교 전용 상수. 현재 코드에는 없다. */
const LEGACY = {
  edgePerLengthUnit: 2,
  edgeMin: 40,
  edgeMax: 260,
  moveMultiplier: [1.4, 1.2, 1, 0.9, 0.8, 0.7, 0.6],
  moveMin: 10,
  pointsPerTick: 20,
};

// ---- 작은 통계 도구 ----

/** @param {number[]} values */
function stats(values) {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return { min: NaN, median: NaN, max: NaN, mean: NaN, n: 0, unreachable: values.length };
  const mid = Math.floor(finite.length / 2);
  const median = finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
  return {
    min: finite[0],
    median,
    max: finite[finite.length - 1],
    mean: finite.reduce((a, b) => a + b, 0) / finite.length,
    n: finite.length,
    unreachable: values.length - finite.length,
  };
}

/** @param {number[]} values */
function negativeRatio(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 1;
  return finite.filter((v) => v < 0).length / finite.length;
}

// ---- 그래프 통과 규칙 ----

/**
 * 이 엣지를 여는 비용. 열 수 없으면 null.
 * 차단은 Force, 전자는 Hacking으로 연다(둘 다면 싼 쪽). Capability 0 기준이라 요구치 3짜리
 * 승강기(A ≤ R-3)는 층계상 불가다.
 * @param {import('../src/engine/types.js').FacilityEdge} edge
 * @returns {{time: number, kind: string} | null}
 */
function openCostFor(edge) {
  const kinds = [];
  if (edge.features.includes('blocked')) kinds.push('force');
  if (edge.features.includes('electronic')) kinds.push('hacking');
  if (kinds.length === 0) return null;
  let best = null;
  for (const kind of kinds) {
    const forecast = forecastAction('openEdge', { edge, capabilityKind: kind, value: BASE_CAPABILITY });
    if (forecast.blocked) continue;
    if (!best || forecast.timeCost < best.time) best = { time: forecast.timeCost, kind };
  }
  return best;
}

/**
 * 플레이어가 실제로 지날 수 있는 방향성 간선 목록을 만든다 — runEngine.isEdgeTraversable와 같은
 * 규칙이다(oneWay는 생성 방향만, 잠긴 문은 열어야, highGround는 유효 Mobility 3 이상).
 * @param {import('../src/engine/types.js').FacilityGraph} graph
 * @param {number} mobility
 * @param {boolean} allowOpening 잠긴 문을 개방 비용을 물고 지나가도 되는가.
 */
function buildArcs(graph, mobility, allowOpening) {
  /** @type {Map<string, {to: string, cost: number}[]>} */
  const arcs = new Map();
  const link = (from, to, cost) => {
    if (!arcs.has(from)) arcs.set(from, []);
    arcs.get(from).push({ to, cost });
  };
  for (const edge of graph.edges) {
    if (edge.features.includes('highGround') && !canClimbHighGround(mobility)) continue;
    const locked = edge.features.includes('blocked') || edge.features.includes('electronic');
    let extra = 0;
    if (locked) {
      if (!allowOpening) continue;
      const open = openCostFor(edge);
      if (!open) continue;
      extra = open.time;
    }
    const cost = moveTimeCost(edge, mobility) + extra;
    link(edge.from, edge.to, cost);
    if (!edge.features.includes('oneWay')) link(edge.to, edge.from, cost);
  }
  return arcs;
}

/** 옛 포인트 체계의 통로 비용을 현재 그래프 좌표에서 다시 만든다(반올림 편향 비교 전용). */
function buildLegacyArcs(graph, mobility) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const index = Math.max(-2, Math.min(4, mobility)) + 2;
  /** @type {Map<string, {to: string, cost: number}[]>} */
  const arcs = new Map();
  const link = (from, to, cost) => {
    if (!arcs.has(from)) arcs.set(from, []);
    arcs.get(from).push({ to, cost });
  };
  for (const edge of graph.edges) {
    if (edge.features.includes('highGround') && !canClimbHighGround(mobility)) continue;
    if (edge.features.includes('blocked') || edge.features.includes('electronic')) continue;
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    const points = Math.max(LEGACY.edgeMin, Math.min(LEGACY.edgeMax, Math.round(length * LEGACY.edgePerLengthUnit)));
    const cost = Math.max(LEGACY.moveMin, Math.round(points * LEGACY.moveMultiplier[index]));
    link(edge.from, edge.to, cost);
    if (!edge.features.includes('oneWay')) link(edge.to, edge.from, cost);
  }
  return arcs;
}

/**
 * 방향성 Dijkstra. 노드 200여 개라 우선순위 큐 없이 O(V^2)로 충분하다.
 * @param {Map<string, {to: string, cost: number}[]>} arcs
 * @param {string} fromId
 * @returns {Map<string, number>}
 */
function dijkstra(arcs, fromId) {
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

/** @param {Map<string, number>} distances @param {string} nodeId */
function distOf(distances, nodeId) {
  return distances.get(nodeId) ?? Infinity;
}

// ---- 시드 하나 측정 ----

/** 탈출구를 실제로 쓰려면 도착 뒤 요청 3칸과 개방 대기(Hacking 0 -> 15칸)가 더 든다. */
const EXIT_OVERHEAD = EXIT_REQUEST_TIME + EXIT_OPEN_WAIT_BY_HACKING[BASE_CAPABILITY + 2];

/**
 * 목표부에서 치르는 비용(Capability 0). C5 이후로는 이것이 **완료**가 아니다 — 회수는 물건을
 * 들고 나가야 하고, 파괴는 떨어진 자리에서 기폭해야 하며, 정보는 다른 구역 랜드마크에서
 * 송출해야 한다. 봉쇄는 전부 이 시점에 켜지므로 유예 125칸의 기준 시각도 여기다.
 */
function contractObjectiveCost(type) {
  if (type === 'retrieval') return actionTimeCost('contractRetrieve', { value: BASE_CAPABILITY, capabilityKind: 'stealth' });
  if (type === 'destroy') return actionTimeCost('contractDestroy', { value: BASE_CAPABILITY });
  return actionTimeCost('contractIntel', { value: BASE_CAPABILITY });
}

/**
 * 목표부를 떠난 뒤 완료까지 더 드는 비용(C5).
 * - 파괴: 나가는 길에 2홉만 벌어지면 그 자리에서 기폭하면 되므로 기폭 시간만 더한다.
 * - 정보: 목표부 구역에 인접한 구역의 랜드마크까지 들렀다 가야 하므로 그 우회가 실제 거리로 잡힌다(아래에서 계산).
 * - 회수: 추가 행동 없음 — 출구를 밟는 순간 완료.
 */
function contractCompletionActionCost(type) {
  if (type === 'destroy') return actionTimeCost('contractDetonate');
  if (type === 'intel') return actionTimeCost('contractTransmit', { value: BASE_CAPABILITY });
  return 0;
}

/**
 * @param {number} seed
 */
export function measureSeed(seed) {
  const { graph, usedFallback } = generateFacilityGraph(seed);
  const exitNodeIds = Object.fromEntries(graph.exits.map((e) => [e.exitId, e.nodeId]));
  const runContractDefs = CONTRACT_DEFS.filter((def) => graph.sectorIds.includes(def.sectorId));
  const landmarkBySector = Object.fromEntries(graph.landmarks.map((l) => [l.sectorId, l.nodeId]));

  /** 통로 비용 히스토그램(2~13). */
  const edgeCostHistogram = {};
  for (let c = EDGE_TIME_MIN; c <= EDGE_TIME_MAX; c++) edgeCostHistogram[c] = 0;
  for (const edge of graph.edges) edgeCostHistogram[edge.timeCost] = (edgeCostHistogram[edge.timeCost] || 0) + 1;

  const featureCounts = { plain: 0, oneWay: 0, blocked: 0, electronic: 0, highGround: 0 };
  for (const edge of graph.edges) {
    if (edge.features.length === 0) featureCounts.plain += 1;
    for (const f of edge.features) featureCounts[f] = (featureCounts[f] || 0) + 1;
  }

  /** @type {Record<string, any>} */
  const byMobility = {};
  for (const mobility of MOBILITY_VALUES) {
    const walkArcs = buildArcs(graph, mobility, false);
    const openArcs = buildArcs(graph, mobility, true);
    const walk = dijkstra(walkArcs, graph.startNodeId);
    const open = dijkstra(openArcs, graph.startNodeId);
    const legacy = dijkstra(buildLegacyArcs(graph, mobility), graph.startNodeId);

    const exits = {};
    for (const exitId of ['A', 'key']) {
      const nodeId = exitNodeIds[exitId];
      exits[exitId] = {
        nodeId,
        walk: distOf(walk, nodeId),
        open: distOf(open, nodeId),
        legacyPoints: distOf(legacy, nodeId),
        legacyTicks: distOf(legacy, nodeId) / LEGACY.pointsPerTick,
      };
    }

    // 왕복 여유 — 각 마감에서 최단 경로를 뺀다. walk 기준(잠긴 문을 열지 않는 기본 경로)이
    // 주 수치이고, open은 문을 열어 지름길을 타는 대안이다.
    const slack = {
      exitA: EXIT_A_DISABLED_AT - exits.A.walk,
      exitAOpen: EXIT_A_DISABLED_AT - exits.A.open,
      collapseViaA: RUN_COLLAPSE_TIME - (exits.A.walk + EXIT_OVERHEAD),
      // 옛 체계에서 같은 목적지까지의 여유(칸 환산) — 반올림 편향 비교용.
      legacyExitA: EXIT_A_DISABLED_AT - exits.A.legacyTicks,
    };

    // 계약별 왕복: 시작 -> 목표부 -> 가장 가까운 사용 가능 출구.
    // 한 런은 네 구역만 쓰므로(ADR-0081) 그 구역에 목표부가 있는 계약만 잰다 — 나머지는 이
    // 시드에서 제안되지도 않는다.
    const contracts = {};
    for (const def of runContractDefs) {
      const objectiveNodeId = landmarkBySector[def.sectorId];
      const toObjective = distOf(walk, objectiveNodeId);
      const actionCost = contractObjectiveCost(def.type);
      // 봉쇄는 목표부 행동이 끝나는 순간 켜진다 — 유예 125칸의 기준은 여기다(C5: 파괴 계약도
      // 설치 완료 시각부터이며 기폭 시각이 아니다).
      const acquiredAt = toObjective + actionCost;
      const fromObjective = Number.isFinite(toObjective) ? dijkstra(walkArcs, objectiveNodeId) : new Map();
      // 정보 계약은 목표부를 떠난 뒤 **목표부 구역에 인접한 구역**의 랜드마크를 반드시
      // 들른다(C5) — 출구별로 그 우회가 가장 싼 랜드마크를 골라 더한다. 그 외 유형은 우회가 없다.
      const intelSectorIds = adjacentSectorIds(graph, def.sectorId);
      const detourLandmarks = def.type === 'intel'
        ? graph.landmarks.filter((l) => intelSectorIds.includes(l.sectorId)).map((l) => l.nodeId)
        : [];
      const fromLandmark = new Map(detourLandmarks.map((nodeId) => [nodeId, dijkstra(walkArcs, nodeId)]));
      const completionCost = contractCompletionActionCost(def.type);
      const legs = {};
      for (const exitId of ['A', 'key']) {
        const direct = distOf(fromObjective, exitNodeIds[exitId]);
        const leg = detourLandmarks.length === 0
          ? direct
          : Math.min(...detourLandmarks.map((nodeId) => distOf(fromObjective, nodeId) + distOf(fromLandmark.get(nodeId), exitNodeIds[exitId])));
        const total = acquiredAt + leg + completionCost;
        // 봉쇄는 출구 폐쇄 시각을 앞당기지 않는다(ADR-0083) — 표준 출구 A는 언제나 자기
        // 폐쇄 시각이 마감이고, 열쇠 출구에는 마감이 없다.
        const deadline = exitId === 'A' ? EXIT_A_DISABLED_AT : Infinity;
        legs[exitId] = {
          leg,
          total,
          deadline,
          slack: deadline - total,
          usable: total < deadline && total + EXIT_OVERHEAD < RUN_COLLAPSE_TIME,
        };
      }
      const usable = ['A'].filter((id) => legs[id].usable);
      const best = usable.length === 0 ? null : usable.reduce((a, b) => (legs[a].total <= legs[b].total ? a : b));
      contracts[def.id] = {
        type: def.type, sectorId: def.sectorId, objectiveNodeId,
        toObjective, actionCost, completionCost, acquiredAt, legs,
        bestExit: best,
        bestTotal: best ? legs[best].total : Infinity,
        bestSlack: best ? legs[best].slack : -Infinity,
      };
    }

    const moveCosts = [];
    for (const arcList of walkArcs.values()) for (const arc of arcList) moveCosts.push(arc.cost);

    byMobility[mobility] = { exits, slack, contracts, moveCostStats: stats(moveCosts) };
  }

  return {
    seed, usedFallback,
    sectorIds: graph.sectorIds,
    exitPlacement: graph.exitPlacement,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    edgeCostHistogram,
    featureCounts,
    byMobility,
  };
}

/** @param {number[]} seeds */
export function measure(seeds) {
  return {
    generatedAt: new Date().toISOString(),
    seeds,
    constants: {
      RUN_COLLAPSE_TIME, EXIT_A_DISABLED_AT,
      EXIT_REQUEST_TIME, EXIT_OPEN_WINDOW, exitOverheadAtHacking0: EXIT_OVERHEAD,
    },
    knownAtStart: KNOWN_AT_START,
    seedResults: seeds.map(measureSeed),
  };
}

// ---- 표 출력 ----

/** @param {number} value @param {number} [digits] */
function num(value, digits = 0) {
  if (!Number.isFinite(value)) return '도달불가';
  return value.toFixed(digits);
}

function pad(value, width) {
  const text = String(value);
  const visual = [...text].reduce((sum, ch) => sum + (/[ᄀ-퟿＀-￯]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - visual));
}

function row(cells, widths) {
  return cells.map((cell, i) => pad(cell, widths[i])).join('  ').trimEnd();
}

/** @param {ReturnType<typeof measure>} result */
export function formatReport(result) {
  const out = [];
  const seeds = result.seeds;
  const rs = result.seedResults;
  const pick = (fn) => rs.map(fn);

  out.push('맵 정수 시간 밸런스 측정 (ADR-0075)');
  out.push(`시드 ${seeds[0]}..${seeds[seeds.length - 1]} (${seeds.length}개) · 기본 로드아웃(전 Capability 0)`);
  out.push(`마감: 붕괴 ${RUN_COLLAPSE_TIME} / A 폐쇄 ${EXIT_A_DISABLED_AT} (봉쇄는 출구를 앞당겨 닫지 않는다, ADR-0083)`);
  out.push(`탈출 부대비용: 요청 ${EXIT_REQUEST_TIME} + 개방 대기 ${EXIT_OPEN_WAIT_BY_HACKING[2]}(Hacking 0) = ${EXIT_OVERHEAD}칸`);
  out.push('모든 거리는 사후 최단(전지 시점)이다 — 실제 탐색 비용은 포함하지 않는다.');
  out.push('');

  // 6. 그래프 형태
  out.push('## 1. 그래프 형태');
  out.push(`노드 ${stats(pick((r) => r.nodeCount)).median} · 엣지 중앙 ${stats(pick((r) => r.edgeCount)).median} (최소 ${stats(pick((r) => r.edgeCount)).min} / 최대 ${stats(pick((r) => r.edgeCount)).max})`);
  const histWidths = [6, 10, 8];
  out.push(row(['비용', '엣지 수(합)', '비율'], histWidths));
  let histTotal = 0;
  for (let c = EDGE_TIME_MIN; c <= EDGE_TIME_MAX; c++) histTotal += rs.reduce((sum, r) => sum + r.edgeCostHistogram[c], 0);
  for (let c = EDGE_TIME_MIN; c <= EDGE_TIME_MAX; c++) {
    const count = rs.reduce((sum, r) => sum + r.edgeCostHistogram[c], 0);
    out.push(row([`${c}칸`, count, `${(count / histTotal * 100).toFixed(1)}%`], histWidths));
  }
  const feat = ['plain', 'oneWay', 'blocked', 'electronic', 'highGround']
    .map((k) => `${k} ${(rs.reduce((s, r) => s + (r.featureCounts[k] || 0), 0) / rs.length).toFixed(1)}`).join(' · ');
  out.push(`시드당 평균 엣지 성격: ${feat}`);
  out.push('');

  // 1. 시작점에서 각 출구까지
  out.push('## 2. 시작점 -> 출구 최단 가중거리(칸) [A 위치는 시작 시점 공개, 열쇠는 비공개]');
  const distWidths = [8, 6, 22, 22, 10];
  out.push(row(['Mobility', '출구', '개방 없이 최소/중앙/최대', '문 개방 허용(Cap 0)', '도달불가'], distWidths));
  for (const m of MOBILITY_VALUES) {
    for (const exitId of ['A', 'key']) {
      const walk = stats(pick((r) => r.byMobility[m].exits[exitId].walk));
      const open = stats(pick((r) => r.byMobility[m].exits[exitId].open));
      out.push(row([
        m, exitId,
        `${num(walk.min)} / ${num(walk.median, 1)} / ${num(walk.max)}`,
        `${num(open.min)} / ${num(open.median, 1)} / ${num(open.max)}`,
        walk.unreachable,
      ], distWidths));
    }
  }
  out.push('출구 A는 시작 구역도 계약 목표 구역도 아닌 구역에서 시작점으로부터 가장 먼 노드다(ADR-0083). 열쇠 출구만 무작위이고 비공개다.');
  out.push('');

  out.push(`fallback 토폴로지를 쓴 시드: ${rs.filter((r) => r.usedFallback).length}/${rs.length}`);
  out.push('');

  // 3. 왕복 여유
  out.push('## 3. 마감별 여유 = 마감 − 최단거리 (칸)');
  const slackWidths = [8, 18, 22, 10];
  out.push(row(['Mobility', '마감', '최소/중앙/최대', '음수 시드 비율'], slackWidths));
  const slackRows = [
    [`A 폐쇄 ${EXIT_A_DISABLED_AT}`, (r, m) => r.byMobility[m].slack.exitA],
    [`붕괴 ${RUN_COLLAPSE_TIME}(A경유+부대)`, (r, m) => r.byMobility[m].slack.collapseViaA],
  ];
  for (const m of MOBILITY_VALUES) {
    for (const [label, fn] of slackRows) {
      const values = pick((r) => fn(r, m));
      const s = stats(values);
      out.push(row([m, label, `${num(s.min)} / ${num(s.median, 1)} / ${num(s.max)}`, `${(negativeRatio(values) * 100).toFixed(0)}%`], slackWidths));
    }
  }
  out.push('');

  // 4. 행동 예산
  out.push(`## 4. 행동 예산 — A 탈출 런(여유 = ${EXIT_A_DISABLED_AT} − 시작->A 거리 − 부대비용)을 대표 행동으로 나눈 값`);
  const doorForce = forecastAction('openEdge', { edge: { timeCost: 0, requiredCapability: 1 }, capabilityKind: 'force', value: 0 }).timeCost;
  const doorHack = forecastAction('openEdge', { edge: { timeCost: 0, requiredCapability: 1 }, capabilityKind: 'hacking', value: 0 }).timeCost;
  // 수습 행동(시체 처리·흔적 정리)도 같은 줄에 둔다 — 다른 행동 대비 얼마나 비싼지가 보이지
  // 않으면 "항상 열세인 행동"인지 판정할 수 없다.
  const cleanup0 = forecastAction('cleanTraces', { value: 0 }).timeCost;
  const cleanup4 = forecastAction('cleanTraces', { value: 4 }).timeCost;
  out.push(`대표 행동 비용: 정찰 ${BASIC_RECON_TIME} · 보급품 파밍 ${SUPPLY_FARM_TIME} · 확보 대상 파밍 ${PRIZE_FARM_TIME.normal}~${PRIZE_FARM_TIME.elite} · 문 개방 기본 ${HACKING_TIER1_TIME}~${FORCE_TIER1_TIME}(Cap 0 실제 ${doorHack}~${doorForce}) · 전투 1라운드 ${COMBAT_ROUND_TIME_COST} · 시체 처리 ${CORPSE_DISPOSAL_TIME} · 흔적 정리 ${cleanup4}~${cleanup0}(Perception 4~0)`);
  const budgetWidths = [8, 16, 10, 10, 10, 10, 10];
  out.push(row(['Mobility', '여유(중앙)', '정찰만', '보급파밍만', '확보파밍만', '전투라운드만', '표준세트'], budgetWidths));
  // 표준세트 = 정찰 6 + 보급 파밍 4 + 확보 파밍 2 + 전투 3라운드.
  const SET_COST = 6 * BASIC_RECON_TIME + 4 * SUPPLY_FARM_TIME + 2 * PRIZE_FARM_TIME.normal + 3 * COMBAT_ROUND_TIME_COST;
  for (const m of MOBILITY_VALUES) {
    const budgets = pick((r) => EXIT_A_DISABLED_AT - r.byMobility[m].exits.A.walk - EXIT_OVERHEAD);
    const s = stats(budgets);
    const per = (cost) => (s.median > 0 ? Math.floor(s.median / cost) : 0);
    out.push(row([
      m, num(s.median, 1), per(BASIC_RECON_TIME), per(SUPPLY_FARM_TIME),
      per(PRIZE_FARM_TIME.normal), per(COMBAT_ROUND_TIME_COST), `${(s.median / SET_COST).toFixed(1)}회`,
    ], budgetWidths));
  }
  out.push(`표준세트 = 정찰 6 + 보급 파밍 4 + 확보 파밍 2 + 전투 3라운드 = ${SET_COST}칸`);
  out.push('');

  // 5. 적 압박
  out.push('## 5. 적 압박 — 대표 행동 한 번 동안 위협이 움직이는 횟수');
  const pressureWidths = [18, 10, 12, 12];
  out.push(row(['행동(칸)', '순찰 5칸', '추격 3칸', '조사·경계 4칸'], pressureWidths));
  const medianMove = stats(MOBILITY_VALUES.flatMap((m) => pick((r) => r.byMobility[m].moveCostStats.median))).median;
  const moveMedian0 = stats(pick((r) => r.byMobility[0].moveCostStats.median)).median;
  const actions = [
    [`정찰 ${BASIC_RECON_TIME}`, BASIC_RECON_TIME],
    [`확보 파밍 ${PRIZE_FARM_TIME.normal}`, PRIZE_FARM_TIME.normal],
    [`이동 중앙 ${moveMedian0}(Mob 0)`, moveMedian0],
    [`탈출 부대 ${EXIT_OVERHEAD}`, EXIT_OVERHEAD],
  ];
  for (const [label, cost] of actions) {
    out.push(row([
      label,
      Math.floor(cost / THREAT_MOVE_INTERVAL.patrol),
      Math.floor(cost / THREAT_MOVE_INTERVAL.pursuit),
      Math.floor(cost / THREAT_MOVE_INTERVAL.investigate),
    ], pressureWidths));
  }
  for (const m of MOBILITY_VALUES) {
    const s = stats(pick((r) => EXIT_A_DISABLED_AT - r.byMobility[m].exits.A.walk - EXIT_OVERHEAD));
    out.push(`Mobility ${m}: A 탈출 런 예산 ${num(s.median, 1)}칸 동안 증원(${REINFORCEMENT_INTERVAL}칸 주기) ${Math.floor(Math.max(0, s.median) / REINFORCEMENT_INTERVAL)}회, 붕괴 ${RUN_COLLAPSE_TIME}까지 총 ${Math.floor(RUN_COLLAPSE_TIME / REINFORCEMENT_INTERVAL)}회`);
  }
  out.push(`(전 Mobility 통합 이동 비용 중앙값 ${num(medianMove, 1)}칸)`);
  out.push('');

  // 2. 계약 왕복
  out.push('## 6. 계약 왕복 — 시작 -> 목표부 -> 가장 가까운 사용 가능 출구 [목표부 위치는 시작 시점 공개]');
  const cWidths = [26, 8, 10, 8, 12, 12, 16, 12];
  for (const m of MOBILITY_VALUES) {
    out.push(`Mobility ${m}`);
    out.push(row(['계약', '유형', '->목표부', '행동', '확보시각', 'A다리', '최선 합계(중앙)', '최선 출구'], cWidths));
    for (const def of CONTRACT_DEFS) {
      // 계약마다 "그 목표부 구역이 뽑힌 시드"만 모아 잰다 — 구역 추첨 때문에 계약별 표본 수가
      // 다르므로 몇 개 시드로 낸 값인지도 같이 적는다.
      const present = rs.filter((r) => r.byMobility[m].contracts[def.id]);
      if (present.length === 0) continue;
      const seedPick = (fn) => present.map(fn);
      const toObj = stats(seedPick((r) => r.byMobility[m].contracts[def.id].toObjective));
      const acq = stats(seedPick((r) => r.byMobility[m].contracts[def.id].acquiredAt));
      const aLeg = stats(seedPick((r) => r.byMobility[m].contracts[def.id].legs.A.leg));
      const total = stats(seedPick((r) => r.byMobility[m].contracts[def.id].bestTotal));
      const bestCounts = {};
      for (const r of present) {
        const best = r.byMobility[m].contracts[def.id].bestExit;
        const key = best || '없음';
        bestCounts[key] = (bestCounts[key] || 0) + 1;
      }
      out.push(row([
        `${def.name} (${present.length}시드)`, def.type, num(toObj.median, 1),
        present[0].byMobility[m].contracts[def.id].actionCost,
        num(acq.median, 1), num(aLeg.median, 1), num(total.median, 1),
        Object.entries(bestCounts).map(([k, v]) => `${k}:${v}`).join(' '),
      ], cWidths));
    }
    out.push('');
  }

  // 7. 옛 체계 비교
  out.push('## 7. 옛 포인트 체계 대비 (같은 그래프, 옛 통로 비용·배율을 20으로 나눈 값)');
  const legacyWidths = [8, 6, 22, 22, 20];
  out.push(row(['Mobility', '출구', '현재(칸) 최소/중앙/최대', '옛 환산(칸)', '차이 중앙(현재−옛)'], legacyWidths));
  for (const m of MOBILITY_VALUES) {
    for (const exitId of ['A', 'key']) {
      const now = stats(pick((r) => r.byMobility[m].exits[exitId].walk));
      const old = stats(pick((r) => r.byMobility[m].exits[exitId].legacyTicks));
      const diff = stats(pick((r) => r.byMobility[m].exits[exitId].walk - r.byMobility[m].exits[exitId].legacyTicks));
      out.push(row([
        m, exitId,
        `${num(now.min)} / ${num(now.median, 1)} / ${num(now.max)}`,
        `${num(old.min, 1)} / ${num(old.median, 1)} / ${num(old.max, 1)}`,
        `${diff.median > 0 ? '+' : ''}${num(diff.median, 1)} (${num(diff.min, 1)}..${num(diff.max, 1)})`,
      ], legacyWidths));
    }
  }
  out.push('');
  return out.join('\n');
}

// ---- CLI ----

/** @param {string[]} argv */
export function parseArgs(argv) {
  let seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  let json = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seeds') {
      const spec = argv[++i] || '';
      const match = /^(\d+)\.\.(\d+)$/.exec(spec);
      if (!match) throw new Error(`--seeds 형식은 1..50 이다: ${spec}`);
      const from = Number(match[1]);
      const to = Number(match[2]);
      seeds = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    } else if (argv[i] === '--json') {
      const next = argv[i + 1];
      json = next && !next.startsWith('--') ? (i++, next) : '-';
    }
  }
  return { seeds, json };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  const { seeds, json } = parseArgs(process.argv.slice(2));
  const result = measure(seeds);
  if (json === '-') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    if (json) fs.writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${formatReport(result)}\n`);
    if (json) process.stdout.write(`JSON: ${json}\n`);
  }
}
