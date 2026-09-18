// 출격 준비 화면의 역할군 프리셋. 창고에서 장비를 한 점씩 집어 여섯 Capability를 머릿속으로
// 더하는 일은 이 게임에서 가장 먼저 만나는 벽이고, 그 벽을 넘기 전까지 플레이어는 "무엇을
// 들면 무엇을 할 수 있는가"를 배울 기회조차 얻지 못한다. 프리셋은 그 답을 네 개의 완성된
// 예시로 먼저 보여준다 — 누르면 그대로 장착되고, 거기서 한두 점만 바꿔 자기 것으로 만들면 된다.
//
// 구성 원칙: 각 역할군은 자기 축에서 **다른 셋보다 확실히 높다**(test/loadoutPresets.test.js가
// 네 프리셋의 Capability 합을 실제로 계산해 이 관계를 검증한다). 그래야 네 버튼이 취향이 아니라
// 서로 다른 침투 방식으로 읽힌다. 장비는 전부 런 시작 창고(engine/loadoutReducer.js
// buildStartingWarehouse — 창고에는 장비 정의 전부가 한 점씩 들어 있다)에 실제로 있는 것만 쓴다.
//
// 소모품은 퀵슬롯에 넣을 것만 적는다. 탄약은 건드리지 않는다 — 몇 발을 지고 갈지는 인벤토리
// 용량과의 거래이고, 그 거래는 프리셋이 대신 결정할 만한 것이 아니다.

/** @typedef {import('../engine/types.js').CapabilityValues} CapabilityValues */

/**
 * @typedef {Object} LoadoutPreset
 * @property {string} id
 * @property {string} name
 * @property {string} summary 버튼에 그대로 적히는 한 줄.
 * @property {string[]} weapons equipment.js WEAPON_DEFINITIONS의 id. 슬롯 정원(2)만큼.
 * @property {string} top
 * @property {string} bottom
 * @property {string[]} modules
 * @property {string[]} implants
 * @property {string[]} consumables consumables.js의 defId. 퀵슬롯 정원(3) 이내.
 */

/** @type {LoadoutPreset[]} */
export const LOADOUT_PRESETS = [
  {
    id: 'assault',
    name: '돌격',
    summary: '문을 부수고 들어간다 — Force 최대, 은신은 버린다',
    // 샷건·로켓런처·중갑 한 벌·신체 강화·맨티스 블레이드가 전부 Force를 올린다. 합계는 상한을
    // 한참 넘겨 잘리고(clamp 4), 그 대가로 Stealth는 하한(-2)까지 내려간다 — 조우는 거의
    // 언제나 열세로 시작하므로 전투로 푸는 역할군이다.
    weapons: ['shotgun', 'rocket_launcher'],
    top: 'heavy_top',
    bottom: 'heavy_bottom',
    modules: ['module_body', 'module_mantis_blades'],
    implants: ['implant1', 'implant6', 'implant2'],
    consumables: ['bandage', 'bandage', 'bandage'],
  },
  {
    id: 'infiltrator',
    name: '잠입',
    summary: '들키지 않고 지나간다 — Stealth·Mobility 최대',
    // Stealth를 올려 주는 장비는 창고에 경갑상의 하나뿐이다. 그래서 잠입의 핵심은 "올리는 것"이
    // 아니라 **깎는 것을 하나도 들지 않는 것**이다 — 무기 둘 다 보정이 없고(단검·권총), 기동을
    // 깎는 저격총도 은신을 깎는 산데비스탄·맨티스도 쓰지 않는다.
    weapons: ['dagger', 'pistol'],
    top: 'light_top',
    bottom: 'tactical_bottom',
    modules: ['module_spatial', 'module_neural'],
    implants: ['implant7', 'implant4', 'implant3'],
    consumables: ['bandage', 'bandage'],
  },
  {
    id: 'hacker',
    name: '해커',
    summary: '장치를 열어 길을 만든다 — Hacking·Deception 최대',
    // 전자기 간섭 하나가 Hacking +2 · Deception +1을 동시에 준다. 대가인 Perception -1은 위협
    // 감지 임플란트로 메운다. 무기는 조용한 권총 둘 — 해킹으로 열 수 없는 자리에서만 쏜다.
    weapons: ['pistol', 'auto_pistol'],
    top: 'light_top',
    bottom: 'tactical_bottom',
    modules: ['module_emp', 'module_neural'],
    implants: ['implant2', 'implant1', 'implant3'],
    consumables: ['bandage', 'bandage'],
  },
  {
    id: 'scout',
    name: '정찰',
    summary: '먼저 보고 움직인다 — Perception 최대, 카메라 저격',
    // 저격총(+1, 카메라 저격) · 공간 지각(+2, 집중 투시) · 위협 감지(+1)로 Perception이 상한에
    // 닿는다. 저격총의 Mobility -1이 전술하의의 +1을 그대로 상쇄하므로 발은 느리다 — 정보로
    // 길을 고르는 역할군이지 도망치는 역할군이 아니다.
    weapons: ['sniper_rifle', 'pistol'],
    top: 'light_top',
    bottom: 'tactical_bottom',
    modules: ['module_spatial', 'module_neural'],
    implants: ['implant2', 'implant7', 'implant1'],
    consumables: ['bandage', 'bandage'],
  },
];

/** @param {string} id @returns {LoadoutPreset | undefined} */
export function getLoadoutPreset(id) {
  return LOADOUT_PRESETS.find((preset) => preset.id === id);
}

/**
 * 프리셋이 장착하는 장비 id를 적용 순서대로 편다(소모품 제외). 리듀서의 적용 순서이자 화면의
 * 표시 순서다 — 두 곳이 같은 목록을 봐야 "창고에 없음"이 실제로 건너뛴 것과 일치한다.
 * @param {LoadoutPreset} preset
 * @returns {string[]}
 */
export function presetEquipmentIds(preset) {
  return [...preset.weapons, preset.top, preset.bottom, ...preset.modules, ...preset.implants].filter(Boolean);
}
