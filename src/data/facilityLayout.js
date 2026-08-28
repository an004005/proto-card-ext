// 160-node extraction facility layout config (docs/extraction-map-implementation-spec.md §4).
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

export const NODES_PER_SECTOR = 20;
export const TOTAL_NODES = SECTOR_IDS.length * NODES_PER_SECTOR;

// Mobility 0 기준 "평균적인" 일반 복도 시간 비용 (구현 명세 §6.2) — 실제 엣지 시간은 이제
// 두 노드의 기하학적 거리에 비례해 가감된다(EDGE_TIME_PER_LENGTH_UNIT 이하 참고). 이 값은
// 그 스케일을 맞추는 기준점일 뿐, 더 이상 모든 엣지에 균일하게 적용되지 않는다.
export const STANDARD_EDGE_TIME_COST = 100;

// ---- 기하학적 배치 (구역 링 + 구역 내부 산포) ----
// 구역 하나당 노드 20개를 원판 안에 무작위로 흩뿌리고("씨 뿌리듯"), 일반(비-특수) 엣지는
// 전역에서 가장 가까운 노드 쌍부터 순서대로 연결한다 — 그래서 자연스럽게 "어느 정도 가까운
// 노드끼리만" 이어지고, 구역 경계를 넘는 일반 엣지는 (같은 구역 안의 더 가까운 짝이 거의 항상
// 먼저 소진되므로) 사실상 발생하지 않는다. 구역을 넘나드는 이동은 아래 특수 엣지(§4.2,
// 구역 내부용/구역 간 전용 두 종류)로만 이루어진다.
export const SECTOR_RING_RADIUS = 900; // 전역 중심에서 각 구역 중심까지 거리.
export const SECTOR_NODE_RADIUS = 280; // 구역 중심에서 그 구역 노드가 흩뿌려지는 반경.

// 같은 구역 안에서 노드끼리 최소 이만큼은 떨어지도록 거부 샘플링(rejection sampling)한다 —
// 순수 무작위 산포는 노드가 겹치거나 거의 붙어버리는 경우가 생겨서, 후보를 여러 번 뽑아 이
// 최소 거리를 만족하는 것만 채택한다(그래도 못 찾으면 지금까지 후보 중 가장 널찍한 것으로
// 타협 — 무한 루프 방지). 반경280·20노드 기준 평균 간격(~111)의 약 절반 수준으로 잡은 값.
export const NODE_MIN_SEPARATION = 55;
export const NODE_PLACEMENT_MAX_ATTEMPTS = 40;

// 엣지 시간 비용 = clamp(round(기하 거리 * EDGE_TIME_PER_LENGTH_UNIT), MIN, MAX). 구역 내부
// 최근접 노드 간 평균 거리(~50 단위)가 STANDARD_EDGE_TIME_COST(100)에 가깝게 나오도록 잡은 값.
export const EDGE_TIME_PER_LENGTH_UNIT = 2;
export const EDGE_TIME_MIN = 40;
export const EDGE_TIME_MAX = 260;

// 일반 엣지 배치: 1차 패스는 노드당 차수 2까지만 채워(가까운 순서대로) 촘촘한 그물을 만들고,
// 2차 패스는 여전히 분리된 컴포넌트가 있으면 차수 4 한도 안에서 가장 가까운 쌍부터 이어 붙여
// 반드시 하나로 연결한다(사실상 Kruskal). 3차 패스는 남은 브릿지(끊기면 그래프가 갈라지는
// 엣지)를 Tarjan 알고리즘으로 찾아 같은 차수 4 한도 안에서 양쪽을 잇는 보강 엣지를 추가해
// 실질적인 2-edge-connectivity를 만든다 — 순수 원형 위상(이전 48노드 설계)이 주던 "구조적으로
// 증명된" 보장은 아니지만, 탈출구 배치가 요구하는 2-edge-disjoint 경로를 사실상 항상
// 만족시키기에 충분하다(node --test로 실측 확인).
export const BASE_EDGE_DEGREE_SOFT_CAP = 2;
export const BASE_EDGE_DEGREE_HARD_CAP = 4;

