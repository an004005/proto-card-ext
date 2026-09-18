// 전투 화면 머리 — 맵 시계 옆에 "이 전투에 이미 얼마를 썼나"가 함께 적히는지.
//
// 시계는 남은 칸만 말한다. 몇 라운드를 돌았고 그동안 맵 시간이 얼마나 나갔는지는 따로 적히지
// 않으면 플레이어가 셀 수 없다 — 그 값으로 "지금 빠져나갈까"를 정한다.
//
// MapScreen 렌더 테스트와 같은 방식으로 붙인다(test/helpers/preactResolve.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';
import { startCombat } from '../src/engine/combatReducer.js';
import { COMBAT_ROUND_TIME_COST } from '../src/engine/combatMapIntegration.js';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { installMiniDom, makeRoot } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { snapshotSignal, historySignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory } = await import(projectUrl('../src/engine/historyEngine.js'));
const { CombatScreen, combatTimeSpentText } = await import(projectUrl('../src/components/CombatScreen.js'));

/** 위협 하나와 교전 중인 전투 스냅샷 — 머리 줄만 보기 위한 최소 구성이다. */
function combatSnapshot() {
  const { graph } = generateFacilityGraph(2);
  const run = createRunState(graph, 2);
  const threat = Object.values(run.threats)[0];
  const snapshot = {
    currentScreen: 'map',
    rngState: run.rngState,
    facilityRunState: run,
    playerState: {
      hp: 70, maxHp: 70, overloadActive: false,
      loadout: { consumableSlots: [], weapons: [{ id: 'w1', kind: 'equipment', equipmentId: 'katana', durability: 10 }], modules: [], implants: [] },
      inventory: { items: [], ammo: 8, capacity: 12 }, warehouse: { items: [], ammo: 0, capacity: 99 },
    },
  };
  return startCombat(snapshot, ['nibbit'], undefined, { nodeId: run.playerNodeId, threatId: threat.id, ambush: false });
}

function mountCombat(snapshot) {
  snapshotSignal.value = snapshot;
  historySignal.value = createHistory(snapshot);
  const root = makeRoot();
  render(html`<${CombatScreen} />`, root);
  return root;
}

test('첫 라운드에는 아직 맵 시간이 나가지 않았다', () => {
  assert.equal(combatTimeSpentText(1, COMBAT_ROUND_TIME_COST), '라운드 1 · 이 전투 0칸');
  assert.equal(combatTimeSpentText(3, COMBAT_ROUND_TIME_COST), `라운드 3 · 이 전투 ${2 * COMBAT_ROUND_TIME_COST}칸`);
});

test('전투 머리에 라운드와 이 전투에 쓴 맵 칸이 적힌다', () => {
  const snapshot = combatSnapshot();
  const text = mountCombat(snapshot).textContent;
  assert.ok(text.includes(combatTimeSpentText(snapshot.activeCombatState.turn, COMBAT_ROUND_TIME_COST)), '라운드와 소모 칸이 머리에 보여야 한다');
  assert.ok(text.includes(`전투는 1라운드마다 맵 시간 ${COMBAT_ROUND_TIME_COST}칸이 흐릅니다`), '툴팁이 그 값의 출처를 말해야 한다');
});

test('라운드가 지나면 이 전투에 쓴 칸이 그만큼 늘어난다', () => {
  const snapshot = combatSnapshot();
  const later = { ...snapshot, activeCombatState: { ...snapshot.activeCombatState, turn: 4 } };
  const text = mountCombat(later).textContent;
  assert.ok(text.includes(`라운드 4 · 이 전투 ${3 * COMBAT_ROUND_TIME_COST}칸`), '정산된 라운드 수만큼 칸이 쌓여야 한다');
});
