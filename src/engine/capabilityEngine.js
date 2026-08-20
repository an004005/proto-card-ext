// Capability aggregation for the facility map (docs/extraction-map-implementation-spec.md §6.3,
// docs/map-equipment-capability-mapping.md). Mirrors the filter-by-kind/reduce idiom already used
// by equipmentEngine.js's implant stat functions, generalized into one aggregation object since
// every map rule needs all six values together (unlike combat, which reads implant effects one
// kind at a time).

import { MAP_EQUIPMENT_CAPABILITIES, CAPABILITY_MIN, CAPABILITY_MAX } from '../data/facilityEquipmentCapabilities.js';

const CAPABILITY_KEYS = /** @type {const} */ (['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception']);

/** @param {number} value @returns {number} clamped to §6.3's -2..4 effective range */
function clampCapability(value) {
  return Math.max(CAPABILITY_MIN, Math.min(CAPABILITY_MAX, value));
}

/** @template T @param {T} item @returns {item is NonNullable<T>} */
function isPresent(item) {
  return Boolean(item);
}

/**
 * @param {import('./types.js').Loadout} loadout
 * @returns {import('./types.js').CapabilityValues}
 */
export function computeCapabilities(loadout) {
  const totals = { perception: 0, stealth: 0, hacking: 0, mobility: 0, force: 0, deception: 0 };
  const instances = [
    ...(loadout.weapons || []),
    loadout.top,
    loadout.bottom,
    ...(loadout.modules || []),
    ...(loadout.implantIds || []).map((id) => ({ equipmentId: id })),
  ].filter(isPresent);

  for (const item of instances) {
    const contract = MAP_EQUIPMENT_CAPABILITIES[item.equipmentId ?? ''];
    if (!contract) continue;
    for (const key of CAPABILITY_KEYS) totals[key] += contract.capabilityModifiers[key] || 0;
  }

  for (const key of CAPABILITY_KEYS) totals[key] = clampCapability(totals[key]);
  return totals;
}

/** 요구치 판정에 쓰는 `max(0, value)` (구현 명세 §3.2). @param {number} value */
export function effectiveForRequirement(value) {
  return Math.max(0, value);
}

/**
 * 장착된 장비 인스턴스 중 능동 현장 효과를 가진 것들. `USE_FIELD_EQUIPMENT`가 대상 인스턴스를
 * 고르는 데 쓴다.
 * @param {import('./types.js').Loadout} loadout
 * @returns {{instanceId: string, equipmentId: string, contract: import('../data/facilityEquipmentCapabilities.js').MapEquipmentContract}[]}
 */
export function listFieldActiveEquipment(loadout) {
  const instances = [...(loadout.weapons || []), loadout.top, loadout.bottom, ...(loadout.modules || [])].filter(isPresent);
  /** @type {{instanceId: string, equipmentId: string, contract: import('../data/facilityEquipmentCapabilities.js').MapEquipmentContract}[]} */
  const result = [];
  for (const item of instances) {
    const contract = MAP_EQUIPMENT_CAPABILITIES[item.equipmentId ?? ''];
    if (contract && contract.fieldAction) result.push({ instanceId: item.id, equipmentId: /** @type {string} */ (item.equipmentId), contract });
  }
  return result;
}
