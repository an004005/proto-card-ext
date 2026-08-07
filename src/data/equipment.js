// Weapons and armor (기획서 §5, §8). Equipping one adds its whole cardList to the run deck.

/**
 * @typedef {Object} EquipmentDef
 * @property {string} id
 * @property {string} name
 * @property {'weapon'|'top'|'bottom'|'module'} slot
 * @property {{defId: string, count: number}[]} cardList
 */

/** @type {Object.<string, EquipmentDef>} */
export const WEAPON_DEFINITIONS = {
  katana: {
    id: 'katana', name: '카타나', slot: 'weapon',
    cardList: [{ defId: 'katana_slash', count: 2 }, { defId: 'katana_parry', count: 1 }],
  },
  rifle: {
    id: 'rifle', name: '라이플', slot: 'weapon',
    cardList: [{ defId: 'rifle_aim', count: 1 }, { defId: 'rifle_suppress', count: 1 }, { defId: 'rifle_buttstock', count: 1 }],
  },
  dagger: {
    id: 'dagger', name: '단검', slot: 'weapon',
    cardList: [{ defId: 'dagger_weak_slash', count: 1 }, { defId: 'dagger_stab', count: 1 }],
  },
  pistol: {
    id: 'pistol', name: '권총', slot: 'weapon',
    cardList: [{ defId: 'pistol_shot', count: 2 }],
  },
};

/** @type {Object.<string, EquipmentDef>} */
export const ARMOR_TOP_DEFINITIONS = {
  heavy_top: {
    id: 'heavy_top', name: '중갑상의', slot: 'top',
    cardList: [{ defId: 'heavy_top_dodge', count: 1 }, { defId: 'heavy_top_block', count: 2 }, { defId: 'heavy_top_curse', count: 1 }],
  },
  light_top: {
    id: 'light_top', name: '경갑상의', slot: 'top',
    cardList: [{ defId: 'light_top_dodge', count: 2 }, { defId: 'light_top_deflect', count: 1 }],
  },
};

/** @type {Object.<string, EquipmentDef>} */
export const ARMOR_BOTTOM_DEFINITIONS = {
  tactical_bottom: {
    id: 'tactical_bottom', name: '전술하의', slot: 'bottom',
    cardList: [{ defId: 'tactical_bottom_feint', count: 1 }, { defId: 'tactical_bottom_dash', count: 1 }, { defId: 'tactical_bottom_dodge', count: 1 }],
  },
  heavy_bottom: {
    id: 'heavy_bottom', name: '중장하의', slot: 'bottom',
    cardList: [{ defId: 'heavy_bottom_support', count: 1 }, { defId: 'heavy_bottom_shove', count: 1 }, { defId: 'heavy_bottom_curse', count: 1 }],
  },
};
