// Weapons and armor. Equipping one adds its whole cardList to the run deck (docs/game-rules.md).

/**
 * @typedef {Object} EquipmentDef
 * @property {string} id
 * @property {string} name
 * @property {'weapon'|'top'|'bottom'|'module'} slot
 * @property {{defId: string, count: number}[]} cardList
 * @property {number} [maxLoadBonus] weapon only — adds to the shared loaded-ammo cap (§신규 재장전)
 */

/** @type {Object.<string, EquipmentDef>} */
export const WEAPON_DEFINITIONS = {
  katana: {
    id: 'katana', name: '카타나', slot: 'weapon',
    cardList: [{ defId: 'katana_slash', count: 2 }, { defId: 'katana_parry', count: 1 }],
  },
  rifle: {
    id: 'rifle', name: '자동 소총', slot: 'weapon', maxLoadBonus: 5,
    cardList: [{ defId: 'rifle_aim', count: 1 }, { defId: 'rifle_suppress', count: 1 }, { defId: 'rifle_buttstock', count: 1 }, { defId: 'rifle_tactical_reload', count: 1 }],
  },
  dagger: {
    id: 'dagger', name: '단검', slot: 'weapon',
    cardList: [{ defId: 'dagger_weak_slash', count: 1 }, { defId: 'dagger_stab', count: 1 }],
  },
  pistol: {
    id: 'pistol', name: '권총', slot: 'weapon', maxLoadBonus: 3,
    cardList: [{ defId: 'pistol_shot', count: 2 }, { defId: 'reload', count: 1 }],
  },
  auto_pistol: {
    id: 'auto_pistol', name: '자동권총', slot: 'weapon', maxLoadBonus: 4,
    cardList: [{ defId: 'auto_pistol_shot', count: 2 }, { defId: 'auto_pistol_mozambique', count: 1 }, { defId: 'reload', count: 1 }],
  },
  revolver: {
    id: 'revolver', name: '리볼버', slot: 'weapon', maxLoadBonus: 6,
    cardList: [{ defId: 'revolver_headshot', count: 1 }, { defId: 'revolver_last_round', count: 1 }, { defId: 'revolver_quickdraw', count: 1 }, { defId: 'reload', count: 1 }],
  },
  shotgun: {
    id: 'shotgun', name: '샷건', slot: 'weapon', maxLoadBonus: 5,
    cardList: [{ defId: 'shotgun_birdshot', count: 1 }, { defId: 'shotgun_buckshot', count: 1 }, { defId: 'shotgun_slugshot', count: 1 }, { defId: 'reload', count: 1 }],
  },
  rocket_launcher: {
    id: 'rocket_launcher', name: '로켓런처', slot: 'weapon', maxLoadBonus: 5,
    cardList: [{ defId: 'rocket_launch', count: 5 }, { defId: 'reload', count: 1 }],
  },
  sniper_rifle: {
    id: 'sniper_rifle', name: '저격총', slot: 'weapon', maxLoadBonus: 4,
    cardList: [{ defId: 'sniper_aim', count: 1 }, { defId: 'sniper_shot', count: 2 }, { defId: 'reload', count: 1 }],
  },
};

/** @type {Object.<string, EquipmentDef>} */
export const ARMOR_TOP_DEFINITIONS = {
  heavy_top: {
    id: 'heavy_top', name: '중갑상의', slot: 'top',
    cardList: [{ defId: 'heavy_top_dodge', count: 1 }, { defId: 'heavy_top_block', count: 2 }, { defId: 'heavy_top_status_card', count: 1 }],
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
    cardList: [{ defId: 'heavy_bottom_support', count: 1 }, { defId: 'heavy_bottom_shove', count: 1 }, { defId: 'heavy_bottom_status_card', count: 1 }],
  },
};
