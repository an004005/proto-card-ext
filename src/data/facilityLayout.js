// 206-node extraction facility layout config (docs/extraction-map-implementation-spec.md §4).
// Data only — no generation logic here (that's src/engine/facilityGraph.js).

// 구역을 하나의 큰 링(원환) 위에 순서대로 배치한다 — entrance가 시작점, 링에서 정반대(4칸
// 떨어진) 위치에 power를 둬서 "가장 깊고 위험한 구역"이 항상 시작점에서 (양쪽 어느 방향으로
// 가든) 가장 멀도록 만든다. 인접한 구역끼리만 노드가 기하학적으로 가깝게 배치되므로(아래
// buildBaseGraph 참고), 이 순서가 곧 실제 이동 난이도 순서가 된다.
/** @type {import('../engine/types.js').FacilitySectorId[]} */
export const SECTOR_IDS = ['entrance', 'labs', 'hangar', 'security', 'power', 'waste', 'comms', 'residential'];

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

export const TOTAL_NODES = SECTOR_IDS.reduce((sum, id) => sum + SECTOR_LAYOUTS[id].nodeCount, 0);

// Mobility 0 기준 "평균적인" 일반 복도 시간 비용 (구현 명세 §6.2) — 실제 엣지 시간은 이제
// 두 노드의 기하학적 거리에 비례해 가감된다(EDGE_TIME_PER_LENGTH_UNIT 이하 참고). 이 값은
// 그 스케일을 맞추는 기준점일 뿐, 더 이상 모든 엣지에 균일하게 적용되지 않는다.
export const STANDARD_EDGE_TIME_COST = 100;

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

// 엣지 시간 비용 = clamp(round(기하 거리 * EDGE_TIME_PER_LENGTH_UNIT), MIN, MAX). 구역 내부
// 최근접 노드 간 평균 거리(~50 단위)가 STANDARD_EDGE_TIME_COST(100)에 가깝게 나오도록 잡은 값.
export const EDGE_TIME_PER_LENGTH_UNIT = 2;
export const EDGE_TIME_MIN = 40;
export const EDGE_TIME_MAX = 260;

// 특수 엣지를 얹을 때 한 노드가 가질 수 있는 최대 차수. 기저 그래프에는 적용되지 않는다 —
// 평면도가 만든 문·복도와 관문은 차수를 보지 않고 놓이며, 격자 교차점이나 탑 1층 로비처럼
// 구조적으로 길이 모이는 노드는 이 값을 넘긴다. 특수 엣지 배치만 이 한도를 지키므로, 이미
// 차수가 높은 노드에는 특수 엣지가 더 붙지 않는다.
export const BASE_EDGE_DEGREE_HARD_CAP = 4;

// 링에서 인접한 구역 쌍(마지막-첫 구역도 순환으로 연결) — 구역 내부 특수 엣지와는 별도로,
// 이 쌍들 사이에만 "구역을 넘는" 특수 엣지를 놓는다(§4.2 확장).
/** @type {[string, string][]} */
export const SECTOR_ADJACENCY = SECTOR_IDS.map((s, i) => [s, SECTOR_IDS[(i + 1) % SECTOR_IDS.length]]);

// 탈출구별 Mobility 0 가중 이동비용 범위 (구현 명세 §2.2).
//
// 시작점은 항상 입구·관리동이고 여덟 구역은 균등한 원 위에 있으므로, 시작점 가중거리는 사실상
// 링 위치의 함수다. 그래서 구간을 좁게 잡으면 그 구간이 링의 특정 호에 대응해 버리고, 출구가
// 놓이는 구역이 시드와 무관하게 고정된다 — 예전 값에서는 B의 90%가 동력·정비동(입구의 정반대편,
// 유일하게 5,300을 넘는 구역) 하나에 몰렸다.
//
// 그래서 구간을 아래로 당기고 서로 겹치게 넓혔다. 구간이 겹쳐도 A<열쇠<B 순서는 깨지지 않는다 —
// 순서는 구간이 아니라 placeStartAndExits가 후보를 고를 때 직접 비교해 보장한다. 상한은 시작점에서
// 2-edge-disjoint 경로가 있는 노드까지의 실제 도달 거리(시드마다 5,500~6,600) 아래로 둔다.
export const EXIT_DISTANCE_RANGES = {
  A: { min: 2400, max: 4000 },
  key: { min: 3400, max: 5000 },
  B: { min: 4400, max: 5800 },
};

