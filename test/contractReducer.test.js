import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { offerContracts, computeContractOutcome } from '../src/engine/contractReducer.js';
import { createRngState } from '../src/engine/rng.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';

import { selectRunSectorIds } from '../src/engine/facilityGraph.js';

/** offerContracts는 [retrieval, destroy, intel] 순서로, 뽑힌 구역에 있는 유형만 하나씩 뽑는다. */
function startLoadoutWithType(seed, type) {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed });
  const contract = offered.offeredContracts.find((c) => c.type === type);
  return gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: contract.id });
}

test('offerContracts only offers contracts in the run’s own sectors, at most one per type, and is deterministic', () => {
  for (let seed = 0; seed < 30; seed++) {
    const { sectorIds } = selectRunSectorIds(createRngState(seed));
    const a = offerContracts(createRngState(seed), sectorIds);
    const b = offerContracts(createRngState(seed), sectorIds);
    assert.deepEqual(a.contracts, b.contracts);
    // 갈 수 없는 구역의 계약은 제안되지 않는다 — 수락하는 순간 완수 불가능한 계약이 된다.
    for (const c of a.contracts) {
      assert.ok(CONTRACT_DEFS.includes(c));
      assert.ok(sectorIds.includes(c.sectorId), `seed ${seed}: ${c.id}의 구역 ${c.sectorId}은 이 런에 없다`);
    }
    // 유형별 최대 하나. 구역 조합에 그 유형이 없으면 빠지므로 1~3장이다.
    const types = a.contracts.map((c) => c.type);
    assert.deepEqual(types, [...new Set(types)]);
    assert.ok(a.contracts.length >= 1, `seed ${seed}: 제안이 한 장도 없다`);
    assert.ok(a.contracts.length <= 3);
  }
});

test('ACCEPT_CONTRACT pays the prepayment currency immediately and moves to the loadout screen', () => {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed: 3 });
  const contract = offered.offeredContracts[0];
  const s = gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: contract.id });
  assert.equal(s.currentScreen, 'loadout');
  assert.equal(s.activeContract.id, contract.id);
  assert.equal(s.activeContract.status, 'accepted');
  const currencyItems = s.playerState.inventory.items.filter((i) => i.kind === 'currency');
  assert.equal(currencyItems.length, 1);
  assert.equal(currencyItems[0].value, contract.prepaymentCurrency);
  // 아직 제안 목록에 없는 id로는 수락되지 않는다(no-op).
  assert.equal(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: 'not_offered' }), offered);
});

test('CONFIRM_LOADOUT seeds facilityRunState.contract from the accepted contract and pre-reveals its objective landmark', () => {
  let s = startLoadoutWithType(3, 'destroy');
  const contractId = s.activeContract.id;
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  assert.equal(s.facilityRunState.contract.id, contractId);
  assert.equal(s.facilityRunState.contract.status, 'accepted');
  // activeContract는 confirmLoadout 이후 스냅샷에서 지워진다 — facilityRunState.contract가 유일한 소스.
  assert.equal(s.activeContract, null);

  const landmark = s.facilityRunState.graph.landmarks.find((l) => l.sectorId === s.facilityRunState.contract.sectorId);
  assert.ok(s.facilityRunState.observations[landmark.nodeId], '사전 정보로 목표부 랜드마크가 미리 공개돼 있어야 한다');
});

test('a retrieval contract completes only if the player is still carrying the goods when they extract', () => {
  let s = startLoadoutWithType(3, 'retrieval');
  const contract = s.activeContract;
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const landmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);

  // 확보(ACQUIRE_CONTRACT_GOODS)는 Stealth/Mobility 1+가 필요한데 기본 로드아웃은 아무것도
  // 장착하지 않아 둘 다 0이다 — 그 게이팅은 runEngine.test.js에서 이미 확인했으므로, 여기서는
  // 확보 이후 상태(계약 acquired + 물건이 인벤토리에 있는 상태)를 직접 만들어 완료/실패 판정
  // 자체에 집중한다.
  s = {
    ...s,
    facilityRunState: { ...run, playerNodeId: landmark.nodeId, contract: { ...contract, status: 'acquired', acquiredAt: run.time } },
    playerState: {
      ...s.playerState,
      inventory: Array.from({ length: contract.goodsSlots }).reduce(
        (inv) => ({ ...inv, items: [...inv.items, { id: `goods-${inv.items.length}`, kind: 'contractGoods', contractId: contract.id, value: contract.goodsValuePerSlot }] }),
        s.playerState.inventory,
      ),
    },
  };
  const goodsCount = s.playerState.inventory.items.filter((i) => i.kind === 'contractGoods' && i.contractId === contract.id).length;
  assert.equal(goodsCount, contract.goodsSlots);

  // 이웃 노드에 출구를 강제로 열어 두고(다른 탈출 테스트와 같은 패턴) 밟으면 완료된다.
  const neighborId = run.graph.edges.find((e) => e.from === landmark.nodeId)?.to
    || run.graph.edges.find((e) => e.to === landmark.nodeId)?.from;
  const opened = {
    ...s,
    facilityRunState: {
      ...s.facilityRunState,
      exits: { ...s.facilityRunState.exits, A: { ...s.facilityRunState.exits.A, nodeId: neighborId, status: 'open', openEndsAt: s.facilityRunState.time + 1000 } },
    },
  };
  const extracted = gameReducer(opened, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(extracted.currentScreen, 'extractionComplete');
  assert.equal(extracted.facilityRunState.contract.status, 'completed');

  // 반대로 확보한 물건을 전부 버린 뒤 같은 시나리오를 밟으면: 탈출은 성공(생존)하지만 계약은 실패로 남는다.
  const discarded = {
    ...opened,
    playerState: {
      ...opened.playerState,
      inventory: { ...opened.playerState.inventory, items: opened.playerState.inventory.items.filter((i) => i.kind !== 'contractGoods') },
    },
  };
  const extractedWithoutGoods = gameReducer(discarded, { type: 'MOVE_TO_NODE', nodeId: neighborId });
  assert.equal(extractedWithoutGoods.currentScreen, 'extractionComplete', '미완수 탈출도 생존 성공으로 처리한다(불변 핵심 6번)');
  assert.equal(extractedWithoutGoods.facilityRunState.contract.status, 'acquired', '물건 없이 탈출하면 계약은 완료되지 않는다');
});

