// 48-node extraction facility layout config (docs/extraction-map-implementation-spec.md §4).
// Data only — no generation logic here (that's src/engine/facilityGraph.js). This module does
// NOT replace mapLayout.js/mapEngine.js yet; the 8-floor map keeps running until a later phase
// wires the new facility graph into gameReducer/MapScreen.

/** @type {import('../engine/types.js').FacilitySectorId[]} */
export const SECTOR_IDS = ['entrance', 'labs', 'security', 'power'];

export const SECTOR_NAMES = {
  entrance: '입구·관리동',
  labs: '실험동',
  security: '보안·격리동',
  power: '동력·정비동',
};

export const NODES_PER_SECTOR = 12;
export const TOTAL_NODES = SECTOR_IDS.length * NODES_PER_SECTOR;

// Mobility 0 기준 일반 복도 시간 비용 (구현 명세 §6.2).
export const STANDARD_EDGE_TIME_COST = 100;

// 구역 사슬 순서 — 48노드를 이 순서로 이어붙인 하나의 긴 사슬(체인) 위에 배치한다. power가
// security를 거쳐야만 닿는 "먼" 구역이 되게 하는 순서다. 인접 구역 쌍(체인에서 경계를 맞댄
// 쌍)은 [entrance,labs], [labs,security], [security,power] 세 쌍이다.
// 사슬 하나로 만드는 이유: 4구역을 서로 촘촘히 잇는 그래프는 지름이 12홉을 넘지 못해(실측
// 확인됨) 탈출구 B의 목표(가중 이동비용 1800~2200, 약 18~22홉)를 만들 수 없었다. 체인 + 2칸
// 건너뛰기 지름길(skip edge)을 쓰면 지름이 커지면서도 각 지점이 항상 두 방향 이상으로
// 연결되어(양 옆 spine + 양옆 skip) 2-edge-disjoint 경로 요구도 함께 만족한다.
/** @type {[string, string][]} */
export const SECTOR_ADJACENCY = [
  ['entrance', 'labs'],
  ['labs', 'security'],
  ['security', 'power'],
];

// 체인 위에서 두 칸 건너뛰는 지름길 엣지의 간격. 이 값이 그래프 전체의 최단 경로를
// ceil(포지션 거리 / GLOBAL_SKIP_STEP)홉으로 만들고, 동시에 모든 내부 노드의 차수를 4로,
// 체인 양끝만 2로 만들어 §4.1의 "차수 2~4 목표"를 자동으로 만족시킨다.
export const GLOBAL_SKIP_STEP = 2;

// 탈출구별 Mobility 0 가중 이동비용 범위 (구현 명세 §2.2).
export const EXIT_DISTANCE_RANGES = {
  A: { min: 1000, max: 1500 },
  key: { min: 1400, max: 2000 },
  B: { min: 1800, max: 2200 },
};

export const SPECIAL_EDGES_PER_SECTOR_MIN = 3;
export const SPECIAL_EDGES_PER_SECTOR_MAX = 4;

/** @type {{value: 'oneWay'|'blocked'|'electronic', weight: number}[]} */
export const SPECIAL_EDGE_CATEGORY_WEIGHTS = [
  { value: 'oneWay', weight: 3 },
  { value: 'blocked', weight: 7 },
  { value: 'electronic', weight: 5 },
];
// 두 번째 태그가 붙을 확률 (예: 전자 보안이 걸린 잠금문). oneWay 엣지는 새 지름길이므로 제외한다.
export const SPECIAL_EDGE_SECOND_TAG_CHANCE = 0.3;

export const LANDMARKS_BY_SECTOR = {
  entrance: { id: 'security_records_room', name: '보안 기록실', approaches: ['perception', 'hacking', 'force'] },
  labs: { id: 'quarantine_vault', name: '격리 표본고', approaches: ['stealth', 'force', 'hacking'] },
  security: { id: 'central_control', name: '중앙 관제실', approaches: ['hacking', 'deception', 'force'] },
  power: { id: 'main_generator', name: '주 발전기', approaches: ['force', 'hacking', 'mobility'] },
};

// 노드당 현장 기회 개수 분포. 기대값 1.0 = 0*0.25 + 1*0.5 + 2*0.25.
/** @type {{value: 0|1|2, weight: number}[]} */
export const OPPORTUNITY_COUNT_WEIGHTS = [
  { value: 0, weight: 25 },
  { value: 1, weight: 50 },
  { value: 2, weight: 25 },
];
export const KEY_DROP_CHANCE = 0.01;

// 초기 위협 배치 (구역 순서는 SECTOR_IDS와 일치): 입구 2 / 실험 3 / 보안 4 / 동력 3.
export const THREAT_COUNT_BY_SECTOR = { entrance: 2, labs: 3, security: 4, power: 3 };
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

export const RUN_COLLAPSE_TIME = 4000; // §2.3 t===4000 붕괴, 다른 모든 사건보다 우선.
export const WORLD_TICK_INTERVAL = 10; // §5.1 "전역 시간이 10 시간 포인트 진행될 때마다 1회".

export const EXIT_A_DISABLED_AT = 2500;
export const EXIT_B_DISABLED_AT = 3900;
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