// 구역 "내부" 특수 엣지 (기존과 동일한 배치 방식 — 같은 구역 노드 풀에서만 고름).
export const SPECIAL_EDGES_PER_SECTOR_MIN = 4;
export const SPECIAL_EDGES_PER_SECTOR_MAX = 6;

// 구역 "사이" 특수 엣지 — SECTOR_ADJACENCY의 각 쌍마다, 두 구역 풀에서 각각 하나씩 뽑아 잇는다.
export const CROSS_SECTOR_SPECIAL_EDGES_MIN = 2;
export const CROSS_SECTOR_SPECIAL_EDGES_MAX = 3;

// 원거리 지름길 — 링에서 서로 인접하지 않은(=SECTOR_ADJACENCY에 없는) 구역 쌍을 잇는 특수
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
export const CONCEALMENT_ACTION_TIME_COST = 20;

// 대공간에 서 있는 동안 실효 Stealth가 이만큼 깎인다(D7 격납고: 개방 공간이라 Stealth가 불리).
// 은엄폐와 같은 자리에서 계산되며, 대공간에는 은엄폐가 아예 배치되지 않으므로 상쇄되지 않는다.
export const HALL_STEALTH_PENALTY = 1;

// 구역 통제실 해킹(§신규) — 각 구역의 랜드마크 노드(graph.landmarks)에서만 시도할 수 있다.
// 해킹 수치별로 누적 언락(상위 레벨은 하위 효과를 전부 포함): 1=이 구역 순찰경로 영구 표시,
// 2=이 구역 경계레벨 감소(감소량 = 해킹 수치 - 1), 3=맵 전체 위협 전원 patrol 전환.
export const CONTROL_ROOM_HACK_TIME = 150;
export const CONTROL_ROOM_HACK_OVERLOAD = 10;

// 계약(§3단계, D3·D4·D21). 완료 액션 세 종류의 시간·과부화 비용. 확보(회수 물건 집기·정보
// 데이터 추출)는 정찰보다 무겁고 해킹보다는 가볍게, 파괴는 가장 무겁게, 송출은 확보보다
// 가볍게 잡았다 — 다른 §신규 필드 액션들과 같은 대역(80~180)에 맞춘 1차값이다.
export const CONTRACT_ACQUIRE_TIME = 120;
export const CONTRACT_ACQUIRE_OVERLOAD = 8;
export const CONTRACT_DESTROY_TIME = 180;
export const CONTRACT_DESTROY_OVERLOAD = 15;
export const CONTRACT_TRANSMIT_TIME = 100;
export const CONTRACT_TRANSMIT_OVERLOAD = 10;

// 봉쇄(D22) — 계약 목표를 확보한 순간부터 켜진다. 위협 이동 간격을 전역으로 줄이고(작을수록
// 빠르다), 두 표준 출구 중 더 먼 B의 비활성 시각을 앞당긴다 — 어느 쪽이 닫힐지 예측 가능해야
// 플레이어가 대비할 수 있으므로 무작위나 조건부가 아니라 항상 B로 고정한다.
export const LOCKDOWN_THREAT_SPEED_MULTIPLIER = 0.6;
export const LOCKDOWN_EXIT_CLOSE_WINDOW = 2500;

