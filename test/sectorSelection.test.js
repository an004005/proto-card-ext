// 구역 추첨(ADR-0081·ADR-0083) — 한 런은 여덟 구역 정의 중 넷만 쓴다. 추첨은 계약 수락 뒤에
// 돌고 수락한 계약의 목표 구역을 반드시 포함한다. 여기서 보는 것은 그 추첨의 규칙(시작 구역
// 고정·계약 구역 보장·개수·링 순서)과, 그 규칙이 그래프 생성까지 실제로 닿는가다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectRunSectorIds, sectorRingPairs, adjacentSectorIds, generateFacilityGraph,
} from '../src/engine/facilityGraph.js';
import { createRngState } from '../src/engine/rng.js';
import {
  ALL_SECTOR_IDS, RUN_SECTOR_COUNT, START_SECTOR_ID, DEEPEST_SECTOR_ID,
  totalNodesFor,
} from '../src/data/facilityLayout.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { offerContracts } from '../src/engine/contractReducer.js';
import { gameReducer } from '../src/engine/gameReducer.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i);

test('추첨은 시드마다 결정론적이고, 시작 구역을 항상 포함한 서로 다른 네 구역을 낸다', () => {
  for (const seed of SEEDS) {
    const a = selectRunSectorIds(createRngState(seed));
    const b = selectRunSectorIds(createRngState(seed));
    assert.deepEqual(a.sectorIds, b.sectorIds, `시드 ${seed}: 같은 시드는 같은 구역`);
    assert.equal(a.rngState, b.rngState);

    const ids = a.sectorIds;
    assert.equal(ids.length, RUN_SECTOR_COUNT, `시드 ${seed}: 구역 수`);
    assert.equal(new Set(ids).size, RUN_SECTOR_COUNT, `시드 ${seed}: 중복 없음`);
    assert.equal(ids[0], START_SECTOR_ID, `시드 ${seed}: 시작 구역은 링 0번`);
    for (const id of ids) assert.ok(ALL_SECTOR_IDS.includes(id), `시드 ${seed}: ${id}는 정의에 없다`);
  }
});

test('동력·정비동이 뽑히면 링에서 시작 구역 정반대에 놓인다 — 가장 깊은 곳이 가장 멀다', () => {
  let withDeepest = 0;
  for (const seed of SEEDS) {
    const ids = selectRunSectorIds(createRngState(seed)).sectorIds;
    const at = ids.indexOf(DEEPEST_SECTOR_ID);
    if (at < 0) continue;
    withDeepest += 1;
    assert.equal(at, RUN_SECTOR_COUNT / 2, `시드 ${seed}: ${DEEPEST_SECTOR_ID}는 링 2번이어야 한다`);
    // 링 반대편은 이웃이 아니다 — 어느 방향으로 돌아도 두 칸이다.
    assert.ok(!adjacentSectorIds({ sectorIds: ids }, START_SECTOR_ID).includes(DEEPEST_SECTOR_ID));
  }
  assert.ok(withDeepest > 0, '표본에 동력·정비동이 뽑힌 시드가 있어야 한다');
});

test('나머지 일곱 구역은 모두 뽑힐 수 있고 어느 하나로 쏠리지 않는다', () => {
  const counts = Object.fromEntries(ALL_SECTOR_IDS.map((id) => [id, 0]));
  for (const seed of SEEDS) {
    for (const id of selectRunSectorIds(createRngState(seed)).sectorIds) counts[id] += 1;
  }
  assert.equal(counts[START_SECTOR_ID], SEEDS.length, '시작 구역은 매 런 들어간다');
  for (const id of ALL_SECTOR_IDS.filter((x) => x !== START_SECTOR_ID)) {
    // 기대값은 200 * 3/7 ≈ 86. 균등 추첨이면 절반 아래로 내려가거나 1.5배를 넘지 않는다.
    assert.ok(counts[id] > SEEDS.length * 3 / 7 / 2, `${id}가 너무 드물다 (${counts[id]})`);
    assert.ok(counts[id] < SEEDS.length * 3 / 7 * 1.5, `${id}가 너무 잦다 (${counts[id]})`);
  }
});

test('인접은 4칸 링이다 — 이웃 둘, 맞은편 하나는 이웃이 아니다', () => {
  for (const seed of SEEDS) {
    const ids = selectRunSectorIds(createRngState(seed)).sectorIds;
    const graph = { sectorIds: ids };
    const pairs = sectorRingPairs(ids);
    assert.equal(pairs.length, RUN_SECTOR_COUNT);
    assert.equal(new Set(pairs.map(([a, b]) => [a, b].sort().join('|'))).size, RUN_SECTOR_COUNT);

    for (let i = 0; i < ids.length; i++) {
      const neighbours = adjacentSectorIds(graph, ids[i]);
      assert.deepEqual(new Set(neighbours), new Set([ids[(i + 3) % 4], ids[(i + 1) % 4]]), `시드 ${seed}: ${ids[i]}의 이웃`);
      assert.ok(!neighbours.includes(ids[(i + 2) % 4]), `시드 ${seed}: 맞은편은 이웃이 아니다`);
      assert.ok(!neighbours.includes(ids[i]), '자기 자신은 이웃이 아니다');
      // 인접은 대칭이다 — 한쪽에서만 이웃인 구역이 있으면 경계도 이동이 한 방향으로만 샌다.
      for (const other of neighbours) assert.ok(adjacentSectorIds(graph, other).includes(ids[i]));
    }
  }
});

