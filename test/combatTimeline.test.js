import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombatState, beginPlayerFirst, advanceTurn, advanceTurnWithSteps } from '../src/engine/combatEngine.js';
import { gameReducer } from '../src/engine/gameReducer.js';
import { buildCombatTimeline } from '../src/state/combatTimeline.js';
import { MONSTER_DEFINITIONS } from '../src/data/monsters.js';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';

function combat(monsterIds = ['nibbit', 'nibbit']) {
  return beginPlayerFirst(createCombatState({
    deckEntries: Array.from({ length: 10 }, (_, i) => ({ defId: 'katana_slash', instanceId: `card-${i}` })),
    monsterIds, playerHp: 70, playerMaxHp: 70, usableAmmo: 8, maxLoad: 999, overload: 0, overloadFloor: 0,
    overloadGainMultiplier: 1, extraDrawPerTurn: 0, turnStartAoeDamage: 0,
    inventoryItemIdsInOrder: [], inventoryCapacity: 30, rngState: { seed: 1 },
  }));
}

test('advanceTurnWithSteps preserves advanceTurn result and exposes one enemy beat per actor', () => {
  const state = combat();
  const replay = advanceTurnWithSteps(state);
  assert.deepEqual(replay.state, advanceTurn(state));
  assert.equal(replay.steps[0].label, '턴 종료');
  assert.equal(replay.steps.at(-1).label, '새 턴');
  assert.equal(replay.steps.filter((step) => step.actor === 'enemy').length, 2);
});

test('advanceTurnWithSteps matches the synchronous resolver for every monster roster entry', () => {
  for (const monsterId of Object.keys(MONSTER_DEFINITIONS)) {
    const replayed = advanceTurnWithSteps(combat([monsterId])).state;
    const synchronous = advanceTurn(combat([monsterId]));
    // Card instance ids are process-global test fixtures, not game-state semantics.
    const normalize = (value) => JSON.stringify(value).replace(/card-\d+/g, 'card');
    assert.equal(normalize(replayed), normalize(synchronous), monsterId);
  }
});

test('combat timeline keeps intermediate combat snapshots and ends at the reducer snapshot', () => {
  const { graph } = generateFacilityGraph(1);
  const facilityRunState = createRunState(graph, 1);
  const snapshot = {
    currentScreen: 'combat', activeCombatState: combat(), playerState: { loadout: { consumableSlots: [] }, overload: 0 },
    facilityRunState, combatContext: { nodeId: facilityRunState.playerNodeId, ammoAtStart: 8, noiseGauge: 0, noiseIntensity: 0, disengage: { escapeIntent: false, disengageProgress: 0 } },
  };
  const command = { type: 'END_TURN' };
  const timeline = buildCombatTimeline(snapshot, command);
  assert.ok(timeline.length >= 4);
  assert.equal(timeline[0].animation.label, '턴 종료');
  assert.deepEqual(timeline.at(-1).after, gameReducer(snapshot, command));
});

test('advanceTurn은 advanceTurnWithSteps의 얇은 껍데기다 — 구현이 한 벌뿐이다', () => {
  // 적 턴 해결 규칙이 두 벌로 갈라졌던 시절의 회귀 방지(리뷰 A5). 몬스터 전원에 대해 두 경로가
  // 같은 결과를 내는지는 위 테스트가 보고, 여기서는 "껍데기"라는 계약 자체를 못 박는다.
  const state = combat();
  assert.deepEqual(advanceTurn(state), advanceTurnWithSteps(state).state);
  // 적 턴이 아닌 상태(이미 승패가 난 전투)에서는 아무 일도 일어나지 않는다.
  const finished = { ...state, phase: 'victory' };
  assert.equal(advanceTurnWithSteps(finished).steps.length, 1, '턴 종료 프레임 하나만 남는다');
  assert.equal(advanceTurn(finished).phase, 'victory');
});

test('resolveEnemyTurn은 steps 없이 불러도 같은 상태를 낸다', async () => {
  const { resolveEnemyTurn, endPlayerTurn } = await import('../src/engine/combatEngine.js');
  const enemyTurn = endPlayerTurn(combat());
  const steps = [];
  assert.deepEqual(resolveEnemyTurn(enemyTurn), resolveEnemyTurn(enemyTurn, steps));
  assert.ok(steps.length > 0, 'steps를 주면 채워져야 한다');
});