// Cameras and access interfaces are rolled independently, so either device can exist alone or
// both can share a node. Generation guarantees at least one of each per sector.
export const CAMERA_NODE_CHANCE = 0.22;
export const ACCESS_INTERFACE_NODE_CHANCE = 0.16;
export const CAMERA_STEALTH_THRESHOLD = 3;
export const CAMERA_ALERT_RANGE = 3;
export const CAMERA_HACK_TIME = 100;
export const CAMERA_HACK_OVERLOAD = 6;
export const CAMERA_HACK_DURATION = 300;
// Effective Hacking -2/-1/0/1/2/3/4 -> direct graph-hop range (§10.2 문서: "Hacking 1·2·3·4에서
// 각각 1·2·3·4홉 이내"). Hacking 0 이하는 자격 미달로 아예 시도할 수 없으므로 0. A hacked access
// interface instead grants the entire sector, regardless of this direct range (§11.2 카메라·
// 접속 인터페이스 참고).
export const CAMERA_HACK_RANGE_BY_HACKING = [0, 0, 0, 1, 2, 3, 4];
export const CAMERA_FORCE_TIME = 100;
export const CAMERA_FORCE_NOISE = 2;
export const GENERATOR_SECTOR_IDS = ['power', 'labs'];
export const GENERATOR_HACK_TIME = 100;
export const GENERATOR_HACK_OVERLOAD = 6;
export const GENERATOR_FORCE_TIME = 100;
export const GENERATOR_FORCE_NOISE = 2;
export const GENERATOR_COMBAT_START_ARMOR = 5;
// Effective Mobility -2/-1/0/1/2/3/4 scales each geometry-derived corridor cost.
export const MOBILITY_MOVE_TIME_MULTIPLIER = [1.4, 1.2, 1, 0.9, 0.8, 0.7, 0.6];