test('계약 제안은 더 이상 구역으로 좁혀지지 않는다 — 언제나 유형별 한 장씩 세 장이다', () => {
  for (const seed of SEEDS) {
    const { contracts } = offerContracts(createRngState(seed));
    assert.equal(contracts.length, 3, `시드 ${seed}: 제안은 세 장이다`);
    assert.deepEqual(contracts.map((c) => c.type), ['retrieval', 'destroy', 'intel']);
    // 제안마다 그 계약을 고르면 지어질 네 구역이 함께 적혀 있다(ADR-0089).
    for (const contract of contracts) {
      assert.equal(contract.sectorIds.length, RUN_SECTOR_COUNT, `시드 ${seed}/${contract.id}: 구역 수`);
      assert.equal(contract.sectorIds[0], START_SECTOR_ID);
      assert.ok(contract.sectorIds.includes(contract.sectorId), `시드 ${seed}/${contract.id}: 목표 구역이 빠졌다`);
    }
  }
});

test('수락한 계약의 목표 구역은 반드시 뽑히고, 시작 구역 계약도 4구역을 만든다', () => {
  for (const seed of SEEDS) {
    for (const def of CONTRACT_DEFS) {
      const { sectorIds } = selectRunSectorIds(createRngState(seed), def.sectorId);
      assert.equal(sectorIds.length, RUN_SECTOR_COUNT, `시드 ${seed}/${def.id}: 구역 수`);
      assert.equal(new Set(sectorIds).size, RUN_SECTOR_COUNT, `시드 ${seed}/${def.id}: 중복 없음`);
      assert.equal(sectorIds[0], START_SECTOR_ID);
      assert.ok(sectorIds.includes(def.sectorId), `시드 ${seed}/${def.id}: 목표 구역이 빠졌다`);
      // 링 2번은 power가 뽑혔으면 power, 아니면 목표 구역(시작 구역 계약은 예외).
      if (sectorIds.includes(DEEPEST_SECTOR_ID)) {
        assert.equal(sectorIds[2], DEEPEST_SECTOR_ID);
      } else if (def.sectorId !== START_SECTOR_ID) {
        assert.equal(sectorIds[2], def.sectorId, `시드 ${seed}/${def.id}: 목표는 가장 깊은 자리에 놓인다`);
      }
    }
  }
});

test('제안이 보여준 구역을 ACCEPT_CONTRACT가 옮겨 담고 CONFIRM_LOADOUT이 그대로 짓는다', () => {
  for (const seed of [0, 1, 2, 3, 7, 11, 42]) {
    let s = gameReducer(null, { type: 'NEW_RUN', seed });
    assert.equal(s.runSectorIds, null, '스냅샷의 런 구역은 수락 전까지 비어 있다');
    const offeredSectorIds = s.offeredContracts[0].sectorIds;
    s = gameReducer(s, { type: 'ACCEPT_CONTRACT', contractId: s.offeredContracts[0].id });
    assert.deepEqual(s.runSectorIds, offeredSectorIds, '제안에 적힌 구역이 그대로 런의 구역이 된다');
    assert.ok(s.runSectorIds.includes(s.activeContract.sectorId));
    s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
    const graph = s.facilityRunState.graph;
    assert.deepEqual(graph.sectorIds, s.runSectorIds, `시드 ${seed}: 화면이 고른 구역과 지어진 구역이 같아야 한다`);
    // 계약 목표부가 실제로 맵 위에 있다 — 없으면 수락하는 순간 완수 불가능한 런이 된다.
    assert.ok(graph.landmarks.some((l) => l.sectorId === s.facilityRunState.contract.sectorId));
    // 구역별 상태(경계도·증원 시계)도 뽑힌 구역만 갖는다.
    assert.deepEqual(Object.keys(s.facilityRunState.sectorAlerts).sort(), [...graph.sectorIds].sort());
    assert.deepEqual(Object.keys(s.facilityRunState.reinforcements).sort(), [...graph.sectorIds].sort());
  }
});

test('네 구역짜리 그래프는 어떤 시드에서도 fallback 없이 생성된다', () => {
  for (const seed of SEEDS) {
    const { graph, usedFallback } = generateFacilityGraph(seed);
    assert.equal(usedFallback, false, `시드 ${seed}: fallback 토폴로지로 떨어졌다`);
    assert.equal(graph.sectorIds.length, RUN_SECTOR_COUNT);
    // 배치 원형이 정한 노드 수 + 긴 다리를 쪼개며 끼운 복도 노드(ADR-0097, 런당 0~2개).
    const splitNodes = graph.nodes.filter((n) => n.id.includes('_split')).length;
    assert.equal(graph.nodes.length, totalNodesFor(graph.sectorIds) + splitNodes, `시드 ${seed}: 노드 수`);
    assert.equal(graph.landmarks.length, RUN_SECTOR_COUNT);
    // 탈출구는 표준 A와 열쇠 둘뿐이고(ADR-0083) 서로 다른, 시작 구역이 아닌 구역에 놓인다.
    assert.deepEqual(graph.exits.map((e) => e.exitId), ['A', 'key'], `시드 ${seed}: 출구 목록`);
    const exitSectors = graph.exits.map((e) => e.sectorId);
    assert.equal(new Set(exitSectors).size, 2, `시드 ${seed}: 두 출구는 다른 구역에 있다`);
    for (const sectorId of exitSectors) {
      assert.notEqual(sectorId, START_SECTOR_ID, `시드 ${seed}: 시작 구역에는 출구가 없다`);
      assert.ok(graph.sectorIds.includes(sectorId));
    }
    assert.ok(Number.isFinite(graph.exitPlacement.exitAWalkDistance), `시드 ${seed}: A 거리 기록`);
  }
});
