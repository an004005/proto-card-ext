// Extraction facility layout config (docs/extraction-map-implementation-spec.md §4).
// Data only — no generation logic here (that's src/engine/facilityGraph.js).

// 여덟 구역 **정의 전체**다. 한 런은 이 중 RUN_SECTOR_COUNT개만 쓴다(ADR-0081) — 시작점인
// entrance는 항상 들어가고 나머지 세 개를 런 시드로 뽑는다(facilityGraph.js
// selectRunSectorIds). 그러니 이 배열의 순서는 더 이상 링 순서가 아니라 후보 목록의 순서일
// 뿐이고, 실제 링 순서는 런마다 graph.sectorIds가 갖는다.
/** @type {import('../engine/types.js').FacilitySectorId[]} */
export const ALL_SECTOR_IDS = ['entrance', 'labs', 'hangar', 'security', 'power', 'waste', 'comms', 'residential'];

/** 한 런이 쓰는 구역 수. 링이 4칸이므로 각 구역은 이웃 둘과 맞닿고 맞은편 하나와는 떨어진다. */
export const RUN_SECTOR_COUNT = 4;
/** 항상 뽑히는 시작 구역 — 시작점·격자 허브이고, 링 0번 자리를 고정으로 차지한다. */
export const START_SECTOR_ID = 'entrance';
/** 뽑히면 링에서 시작 구역 정반대(인덱스 2)에 놓이는 구역 — "가장 깊고 위험한 곳이 가장 멀다". */
export const DEEPEST_SECTOR_ID = 'power';

export const SECTOR_NAMES = {
  entrance: '입구·관리동',
  labs: '실험동',
  hangar: '격납고·물류창고',
  security: '보안·격리동',
  power: '동력·정비동',
  waste: '폐기물 처리장',
  comms: '통신·관제탑',
  residential: '거주동',
};

// ---- 구역별 배치 원형 (D6·D18·D20) ----
// 노드 수는 더 이상 구역마다 같지 않다. 크기 자체가 정보다 — 격납고가 14개라는 것은 숨을 데가
// 없다는 뜻이고, 거주동이 32개인데 복도 비중이 높다는 것은 병목투성이라는 뜻이다.
//
// `archetype`은 src/engine/layoutArchetypes.js의 골격 생성기를 고른다. 모든 원형은 같은 방식으로
// 만들어진다: 복도 골격을 먼저 놓고(원형마다 모양이 다르다) 그 골격에 방을 매단다.
// `corridorRatio`는 그 구역 노드 중 골격(복도)이 차지하는 비율이고, 나머지가 방이다.
// `roomTypes`는 방에 배정할 노드 유형의 가중치다.
/**
 * @type {Record<string, {
 *   archetype: 'grid'|'chain'|'hall'|'radial'|'tower'|'dual',
 *   nodeCount: number,
 *   corridorRatio: number,
 *   roomTypes: {value: import('../engine/types.js').FacilityNodeType, weight: number}[],
 * }>}
 */
export const SECTOR_LAYOUTS = {
  // 격자 허브 — 갈림길이 많고 안전하다. 어디로 들어갈지 정하는 곳이다.
  entrance: {
    archetype: 'grid', nodeCount: 34, corridorRatio: 0.45,
    roomTypes: [{ value: 'office', weight: 60 }, { value: 'watch', weight: 15 }, { value: 'utility', weight: 15 }, { value: 'refuge', weight: 10 }],
  },
  // 봉인 격실 사슬 — 격실이 전자문으로 직렬 연결되어 해킹 없이는 우회가 길다.
  labs: {
    archetype: 'chain', nodeCount: 28, corridorRatio: 0.30,
    roomTypes: [{ value: 'vault', weight: 45 }, { value: 'office', weight: 35 }, { value: 'utility', weight: 20 }],
  },
  // 대공간 — 노드가 적고 크며 시야가 트여 은엄폐가 거의 없다.
  hangar: {
    archetype: 'hall', nodeCount: 14, corridorRatio: 0.25,
    roomTypes: [{ value: 'office', weight: 50 }, { value: 'utility', weight: 35 }, { value: 'watch', weight: 15 }],
  },
  // 검문 격자 — 짧은 격자지만 통과 지점마다 카메라와 전자문이 겹친다.
  security: {
    archetype: 'grid', nodeCount: 24, corridorRatio: 0.35,
    roomTypes: [{ value: 'watch', weight: 40 }, { value: 'office', weight: 35 }, { value: 'vault', weight: 25 }],
  },
  // 방사형 — 발전기 중심 회랑이며 중심을 지나지 않는 우회로가 드물다.
  power: {
    archetype: 'radial', nodeCount: 26, corridorRatio: 0.45,
    roomTypes: [{ value: 'utility', weight: 60 }, { value: 'office', weight: 25 }, { value: 'vault', weight: 15 }],
  },
  // 이중층 — 정규 통로와 비인가 통로가 겹치고 후자는 대가를 요구한다.
  waste: {
    archetype: 'dual', nodeCount: 30, corridorRatio: 0.40,
    roomTypes: [{ value: 'utility', weight: 50 }, { value: 'office', weight: 30 }, { value: 'refuge', weight: 20 }],
  },
  // 탑 구조 — 올라갈수록 노드가 줄고 정보 가치는 커지며 퇴로가 하나다.
  comms: {
    archetype: 'tower', nodeCount: 18, corridorRatio: 0.35,
    roomTypes: [{ value: 'watch', weight: 45 }, { value: 'office', weight: 35 }, { value: 'utility', weight: 20 }],
  },
  // 선형 사슬 — 복도가 길고 병목이 많아 마주치면 피할 곳이 적다.
  residential: {
    archetype: 'chain', nodeCount: 32, corridorRatio: 0.50,
    roomTypes: [{ value: 'refuge', weight: 45 }, { value: 'office', weight: 40 }, { value: 'utility', weight: 15 }],
  },
};

/**
 * 주어진 구역 조합의 노드 총수. 구역이 런마다 달라지므로 상수가 아니다 — 네 구역 조합은
 * 대략 90~125개 사이에 떨어진다(여덟 구역 전부였던 시절은 206개였다).
 * @param {readonly string[]} sectorIds
 */
export function totalNodesFor(sectorIds) {
  return sectorIds.reduce((sum, id) => sum + SECTOR_LAYOUTS[id].nodeCount, 0);
}

// ---- 기하학적 배치 (구역 링 + 구역별 평면도) ----
// 구역 중심은 하나의 큰 링 위에 균등 배치한다. 각 구역 내부는 SECTOR_LAYOUTS의 배치 원형에
// 따라 평면도처럼 생성된다(layoutArchetypes.js) — 더 이상 원판 안 무작위 산포가 아니다.
// 구역 내부 엣지는 그 평면도가 직접 만들고, 구역과 구역은 관문 노드 한 쌍씩으로만 이어진다.
export const SECTOR_RING_RADIUS = 900; // 전역 중심에서 각 구역 중심까지 거리.
export const SECTOR_NODE_RADIUS = 280; // 구역 중심에서 그 구역 평면도가 차지하는 반경.

