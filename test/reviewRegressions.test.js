// 코드 리뷰에서 확인된 결함들의 회귀 테스트. 전부 "순수 계산과 상태 반영 사이의 접합부"에서
// 나온 것이라, 계산 모듈만 보는 기존 테스트로는 잡히지 않았다 — 여기서는 반드시 커맨드(리듀서)
// 경로나 실제 틱 진행을 거쳐서 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, advanceTime, useOpportunity } from '../src/engine/runEngine.js';
import { broadcastFalseTarget } from '../src/engine/recovery.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { ADJACENT_SECTOR_IDS, WORLD_TICK_INTERVAL } from '../src/data/facilityLayout.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

function snapshotOf(run, playerState = {}) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 50, maxHp: 50, overload: 0, loadout: {}, inventory: { items: [], ammo: 0, capacity: 12 }, ...playerState,
    },
  };
}

test('a retrieval contract is not completed by acting at the objective — only by reaching an open exit', () => {
  const base = makeRun(7);
  const contract = CONTRACT_DEFS.find((c) => c.type === 'retrieval');
  const landmark = base.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const goods = Array.from({ length: contract.goodsSlots }, (_, i) => ({
    id: `g${i}`, kind: 'contractGoods', contractId: contract.id, value: contract.goodsValuePerSlot,
  }));
  const run = {
    ...base,
    playerNodeId: landmark.nodeId,
    contract: { ...contract, status: 'acquired', acquiredAt: base.time },
  };
  const held = snapshotOf(run, { inventory: { items: goods, ammo: 0, capacity: 12 } });

  // 물건을 들고 목표부에 서서 아무 행동이나 해도 계약은 완료되지 않는다 — 들고 나가야 한다.
  const after = gameReducer(held, { type: 'BASIC_RECON' });
  assert.equal(after.facilityRunState.contract.status, 'acquired', '목표부에서 정찰만으로 계약이 끝나면 마지막 장이 사라진다');
  assert.equal(after.currentScreen, 'map');

  // 출구를 밟는 순간에만 완료된다.
  const edge = base.graph.edges.find((e) => e.from === landmark.nodeId || e.to === landmark.nodeId);
  const neighborId = edge.from === landmark.nodeId ? edge.to : edge.from;
  const opened = {
    ...after,
    facilityRunState: {
      ...after.facilityRunState,
      exits: { ...after.facilityRunState.exits, A: { ...after.facilityRunState.exits.A, nodeId: neighborId, status: 'open', openEndsAt: after.facilityRunState.time + 1000 } },
    },
  };
  const extracted = gameReducer(opened, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(extracted.currentScreen, 'extractionComplete');
  assert.equal(extracted.facilityRunState.contract.status, 'completed');
});

test('a discovery is reported to the sector it happened in, not to the finder’s home sector', () => {
  const base = makeRun(1);
  // 본적이 다른 구역인 위협을 데려와, 남의 구역 노드에 있는 시체를 밟게 한다.
  const visitor = Object.values(base.threats).find((t) => t.sectorId !== 'labs');
  assert.ok(visitor, 'fixture should contain a threat from another sector');
  const labsNodes = base.graph.nodes.filter((n) => n.sectorId === 'labs').slice(0, 2);
  const to = labsNodes[1] || labsNodes[0];

  const state = {
    ...base,
    playerNodeId: null,
    corpses: [{ id: 'c1', nodeId: to.id, sectorId: 'labs', createdAt: 0 }],
    threats: {
      ...base.threats,
      // 순찰 목표를 자기가 선 자리로 두면 다음 틱에 그 자리를 다시 '밟아' 발견 판정이 돈다
      // (reinforcement.test.js와 같은 방식).
      [visitor.id]: { ...visitor, nodeId: to.id, patrolRoute: [to.id], patrolIndex: 0, nextMoveAt: base.time, mode: 'patrol' },
    },
  };
  const after = advanceTime(state, state.time + WORLD_TICK_INTERVAL);

  assert.equal(after.corpses.length, 0, '시체는 신고되어 사라진다');
  assert.equal(after.sectorAlerts.labs.level, 1, '시체가 있던 구역의 경계도가 오른다');
  assert.equal(after.sectorAlerts[visitor.sectorId].level, 0, '발견자의 본적 구역은 오르지 않는다');
  // 이중계산 방지 등록도 같은 구역에 들어가야 한다 — 그러지 않으면 조사하러 온 위협이 허탕치며
  // 한 번 더 올려 시체 하나가 두 단계를 만든다.
  const investigation = after.noiseEvents[after.noiseEvents.length - 1];
  assert.ok(after.sectorAlerts.labs.resolvedEventIds.includes(investigation.id), '조사 소음은 그 구역에서 이미 처리된 것으로 등록된다');
});

test('a false broadcast cannot dump alert into a sector that is already at maximum', () => {
  const base = makeRun(1);
  const entry = base.graph.accessInterfaces[0];
  const sectorId = entry.nodeId.split('_')[0];
  const neighborId = ADJACENT_SECTOR_IDS[sectorId][0];
  const state = {
    ...base,
    playerNodeId: entry.nodeId,
    sectorAlerts: {
      ...base.sectorAlerts,
      [sectorId]: { level: 3, resolvedEventIds: [] },
      [neighborId]: { level: 3, resolvedEventIds: [] },
    },
  };
  // 상한에 찬 곳으로 넘기면 +1이 잘려 사라진다 — 옮기는 수단이 지우는 수단이 되므로 막는다.
  assert.throws(() => broadcastFalseTarget(state, 3, neighborId), /maximum/);
  assert.equal(state.sectorAlerts[sectorId].level, 3, '실패한 시도는 아무것도 바꾸지 않는다');
});

test('an ambushed prize grants nothing — the ambush is the cost of rushing it', () => {
  const base = makeRun(3);
  const nodeId = base.playerNodeId;
  const threat = Object.values(base.threats)[0];
  const run = {
    ...base,
    graph: { ...base.graph, opportunities: [{ id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'combat' }] },
    // 같은 노드에 위협을 세워 파밍 도중 매복이 열리게 한다.
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId, nextMoveAt: base.time } },
  };
  const after = gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'p1', mode: 'rush' });

  assert.equal(after.playerState.inventory.items.length, 0, '매복당한 확보 대상이 보급품 보상으로 새면 안 된다');
  assert.equal(after.playerState.inventory.ammo, 0);
  assert.equal(after.facilityRunState.pendingFarmChoice, null, '고를 틈도 없다');
});

