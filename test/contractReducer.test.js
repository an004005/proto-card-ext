import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer } from '../src/engine/gameReducer.js';
import { offerContracts, computeContractOutcome } from '../src/engine/contractReducer.js';
import { createRngState } from '../src/engine/rng.js';
import { CONTRACT_DEFS } from '../src/data/contracts.js';
import { finishTaskSnapshot } from './helpers/finishTask.js';


/** offerContracts는 [retrieval, destroy, intel] 순서로 유형마다 한 장씩, 여덟 구역 전부에서 뽑는다. */
function startLoadoutWithType(seed, type) {
  const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed }));
  const contract = offered.offeredContracts.find((c) => c.type === type);
  return finishTaskSnapshot(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: contract.id }));
}

test('offerContracts는 여덟 구역 전부에서 유형별 한 장씩, 언제나 세 장을 결정론적으로 뽑는다', () => {
  for (let seed = 0; seed < 30; seed++) {
    const a = offerContracts(createRngState(seed));
    const b = offerContracts(createRngState(seed));
    assert.deepEqual(a.contracts, b.contracts);
    // 제안은 계약 정의에 sectorIds를 얹은 사본이다(ADR-0089) — 정의 자체는 그대로 남는다.
    for (const c of a.contracts) assert.ok(CONTRACT_DEFS.some((def) => def.id === c.id));
    // 구역으로 좁혀지지 않으므로(ADR-0083) 유형별 한 장씩 언제나 세 장이다.
    assert.deepEqual(a.contracts.map((c) => c.type), ['retrieval', 'destroy', 'intel']);
    assert.equal(a.contracts.length, 3, `seed ${seed}: 제안은 언제나 세 장이다`);
  }
});

test('제안마다 그 계약을 고르면 지어질 네 구역이 미리 적혀 있다 (ADR-0089)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed }));
    assert.equal(offered.runSectorIds, null, `seed ${seed}: 수락 전 스냅샷에는 구역이 아직 없다`);
    for (const contract of offered.offeredContracts) {
      const ids = contract.sectorIds;
      assert.equal(ids.length, 4, `seed ${seed}: 제안 ${contract.id}의 구역 수`);
      assert.equal(new Set(ids).size, 4, `seed ${seed}: 중복 없음`);
      assert.equal(ids[0], 'entrance', `seed ${seed}: 시작 구역(입구·관리동)은 링 0번`);
      assert.ok(ids.includes(contract.sectorId), `seed ${seed}: ${contract.id}의 목표 구역이 빠졌다`);
      // 링 2번(시작점 정반대)은 power가 있으면 power, 없으면 목표 구역이다.
      const deep = ids.includes('power') ? 'power' : (contract.sectorId === 'entrance' ? null : contract.sectorId);
      if (deep) assert.equal(ids[2], deep, `seed ${seed}: 링 2번 자리`);
    }
    // 같은 시드면 제안도 구역도 같다 — 세 제안이 한 RNG를 순서대로 진행시켜 굴린 결과다.
    const again = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed }));
    assert.deepEqual(again.offeredContracts.map((c) => c.sectorIds), offered.offeredContracts.map((c) => c.sectorIds));
  }
});

test('수락 뒤 런의 구역은 제안에 적혀 있던 그것이다 — 다시 굴리지 않는다', () => {
  for (let seed = 0; seed < 30; seed++) {
    const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed }));
    for (const contract of offered.offeredContracts) {
      const accepted = finishTaskSnapshot(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: contract.id }));
      assert.deepEqual(accepted.runSectorIds, contract.sectorIds, `seed ${seed}: ${contract.id}의 제안과 런이 어긋났다`);
      // 수락은 RNG를 진행시키지 않는다 — 추첨이 이미 제안 시점에 끝났기 때문이다.
      assert.equal(accepted.rngState, offered.rngState, `seed ${seed}: 수락이 RNG를 건드렸다`);
      // 그리고 실제로 지어지는 시설도 그 목록 그대로다.
      const built = finishTaskSnapshot(gameReducer(accepted, { type: 'CONFIRM_LOADOUT' }));
      assert.deepEqual(built.facilityRunState.graph.sectorIds, contract.sectorIds, `seed ${seed}: 화면이 보여준 구역과 지어진 구역이 다르다`);
    }
  }
});

test('ACCEPT_CONTRACT pays the prepayment currency immediately and moves to the loadout screen', () => {
  const offered = finishTaskSnapshot(gameReducer(null, { type: 'NEW_RUN', seed: 3 }));
  const contract = offered.offeredContracts[0];
  const s = finishTaskSnapshot(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: contract.id }));
  assert.equal(s.currentScreen, 'loadout');
  assert.equal(s.activeContract.id, contract.id);
  assert.equal(s.activeContract.status, 'accepted');
  const currencyItems = s.playerState.inventory.items.filter((i) => i.kind === 'currency');
  assert.equal(currencyItems.length, 1);
  assert.equal(currencyItems[0].value, contract.prepaymentCurrency);
  // 아직 제안 목록에 없는 id로는 수락되지 않는다(no-op).
  assert.equal(finishTaskSnapshot(gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: 'not_offered' })), offered);
});

