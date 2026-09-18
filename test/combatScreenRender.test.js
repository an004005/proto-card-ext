// 전투 화면이 실제로 그려지는지 — 그리고 플레이어가 무엇을 볼 수 있어야 하는지.
//
// 시계는 남은 칸만 말한다. 몇 라운드를 돌았고 그동안 맵 시간이 얼마나 나갔는지는 따로 적히지
// 않으면 플레이어가 셀 수 없다 — 그 값으로 "지금 빠져나갈까"를 정한다.
//
// 화면 자체도 배치를 바꿀 때마다 "인텐트 글자가 아직 읽히는가", "디버그 상자가 기본으로 열려
// 있지는 않은가"가 조용히 깨지므로, 진짜 전투 스냅샷 하나를 세워 그대로 눌러 본다.
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

const { installMiniDom, makeRoot, findByText, queryAll, fire } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { snapshotSignal, historySignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory } = await import(projectUrl('../src/engine/historyEngine.js'));
const { CombatScreen, combatTimeSpentText } = await import(projectUrl('../src/components/CombatScreen.js'));
const { describeIntent, badgeLabel } = await import(projectUrl('../src/components/IntentIcon.js'));

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

test('전투 화면이 제목·손패·턴 종료와 함께 그려진다', () => {
  const text = mountCombat(combatSnapshot()).textContent;
  assert.ok(text.includes('전투 —'), '전투 제목이 보여야 한다');
  assert.ok(text.includes('턴 종료'), '턴 종료 버튼이 있어야 한다');
});

test('적 인텐트는 삼각형이 아니라 글자가 붙은 배지로 보인다', () => {
  const snapshot = combatSnapshot();
  const root = mountCombat(snapshot);
  const combat = snapshot.activeCombatState;
  const enemy = combat.enemies.find((e) => e.hp > 0 && e.intent);
  assert.ok(enemy, '인텐트를 가진 적이 있어야 한다');

  // 화면에 적히는 글자는 describeIntent의 툴팁에서 잘라 쓴다 — 표가 한 벌뿐인지 여기서 본다.
  const { tooltip, isAttack } = describeIntent(enemy.intent, enemy.statuses, !!combat.player.statuses.vulnerable);
  const label = badgeLabel(tooltip);
  assert.ok(label.length > 0, '인텐트 배지에 적을 글자가 있어야 한다');
  assert.ok(root.textContent.includes(label), `인텐트 배지 '${label}'가 화면에 없다`);
  if (isAttack) assert.ok(label.startsWith('공격 '), '공격 인텐트는 "공격 N"으로 적힌다');

  // 아이콘은 20px 선 아이콘이다 — 예전 CSS 삼각형과 달리 svg로 그려진다.
  const icons = queryAll(root, (node) => node.localName === 'svg' && node.getAttribute('width') === '20');
  assert.ok(icons.length > 0, '인텐트 아이콘(svg)이 그려져야 한다');
});

test('디버그 상자는 기본으로 닫혀 있고 DEBUG 토글로만 열린다', async () => {
  const root = mountCombat(combatSnapshot());
  assert.ok(!root.textContent.includes('DEBUG 즉시 승리'), '디버그 상자가 처음부터 열려 있다');

  const toggle = queryAll(root, (node) => node.localName === 'button' && node.textContent.trim() === 'DEBUG')[0];
  assert.ok(toggle, '헤더에 DEBUG 토글 버튼이 있어야 한다');
  fire(toggle, 'click');
  await new Promise((resolve) => { setTimeout(resolve, 0); }); // preact의 재렌더는 마이크로태스크 뒤에 온다

  assert.ok(root.textContent.includes('DEBUG 즉시 승리'), 'DEBUG를 눌러도 디버그 상자가 열리지 않았다');
  assert.ok(findByText(root, 'button', 'Undo'), '디버그 상자 안에 히스토리 조작이 있어야 한다');
});
