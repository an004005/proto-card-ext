// Capability + active field-effect contract per equipped item (docs/map-equipment-capability-mapping.md).
// equipmentId must match src/data/equipment.js / modules.js / implants.js exactly — this is the
// single authority for map Capability values; combat card stats are untouched by this file.

/**
 * @typedef {Object} MapEquipmentContract
 * @property {Partial<Record<'perception'|'stealth'|'hacking'|'mobility'|'force'|'deception', number>>} capabilityModifiers
 * @property {null | {
 *   kind: 'temporary_barrier'|'snapshot_scan'|'remote_intrusion',
 *   timeCost: number, overloadGain: number, cooldown: number, duration: number|null,
 *   range: 1|2, targetKind: 'edge'|'node_contents'|'electronic_device',
 * }} fieldAction
 */

/** @type {Object.<string, MapEquipmentContract>} */
export const MAP_EQUIPMENT_CAPABILITIES = {
  katana: { capabilityModifiers: { force: 1, stealth: 1 }, fieldAction: null },
  rifle: { capabilityModifiers: {}, fieldAction: null },
  dagger: { capabilityModifiers: {}, fieldAction: null },
  pistol: { capabilityModifiers: {}, fieldAction: null },
  heavy_top: { capabilityModifiers: { force: 1, stealth: -1 }, fieldAction: null },
  light_top: { capabilityModifiers: { stealth: 1 }, fieldAction: null },
  tactical_bottom: { capabilityModifiers: { mobility: 1, deception: 1 }, fieldAction: null },
  heavy_bottom: { capabilityModifiers: { force: 1, mobility: -1 }, fieldAction: null },
  module_neural: { capabilityModifiers: {}, fieldAction: null },
  module_body: { capabilityModifiers: { force: 1, mobility: 1, deception: -1 }, fieldAction: null },
  module_forcefield: {
    capabilityModifiers: { hacking: -1 },
    fieldAction: {
      kind: 'temporary_barrier', timeCost: 100, overloadGain: 10, cooldown: 300, duration: 200, range: 1, targetKind: 'edge',
    },
  },
  module_spatial: {
    capabilityModifiers: { perception: 2 },
    fieldAction: {
      kind: 'snapshot_scan', timeCost: 100, overloadGain: 8, cooldown: 300, duration: null, range: 2, targetKind: 'node_contents',
    },
  },
  module_emp: {
    capabilityModifiers: { hacking: 2, deception: 1, perception: -1 },
    fieldAction: {
      kind: 'remote_intrusion', timeCost: 100, overloadGain: 12, cooldown: 300, duration: 200, range: 2, targetKind: 'electronic_device',
    },
  },
  implant1: { capabilityModifiers: {}, fieldAction: null },
  implant2: { capabilityModifiers: { perception: 1 }, fieldAction: null },
  implant3: { capabilityModifiers: {}, fieldAction: null },
  implant4: { capabilityModifiers: { mobility: 1 }, fieldAction: null },
  implant5: { capabilityModifiers: {}, fieldAction: null },
  implant6: { capabilityModifiers: {}, fieldAction: null },
};

export const CAPABILITY_MIN = -2;
export const CAPABILITY_MAX = 4;
