// §5단계 파밍 두 등급(D10)과 역할축 3중 1택(D11). 검증 질문이 "무엇을 포기할지 고민하게
// 되는가"이므로, 확보 대상이 (1) 더 비싸고 (2) 즉시 들어오지 않고 (3) 고른 하나만 들어오는지를
// 본다. 보급품은 예전 동작 그대로여야 한다(회귀).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState, useOpportunity } from '../src/engine/runEngine.js';
import {
  SUPPLY_FARM_TIME, PRIZE_FARM_TIME, SUPPLY_FARM_NOISE, PRIZE_FARM_NOISE,
} from '../src/data/facilityLayout.js';
import { MAX_DURABILITY } from '../src/engine/equipmentEngine.js';
import { finishTask, finishTaskSnapshot } from './helpers/finishTask.js';

function makeRun(seed = 1) {
  const { graph } = generateFacilityGraph(seed);
  return createRunState(graph, seed);
}

/** 플레이어가 선 노드에 원하는 등급의 기회 하나만 놓는다 — 배치 확률에 의존하지 않기 위해서다. */
function withOpportunityHere(state, extra) {
  const opportunity = {
    id: 'opp_test', nodeId: state.playerNodeId, keyEligible: false, usesRemaining: 1, grade: 'supply', ...extra,
  };
  return { ...state, graph: { ...state.graph, opportunities: [opportunity] } };
}

function snapshotOf(run) {
  return {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: { hp: 50, maxHp: 50, overloadActive: false, loadout: {}, inventory: { items: [], ammo: 0, capacity: 12 } },
  };
}

test('a supply opportunity is cheap and grants immediately; a prize costs more and grants nothing yet', () => {
  const base = makeRun(1);
  const supply = finishTask(useOpportunity(withOpportunityHere(base, {}), 'opp_test', 'normal').state);
  assert.equal(supply.time - base.time, SUPPLY_FARM_TIME);
  assert.equal(supply.pendingFarmChoice, null, '보급품은 고를 것이 없다');

  const prize = finishTask(useOpportunity(withOpportunityHere(base, { grade: 'prize', tier: 'elite', axis: 'combat' }), 'opp_test', 'normal').state);
  assert.equal(prize.time - base.time, PRIZE_FARM_TIME.elite);
  assert.ok(PRIZE_FARM_TIME.elite > PRIZE_FARM_TIME.normal, '등급이 높을수록 오래 걸린다');
  assert.ok(PRIZE_FARM_NOISE.normal > SUPPLY_FARM_NOISE, '확보 대상은 보급품보다 시끄럽다');
  assert.ok(prize.pendingFarmChoice, '확보 대상은 고를 후보를 세운다');
  assert.equal(prize.pendingFarmChoice.axis, 'combat', '후보의 축은 그 자리의 축이다');
});

test('prize options are deterministic for the same seed and never fewer than one', () => {
  const a = finishTask(useOpportunity(withOpportunityHere(makeRun(7), { grade: 'prize', tier: 'normal', axis: 'infiltration' }), 'opp_test', 'normal').state);
  const b = finishTask(useOpportunity(withOpportunityHere(makeRun(7), { grade: 'prize', tier: 'normal', axis: 'infiltration' }), 'opp_test', 'normal').state);
  assert.deepEqual(a.pendingFarmChoice.options, b.pendingFarmChoice.options);
  assert.ok(a.pendingFarmChoice.options.length >= 1);
  const keys = a.pendingFarmChoice.options.map((o) => JSON.stringify(o));
  assert.equal(new Set(keys).size, keys.length, '같은 후보가 두 번 나오지 않는다');
});

test('nothing enters the inventory until a prize option is selected, and only the chosen one does', () => {
  const run = withOpportunityHere(makeRun(3), { grade: 'prize', tier: 'elite', axis: 'resource' });
  const farmed = finishTaskSnapshot(gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'opp_test', mode: 'normal' }));
  assert.ok(farmed.facilityRunState.pendingFarmChoice, '후보가 서 있다');
  assert.equal(farmed.playerState.inventory.items.length, 0, '고르기 전에는 아무것도 들어오지 않는다');
  assert.equal(farmed.playerState.inventory.ammo, 0);

  const options = farmed.facilityRunState.pendingFarmChoice.options;
  const picked = finishTaskSnapshot(gameReducer(farmed, { type: 'SELECT_FARM_REWARD', optionIndex: 0 }));
  assert.equal(picked.facilityRunState.pendingFarmChoice, null, '고르면 대기가 끝난다');
  const gained = picked.playerState.inventory.items.length + (picked.playerState.inventory.ammo > 0 ? 1 : 0);
  assert.equal(gained, 1, '고른 하나만 들어온다');
  assert.notEqual(options.length, 0);

  // 이미 고른 뒤에는 같은 커맨드가 아무 일도 하지 않는다 — 후보를 여러 번 챙길 수 없다.
  assert.equal(finishTaskSnapshot(gameReducer(picked, { type: 'SELECT_FARM_REWARD', optionIndex: 1 })), picked);
});

test('elite prize equipment arrives new; normal prize equipment arrives used', () => {
  // 등급이 비용만 크고 받는 것이 같으면 elite는 순수 손해가 된다 — 내구도로 값을 치른다.
  function durabilityOfFirstEquipment(seed, tier) {
    const run = withOpportunityHere(makeRun(seed), { grade: 'prize', tier, axis: 'combat' });
    const farmed = finishTaskSnapshot(gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'opp_test', mode: 'normal' }));
    const index = farmed.facilityRunState.pendingFarmChoice.options.findIndex((o) => o.kind === 'equipment');
    if (index < 0) return null;
    const picked = finishTaskSnapshot(gameReducer(farmed, { type: 'SELECT_FARM_REWARD', optionIndex: index }));
    return picked.playerState.inventory.items.find((i) => i.kind === 'equipment').durability;
  }

  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const elite = durabilityOfFirstEquipment(seed, 'elite');
    if (elite === null) continue;
    assert.equal(elite, MAX_DURABILITY, 'elite 장비는 새것으로 들어온다');
    const normal = durabilityOfFirstEquipment(seed, 'normal');
    assert.ok(normal < MAX_DURABILITY, 'normal 장비는 쓰던 것으로 들어온다');
    checked += 1;
  }
  assert.ok(checked > 0, '장비 후보가 한 번도 안 나왔다면 이 테스트가 아무것도 확인하지 못한 것이다');
});

test('leaving the node discards an unselected prize choice', () => {
  const run = withOpportunityHere(makeRun(5), { grade: 'prize', tier: 'normal', axis: 'combat' });
  const farmed = finishTaskSnapshot(gameReducer(snapshotOf(run), { type: 'USE_OPPORTUNITY', opportunityId: 'opp_test', mode: 'normal' }));
  assert.ok(farmed.facilityRunState.pendingFarmChoice);

  const here = farmed.facilityRunState.playerNodeId;
  const edge = farmed.facilityRunState.graph.edges.find((e) => e.from === here || e.to === here);
  const neighborId = edge.from === here ? edge.to : edge.from;
  const moved = finishTaskSnapshot(gameReducer(farmed, { type: 'MOVE_TO_NODE', nodeId: neighborId }));
  assert.notEqual(moved, farmed, '이동이 실제로 일어나야 이 테스트가 의미를 갖는다');
  assert.equal(moved.facilityRunState.pendingFarmChoice, null, '자리를 뜨면 후보는 사라진다');
  assert.equal(moved.playerState.inventory.items.length, 0);
});
