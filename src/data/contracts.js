// 계약 정의 (docs/proposals/map-redesign-decisions.md D3·D4·D21). 목표부는 새 노드가 아니라
// facilityLayout.js의 LANDMARKS_BY_SECTOR를 그대로 가리킨다 — 아홉 계약의 시설명이 여덟
// 랜드마크 이름과 정확히 일치한다(통신동만 파괴·정보 두 계약이 같은 랜드마크를 공유).
//
// 여덟 구역 전부에 계약이 있고, 제안은 그 전부에서 유형별 한 장씩 뽑는다(ADR-0083) — 구역
// 추첨은 제안이 아니라 **수락** 뒤에 돌고, 수락한 계약의 목표 구역이 그 추첨에 무조건
// 포함된다(facilityGraph.selectRunSectorIds). 그래서 갈 수 없는 구역의 계약이 제안되는 일도,
// 제안이 세 장 아래로 내려가는 일도 없다.
//
// 정보(intel) 계약은 목표부에서 데이터를 딴 뒤 **목표부 구역에 인접한 구역**(이 런의 구역 링,
// facilityGraph.js adjacentSectorIds)의 랜드마크에서 송출해야 완료된다 — 이웃 하나만큼의
// 우회가 이 계약의 마지막 장이다.
//
// 봉쇄는 계약 유형을 가리지 않는다(ADR-0083) — 위협 이동 가속, 증원 90칸, 상황 보정 Stealth −1이
// 세 유형 모두에 똑같이 걸리고, 출구 폐쇄 시각은 어느 유형에서도 앞당겨지지 않는다.
//
// 수치는 실측 전 1차값이며 플레이테스트 후 조정 대상이다.

/** @typedef {'retrieval'|'destroy'|'intel'} ContractType */

/**
 * @typedef {Object} ContractDef
 * @property {string} id
 * @property {ContractType} type
 * @property {import('../engine/types.js').FacilitySectorId} sectorId 목표부가 있는 구역. LANDMARKS_BY_SECTOR[sectorId]가 목표부다.
 * @property {string} name
 * @property {string} flavor
 * @property {number} [goodsSlots] retrieval 전용 — 확보한 물건이 인벤토리에서 차지하는 칸 수.
 * @property {number} [goodsValuePerSlot] retrieval 전용 — 물건 한 칸의 회수 점수 가치.
 * @property {number} [completionRewardValue] destroy/intel 전용 — 완료 시 회수 점수에 더하는 값.
 * @property {number} penaltyValue 미완수 시 회수 점수에서 빼는 값.
 * @property {number} prepaymentCurrency 수락 즉시 인벤토리에 지급하는 재화.
 */

/** @type {ContractDef[]} */
export const CONTRACT_DEFS = [
  {
    id: 'sample_retrieval', type: 'retrieval', sectorId: 'labs', name: '표본 회수',
    flavor: '표본이 인벤토리 2칸을 먹는다',
    goodsSlots: 2, goodsValuePerSlot: 25, penaltyValue: 40, prepaymentCurrency: 20,
  },
  {
    id: 'safe_opening', type: 'retrieval', sectorId: 'residential', name: '금고 개방',
    flavor: '병목투성이 구역에서 짐을 지고 빠져나와야 한다',
    goodsSlots: 1, goodsValuePerSlot: 45, penaltyValue: 30, prepaymentCurrency: 15,
  },
  {
    id: 'cargo_salvage', type: 'retrieval', sectorId: 'hangar', name: '화물 인양',
    flavor: '3칸짜리 대형 화물. Mobility가 낮으면 반출이 지옥이다',
    goodsSlots: 3, goodsValuePerSlot: 20, penaltyValue: 50, prepaymentCurrency: 25,
  },
  {
    id: 'generator_shutdown', type: 'destroy', sectorId: 'power', name: '발전 정지',
    flavor: '동력동 깊숙한 곳에서 설치하고 물러나 기폭한다',
    completionRewardValue: 60, penaltyValue: 35, prepaymentCurrency: 20,
  },
  {
    id: 'incinerator_blast', type: 'destroy', sectorId: 'waste', name: '소각로 폭파',
    flavor: '폐기물 구역 안쪽에서 설치하고 물러나 기폭한다',
    completionRewardValue: 55, penaltyValue: 30, prepaymentCurrency: 15,
  },
  {
    id: 'tower_disable', type: 'destroy', sectorId: 'comms', name: '관제탑 무력화',
    flavor: '퇴로가 하나뿐인 탑에서 터뜨리고 내려와야 한다',
    completionRewardValue: 70, penaltyValue: 40, prepaymentCurrency: 25,
  },
  {
    id: 'record_review', type: 'intel', sectorId: 'entrance', name: '기록 열람',
    flavor: '가깝고 얕다. 대신 이웃 구역 송출 지점도 가까워 보상이 작다',
    completionRewardValue: 35, penaltyValue: 20, prepaymentCurrency: 10,
  },
  {
    id: 'control_infiltration', type: 'intel', sectorId: 'security', name: '관제 침투',
    flavor: '보안동에서 데이터를 따고 이웃 구역에서 송출한다',
    completionRewardValue: 65, penaltyValue: 35, prepaymentCurrency: 20,
  },
  {
    id: 'signal_intercept', type: 'intel', sectorId: 'comms', name: '신호 도청',
    flavor: '통신동 탑에서 데이터를 따고 이웃 구역에서 송출한다',
    completionRewardValue: 60, penaltyValue: 35, prepaymentCurrency: 20,
  },
];

/** @param {string} id @returns {ContractDef | undefined} */
export function getContractDef(id) {
  return CONTRACT_DEFS.find((c) => c.id === id);
}