// 같은 구역 안에서 두 노드가 이만큼은 떨어져 있어야 한다. 평면도를 반지름 1로 정규화한 뒤의
// 로컬 단위이므로, 구역 크기와 무관하게 화면상 간격이 같아진다(정규화 좌표 1 = 화면 약 154px).
// 방을 복도에 매달 때 서로 겹칠 수 있어, 생성 마지막에 이 값을 만족할 때까지 밀어낸다.
export const NODE_MIN_SEPARATION = 0.17;
export const NODE_SEPARATION_PASSES = 24;

// 배치 원형이 구조적으로 항상 놓는 특수 엣지의 개수. 무작위 특수 엣지와 달리 시드와 무관하게
// 존재하므로 개수 계약을 검증할 때 따로 더해야 한다.
/** @type {Record<string, number>} */
export const ARCHITECTURAL_SPECIAL_EDGES_BY_SECTOR = { comms: 1 };

// 통신·관제탑 승강기: 1층과 꼭대기를 바로 잇는다. 계단으로 한 층씩 오르는 것과 달리 한 번에
// 올라가지만 잠겨 있다. 차단·전자 두 태그를 다 가지므로 Force로 문을 뜯든 Hacking으로 제어를
// 잡든 열 수 있고, 어느 쪽이든 이만큼이 필요하다. 탑의 유일한 지름길이다.
export const TOWER_ELEVATOR_REQUIREMENT = 3;

// 탑 구조는 1층만 바깥으로 열려 있다. 계단은 층과 층만 잇고 위층 방은 자기 층에만 붙으므로,
// 다른 구역으로 나가는 길과 구역 간 특수 엣지는 전부 1층 로비를 지나야 한다. 로비가 노드
// 하나뿐이면 그 한 점에 연결이 몰려 차수 상한에 걸리므로, 1층에는 방을 이만큼 먼저 붙인다.
export const TOWER_LOBBY_ROOMS = 4;

// 로비 방이 1층 복도에서 떨어지는 거리 배수. 탑은 위아래로 길어서 정규화하면 가로 폭이 크게
// 줄어든다. 기본 간격 그대로 두면 로비 노드들이 최소 간격에 딱 붙은 덩어리로 보이므로, 1층만
// 넓게 벌려 출입층이라는 것이 도면에서 읽히게 한다.
export const TOWER_LOBBY_SPREAD = 2.6;

// 표지 노드(구역 랜드마크·통제실) 후보의 개수 범위. 배치 원형이 후보가 될 마디를 정하고,
// 거기 붙은 방들이 후보가 된다. 너무 많으면 도면을 봐도 좁혀지지 않고, 하나뿐이면 정찰할
// 이유가 없다 — 도면으로 좁히고 정찰로 확정한다는 D16의 노림수가 이 범위 안에서만 성립한다.
export const LANDMARK_CANDIDATE_MIN = 2;
export const LANDMARK_CANDIDATE_MAX = 4;

// 통로에는 더 이상 고유한 시간 비용이 없다(ADR-0084). 한 칸은 한 홉이고, 통로의 길이는
// 화면상의 거리로만 남는다 — 거리 지표(graphUtils.baselineWalkDistances, 출구 A 배치)는 전부
// 홉수로 잰다.

// 특수 엣지를 얹을 때 한 노드가 가질 수 있는 최대 차수. 기저 그래프에는 적용되지 않는다 —
// 평면도가 만든 문·복도와 관문은 차수를 보지 않고 놓이며, 격자 교차점이나 탑 1층 로비처럼
// 구조적으로 길이 모이는 노드는 이 값을 넘긴다. 특수 엣지 배치만 이 한도를 지키므로, 이미
// 차수가 높은 노드에는 특수 엣지가 더 붙지 않는다.
export const BASE_EDGE_DEGREE_HARD_CAP = 4;

// 링에서 인접한 구역 쌍은 런마다 다르므로 상수가 아니다 — facilityGraph.js sectorRingPairs가
// graph.sectorIds에서 만든다. 구역 내부 특수 엣지와는 별도로, 그 쌍들 사이에만 "구역을 넘는"
// 특수 엣지를 놓는다(§4.2 확장).

// 열쇠 출구 자리를 찾는 재시도 횟수(ADR-0083). 표준 출구 A는 "자격 있는 구역에서 시작점에서
// 가장 먼 노드"로 결정론적으로 정해지므로 재시도가 필요 없고, 열쇠 출구만 무작위 구역에서
// 2-edge-disjoint 조건을 만족하는 노드를 이만큼 시도해 찾는다. 다 실패하면 그 시드의 그래프
// 생성을 통째로 다시 돌린다(GENERATION_MAX_ATTEMPTS).
export const EXIT_PLACEMENT_MAX_ATTEMPTS = 24;

// 구역 "내부" 특수 엣지 (기존과 동일한 배치 방식 — 같은 구역 노드 풀에서만 고름).
export const SPECIAL_EDGES_PER_SECTOR_MIN = 4;
export const SPECIAL_EDGES_PER_SECTOR_MAX = 6;

// 구역 "사이" 특수 엣지 — 링에서 맞닿은 각 쌍마다, 두 구역 풀에서 각각 하나씩 뽑아 잇는다.
export const CROSS_SECTOR_SPECIAL_EDGES_MIN = 2;
export const CROSS_SECTOR_SPECIAL_EDGES_MAX = 3;

// 원거리 지름길 — 링에서 서로 인접하지 않은 구역 쌍을 잇는 특수
// 엣지. 아주 소수만 둔다(전체 그래프에 걸쳐 이 개수만큼, 구역 쌍마다가 아니다) — 없어도 되는
// 도박성 지름길이라, 많으면 "인접 구역만 연결된다"는 설계 의도 자체가 흐려진다.
export const LONG_RANGE_SPECIAL_EDGES_MIN = 2;
export const LONG_RANGE_SPECIAL_EDGES_MAX = 3;

// 특수 엣지의 성격. 'electronic'은 여기 없다 — 전자는 통로의 종류가 아니라 자물쇠의 종류이기
// 때문이다. 막힌 통로는 'blocked'가 만들고, 그중 일부에 'electronic'이 덧붙어 "전자식 자물쇠라
// Hacking으로도 열리는 문"이 된다. 전자 태그만 달린 엣지는 여는 절차 없이 지나갈 수 있어
// 화면에는 잠긴 문으로 보이는데 실제로는 아무것도 막지 않았다.
/** @type {{value: 'oneWay'|'blocked'|'highGround', weight: number}[]} */
export const SPECIAL_EDGE_CATEGORY_WEIGHTS = [
  { value: 'oneWay', weight: 3 },
  { value: 'blocked', weight: 6 },
  { value: 'highGround', weight: 3 },
];
// 막힌 통로에 전자식 자물쇠가 걸릴 확률. 걸리면 Force와 Hacking 둘 다로 열 수 있고, 안 걸리면
// 물리 자물쇠라 Force로만 열린다. Hacking으로 열 수 있는 문의 비율이 이 값이다.
export const SPECIAL_EDGE_SECOND_TAG_CHANCE = 0.4;

/**
 * 고지대 엣지를 넘는 표준 Mobility. 다른 요구치와 똑같이 층계(D8)로 판정한다 — 예전에는 이
 * 하나만 이분 게이트라 "3이면 되고 2면 안 되는" 체크박스였고, 그래서 Mobility 2 빌드에는
 * 지도의 일부가 통째로 없는 길이었다. 지금은 부족분을 HP로 치르고 넘는다(Mobility 2는 무리,
 * 1은 위태). 판정에는 `effectiveForRequirement`의 0 하한을 그대로 쓰므로 0 이하는 전부 불가다.
 */