test('computeContractOutcome gives a positive delta on completion and a negative one (the penalty) otherwise', () => {
  assert.equal(computeContractOutcome(null), null);
  assert.equal(computeContractOutcome({ contract: null }), null);

  const destroyDef = CONTRACT_DEFS.find((c) => c.type === 'destroy');
  const completed = computeContractOutcome({ contract: { ...destroyDef, status: 'completed' } });
  assert.equal(completed.completed, true);
  assert.equal(completed.scoreDelta, destroyDef.completionRewardValue);

  const failed = computeContractOutcome({ contract: { ...destroyDef, status: 'accepted' } });
  assert.equal(failed.completed, false);
  assert.equal(failed.scoreDelta, -destroyDef.penaltyValue);
});

// ---- C5: 파괴 계약의 마지막 장 ----

test('파괴 계약은 설치 뒤 목표부에서 떨어진 자리에서 기폭해야 완료된다', async () => {
  const { bfsHopDistances } = await import('../src/engine/graphUtils.js');
  const { CONTRACT_DETONATE_MIN_HOPS } = await import('../src/data/facilityLayout.js');

  let s = startLoadoutWithType(3, 'destroy');
  const contract = s.activeContract;
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const landmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);

  // 설치 이후 상태를 직접 세운다 — Force 게이팅 자체는 runEngine.test.js가 본다.
  const planted = {
    ...s,
    facilityRunState: {
      ...run, playerNodeId: landmark.nodeId,
      contract: { ...contract, status: 'acquired', acquiredAt: run.time },
      lockdown: { startedAt: run.time },
    },
  };

  // 목표부에 서 있는 채로 누르면 아무 일도 일어나지 않는다(리듀서는 항상 total function).
  assert.equal(gameReducer(planted, { type: 'DETONATE_CONTRACT_CHARGE' }), planted);

  const hops = bfsHopDistances(run.graph.edges, landmark.nodeId);
  const farNodeId = run.graph.nodes.map((n) => n.id).find((id) => (hops.get(id) ?? -1) >= CONTRACT_DETONATE_MIN_HOPS);
  const away = { ...planted, facilityRunState: { ...planted.facilityRunState, playerNodeId: farNodeId } };
  const detonated = gameReducer(away, { type: 'DETONATE_CONTRACT_CHARGE' });
  assert.equal(detonated.facilityRunState.contract.status, 'completed');
  assert.equal(computeContractOutcome(detonated.facilityRunState).scoreDelta, contract.completionRewardValue);
});

// ---- C5: 정보 계약의 송출 지점은 목표부 구역의 이웃 둘뿐 ----

test('정보 송출은 목표부 구역에 인접한 구역의 랜드마크에서만 된다', async () => {
  const { adjacentSectorIds } = await import('../src/engine/facilityGraph.js');

  let s = startLoadoutWithType(3, 'intel');
  const contract = s.activeContract;
  s = gameReducer(s, { type: 'CONFIRM_LOADOUT' });
  const run = s.facilityRunState;
  const adjacentIds = adjacentSectorIds(run.graph, contract.sectorId);
  const objectiveLandmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);
  const adjacentLandmark = run.graph.landmarks.find((l) => adjacentIds.includes(l.sectorId));
  const farLandmark = run.graph.landmarks.find((l) => l.sectorId !== contract.sectorId && !adjacentIds.includes(l.sectorId));
  assert.ok(objectiveLandmark && adjacentLandmark && farLandmark);

  // 확보 이후 상태를 직접 세운다 — Hacking 게이팅 자체는 runEngine.test.js가 본다.
  // 위협은 비운다 — 여기서 보는 것은 "어디서 송출할 수 있는가"이지 작업이 중단되는가가
  // 아니다. 구역이 런마다 뽑히면서(ADR-0081) 이웃 랜드마크 옆에 위협이 서 있는 시드가 생겨
  // 송출 작업이 중단되곤 했다.
  const atNode = (nodeId) => ({
    ...s,
    facilityRunState: {
      ...run, playerNodeId: nodeId, threats: {},
      contract: { ...contract, status: 'acquired', acquiredAt: run.time },
      lockdown: { startedAt: run.time },
    },
  });

  // 리듀서는 total function이라 불가능한 자리에서는 상태가 그대로다.
  const atObjective = atNode(objectiveLandmark.nodeId);
  assert.equal(gameReducer(atObjective, { type: 'TRANSMIT_CONTRACT_INTEL' }), atObjective, '목표부 구역은 불가');
  const atFar = atNode(farLandmark.nodeId);
  assert.equal(gameReducer(atFar, { type: 'TRANSMIT_CONTRACT_INTEL' }), atFar, '인접하지 않은 구역은 불가');

  const transmitted = gameReducer(atNode(adjacentLandmark.nodeId), { type: 'TRANSMIT_CONTRACT_INTEL' });
  assert.equal(transmitted.facilityRunState.contract.status, 'completed');
  assert.equal(computeContractOutcome(transmitted.facilityRunState).scoreDelta, contract.completionRewardValue);
});