test('CONFIRM_LOADOUT seeds facilityRunState.contract from the accepted contract and pre-reveals its objective landmark', () => {
  let s = startLoadoutWithType(3, 'destroy');
  const contractId = s.activeContract.id;
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
  const run = s.facilityRunState;
  const landmark = run.graph.landmarks.find((l) => l.sectorId === contract.sectorId);

  // 확보(ACQUIRE_CONTRACT_GOODS)는 Stealth/Mobility 1+가 필요한데 기본 로드아웃은 아무것도
  // 장착하지 않아 둘 다 0이다 — 그 게이팅은 runEngine.test.js에서 이미 확인했으므로, 여기서는
  // 확보 이후 상태(계약 acquired + 물건이 인벤토리에 있는 상태)를 직접 만들어 완료/실패 판정
  // 자체에 집중한다.
  s = {
    ...s,
    // 위협은 비운다 — 여기서 보는 것은 "물건을 들고 나갔는가"이지 도중에 붙잡히는가가 아니다.
    // 구역이 런마다 뽑히므로(ADR-0081) 목표부 옆에 위협이 서 있는 시드가 생긴다.
    facilityRunState: { ...run, playerNodeId: landmark.nodeId, threats: {}, contract: { ...contract, status: 'acquired', acquiredAt: run.time } },
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
  // 아무 통로나 잡으면 안 된다 — 고지대 통로는 Mobility 0으로는 넘지 못하고, 잠긴 특수 통로는
  // 아예 열려 있지 않다. 여기서 보려는 것은 이동 판정이 아니라 탈출 시점의 계약 정산이다.
  const plainEdge = run.graph.edges.find((e) => (e.from === landmark.nodeId || e.to === landmark.nodeId)
    && !(e.features || []).length && !e.lockKind && !e.special);
  const neighborId = plainEdge.from === landmark.nodeId ? plainEdge.to : plainEdge.from;
  const opened = {
    ...s,
    facilityRunState: {
      ...s.facilityRunState,
      exits: { ...s.facilityRunState.exits, A: { ...s.facilityRunState.exits.A, nodeId: neighborId, status: 'open', openEndsAt: s.facilityRunState.time + 1000 } },
    },
  };
  const extracted = finishTaskSnapshot(gameReducer(opened, { type: 'MOVE_TO_NODE', nodeId: neighborId }));
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
  const extractedWithoutGoods = finishTaskSnapshot(gameReducer(discarded, { type: 'MOVE_TO_NODE', nodeId: neighborId }));
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
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  assert.equal(finishTaskSnapshot(gameReducer(planted, { type: 'DETONATE_CONTRACT_CHARGE' })), planted);

  const hops = bfsHopDistances(run.graph.edges, landmark.nodeId);
  const farNodeId = run.graph.nodes.map((n) => n.id).find((id) => (hops.get(id) ?? -1) >= CONTRACT_DETONATE_MIN_HOPS);
  const away = { ...planted, facilityRunState: { ...planted.facilityRunState, playerNodeId: farNodeId } };
  const detonated = finishTaskSnapshot(gameReducer(away, { type: 'DETONATE_CONTRACT_CHARGE' }));
  assert.equal(detonated.facilityRunState.contract.status, 'completed');
  assert.equal(computeContractOutcome(detonated.facilityRunState).scoreDelta, contract.completionRewardValue);
});

// ---- C5: 정보 계약의 송출 지점은 목표부 구역의 이웃 둘뿐 ----

test('정보 송출은 목표부 구역에 인접한 구역의 랜드마크에서만 된다', async () => {
  const { adjacentSectorIds } = await import('../src/engine/facilityGraph.js');

  let s = startLoadoutWithType(3, 'intel');
  const contract = s.activeContract;
  s = finishTaskSnapshot(gameReducer(s, { type: 'CONFIRM_LOADOUT' }));
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
  assert.equal(finishTaskSnapshot(gameReducer(atObjective, { type: 'TRANSMIT_CONTRACT_INTEL' })), atObjective, '목표부 구역은 불가');
  const atFar = atNode(farLandmark.nodeId);
  assert.equal(finishTaskSnapshot(gameReducer(atFar, { type: 'TRANSMIT_CONTRACT_INTEL' })), atFar, '인접하지 않은 구역은 불가');

  const transmitted = finishTaskSnapshot(gameReducer(atNode(adjacentLandmark.nodeId), { type: 'TRANSMIT_CONTRACT_INTEL' }));
  assert.equal(transmitted.facilityRunState.contract.status, 'completed');
  assert.equal(computeContractOutcome(transmitted.facilityRunState).scoreDelta, contract.completionRewardValue);
});