export const HIGH_GROUND_MOBILITY_REQUIREMENT = 3;

export const LANDMARKS_BY_SECTOR = {
  entrance: { id: 'security_records_room', name: '보안 기록실', approaches: ['perception', 'hacking', 'force'] },
  labs: { id: 'quarantine_vault', name: '격리 표본고', approaches: ['stealth', 'force', 'hacking'] },
  hangar: { id: 'cargo_bay', name: '화물 격납고', approaches: ['force', 'mobility', 'hacking'] },
  security: { id: 'central_control', name: '중앙 관제실', approaches: ['hacking', 'deception', 'force'] },
  power: { id: 'main_generator', name: '주 발전기', approaches: ['force', 'hacking', 'mobility'] },
  waste: { id: 'incinerator_core', name: '소각로 중심부', approaches: ['force', 'stealth', 'hacking'] },
  comms: { id: 'control_tower', name: '중앙 관제탑', approaches: ['hacking', 'perception', 'deception'] },
  residential: { id: 'staff_quarters_vault', name: '직원 숙소 금고', approaches: ['stealth', 'deception', 'hacking'] },
};

// 노드당 현장 기회 개수 분포 — 이제 노드 유형이 정한다(D18 두 번째 축). 복도와 비인가 통로는
// 지나가는 곳이라 거의 비어 있고, 봉인 격실과 사무·작업실은 뒤질 것이 많다.
/** @type {Record<import('../engine/types.js').FacilityNodeType, {value: 0|1|2, weight: number}[]>} */
export const NODE_TYPE_OPPORTUNITY_WEIGHTS = {
  corridor: [{ value: 0, weight: 90 }, { value: 1, weight: 10 }],
  crawlway: [{ value: 0, weight: 80 }, { value: 1, weight: 20 }],
  watch: [{ value: 0, weight: 40 }, { value: 1, weight: 45 }, { value: 2, weight: 15 }],
  refuge: [{ value: 0, weight: 25 }, { value: 1, weight: 55 }, { value: 2, weight: 20 }],
  utility: [{ value: 0, weight: 20 }, { value: 1, weight: 50 }, { value: 2, weight: 30 }],
  hall: [{ value: 0, weight: 20 }, { value: 1, weight: 40 }, { value: 2, weight: 40 }],
  office: [{ value: 0, weight: 10 }, { value: 1, weight: 50 }, { value: 2, weight: 40 }],
  vault: [{ value: 0, weight: 5 }, { value: 1, weight: 35 }, { value: 2, weight: 60 }],
};
// 현장 기회 하나가 몇 번 파밍 가능한지 — 더 이상 "1회용"이 기본이 아니다. 기대값 ~1.65회.
/** @type {{value: 1|2|3, weight: number}[]} */
export const OPPORTUNITY_USES_WEIGHTS = [
  { value: 1, weight: 45 },
  { value: 2, weight: 35 },
  { value: 3, weight: 20 },
];
export const KEY_DROP_CHANCE = 0.01;

// 노드별 은엄폐: 값(1~3)만큼 그 노드에서 임시로 실효 Stealth를 올려준다. 다른 노드로 이동하면
// 사라진다. 이제 노드 유형이 분포를 정한다(D18 첫 번째 축) — 은신처와 비인가 통로는 몸을 숨길
// 데가 많고, 복도와 대공간은 시야가 트여 아예 없다.
/** @type {Record<import('../engine/types.js').FacilityNodeType, {value: 0|1|2|3, weight: number}[]>} */
export const NODE_TYPE_CONCEALMENT_WEIGHTS = {
  corridor: [{ value: 0, weight: 100 }],
  hall: [{ value: 0, weight: 100 }],
  office: [{ value: 0, weight: 65 }, { value: 1, weight: 20 }, { value: 2, weight: 15 }],
  utility: [{ value: 0, weight: 55 }, { value: 1, weight: 25 }, { value: 2, weight: 20 }],
  watch: [{ value: 0, weight: 60 }, { value: 1, weight: 25 }, { value: 2, weight: 15 }],
  vault: [{ value: 0, weight: 40 }, { value: 2, weight: 35 }, { value: 3, weight: 25 }],
  crawlway: [{ value: 0, weight: 20 }, { value: 2, weight: 45 }, { value: 3, weight: 35 }],
  refuge: [{ value: 0, weight: 10 }, { value: 2, weight: 40 }, { value: 3, weight: 50 }],
};
export const CONCEALMENT_ACTION_TIME_COST = 1;

// 대공간에 서 있는 동안 실효 Stealth가 이만큼 깎인다(D7 격납고: 개방 공간이라 Stealth가 불리).
// 은엄폐와 같은 자리에서 계산되며, 대공간에는 은엄폐가 아예 배치되지 않으므로 상쇄되지 않는다.
export const HALL_STEALTH_PENALTY = 1;

// ---- 조우의 상황 보정 (ADR-0079) ----
//
// 실효 Stealth는 장비 합(capabilityEngine)만으로 정해지지 않는다. 서 있는 자리와 시설의 현재
// 상태가 같은 자리에서 더해진다 — 장비를 바꿀 수 없는 런 중반에도 "어디서 마주치는가"를 골라
// 판정을 바꿀 수 있어야 하기 때문이다. 전부 정수 ±1 단위이며 곱하지 않는다(ADR-0063 결정론).
//
// 살아 있는(해킹·파괴되지 않은) 카메라가 있는 노드. 사람 눈만이 아니라 렌즈도 나를 본다.
export const STEALTH_CONTEXT_CAMERA = -1;
// 전원이 끊긴 구역(D12 전원 차단 또는 발전 정지 계약). 어두우면 숨기 쉽다.
export const STEALTH_CONTEXT_POWER_CUT = 1;
// 봉쇄 중(D22). 전 구역이 눈을 뜨고 있어 어디에 서 있든 한 단계 불리하다.
export const STEALTH_CONTEXT_LOCKDOWN = -1;

// 구역 통제실 해킹(§신규) — 각 구역의 랜드마크 노드(graph.landmarks)에서만 시도할 수 있다.
// 해킹 수치별로 누적 언락(상위 레벨은 하위 효과를 전부 포함): 1=이 구역 순찰경로 영구 표시,
// 2=이 구역 경계레벨 감소(감소량 = 해킹 수치 - 1), 3=맵 전체 위협 전원 patrol 전환.
export const CONTROL_ROOM_HACK_TIME = 4;

// 계약(§3단계, D3·D4·D21). 완료 액션 세 종류의 시간 비용. 확보(회수 물건 집기·정보
// 데이터 추출)는 정찰보다 무겁고 해킹보다는 가볍게, 파괴는 가장 무겁게, 송출은 확보보다
// 가볍게 잡았다 — 다른 §신규 필드 액션들과 같은 대역(4~9칸)에 맞춘 1차값이다.
export const CONTRACT_ACQUIRE_TIME = 3;
export const CONTRACT_DESTROY_TIME = 5;
export const CONTRACT_TRANSMIT_TIME = 3;

