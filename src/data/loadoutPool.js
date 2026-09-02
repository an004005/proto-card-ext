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

export const STARTING_AMMO = 8;
