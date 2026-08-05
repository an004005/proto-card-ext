// Implants (기획서 §10). Passive — no cards. Equipping one permanently occupies `floorOverload`
// of the run's overload floor (never reducible below it).
export const IMPLANT_DEFINITIONS = {
  implant1: { id: 'implant1', name: '① 체력 보강', floorOverload: 10, effect: { kind: 'maxHpBonus', amount: 7 }, description: '최대 체력 +7' },
  implant2: { id: 'implant2', name: '② 위협 감지', floorOverload: 20, effect: { kind: 'combatStartDebuffAll', vulnerable: 1, weak: 1 }, description: '전투 시작 시 모든 적 취약1·약화1' },
  implant3: { id: 'implant3', name: '③ 수납 확장', floorOverload: 5, effect: { kind: 'inventoryBonus', amount: 5 }, description: '인벤토리 +5칸' },
  implant4: { id: 'implant4', name: '④ 반응 가속', floorOverload: 20, effect: { kind: 'extraDrawPerTurn', amount: 1 }, description: '매턴 드로우 +1' },
  implant5: { id: 'implant5', name: '⑤ 열 차단', floorOverload: 30, effect: { kind: 'overloadGainMultiplier', multiplier: 0.5 }, description: '획득 과부화 50% 차감' },
  implant6: { id: 'implant6', name: '⑥ 산개 방출', floorOverload: 15, effect: { kind: 'turnStartAoeDamage', amount: 3 }, description: '매턴 시작 광역 3 피해' },
};
