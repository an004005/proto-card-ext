import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapabilities } from '../src/engine/capabilityEngine.js';
import { computeFloorOverload } from '../src/engine/equipmentEngine.js';

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

// Cross-checked by hand against docs/extraction-map-implementation-spec.md §12.2's baseline
// table (P/S/H/M/F/D + floor) during doc review — this locks that table's arithmetic in as a
// regression test now that the aggregation code actually exists.
const BASELINES = [
  { id: 'perception_spatial', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_spatial', 'module_neural'], ['implant1', 'implant3']), expect: [2, 2, 0, 1, 1, 1], floor: 15 },
  { id: 'perception_threat', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_spatial', 'module_neural'], ['implant2']), expect: [3, 2, 0, 1, 1, 1], floor: 20 },
  { id: 'stealth_light', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, 2, 0, 2, 2, 0], floor: 15 },
  { id: 'stealth_katana', l: loadout(['katana', 'katana'], 'light_top', 'heavy_bottom', ['module_neural', 'module_neural'], ['implant1', 'implant3']), expect: [0, 3, 0, -1, 3, 0], floor: 15 },
  { id: 'hacking_emp', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_emp', 'module_neural'], ['implant1', 'implant3']), expect: [-1, 2, 2, -1, 2, 1], floor: 15 },
  { id: 'hacking_forcefield', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_forcefield', 'module_neural'], ['implant1', 'implant3']), expect: [0, 2, -1, 1, 1, 1], floor: 15 },
  { id: 'mobility_tactical', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_neural', 'module_neural'], ['implant1', 'implant4']), expect: [0, 2, 0, 2, 1, 1], floor: 30 },
  { id: 'mobility_reaction', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant4']), expect: [0, 2, 0, 3, 2, 0], floor: 20 },
  { id: 'force_heavy_top', l: loadout(['katana', 'katana'], 'heavy_top', 'tactical_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, 1, 0, 2, 4, 0], floor: 15 },
  { id: 'force_body', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_body', 'module_neural'], ['implant1', 'implant3']), expect: [0, 2, 0, 0, 3, -1], floor: 15 },
  { id: 'deception_tactical', l: loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_emp', 'module_emp'], ['implant1', 'implant3']), expect: [-2, 2, 4, 1, 1, 3], floor: 15 },
  { id: 'deception_emp', l: loadout(['katana', 'rifle'], 'light_top', 'heavy_bottom', ['module_emp', 'module_emp'], ['implant1', 'implant3']), expect: [-2, 2, 4, -1, 2, 2], floor: 15 },
];

for (const { id, l, expect, floor } of BASELINES) {
  test(`baseline ${id} matches the spec's P/S/H/M/F/D and Overload floor`, () => {
    const cap = computeCapabilities(l);
    assert.deepEqual(
      [cap.perception, cap.stealth, cap.hacking, cap.mobility, cap.force, cap.deception],
      expect,
    );
    assert.equal(computeFloorOverload(l), floor);
  });
}

test('capability values clamp to -2..4 even with extreme loadouts', () => {
  const heavyDeception = loadout(['katana', 'rifle'], 'light_top', 'tactical_bottom', ['module_emp', 'module_emp'], ['implant1']);
  const cap = computeCapabilities(heavyDeception);
  for (const key of Object.keys(cap)) {
    assert.ok(cap[key] >= -2 && cap[key] <= 4, `${key}=${cap[key]} out of range`);
  }
});
