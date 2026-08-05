// Warehouse (창고) vs farming-only pool split (기획서 §13.2). Warehouse items are available
// at run start; farming-only items only ever appear via drops.
export const WAREHOUSE_STARTING_POOL = {
  weapons: ['katana', 'dagger'],
  tops: ['light_top'],
  bottoms: ['tactical_bottom'],
  modules: ['module_neural', 'module_body'],
  implants: ['implant1', 'implant3', 'implant6'],
  consumables: [{ defId: 'bandage', count: 2 }, { defId: 'stabilizer', count: 1 }],
};

export const FARMING_ONLY_POOL = {
  weapons: ['rifle', 'pistol'],
  tops: ['heavy_top'],
  bottoms: ['heavy_bottom'],
  modules: ['module_forcefield', 'module_spatial', 'module_emp'],
  implants: ['implant2', 'implant4', 'implant5'],
  consumables: ['grenade', 'flashbang'],
};

export const STARTING_AMMO = 8;
