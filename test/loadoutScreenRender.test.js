// 출격 준비 화면의 프리셋 줄 — 버튼 넷이 실제로 그려지고, 누르면 그 역할군으로 갈아입는가.
// 그리고 창고에 없는 항목이 있으면 그 사실이 화면에 적히는가(조용히 빠지면 플레이어는 약속된
// Capability와 실제 수치가 왜 다른지 알 수 없다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { gameReducer } from '../src/engine/gameReducer.js';
import { LOADOUT_PRESETS } from '../src/data/loadoutPresets.js';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { installMiniDom, makeRoot, findByText, fire } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { snapshotSignal, historySignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory } = await import(projectUrl('../src/engine/historyEngine.js'));
const { LoadoutScreen } = await import(projectUrl('../src/components/LoadoutScreen.js'));

function startLoadout(seed) {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed });
  return gameReducer(offered, { type: 'ACCEPT_CONTRACT', contractId: offered.offeredContracts[0].id });
}

function mount(snapshot) {
  historySignal.value = createHistory(snapshot);
  snapshotSignal.value = snapshot;
  const root = makeRoot();
  render(html`<${LoadoutScreen} />`, root);
  return root;
}

test('프리셋 줄에 역할군 버튼 넷이 이름과 한 줄 요약과 함께 그려진다', () => {
  const root = mount(startLoadout(5));
  const text = root.textContent;
  assert.ok(text.includes('프리셋'), '프리셋 줄이 없다');
  for (const preset of LOADOUT_PRESETS) {
    assert.ok(findByText(root, 'button', preset.name), `${preset.name} 버튼이 없다`);
    assert.ok(text.includes(preset.summary), `${preset.id}: 한 줄 요약이 없다`);
  }
});

test('버튼을 누르면 그 역할군 구성으로 갈아입는다', () => {
  const root = mount(startLoadout(5));
  const assault = LOADOUT_PRESETS.find((p) => p.id === 'assault');
  assert.equal(fire(findByText(root, 'button', assault.name), 'click'), 1);

  const loadout = snapshotSignal.value.playerState.loadout;
  assert.deepEqual(loadout.weapons.map((w) => w.equipmentId), assault.weapons);
  assert.equal(loadout.top.equipmentId, assault.top);
  assert.deepEqual(loadout.implantIds, assault.implants);
});

test('창고에 없는 항목은 "창고에 없음" 줄로 알린다', () => {
  const start = startLoadout(5);
  const stripped = {
    ...start,
    playerState: {
      ...start.playerState,
      warehouse: { ...start.playerState.warehouse, items: start.playerState.warehouse.items.filter((i) => i.equipmentId !== 'shotgun') },
    },
  };
  const applied = gameReducer(stripped, { type: 'APPLY_LOADOUT_PRESET', presetId: 'assault' });
  const text = mount(applied).textContent;
  assert.ok(text.includes('창고에 없음'), '건너뛴 항목 안내가 없다');
  assert.ok(text.includes('샷건'), '건너뛴 항목의 이름이 id가 아니라 사람 이름으로 나와야 한다');
});
