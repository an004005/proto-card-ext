// Implants (docs/game-rules.md). Passive — no cards. Each one is a permanent loadout slot effect
// for the whole run; the warehouse is inaccessible mid-run so they never change once a run starts.

/**
 * @typedef {Object} ImplantDef
 * @property {string} id
 * @property {string} name
 * @property {Object[]} effects
 * @property {string} description
 */

/** @type {Object.<string, ImplantDef>} */
export const IMPLANT_DEFINITIONS = {
  implant1: { id: 'implant1', name: '① 체력 보강', effects: [{ kind: 'maxHpBonus', amount: 7 }], description: '최대 체력 +7' },
  implant2: {
    id: 'implant2', name: '② 위협 감지',
    effects: [{ kind: 'combatStartDebuffAll', vulnerable: 1, weak: 1 }],
    description: '전투 시작 시 모든 적 취약1·약화1',
  },
  implant3: { id: 'implant3', name: '③ 수납 확장', effects: [{ kind: 'inventoryBonus', amount: 5 }], description: '인벤토리 +5칸' },
  implant4: {
    id: 'implant4', name: '④ 반응 가속',
    effects: [{ kind: 'extraDrawPerTurn', amount: 1 }],
    description: '매턴 드로우 +1',
  },
  implant6: {
    id: 'implant6', name: '⑥ 산개 방출',
    effects: [{ kind: 'turnStartAoeDamage', amount: 3 }],
    description: '매턴 시작 광역 3 피해',
  },
  implant7: {
    id: 'implant7', name: '⑦ 지도',
    effects: [{ kind: 'sectorLandmarkArrow' }],
    description: '현재 구역 핵심시설 위치를 화살표로 표시(그 노드를 확인하면 사라짐)',
  },
};