/**
 * 파괴 계약의 마지막 장(C5). 목표부에서 폭약을 **설치**(CONTRACT_DESTROY_TIME, 여기서 봉쇄
 * 시작)하고, 목표부에서 충분히 떨어진 자리에서 **기폭**해야 완료다. 설치와 동시에 완료였던
 * 시절에는 목표부가 곧 종점이라 "터뜨리고 내려오는" 장면이 아예 없었다 — 봉쇄가 켜진 시설을
 * 가로질러 빠져나오는 그 구간이 이 계약의 값이다.
 */
export const CONTRACT_DETONATE_TIME = 1;
/** 기폭 지점이 목표부에서 떨어져 있어야 하는 최소 홉수. */
export const CONTRACT_DETONATE_MIN_HOPS = 2;

// 봉쇄(D22) — 계약 목표를 확보한 순간부터 켜진다. 하는 일은 **위협 가속뿐**이다(ADR-0083):
// 위협 이동 간격을 전역으로 줄이고(LOCKDOWN_THREAT_MOVE_INTERVAL), 각 구역의 다음 증원을
// 당기고(REINFORCEMENT_LOCKDOWN_INTERVAL), 상황 보정 Stealth −1을 건다. 출구 폐쇄 시각은
// 건드리지 않는다 — 표준 출구가 A 하나뿐이라 그것까지 앞당겨 닫으면 봉쇄가 곧 실패 선고가 된다.

// Cameras and access interfaces are rolled independently, so either device can exist alone or
// both can share a node. Generation guarantees at least one of each per sector.
export const CAMERA_NODE_CHANCE = 0.22;
export const ACCESS_INTERFACE_NODE_CHANCE = 0.16;
export const CAMERA_STEALTH_THRESHOLD = 3;
export const CAMERA_ALERT_RANGE = 3;
export const CAMERA_HACK_TIME = 3;
export const CAMERA_HACK_DURATION = 15;
// Effective Hacking -2/-1/0/1/2/3/4 -> direct graph-hop range (§10.2 문서: "Hacking 1·2·3·4에서
// 각각 1·2·3·4홉 이내"). Hacking 0 이하는 자격 미달로 아예 시도할 수 없으므로 0. A hacked access
// interface instead grants the entire sector, regardless of this direct range (§11.2 카메라·
// 접속 인터페이스 참고).
export const CAMERA_HACK_RANGE_BY_HACKING = [0, 0, 0, 1, 2, 3, 4];

// 접속 인터페이스를 장악하면 그 구역 카메라의 **위치**가 지도에 드러난다. 인터페이스는 구역
// 카메라 버스이므로, 제어를 잡으면 어느 노드에 눈이 달려 있는지가 먼저 읽힌다 — 카메라를 끄는
// 것과 카메라가 어디 있는지 아는 것은 다른 정보이고, 후자가 인터페이스를 잡을 이유 하나를 더 준다.
// 잘 하는 해커일수록 버스를 더 멀리까지 따라 읽는다. 인터페이스 노드에서 센 홉수이며 같은 구역
// 안으로만 퍼진다(카메라 무력화가 구역 단위인 것과 같은 경계다).
// index = clamp(유효 Hacking, -2, 4) + 2.
export const INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING = [1, 1, 2, 3, 4, 5, 6];
export const CAMERA_FORCE_TIME = 3;
export const CAMERA_FORCE_NOISE = 2;

// ---- 카메라 저격 (저격총의 현장 행동) ----
// 원거리·비해킹 빌드에게 카메라를 끄는 수단을 준다. 해킹은 사거리 안에서 잠깐 무력화할 뿐이고
// Force 파괴는 카메라가 보는 자리에 들어가야 하므로, 저격총(perception +1 / mobility −1)을 든
// 빌드는 카메라 앞에서 선택지가 없었다.
//
// 통화는 Perception이다. Force가 아닌 이유는 둘이다 — Force는 이미 "가서 부순다"의 통화이고,
// 원거리 파괴의 병목은 힘이 아니라 조준이다. 그리고 Perception이 정보 수단에만 머물면
// Perception 특화 장비가 능동 행동을 하나도 갖지 못한다.
export const CAMERA_SNIPE_REQUIREMENT = 2;
export const CAMERA_SNIPE_TIME = 2;
/** 총성은 **내 노드**에서 난다 — 위협이 조사하러 오는 곳은 카메라가 아니라 쏜 자리다. */
export const CAMERA_SNIPE_NOISE = 2;
/** 사거리는 통로 홉수다. 시야가 없으면 못 쏜다 — 잠긴 통로 너머와 일방통행의 역방향은 불가. */
export const CAMERA_SNIPE_RANGE = 2;
/** 장전된 탄은 전투 안에만 있는 개념이라(combatEngine.createCombat), 맵에서는 인벤토리의 예비탄 1발을 쓴다. */
export const CAMERA_SNIPE_AMMO_COST = 1;
export const GENERATOR_SECTOR_IDS = ['power', 'labs'];
export const GENERATOR_HACK_TIME = 3;
export const GENERATOR_FORCE_TIME = 3;
export const GENERATOR_FORCE_NOISE = 2;
export const GENERATOR_COMBAT_START_ARMOR = 5;
// 이동은 언제나 1칸이다(ADR-0084) — 통로의 길이도, Mobility도 이동 시간을 바꾸지 않는다.
// Mobility는 고지대 통과·조우 회피·회수 계약의 판정 통화로 남는다.

// 초기 위협 배치 — 구역 정원이다. 뽑힌 구역만 채워지므로 한 런의 총 위협 수는 조합에 따라
// 다르다(입구 3 + 나머지 세 구역의 합, 12~16).
export const THREAT_COUNT_BY_SECTOR = {
  entrance: 3, labs: 3, hangar: 3, security: 4, power: 5, waste: 4, comms: 3, residential: 3,
};
export const THREAT_MIN_HOPS_FROM_START = 3; // "시작점 2홉 안에 배치하지 않는다" -> 최소 3홉.
export const THREAT_MIN_HOPS_BETWEEN_MARKERS = 2;
export const THREAT_PATROL_ROUTE_MIN = 2;
export const THREAT_PATROL_ROUTE_MAX = 4;

/** @type {{value: 2|3|4, weight: number}[]} */
export const THREAT_GROUP_SIZE_WEIGHTS = [
  { value: 2, weight: 65 },
  { value: 3, weight: 30 },
  { value: 4, weight: 5 },
];
export const ENTRANCE_THREAT_MAX_GROUP_SIZE = 2;

export const GENERATION_MAX_ATTEMPTS = 64;
export const FALLBACK_TOPOLOGY_SEED_SEARCH_LIMIT = 256;

// ---- 시간·탈출 (구현 명세 §2, §5, §7) ----
// 맵 시간의 단위는 정수 "칸" 하나뿐이다(ADR-0075). 아래 값은 전부 칸이며, 런타임에서 이 값에
// 배율을 곱해 소수를 만들지 않는다.

// 마감은 언제나 "시작점에서 가장 먼 출구(A)까지의 실측 중앙값"에 매여 있다. 그 중앙값은
// Mobility 0에서 12칸(12홉)이고, 붕괴는 그 약 6.7배, A 폐쇄는 약 4.2배다(ADR-0085). 이 배수는
// 마감이 재는 것이 "몇 칸인가"가 아니라 "가장 먼 출구까지 왕복하면서 계약을 끝낼 수 있는가"이기
// 때문에 정해졌다 — 회수·파괴·정보 계약의 왕복(목표부까지 이동 + 현장 작업 + 출구 가동)이
// 대부분의 시드에서 들어오도록 고른 값이다.
export const RUN_COLLAPSE_TIME = 80; // §2.3 t>=RUN_COLLAPSE_TIME 붕괴, 다른 모든 사건보다 우선.