// 링에서 인접한 구역 쌍(마지막-첫 구역도 순환으로 연결) — 구역 내부 특수 엣지와는 별도로,
// 이 쌍들 사이에만 "구역을 넘는" 특수 엣지를 놓는다(§4.2 확장).
/** @type {[string, string][]} */
export const SECTOR_ADJACENCY = SECTOR_IDS.map((s, i) => [s, SECTOR_IDS[(i + 1) % SECTOR_IDS.length]]);

// 탈출구별 Mobility 0 가중 이동비용 범위 (구현 명세 §2.2). 160노드 스케일에 맞춰 재조정됨 —
// scratchpad 스크립트로 실측한 뒤 확정한 값(아래 facilityGraph.js 상단 주석 참고).
export const EXIT_DISTANCE_RANGES = {
  A: { min: 3200, max: 5000 },
  key: { min: 4600, max: 6700 },
  B: { min: 6000, max: 7600 },
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

/** @type {{value: 'oneWay'|'blocked'|'electronic'|'highGround', weight: number}[]} */
export const SPECIAL_EDGE_CATEGORY_WEIGHTS = [
  { value: 'oneWay', weight: 3 },
  { value: 'blocked', weight: 7 },
  { value: 'electronic', weight: 5 },
  { value: 'highGround', weight: 3 },
];
// 두 번째 태그가 붙을 확률 (예: 전자 보안이 걸린 잠금문). oneWay 엣지는 새 지름길이므로 제외한다.
export const SPECIAL_EDGE_SECOND_TAG_CHANCE = 0.3;

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

// 노드당 현장 기회 개수 분포. 기대값 1.0 = 0*0.25 + 1*0.5 + 2*0.25.
/** @type {{value: 0|1|2, weight: number}[]} */
export const OPPORTUNITY_COUNT_WEIGHTS = [
  { value: 0, weight: 25 },
  { value: 1, weight: 50 },
  { value: 2, weight: 25 },
];
// 현장 기회 하나가 몇 번 파밍 가능한지 — 더 이상 "1회용"이 기본이 아니다. 기대값 ~1.65회.
/** @type {{value: 1|2|3, weight: number}[]} */
export const OPPORTUNITY_USES_WEIGHTS = [
  { value: 1, weight: 45 },
  { value: 2, weight: 35 },
  { value: 3, weight: 20 },
];
export const KEY_DROP_CHANCE = 0.01;

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
// 동력 7 / 폐기물 6 / 통신 4 / 거주 4 (총 40, 48노드 시절 밀도 0.25/노드를 160노드로 유지).
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

// 160노드 스케일(구 EXIT_DISTANCE_RANGES.B 대비 ~3.45배)에 맞춰 재조정됨.
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
export const FARM_TIME = 140;
export const FARM_NOISE = 1;

// ---- Capability 행동표 tier 1 (§6.3) — MVP는 tier 1 접근만 구현한다. 더 높은 tier(예: Force
// 2~4의 바리케이드 파괴·구조물 붕괴)는 이후 단계 과제로 남긴다.
export const FORCE_TIER1_TIME = 100;
export const FORCE_BASE_NOISE = 2; // §6.3 "Force 기본 소음은 2와 흔적이다."
export const HACKING_TIER1_TIME = 80;
export const HACKING_BASE_NOISE = 0;
// §8.2 "Hacking 1/2/3/4 신속 접근 +3/+6/+9/+12" — MVP는 tier 1의 +3만 사용한다.
export const HACKING_TIER1_OVERLOAD_GAIN = 3;
export const RUSH_OVERLOAD_GAIN = 6; // §8.2 "강행 접근의 Overload 대가 +6"
