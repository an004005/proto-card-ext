// 조우 패널의 「지금 할 수 있는 것」 표가 실제로 그려진 버튼과 같은 말을 하는가.
//
// 예전에는 표가 손으로 적혀 있어서 동률에 없는 '교전'을 적고(교전은 강제 전투에만 있다),
// 강제 전투에는 없는 '회피·속이기'를 적었다. 지금은 TIER_BUTTONS 하나가 렌더 분기와 표를
// 함께 먹이므로, 그 둘이 다시 갈라지면 이 테스트가 먼저 깨진다.
//
// MapScreen/CombatScreen 렌더 테스트와 같은 방식으로 붙인다(test/helpers/preactResolve.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateFacilityGraph } from '../src/engine/facilityGraph.js';
import { createRunState } from '../src/engine/runEngine.js';

const projectUrl = (path) => new URL(path, import.meta.url).href;
register(projectUrl('./helpers/preactResolve.mjs'));

const { installMiniDom, makeRoot, queryAll } = await import(projectUrl('./helpers/miniDom.mjs'));
installMiniDom();
const { render, html } = await import(projectUrl('../src/lib.js'));
const { EncounterPanel, encounterAllowanceText } = await import(projectUrl('../src/components/EncounterPanel.js'));

/** 허용 표에 적히는 이름 → 그 버튼에 실제로 적히는 글자. */
const BUTTON_TEXT = { 기습: '기습', 무시: '무시', 회피: '회피', 속이기: '속이기', 교전: '전투' };

const CAPABILITIES = { perception: 2, stealth: 2, hacking: 2, mobility: 2, force: 2, deception: 4 };

function mountPanel(tier) {
  const { graph } = generateFacilityGraph(11);
  const base = createRunState(graph, 11);
  const threat = Object.values(base.threats)[0];
  const run = {
    ...base,
    threats: { ...base.threats, [threat.id]: { ...threat, nodeId: base.playerNodeId } },
    encounter: { threatId: threat.id, nodeId: base.playerNodeId, tier, graceUsed: false },
  };
  const root = makeRoot();
  render(html`<${EncounterPanel} run=${run} capabilities=${CAPABILITIES} />`, root);
  return root;
}

/** 패널 안에서 실제로 누를 수 있는 버튼들만. 잠긴 버튼은 "할 수 있는 것"이 아니다. */
function enabledButtons(root) {
  return queryAll(root, (node) => node.localName === 'button' && node.getAttribute('disabled') === null);
}

for (const tier of ['advantage', 'even', 'disadvantage', 'forced']) {
  test(`조우 패널(${tier}): 허용 표에 적힌 행동이 곧 눌리는 버튼이다`, () => {
    const root = mountPanel(tier);
    const allowed = encounterAllowanceText(tier).allowed;
    const buttons = enabledButtons(root).map((node) => node.textContent);

    for (const [name, text] of Object.entries(BUTTON_TEXT)) {
      const listed = allowed.includes(name);
      const rendered = buttons.some((label) => label.includes(text));
      assert.equal(rendered, listed, listed
        ? `${tier}: 표는 '${name}'을 허용한다고 적는데 그 버튼이 없다`
        : `${tier}: 표에 없는 '${name}' 버튼이 눌리는 채로 그려졌다`);
    }
  });
}

test('우위 허용 표는 요약 한 줄이다 — 그래도 버튼 이름이 전부 적힌다', () => {
  const { allowed } = encounterAllowanceText('advantage');
  assert.equal(allowed, '모든 행동 — 기습·무시·회피·속이기 포함');
});

test('동률에는 교전 버튼이 없다 — 전투는 열세 지속에서만 열린다', () => {
  const buttons = enabledButtons(mountPanel('even')).map((node) => node.textContent);
  assert.ok(!buttons.some((label) => label.includes('전투')), '동률에서 전투 버튼이 눌린다');
  assert.ok(buttons.some((label) => label.includes('회피')), '동률에 회피 버튼이 있어야 한다');
  assert.ok(!encounterAllowanceText('even').allowed.includes('교전'), '동률 허용 표에 교전이 적혀 있다');
});

test('열세 지속에는 회피·속이기가 없다 — 남는 것은 전투뿐이다', () => {
  const buttons = enabledButtons(mountPanel('forced')).map((node) => node.textContent);
  assert.ok(!buttons.some((label) => label.includes('회피')), '강제 전투에서 회피 버튼이 눌린다');
  assert.ok(!buttons.some((label) => label.includes('속이기')), '강제 전투에서 속이기 버튼이 눌린다');
  assert.ok(buttons.some((label) => label.includes('전투')), '강제 전투에 전투 버튼이 있어야 한다');
  const { allowed, blocked } = encounterAllowanceText('forced');
  assert.ok(allowed.includes('교전'), '강제 전투 허용 표에 교전이 없다');
  assert.ok(blocked.includes('회피'), '막힌 것에 회피가 적혀 있어야 한다');
});

test('열세는 버튼 없이 안내문과 재판정 규칙만 적는다', () => {
  const root = mountPanel('disadvantage');
  const { allowed, blocked } = encounterAllowanceText('disadvantage');
  assert.ok(allowed.includes('유료 행동 1회'), '남은 행동권이 적혀 있어야 한다');
  assert.ok(blocked.startsWith('없음'), '열세에서 지금 막힌 행동은 없다 — 다시 판정될 뿐이다');
  assert.ok(root.textContent.includes('지금 할 수 있는 것'), '허용·막힘 목록이 있어야 한다');
});