// 표준 출구는 A 하나뿐이다(ADR-0083). 폐쇄는 "가동을 시작하는 시각"만 본다.
export const EXIT_A_DISABLED_AT = 50;
export const EXIT_OPEN_WINDOW = 5;

/**
 * 유효 Hacking -2~-1/0/1/2/3/4 -> **탈출구 가동** 게이지 길이(칸). 가동은 다른 현장 작업과 같은
 * 모양이다(ADR-0084) — 1칸을 써서 걸어두고, 그 자리에서 대기로 게이지를 채운다. 게이지가 차면
 * 출구가 EXIT_OPEN_WINDOW칸 동안 열린다. 길이는 옛 [18,18,18,16,13,11,8]의 절반으로 줄였다
 * (ADR-0085): 가동 하나가 마감 예산의 절반을 먹으면 탈출은 선택이 아니라 통행료가 되므로,
 * "언제 가동을 걸 것인가"가 판단으로 남을 만큼만 남긴다. effectiveHacking을 -2..4로 clamp한 뒤
 * (value+2) 인덱스로 조회.
 */
export const EXIT_ACTIVATE_TIME_BY_HACKING = [5, 5, 5, 4, 4, 3, 2];

export const NOISE_DURATION = 5; // §7.1 소음은 발생 시각 C부터 [C, C+5) 동안 들린다.
export const INVESTIGATION_MEMORY_DURATION = 15; // §7.1 "출처 도착 또는 기억 만료 전까지".
export const EVIDENCE_TRACE_DURATION_LIGHT = null; // §7.2: 흔적은 시간 만료가 아니라 발견/정리로만 사라진다.

// ---- 위협 이동 간격 ----
//
// 이동이 1칸이 되어도(ADR-0084) 위협의 간격표는 그대로다 — 플레이어가 한 칸에 한 홉을 걷게
// 되면서 이 표는 이제 "내가 한 홉 갈 때 저쪽은 몇 분의 1홉 가는가"로 직접 읽힌다: 순찰 5칸
// 간격은 내 다섯 홉에 한 홉, 추격 3칸은 세 홉에 한 홉이다. 시간을 쓰는 쪽이 이동이 아니라
// 작업(게이지)이 되었으므로, 위협이 따라붙는 자리도 이동 중이 아니라 **작업 중**이다.

// §CONTEXT.md "순찰 경로": mode별 다음 엣지 이동 간격(칸).
export const THREAT_MOVE_INTERVAL = { patrol: 5, investigate: 4, alert: 4, pursuit: 3, exit_guard: 4 };

// 봉쇄 중 이동 간격은 배율이 아니라 고정표다(ADR-0075) — 0.6을 곱하면 자투리 칸이 생기고,
// "지금 몇 칸 뒤에 움직이나"를 뺄셈으로 알 수 없게 된다.
export const LOCKDOWN_THREAT_MOVE_INTERVAL = { patrol: 3, investigate: 3, alert: 3, pursuit: 2, exit_guard: 3 };

// 구역 경계도 2 이상이면 그 구역의 위협은 **모드를 가리지 않고** 빨라진다. 예전에는 조사·경계만
// 빨라져서, 경계도가 올라간 구역을 순찰하는 무리는 아무 일도 없던 구역과 똑같은 속도로 걸었다 —
// "이 구역이 깨어났다"가 실제 압박으로 읽히지 않았다. 봉쇄표와 함께 걸리면 둘 중 작은 값을 쓴다.
export const SECTOR_ALERT_MOVE_INTERVAL = { patrol: 3, investigate: 3, alert: 3, pursuit: 2, exit_guard: 3 };
/** 이 경계도부터 위 표가 적용된다. */
export const SECTOR_ALERT_FAST_MOVE_LEVEL = 2;

/** @type {Record<0|1|2|3, 0|1|2>} */
export const SECTOR_ALERT_MIN_ENEMY_ALERT = { 0: 0, 1: 1, 2: 2, 3: 2 }; // §7.4

// ---- 위협 경계 감쇠 (ADR-0079) ----
//
// 개별 위협 마커의 경계다. 구역 경계도(sectorAlerts)는 여기서 건드리지 않는다 — 그것은
// 시간으로 내려가지 않고 수습 수단으로만 내려간다(ADR-0073 총량 보존).
//
// 플레이어를 시야에서 잃은 마커는 영원히 쫓지 않는다. 추적 중 플레이어를 관측하지 못한 채
// 이만큼 지나면 조사로 내려간다. 관측하면(같은 노드 또는 인접 노드) 타이머가 리셋된다.
export const PURSUIT_DECAY_TICKS = 6;
// 조사로 내려온 뒤에도 관측하지 못한 채 이만큼 더 지나면 순찰로 돌아간다(추적 시작 기준 14칸).
export const INVESTIGATE_DECAY_TICKS = 8;
// 감쇠 단계별로 마커의 alert이 내려앉는 값. 구역 경계도가 만든 하한(SECTOR_ALERT_MIN_ENEMY_ALERT)
// 아래로는 내려가지 않는다.
export const PURSUIT_DECAY_ALERT = 2;

// 구역 경계도는 시간으로 감소하지 않는다(ADR-0069, ADR-0073). 저절로 회복되는 페널티는 결정을
// 만들지 않는다 — 낮추려면 통제실을 장악해야 한다. 압력 게이지도 마찬가지로 시간으로 빠지지
// 않고, 단계를 낮추는 수습이 걸릴 때 그 구역 게이지가 0으로 지워진다(ADR-0082).

// ---- 인과 고리와 수습 (§4단계, D12·D13·D14) ----

// 경계도는 단계가 아니라 **압력 게이지**로 오른다(ADR-0082). 한 번의 실수가 통째로 한 단계를
// 올리면 "아무 일도 없음"과 "+1" 사이에 중간이 없어서, 작은 실수도 큰 실수처럼 느껴지고 큰
// 실수는 값이 싸 보인다. 원인마다 압력을 얹고, 게이지가 가득 차야 단계가 1 오른다.
// 전투 소음 게이지(NOISE_GAUGE_CAPACITY)와 같은 모양이다 — 같은 시설 안에서 "쌓이다 터진다"는
// 감각을 두 화면이 공유한다.
export const ALERT_GAUGE_CAPACITY = 10;
/**
 * 원인별 압력. 정원 10 대비로 읽는다 — 카메라 감지·시체 발견은 혼자서도 절반 넘게 채우고,
 * 강한 흔적 하나나 서툰 손놀림은 두 번 겹쳐야 한 단계가 된다. 허탕 조사는 가장 싸다: 위협이
 * 소음을 쫓다 헛물을 켜는 것은 플레이어의 실수라기보다 시설의 일상이다.
 * 같은 노드에서 시체와 강한 흔적이 함께 발견되면 둘 다 더해져(6+4) 정확히 한 단계가 오른다.
 * @type {Record<'cameraDetection'|'corpseFound'|'strongTraceFound'|'failedInvestigation'|'botchedAction', number>}
 */
