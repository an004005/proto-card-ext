// Consumables (docs/game-rules.md). Pouch holds 3 slots, not deck cards; current combat use
// consumes the item without deducting the definition's display-only cost value.
// 수리 부품은 아직 구현하지 않았다(docs/planned.md).
/** @typedef {import('../engine/types.js').MapTags} MapTags */

/**
 * @typedef {Object} ConsumableDef
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {Object} effect
 * @property {string} effect.kind
 * @property {string} description
 * @property {MapTags} mapTags docs/card-map-tag-mapping.md.
 */

/** @type {Object.<string, ConsumableDef>} */
export const CONSUMABLE_DEFINITIONS = {
  bandage: { id: 'bandage', name: '붕대', cost: 1, effect: { kind: 'healPercent', amount: 0.2 }, description: '체력 20% 회복', mapTags: { noise: 0, traits: ['healing'], disengageProgress: 0 } },
  grenade: { id: 'grenade', name: '수류탄', cost: 1, effect: { kind: 'aoeDamage', amount: 10 }, description: '광역 피해 10', mapTags: { noise: 3, traits: ['explosive'], disengageProgress: 0 } },
  flashbang: { id: 'flashbang', name: '섬광탄', cost: 1, effect: { kind: 'aoeDebuff', vulnerable: 1, weak: 1 }, description: '광역 취약·약화 1턴', mapTags: { noise: 2, traits: ['escape'], disengageProgress: 1 } },
};
