// Warehouse (창고) vs farming-only pool split (docs/game-rules.md). Warehouse items are available
// at run start; farming-only items only ever appear via drops.
/**
 * @typedef {Object} EquipmentPool
 * @property {string[]} weapons
 * @property {string[]} tops
 * @property {string[]} bottoms
 * @property {string[]} modules
 * @property {string[]} implants
 * @property {(string|{defId: string, count: number})[]} consumables
 */

/** @type {EquipmentPool} */
export const WAREHOUSE_STARTING_POOL = {
  weapons: ['katana', 'dagger'],
  tops: ['light_top'],
  bottoms: ['tactical_bottom'],
  modules: ['module_neural', 'module_body'],
  implants: ['implant1', 'implant3', 'implant6', 'implant7'],
  consumables: [{ defId: 'bandage', count: 2 }, { defId: 'stabilizer', count: 1 }],
};

/** @type {EquipmentPool} */
export const FARMING_ONLY_POOL = {
  weapons: ['rifle', 'pistol', 'auto_pistol', 'revolver', 'shotgun', 'rocket_launcher', 'sniper_rifle'],
  tops: ['heavy_top'],
  bottoms: ['heavy_bottom'],
  modules: ['module_forcefield', 'module_spatial', 'module_emp', 'module_sandevistan', 'module_mantis_blades'],
  implants: ['implant2', 'implant4', 'implant5'],
  consumables: ['grenade', 'flashbang'],
};

/**
 * 런 시작 시 창고에 들어 있는 탄약(C1: 8 → 16).
 *
 * 8발은 10발 스택 하나도 못 채우는 양이라, 총기 무기를 고른 플레이어는 첫 전투 두어 번 만에
 * 탄이 말라 근접 카드만 내게 됐다 — 무기 선택이 선택이 아니게 된다. 16발이면 스택 두 칸을
 * 차지하는 대신(과적 압박은 그대로) 초반 몇 전투를 총으로 풀 수 있다.
 */
export const STARTING_AMMO = 16;