export const ALERT_PRESSURE = {
  cameraDetection: 6,
  corpseFound: 6,
  strongTraceFound: 4,
  failedInvestigation: 3,
  // 층계 위태(Stealth·Hacking −2 이하)로 그 자리에서 들키는 것.
  botchedAction: 4,
};

// ---- 추적자 (ADR-0092) ----
//
// 경계도 3단계는 예전에는 "위협이 조금 더 빨리 걷는다"로만 읽혔다. 최대 단계에 도달해도 지도
// 위에서 달라지는 것이 이동 간격 하나뿐이라, 마지막 단계가 그 앞 단계와 같은 종류의 압박이었다.
// 3단계에서는 **이름을 가진 하나**가 나온다 — 구역을 순찰하는 무리가 아니라 나를 향해 걷는 개체다.
//
// 추적자는 경계도 가속·봉쇄와 무관하게 고정 간격으로 움직인다. 다른 위협처럼 표를 따르게 하면
// 봉쇄와 경계도가 겹칠 때 추적자만 두 배로 빨라져 "몇 칸 뒤에 닿는가"를 셀 수 없어진다 —
// 이 개체의 압박은 속도가 아니라 **끈질김**이다.
export const HUNTER_MOVE_INTERVAL = 2;
/** 위협 마커 perception(computeThreatPerception이 여기에 alert을 더한다)이 아니라 추적자 마커 자체의 지각. */
export const HUNTER_PERCEPTION = 3;
/** 이만큼 연속으로 플레이어를 관측하지 못하면 흔적을 놓치고 물러난다. 관측하면 0으로 되돌아간다. */
export const HUNTER_LOSE_TICKS = 20;
/** 추적자의 시야 — 일반 위협의 1홉보다 넓다. 이 홉 안에 있으면 본다. */
export const HUNTER_SIGHT_HOPS = 2;
/** 실효 Stealth가 이 값 이상이면 시야 안에 있어도 추적자가 놓친다(카메라 임계와 같은 눈금). */
export const HUNTER_STEALTH_THRESHOLD = 3;

// 시체(D13) — 전투에서 이긴 노드에 남는다. 위협이 밟으면 신고되어 경계도가 오르고 그 지점으로
// 조사가 몰린다. 치우는 것은 선택이며 기본은 그냥 두고 가는 것이다.
export const CORPSE_DISPOSAL_TIME = 3;
/** 시체·강한 흔적이 발견됐을 때 그 지점에 생기는 조사 유발 소음의 강도. */
export const DISCOVERY_NOISE_INTENSITY = 2;

// 흔적(D12의 원인 쪽) — 이동마다 쌓이므로 발견마다 경계도를 올리면 즉시 최대로 간다. 그래서
// tier로 가른다: 약한 흔적은 위협을 끌어들이기만 하고, 강한 흔적(Stealth -2 이하)만 경계도를
// 올린다. 중장비 빌드가 실제로 위험해지는 자리다.
export const EVIDENCE_TIER_RAISING_ALERT = 2;
/**
 * 유효 Perception -2~4 -> 흔적 정리 시간. 크고, 그동안 무방비다(D12).
 * 첫 칸(Perception -2)은 층계상 도달할 수 없어 실제로는 쓰이지 않는다 — 다른 Capability 표와
 * 같은 -2~4 일곱 칸 모양을 유지하려고 남겨 둔 자리다.
 */
export const TRACE_CLEANUP_TIME_BY_PERCEPTION = [4, 4, 4, 3, 3, 2, 2];

// 증원(D14) — 구역마다 로스터(graph.threats)에 정해진 정원이 있고, 전투로 비운 자리만 다시
// 채운다("그냥 리스폰"). 정원을 넘지 않으므로 맵 청소는 불가능해지되 무한 증식도 하지 않는다.
// 증원은 구역 관문에서 나온다 — 등 뒤에서 생기지 않는다.
export const REINFORCEMENT_INTERVAL = 180;
// 봉쇄(D22) 중에는 교대가 빨라진다 — 기존 위협의 이동 가속(LOCKDOWN_THREAT_MOVE_INTERVAL)과
// 함께 "마지막 장"의 압박을 만든다. 봉쇄에 들어가는 순간 각 구역의 다음 교대 시각을
// min(기존, 현재+90)으로 당긴다.
export const REINFORCEMENT_LOCKDOWN_INTERVAL = 90;

// 전원 차단(D12) — 그 구역 경계도 상승을 잠시 멈춘다. 대가는 큰 소음과, 그동안 그 구역의
// 전자식 자물쇠를 열 수 없다는 것이다(전원이 없으니 해킹할 제어가 없다. 문을 뜯는 Force는 된다).
export const POWER_CUT_DURATION = 30;
export const POWER_CUT_TIME = 3;
export const POWER_CUT_NOISE = 3;

// ---- 기만: 유인과 오도 ----
//
// 가짜 소음 — Deception만 있으면 어디서든 쓸 수 있는 유인 수단이다. 접속 인터페이스를 요구하는
// 가짜 목표 송출과 달리 자리를 가리지 않지만, 경계도를 옮기지는 못한다. 시선만 끈다.
export const FAKE_NOISE_TIME = 2;
export const FAKE_NOISE_REQUIREMENT = 1;
/**
 * 실효 Deception -2/-1/0/1/2/3/4 -> 소음을 심을 수 있는 홉 범위.
 *
 * 요구치(1)에 못 미쳐도 심을 수는 있다 — 층계(D8)가 대가를 시간으로 받고, 사거리는 최소인
 * 1홉으로 주저앉는다. 불가 구간(-2)만 0이며 그 값은 실제로 조회되지 않는다: 그 전에
 * `requireActionCost('fakeNoise')`가 막는다.
 */
export const FAKE_NOISE_RANGE_BY_DECEPTION = [0, 1, 1, 1, 2, 3, 3];
/** 이 수치 이상이면 심는 소음의 강도가 1이 아니라 2다 — 더 멀리까지 들린다. */
export const FAKE_NOISE_STRONG_DECEPTION = 3;
export const FAKE_NOISE_INTENSITY = 1;
export const FAKE_NOISE_STRONG_INTENSITY = 2;

// 조우 속이기 — 동률 조우에서 회피 대신 고를 수 있다. 위협당 한 번뿐이고 칸을 쓰지 않는다.
export const ENCOUNTER_DECEIVE_REQUIREMENT = 2;
/**
 * 조우 속이기의 층계 대가. 0칸짜리 행동이라 시간으로는 받을 수 없고(시간 가감을 얹으면 "0칸
 * 선택지"라는 성격 자체가 사라진다), Deception의 통화인 지속도 이 한 번짜리 행동에는 붙일
 * 자리가 없다. 그래서 대가를 **판정 자체**에서 받는다:
 *
 * - 무리(Deception 1): 속임수가 엉성해 성공 기준이 1 높아진다(그 위협의 경계 + 1 이상 필요).
 * - 위태(Deception 0): 위와 같고, 시도 자체가 들통나 성공·실패와 무관하게 그 위협의 경계가 1 오른다.
 * - 불가(Deception -1 이하): 시도할 수 없다.
 */
