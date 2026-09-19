// 계약 화면이 "이번 시설"을 실제로 그리는가 — 구역 추첨이 제안 시점으로 옮겨진 뒤(ADR-0089)
// 이 줄이 계약 선택의 절반이다. 네 구역 이름과 시작·목표·가장 깊음 표시가 링 순서대로 보여야
// 플레이어가 "목표까지 얼마나 들어가야 하는가"를 수락 전에 읽을 수 있다.
//
// MapScreen/CombatScreen 렌더 테스트와 같은 방식으로 붙인다(test/helpers/preactResolve.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { gameReducer } from '../src/engine/gameReducer.js';
import { SECTOR_NAMES } from '../src/data/facilityLayout.js';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { installMiniDom, makeRoot, findByText, fire } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { snapshotSignal, historySignal } = await import(projectUrl('../src/state/runState.js'));
const { createHistory } = await import(projectUrl('../src/engine/historyEngine.js'));
const { ContractScreen } = await import(projectUrl('../src/components/ContractScreen.js'));

function mount(snapshot) {
  historySignal.value = createHistory(snapshot);
  snapshotSignal.value = snapshot;
  const root = makeRoot();
  render(html`<${ContractScreen} />`, root);
  return root;
}

test('계약 카드마다 "이번 시설" 줄에 네 구역이 링 순서로 적힌다', () => {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed: 11 });
  const root = mount(offered);
  const text = root.textContent;

  assert.ok(text.includes('이번 시설'), '"이번 시설" 줄이 없다');
  for (const contract of offered.offeredContracts) {
    for (const sectorId of contract.sectorIds) {
      assert.ok(text.includes(SECTOR_NAMES[sectorId]), `${SECTOR_NAMES[sectorId]}가 화면에 없다`);
    }
    assert.ok(text.includes(SECTOR_NAMES[contract.sectorId]), '목표 구역 이름이 없다');
  }
  // 시작·목표·가장 깊음 세 표시가 모두 붙는다. 셋이 같은 구역에 겹치는 일은 없다(시작 구역은
  // 링 0번이고 가장 깊은 자리는 링 2번이다).
  assert.ok(text.includes('(시작)'), '시작 구역 표시가 없다');
  // 계약 설명 어딘가의 '목표'가 아니라 구역 줄에 붙는 태그여야 한다 — 목표 구역이 가장 깊은
  // 자리를 겸하면 한 괄호에 둘이 함께 들어간다.
  assert.match(text, /\(목표[)·]/, '목표 구역 태그가 없다');
  assert.ok(text.includes('가장 깊음'), '가장 깊은 자리 표시가 없다');
});

test('계약을 수락하면 화면이 보여준 구역이 그대로 런의 구역이 된다', () => {
  const offered = gameReducer(null, { type: 'NEW_RUN', seed: 11 });
  const root = mount(offered);
  const button = findByText(root, 'button', '이 계약 수락');
  assert.ok(button, '수락 버튼이 없다');

  let dispatched = null;
  // 첫 카드의 수락 버튼을 실제로 눌러 본다 — 화면이 부르는 커맨드가 곧 이 규칙의 마지막 고리다.
  const fired = fire(button, 'click');
  assert.equal(fired, 1);
  dispatched = snapshotSignal.value;
  assert.deepEqual(dispatched.runSectorIds, offered.offeredContracts[0].sectorIds);
});