test('a supply farm still grants while a prize choice is pending — and a second prize cannot overwrite the standing options', () => {
  const base = makeRun(3);
  const nodeId = base.playerNodeId;
  const run = {
    ...base,
    graph: {
      ...base.graph,
      opportunities: [
        { id: 'p1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'normal', axis: 'resource' },
        { id: 'p2', nodeId, keyEligible: false, usesRemaining: 1, grade: 'prize', tier: 'elite', axis: 'combat' },
        { id: 's1', nodeId, keyEligible: false, usesRemaining: 1, grade: 'supply' },
      ],
    },
  };
  const farmed = gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'p1', mode: 'normal' });
  const standing = farmed.facilityRunState.pendingFarmChoice;
  assert.ok(standing, '확보 대상 후보가 서 있다');

  // 선택이 대기 중이어도 보급품은 예전처럼 바로 들어와야 한다.
  const supplied = gameReducer(farmed, { type: 'USE_OPPORTUNITY', opportunityId: 's1', mode: 'normal' });
  const gained = supplied.playerState.inventory.items.length + (supplied.playerState.inventory.ammo > 0 ? 1 : 0);
  assert.equal(gained, 1, '보급품은 대기 중인 선택과 무관하게 지급된다');
  assert.deepEqual(supplied.facilityRunState.pendingFarmChoice, standing, '그리고 서 있던 후보를 건드리지 않는다');

  // 반대로 두 번째 확보 대상은 시작조차 되지 않는다 — 허용하면 앞선 후보가 조용히 덮인다.
  const blocked = gameReducer(supplied, { type: 'USE_OPPORTUNITY', opportunityId: 'p2', mode: 'normal' });
  assert.equal(blocked, supplied, '고르기 전에는 다른 확보 대상을 팔 수 없다');
  assert.throws(() => useOpportunity(supplied.facilityRunState, 'p2', 'normal'), /pending farm reward/);
});

test('equipment broken by a ladder cost falls back into the inventory instead of vanishing', () => {
  const base = makeRun(1);
  const weapon = { id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 1 };
  const snapshot = snapshotOf(
    { ...base, pendingDurabilityLoss: 1 },
    { loadout: { weapons: [weapon], top: null, bottom: null, modules: [], implantIds: [], consumableSlots: [] } },
  );
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });

  assert.equal(after.playerState.loadout.weapons.length, 0, '파손된 장비는 슬롯에서 빠진다');
  const returned = after.playerState.inventory.items.find((i) => i.id === 'w1');
  assert.ok(returned, '하지만 게임에서 사라지지는 않는다');
  assert.equal(returned.durability, 0);
  assert.equal(after.facilityRunState.pendingDurabilityLoss, 0);
});

test('HP reaching zero from a ladder cost ends the run', () => {
  const base = makeRun(1);
  const snapshot = snapshotOf({ ...base, pendingHpLoss: 8 }, { hp: 5 });
  const after = gameReducer(snapshot, { type: 'BASIC_RECON' });
  assert.equal(after.playerState.hp, 0);
  assert.equal(after.currentScreen, 'gameOver', 'HP 0으로 런이 계속되면 안 된다');
});

test('expired power cuts are pruned instead of accumulating for the whole run', () => {
  const base = makeRun(1);
  const state = { ...base, powerCuts: [{ sectorId: 'labs', expiresAt: 100 }, { sectorId: 'entrance', expiresAt: 99999 }] };
  const after = advanceTime(state, 400);
  assert.deepEqual(after.powerCuts.map((c) => c.sectorId), ['entrance']);
});