// 초기 위협 배치 (구역 순서는 SECTOR_IDS와 일치): 입구 3 / 실험 5 / 격납고 5 / 보안 6 /
// 동력 7 / 폐기물 6 / 통신 4 / 거주 4 (총 40).
export const THREAT_COUNT_BY_SECTOR = {
  entrance: 3, labs: 5, hangar: 5, security: 6, power: 7, waste: 6, comms: 4, residential: 4,
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

// ---- 시간·틱·탈출 (구현 명세 §2, §5, §7) ----

// EXIT_DISTANCE_RANGES.B 상한(5,800) 대비 약 2.4배. 가장 먼 탈출구를 찍고 돌아 나올 여유는
// 있되, 시설 전체를 훑고 나갈 만큼은 아니게 잡은 값이다.
export const RUN_COLLAPSE_TIME = 14000; // §2.3 t===RUN_COLLAPSE_TIME 붕괴, 다른 모든 사건보다 우선.
export const WORLD_TICK_INTERVAL = 10; // §5.1 "전역 시간이 10 시간 포인트 진행될 때마다 1회".

export const EXIT_A_DISABLED_AT = 8600;
export const EXIT_B_DISABLED_AT = 13400;
export const EXIT_REQUEST_TIME = 50;
export const EXIT_OPEN_WINDOW = 100;

// 유효 Hacking -2~-1/0/1/2/3/4 -> 개방 대기 (§2.2, §CONTEXT 탈출 카운트다운). effectiveHacking을
// -2..4 범위로 clamp한 뒤 이 배열의 (value+2) 인덱스로 조회한다.
export const EXIT_OPEN_WAIT_BY_HACKING = [300, 300, 300, 250, 200, 150, 100];

export const NOISE_DURATION = 100; // §7.1 "일반 소음은 100포인트 동안 지속".
export const INVESTIGATION_MEMORY_DURATION = 300; // §7.1 "출처 도착 또는 기억 만료 전까지".
export const EVIDENCE_TRACE_DURATION_LIGHT = null; // §7.2: 흔적은 시간 만료가 아니라 발견/정리로만 사라진다.

// §CONTEXT.md "순찰 경로": mode별 다음 엣지 이동 간격. 구역 경계도 2/3은 조사·경계에 한해 더
// 빨라진다(아래 SECTOR_ALERT_INVESTIGATE_INTERVAL로 override).
export const THREAT_MOVE_INTERVAL = { patrol: 100, investigate: 80, alert: 80, pursuit: 60, exit_guard: 80 };
/** @type {Partial<Record<0|1|2|3, number>>} sectorAlertLevel -> interval override */
export const SECTOR_ALERT_INVESTIGATE_INTERVAL = { 2: 70, 3: 60 };

/** @type {Record<0|1|2|3, 0|1|2>} */
export const SECTOR_ALERT_MIN_ENEMY_ALERT = { 0: 0, 1: 1, 2: 2, 3: 2 }; // §7.4

// 구역 경계도는 시간으로 감소하지 않는다(ADR-0069, ADR-0073). 저절로 회복되는 페널티는 결정을
// 만들지 않는다 — 낮추려면 통제실을 장악해야 한다.

// ---- 인과 고리와 수습 (§4단계, D12·D13·D14) ----

// 경계도 상승은 어느 원인이든 한 단계씩이다(escalateSectorAlert). 카메라 감지·시체 발견·강한
// 흔적 발견이 모두 같은 폭으로 올리므로 원인별 상수를 따로 두지 않는다.

// 시체(D13) — 전투에서 이긴 노드에 남는다. 위협이 밟으면 신고되어 경계도가 오르고 그 지점으로
// 조사가 몰린다. 치우는 것은 선택이며 기본은 그냥 두고 가는 것이다.
export const CORPSE_DISPOSAL_TIME = 200;
/** 시체·강한 흔적이 발견됐을 때 그 지점에 생기는 조사 유발 소음의 강도. */
export const DISCOVERY_NOISE_INTENSITY = 2;

// 흔적(D12의 원인 쪽) — 이동마다 쌓이므로 발견마다 경계도를 올리면 즉시 최대로 간다. 그래서
// tier로 가른다: 약한 흔적은 위협을 끌어들이기만 하고, 강한 흔적(Stealth -2 이하)만 경계도를
// 올린다. 중장비 빌드가 실제로 위험해지는 자리다.
export const EVIDENCE_TIER_RAISING_ALERT = 2;
/** 유효 Perception -2~4 -> 흔적 정리 시간. 크고, 그동안 무방비다(D12). */
export const TRACE_CLEANUP_TIME_BY_PERCEPTION = [320, 320, 280, 250, 210, 180, 150];

// 증원(D14) — 구역마다 로스터(graph.threats)에 정해진 정원이 있고, 전투로 비운 자리만 다시
// 채운다("그냥 리스폰"). 정원을 넘지 않으므로 맵 청소는 불가능해지되 무한 증식도 하지 않는다.
// 증원은 구역 관문에서 나온다 — 등 뒤에서 생기지 않는다.
export const REINFORCEMENT_INTERVAL = 1800;
// 봉쇄(D22) 중에는 교대가 빨라진다 — 기존 위협의 이동 가속(LOCKDOWN_THREAT_SPEED_MULTIPLIER)과
// 함께 "마지막 장"의 압박을 만든다.
export const REINFORCEMENT_LOCKDOWN_MULTIPLIER = 0.5;

// 전원 차단(D12) — 그 구역 경계도 상승을 잠시 멈춘다. 대가는 큰 소음과, 그동안 그 구역의
// 전자식 자물쇠를 열 수 없다는 것이다(전원이 없으니 해킹할 제어가 없다. 문을 뜯는 Force는 된다).
export const POWER_CUT_DURATION = 600;
export const POWER_CUT_TIME = 120;
export const POWER_CUT_NOISE = 3;

// 가짜 목표 송출(D12) — 경계를 인접 구역으로 옮긴다. 총량은 보존된다.
export const FALSE_BROADCAST_TIME = 130;
export const FALSE_BROADCAST_OVERLOAD = 6;
export const FALSE_BROADCAST_INTENSITY = 2;
/** 심어둔 가짜 목표가 유지되는 시간 — 소음(100)보다 길어야 위협이 실제로 그쪽까지 걸어간다. */
export const FALSE_BROADCAST_DURATION = 300;

// 구역 링(SECTOR_IDS) 위에서 서로 맞닿은 구역. 경계도를 옮기거나(D12 가짜 목표 송출) 인접
// 구역까지 낮출 때(통제실 해킹 3단계) 쓰는 유일한 인접 정의다 — 기하학적 배치가 이 링 순서를
// 그대로 따르므로(SECTOR_RING_RADIUS 참고) 링 이웃이 곧 실제로 걸어서 넘어가는 이웃이다.
/** @type {Record<string, import('../engine/types.js').FacilitySectorId[]>} */
export const ADJACENT_SECTOR_IDS = Object.fromEntries(SECTOR_IDS.map((id, i) => [
  id,
  [SECTOR_IDS[(i + SECTOR_IDS.length - 1) % SECTOR_IDS.length], SECTOR_IDS[(i + 1) % SECTOR_IDS.length]],
]));

// ---- Capability 층계 (§5단계, D8) ----
// 요구치 R, 실효 A의 차이로 단계가 갈린다. A ≥ R+1 surplus / A = R standard /
// A = R-1 strained / A = R-2 severe / A ≤ R-3 impossible.
//
// 핵심은 부족분을 전부 시간으로 받지 않는 것이다 — 그러면 시간이 다시 단일 통화가 된다.
// Capability마다 받는 통화가 다르고, 아래 표가 그 통화별 수치다.

/** 모든 단계에 공통으로 걸리는 시간 배수. Mobility와 Perception은 이것이 주 통화다. */
export const CAPABILITY_STEP_TIME_MULTIPLIER = { surplus: 0.75, standard: 1, strained: 1.4, severe: 2 };
/** Force — 힘으로 밀어붙이면 시끄럽다. severe에서는 장비도 상한다. */
export const CAPABILITY_STEP_NOISE_DELTA = { surplus: -1, standard: 0, strained: 1, severe: 2 };
export const CAPABILITY_STEP_DURABILITY_LOSS = { surplus: 0, standard: 0, strained: 0, severe: 1 };
/** Hacking — 서툴수록 시스템에 부하가 남는다(D9 역탐지 게이지는 5단계 범위 밖). */
export const CAPABILITY_STEP_OVERLOAD_DELTA = { surplus: -3, standard: 0, strained: 6, severe: 14 };
/** Mobility — 무리하면 몸이 상한다. playerState.hp라 커맨드 래퍼에서 반영한다. */
export const CAPABILITY_STEP_HP_COST = { surplus: 0, standard: 0, strained: 3, severe: 8 };
/** Deception — 어설픈 속임수는 오래 못 간다. */
export const CAPABILITY_STEP_DURATION_MULTIPLIER = { surplus: 1.25, standard: 1, strained: 0.5, severe: 0.25 };
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

export const SUPPLY_FARM_TIME = 90;
export const SUPPLY_FARM_NOISE = 1;
/** @type {Record<'normal'|'elite', number>} */
export const PRIZE_FARM_TIME = { normal: 200, elite: 260 };
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

// ---- Overload (§8) ----

export const OVERLOAD_MELTDOWN = 100;
export const OVERLOAD_MIN = 0;

// ---- 공통 접근 모드 (§6.1) ----

export const APPROACH_TIME_DELTA = { safe: 40, normal: 0, rush: -40 };
export const APPROACH_NOISE_DELTA = { safe: -1, normal: 0, rush: 1 };
export const APPROACH_MIN_TIME = 20;

// ---- 기본 맵 행동 (§6.2) ----

export const BASIC_RECON_TIME = 80;

// ---- Capability 행동표 tier 1 (§6.3) — MVP는 tier 1 접근만 구현한다. 더 높은 tier(예: Force
// 2~4의 바리케이드 파괴·구조물 붕괴)는 이후 단계 과제로 남긴다.
export const FORCE_TIER1_TIME = 100;
export const FORCE_BASE_NOISE = 2; // §6.3 "Force 기본 소음은 2와 흔적이다."
export const HACKING_TIER1_TIME = 80;
export const HACKING_BASE_NOISE = 0;
// §8.2 "Hacking 1/2/3/4 신속 접근 +3/+6/+9/+12" — MVP는 tier 1의 +3만 사용한다.
export const HACKING_TIER1_OVERLOAD_GAIN = 3;
export const RUSH_OVERLOAD_GAIN = 6; // §8.2 "강행 접근의 Overload 대가 +6"
