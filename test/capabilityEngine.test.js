import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCapabilities, effectiveCapabilities, injuryPenalty, maxCapabilities,
} from '../src/engine/capabilityEngine.js';

let seq = 0;
/** @param {string} equipmentId */
function item(equipmentId) { return { id: `i${seq++}`, equipmentId, durability: 10 }; }

/**
 * @param {string[]} weapons @param {string} top @param {string|null} bottom
 * @param {string[]} modules @param {string[]} implantIds
 */
function loadout(weapons, top, bottom, modules, implantIds) {
  return {
    weapons: weapons.map(item), top: top ? item(top) : null, bottom: bottom ? item(bottom) : null,
    modules: modules.map(item), implantIds,
  };
}

// P/S/H/M/F/D 대표 로드아웃 산술을 고정하는 회귀 테스트다.
// 수치의 근거는 src/data/facilityEquipmentCapabilities.js 하나뿐이다 — 무상 보너스 정리(C4)로
// 카타나는 Force만, 전술하의는 Mobility만 주고, 산데비스탄은 Mobility +2의 대가로 Stealth -1이다.
const BASELINES = [
  { id: 'perception_spatial', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_spatial', 'module_neural'], ['implant1', 'implant3']), expect: [2, 1, 0, 1, 1, 0] },
  { id: 'perception_threat', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_spatial', 'module_neural'], ['implant2']), expect: [3, 1, 0, 1, 1, 0] },
  { id: 'stealth_light', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, 1, 0, 2, 2, -1] },
  { id: 'stealth_katana', l: loadout(['katana', 'katana'], 'light_top', 'heavy_bottom', ['module_neural', 'module_neural'], ['implant1', 'implant3']), expect: [0, 1, 0, -1, 3, 0] },
  { id: 'hacking_emp', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_emp', 'module_neural'], ['implant1', 'implant3']), expect: [-1, 1, 2, -1, 2, 1] },
  { id: 'hacking_forcefield', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_forcefield', 'module_neural'], ['implant1', 'implant3']), expect: [0, 1, -1, 1, 1, 0] },
  { id: 'mobility_tactical', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_neural', 'module_neural'], ['implant1', 'implant4']), expect: [0, 1, 0, 2, 1, 0] },
  { id: 'mobility_reaction', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant4']), expect: [0, 1, 0, 3, 2, -1] },
  { id: 'force_heavy_top', l: loadout(['katana', 'katana'], 'heavy_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, -1, 0, 2, 4, -1] },
  { id: 'force_body', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, 1, 0, 0, 3, -1] },
  { id: 'deception_tactical', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_emp', 'module_emp'], ['implant1', 'implant3']), expect: [-2, 1, 4, 1, 1, 2] },
  { id: 'deception_emp', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_emp', 'module_emp'], ['implant1', 'implant3']), expect: [-2, 1, 4, -1, 2, 2] },
];

for (const { id, l, expect } of BASELINES) {
  test(`baseline ${id} matches the spec's P/S/H/M/F/D`, () => {
    const cap = computeCapabilities(l);
    assert.deepEqual(
      [cap.perception, cap.stealth, cap.hacking, cap.mobility, cap.force, cap.deception],
      expect,
    );
  });
}

test('capability values clamp to -2..4 even with extreme loadouts', () => {
  const heavyDeception = loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_emp', 'module_emp'], ['implant1']);
  const cap = computeCapabilities(heavyDeception);
  for (const key of Object.keys(cap)) {
    assert.ok(cap[key] >= -2 && cap[key] <= 4, `${key}=${cap[key]} out of range`);
  }
});

// ---- 부상 페널티 (ADR-0093) ----
//
// 다친 몸으로는 침투가 안 된다. 문턱은 HP 50%·25%이고, 상태를 저장하지 않고 매번 HP에서
// 계산하므로 회복하면 그 자리에서 풀린다. 문턱은 "정확히 그 값"도 포함한다 — 경계값이 어느
// 쪽에 붙는지가 흐릿하면 붕대를 한 장 더 쓸지 말지를 셀 수 없다.
function snapshotWith(hp, maxHp, l, overrideArmed = false) {
  return { facilityRunState: { overrideArmed }, playerState: { hp, maxHp, loadout: l } };
}

test('injuryPenalty는 HP 50%·25%를 경계로 −1·−2를 낸다 (경계값 포함)', () => {
  assert.equal(injuryPenalty(41, 80), 0, '50%를 넘으면 페널티가 없다');
  assert.equal(injuryPenalty(40, 80), 1, '정확히 50%는 −1이다');
  assert.equal(injuryPenalty(21, 80), 1, '25%를 넘고 50% 이하면 −1이다');
  assert.equal(injuryPenalty(20, 80), 2, '정확히 25%는 −2이다');
  assert.equal(injuryPenalty(1, 80), 2);
  assert.equal(injuryPenalty(0, 80), 2);
  assert.equal(injuryPenalty(80, 80), 0);
  assert.equal(injuryPenalty(10, 0), 0, 'maxHp가 0이면 판정할 것이 없다');
});

test('effectiveCapabilities는 장비 합에 부상 페널티를 여섯 값 전부에 적용한 뒤 클램프한다', () => {
  const l = loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_spatial'], ['implant2']);
  const healthy = effectiveCapabilities(snapshotWith(100, 100, l));
  assert.deepEqual(healthy, computeCapabilities(l), '멀쩡하면 장비 합 그대로다');

  const hurt = effectiveCapabilities(snapshotWith(50, 100, l));
  for (const key of Object.keys(healthy)) {
    assert.equal(hurt[key], Math.max(-2, healthy[key] - 1), `${key}: 여섯 값 전부가 −1이고 하한에서 멈춘다`);
  }

  const critical = effectiveCapabilities(snapshotWith(25, 100, l));
  for (const key of Object.keys(healthy)) {
    assert.equal(critical[key], Math.max(-2, healthy[key] - 2), `${key}: 25% 이하는 −2`);
  }
});

test('오버라이드 칩을 쓰는 동안은 부상이 있어도 여섯 값이 상한 그대로다 (ADR-0086)', () => {
  const l = loadout(['katana'], 'light_top', 'tactical_bottom', [], []);
  assert.deepEqual(effectiveCapabilities(snapshotWith(1, 100, l, true)), maxCapabilities());
});

test('회복하면 페널티는 저장되지 않고 그 자리에서 풀린다', () => {
  const l = loadout(['katana'], 'light_top', 'tactical_bottom', [], []);
  const hurt = effectiveCapabilities(snapshotWith(10, 100, l));
  const healed = effectiveCapabilities(snapshotWith(90, 100, l));
  assert.notDeepEqual(hurt, healed);
  assert.deepEqual(healed, computeCapabilities(l));
});