export const ENCOUNTER_DECEIVE_STEP_PENALTY = {
  surplus: { successPenalty: 0, raisesThreatAlert: false },
  standard: { successPenalty: 0, raisesThreatAlert: false },
  strained: { successPenalty: 1, raisesThreatAlert: false },
  severe: { successPenalty: 1, raisesThreatAlert: true },
};

// 가짜 목표 송출을 인접 구역이 아니라 아무 구역으로나 쏠 수 있게 되는 수치.
export const FALSE_BROADCAST_ANY_SECTOR_DECEPTION = 3;

// 가짜 목표 송출(D12) — 경계를 인접 구역으로 옮긴다. 총량은 보존된다.
export const FALSE_BROADCAST_TIME = 4;
export const FALSE_BROADCAST_INTENSITY = 2;
/**
 * Deception — 어설픈 속임수는 오래 못 간다. 심어둔 가짜 목표가 유지되는 시간이며, 소음(5칸)
 * 보다 길어야 위협이 실제로 그쪽까지 걸어간다. 층계별 **고정 칸 표**이고 적정(standard)이
 * 기본 15칸이다. 배율이 아니라 표인 이유는 ADR-0075 — 지속도 시간이라 정수 칸으로 읽히고
 * 뺄셈으로 예측 가능해야 한다. 지속이 통화인 행동은 저마다 자기 표를 갖고 호출부가 넘긴다.
 */
export const FALSE_BROADCAST_DURATION_BY_STEP = { surplus: 19, standard: 15, strained: 8, severe: 4 };

// 구역 링 위에서 서로 맞닿은 구역은 런마다 다르므로 여기 상수로 둘 수 없다 —
// facilityGraph.js adjacentSectorIds(graph, sectorId)가 유일한 인접 정의다. 경계도를
// 옮기거나(D12 가짜 목표 송출) 인접 구역까지 낮출 때(통제실 해킹 3단계) 그 하나를 쓴다. 기하학적
// 배치가 링 순서를 그대로 따르므로(SECTOR_RING_RADIUS 참고) 링 이웃이 곧 실제로 걸어서 넘어가는
// 이웃이다.

// ---- Capability 층계 (§5단계, D8) ----
// 요구치 R, 실효 A의 차이로 단계가 갈린다. A ≥ R+1 surplus / A = R standard /
// A = R-1 strained / A = R-2 severe / A ≤ R-3 impossible.
//
// 핵심은 부족분을 전부 시간으로 받지 않는 것이다 — 그러면 시간이 다시 단일 통화가 된다.
// Capability마다 받는 통화가 다르고, 아래 표가 그 통화별 수치다.

/**
 * 모든 단계에 공통으로 걸리는 시간 **칸 가감**. Mobility와 Perception은 이것이 주 통화다.
 * 배율이 아니라 가감인 이유는 ADR-0075 — 저장된 칸에 배율을 곱하면 반올림이 끼어들어 같은
 * 행동이 기본 비용마다 다른 값으로 갈라지고, "이 행동 동안 적이 몇 번 움직이나"를 뺄셈으로
 * 알 수 없게 된다. 전용 시간 규칙을 가진 행동(이동, 흔적 정리)에는 중복 적용하지 않는다.
 */
export const CAPABILITY_STEP_TIME_DELTA = { surplus: -1, standard: 0, strained: 2, severe: 4 };
/** 층계·접근 가감을 다 받은 뒤에도 유료 행동은 최소 1칸이다. */
export const CAPABILITY_MIN_TIME = 1;
/** Force — 힘으로 밀어붙이면 시끄럽다. severe에서는 장비도 상한다. */
export const CAPABILITY_STEP_NOISE_DELTA = { surplus: -1, standard: 0, strained: 1, severe: 2 };
export const CAPABILITY_STEP_DURABILITY_LOSS = { surplus: 0, standard: 0, strained: 0, severe: 1 };
/** Mobility — 무리하면 몸이 상한다. playerState.hp라 커맨드 래퍼에서 반영한다. */
export const CAPABILITY_STEP_HP_COST = { surplus: 0, standard: 0, strained: 3, severe: 8 };
/** Stealth — 서툰 침투는 흔적을 남긴다. severe는 그 자리에서 경계까지 올린다(4단계 파이프라인 재사용). */
export const CAPABILITY_STEP_LEAVES_STRONG_TRACE = { surplus: false, standard: false, strained: true, severe: true };
export const CAPABILITY_STEP_RAISES_ALERT = { surplus: false, standard: false, strained: false, severe: true };

// ---- 현장 기회 두 등급 (§5단계, D10·D11) ----
// 보급품은 흔하고 즉시 획득이며 짧고 조용하다. 확보 대상은 구역당 소수이고 후보 3개 중
// 하나를 고르며 길고 시끄럽다. 확보 대상 물품은 인벤토리를 크게 먹어 "이걸 넣으려면 무엇을
// 버릴까"까지 같이 묻는다.

/** 기회가 확보 대상으로 승격될 확률. 중요한 방일수록 높다(NODE_TYPE_OPPORTUNITY_WEIGHTS와 같은 결). */
/** @type {Record<import('../engine/types.js').FacilityNodeType, number>} */
export const PRIZE_PROMOTION_CHANCE_BY_NODE_TYPE = {
  vault: 0.20, office: 0.20, utility: 0.20, hall: 0.18,
  refuge: 0.14, watch: 0.14, crawlway: 0.05, corridor: 0.02,
};
/** 확보 대상의 등급 — 정찰로 미리 보이며, 높을수록 파밍 시간과 소음이 크다(D11). */
/** @type {{value: 'normal'|'elite', weight: number}[]} */
export const PRIZE_TIER_WEIGHTS = [{ value: 'normal', weight: 70 }, { value: 'elite', weight: 30 }];

export const SUPPLY_FARM_TIME = 3;
export const SUPPLY_FARM_NOISE = 1;
/** @type {Record<'normal'|'elite', number>} */
export const PRIZE_FARM_TIME = { normal: 5, elite: 7 };
/** @type {Record<'normal'|'elite', 1|2|3>} */
export const PRIZE_FARM_NOISE = { normal: 2, elite: 3 };
// 확보 대상 지점의 역할축. 지점마다 독립적으로 굴리므로 한 구역의 확보 대상이 전부 같은
// 축일 수도 있다 — 정찰로 "종류"가 보이니, 축이 겹친 구역은 그만큼 갈 이유가 줄어든다.
/** @type {{value: 'combat'|'infiltration'|'resource', weight: number}[]} */
export const PRIZE_AXIS_WEIGHTS = [
  { value: 'combat', weight: 35 },
  { value: 'infiltration', weight: 35 },
  { value: 'resource', weight: 30 },
];
/** 확보 대상 파밍이 내놓는 후보 수 — 전부 그 지점의 축에서 나온다. */
export const PRIZE_OPTION_COUNT = 3;

/** @type {Record<1|2|3|4, number>} §7.1 소음 단계 -> 홉 범위 */
export const NOISE_HOP_RANGE = { 1: 1, 2: 2, 3: 3, 4: Infinity };

// ---- 공통 접근 모드 (§6.1) ----

export const APPROACH_TIME_DELTA = { safe: 2, normal: 0, rush: -2 };
export const APPROACH_NOISE_DELTA = { safe: -1, normal: 0, rush: 1 };
export const APPROACH_MIN_TIME = 1;

// ---- 기본 맵 행동 (§6.2) ----

