// Modules (기획서 §9). module_charge_slash only enters the deck if 카타나 is also equipped
// (its card def carries requiresWeapon: 'katana' — see equipmentEngine.js).
export const MODULE_DEFINITIONS = {
  module_neural: {
    id: 'module_neural', name: '신경 강화', slot: 'module',
    cardList: [{ defId: 'module_neural_boost', count: 1 }],
  },
  module_body: {
    id: 'module_body', name: '신체 강화', slot: 'module',
    cardList: [{ defId: 'module_body_boost', count: 1 }, { defId: 'module_charge_slash', count: 1 }],
  },
  module_forcefield: {
    id: 'module_forcefield', name: '역장 강화', slot: 'module',
    cardList: [{ defId: 'module_forcefield_defense', count: 1 }, { defId: 'module_forcefield_blast', count: 1 }],
  },
  module_spatial: {
    id: 'module_spatial', name: '공간 지각', slot: 'module',
    cardList: [{ defId: 'module_spatial_awareness', count: 1 }, { defId: 'module_xray_vision', count: 1 }],
  },
  module_emp: {
    id: 'module_emp', name: '전자기 간섭', slot: 'module',
    cardList: [{ defId: 'module_hack', count: 1 }],
  },
};

// Per-stage flat bonuses for the "variable" power modules (기획서 §9). Looked up live at
// every damage/block calculation while the power is active — never cached.
export const MODULE_POWER_STAGE_TABLES = {
  neuralBoost: [1, 2, 2, 1], // 방어력 +N (block bonus)
  bodyBoost: [1, 2, 2, 1], // 근접 공격력 +N
  spatialAwareness: [1, 2, 3, 1], // 원거리 공격력 +N
};
