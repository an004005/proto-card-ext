import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapabilities } from '../src/engine/capabilityEngine.js';

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