export const BASIC_RECON_TIME = 2;
// 기본 정찰의 표준 홉 범위 — 현재 노드 + 1홉. 무료 인접 실시간 관측도 1홉이므로, Perception
// 0~2에서 정찰이 사는 것은 **사거리가 아니라 깊이**다: 무료 관측이 "무언가 있다"까지라면 정찰은
// 그 자리의 내용물과 위협 상세를 읽는다. 사거리를 더 사려면 Perception 3 이상이어야 한다
// (PERCEPTION_INFO_TABLE에서 2홉). 이 상수는 Perception 0~2의 값이자 호출부가 수치를 모를 때의
// 기본값이다.
export const BASIC_RECON_HOP_RANGE = 1;

// ---- 정보의 깊이 (ADR-0079 계열, Perception) ----
//
// 정찰 비용(4칸)은 Perception과 무관하게 고정이고, 사거리는 Perception 0~2에서 1홉,
// 3 이상에서 2홉이다. Perception이 주로 정하는 것은 정찰과 무료 인접 관측이 **무엇을**
// 보여주는가다. 그래서 Perception은 진행을 막지 않고(ADR-0055) 같은 4칸으로 더 깊은 정보를 산다.
//
// Perception 0~2의 사거리 1홉은 무료 인접 관측과 같은 범위다 — 그 구간에서 정찰이 사는 것은
// 깊이뿐이고, 사거리는 Perception 3부터 늘어난다.
//
// index = clamp(실효 Perception, -2, 4) + 2. `level`은 관측 기록에 그대로 박혀(`detailLevel`)
// UI가 그보다 깊은 것을 렌더하지 못하게 한다 — 나중에 Perception을 올려도 과거 관측이 소급해
// 깊어지지는 않는다.
//
// threat/extra의 각 항목은 누적이다(상위 레벨이 하위를 전부 포함한다).
/**
 * @typedef {Object} PerceptionInfoLevel
 * @property {number} level 0~5. 관측 기록의 detailLevel.
 * @property {number} reconHops 정찰 사거리(홉).
 * @property {('presence'|'size'|'mode'|'alert'|'nextMove'|'composition'|'patrolNext')[]} threat 위협에 대해 읽히는 항목.
 * @property {('prizeGrade'|'prizeAxis'|'concealment'|'evidence')[]} extra 사거리 안에서 함께 드러나는 것.
 */
/** @type {PerceptionInfoLevel[]} */
export const PERCEPTION_INFO_TABLE = [
  // -2
  { level: 0, reconHops: 1, threat: ['presence'], extra: [] },
  // -1
  { level: 0, reconHops: 1, threat: ['presence'], extra: [] },
  // 0
  { level: 1, reconHops: 1, threat: ['presence', 'size'], extra: ['prizeGrade'] },
  // 1
  { level: 2, reconHops: 1, threat: ['presence', 'size', 'mode'], extra: ['prizeGrade', 'prizeAxis'] },
  // 2
  { level: 3, reconHops: 1, threat: ['presence', 'size', 'mode', 'alert', 'nextMove'], extra: ['prizeGrade', 'prizeAxis', 'concealment'] },
  // 3
  { level: 4, reconHops: 2, threat: ['presence', 'size', 'mode', 'alert', 'nextMove', 'composition'], extra: ['prizeGrade', 'prizeAxis', 'concealment'] },
  // 4
  { level: 5, reconHops: 2, threat: ['presence', 'size', 'mode', 'alert', 'nextMove', 'composition', 'patrolNext'], extra: ['prizeGrade', 'prizeAxis', 'concealment', 'evidence'] },
];

// 장치(카메라·접속 인터페이스·발전기)와 현장 기회의 **존재**는 이 표에 없다. **값을 치른**
// 관측이 닿기만 하면 Perception 깊이와 무관하게 관측 기록의 `contents`에 적힌다 — 방 안에
// 무엇이 놓여 있는지까지 Perception으로 가리면 "정찰은 무엇을 사는가"가 읽히지 않는다.
// Perception이 가르는 것은 그 다음의 깊이뿐이다: 위협 상세, 확보 대상의 등급·역할축, 은엄폐 값.
//
// 다만 "값을 치른"이 조건이다. 공짜 인접 시야는 내용물을 적지 않고 위협 유무만 적는다
// (FREE_OBSERVATION_DETAIL_LEVEL) — 내용물은 정찰·집중 투시·카메라·인터페이스가 파는 것이다.
// 서 있는 노드만은 공짜로도 내용물이 보인다: 그 방 안에 서 있기 때문이다.

// 무료 인접 관측은 Perception과 무관하게 이 깊이로 고정이다 — **유무까지**, 그 이상은 없다.
// 공짜 시야가 말해 주는 것은 "저기 무언가 있다" 하나뿐이고, 방 안에 무엇이 놓여 있는지(현장
// 기회·장치)와 그 너머의 깊이는 전부 값을 치러야 산다: 정찰, 집중 투시, 해킹한 카메라,
// 접속 인터페이스. 값을 치르지 않고 얻는 정보가 빌드에 따라 달라지면 "정찰을 할 것인가"라는
// 결정 자체가 흐려지므로 Perception도 타지 않는다.
//
// 서 있는 노드는 예외다 — 발로 딛고 선 방은 다 보이므로 내용물과 출구 상태를 깊이 1로 적는다
// (runEngine.refreshLocalObservations). 이 상수가 정하는 것은 **인접** 노드의 깊이다.
export const FREE_OBSERVATION_DETAIL_LEVEL = 0;

// 이 수치 이상이면 대기 중에도 인접 1홉의 실시간 관측이 끊기지 않는다(대기 관측 차단의 예외).
export const PERCEPTION_WAIT_OBSERVATION_MIN = 2;

// 대기와 조우 회피. 대기는 HP·경계도를 회복시키지 않는다 — 개방·쿨다운·적 위치를
// 기다리는 용도다. 묶음 대기는 1칸 대기를 반복하며 새 조우·출구 개방/폐쇄·붕괴에서 즉시 멈춘다.
export const WAIT_TICK_TIME = 1;
export const WAIT_BATCH_MAX_TICKS = 5;
// 회피에 시간이 들지 않으면 같은 위협의 추적을 무한히 공짜로 끊을 수 있다.
export const ENCOUNTER_EVADE_TIME = 1;

// ---- 전투 라운드 정산 (planned §8) ----

/** 전투 1라운드(플레이어 행동 구간 + 적 반응)에 드는 맵 칸. 적 수나 카드 수로 늘어나지 않는다. */
export const COMBAT_ROUND_TIME_COST = 1;
/** 적 기습으로 생기는 추가 선공 구간. 라운드 비용과 별도로 한 번 청구된다. */
export const COMBAT_ENEMY_AMBUSH_TIME_COST = 1;

// ---- Capability 행동표 tier 1 (§6.3) — MVP는 tier 1 접근만 구현한다. 더 높은 tier(예: Force
// 2~4의 바리케이드 파괴·구조물 붕괴)는 이후 단계 과제로 남긴다.
export const FORCE_TIER1_TIME = 3;
export const FORCE_BASE_NOISE = 2; // §6.3 "Force 기본 소음은 2와 흔적이다."
export const HACKING_TIER1_TIME = 2;
export const HACKING_BASE_NOISE = 0;
