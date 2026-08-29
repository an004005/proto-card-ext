// Drop tables. 전투 승리 후 자동 지급 방식은 rewardEngine.js의 보상 화면 경로로 처리된다.
import { pick } from '../engine/rng.js';

/** @type {{value: string, weight: number}[]} */
export const CONSUMABLE_DROP_WEIGHTS = [
  { value: 'stabilizer', weight: 0.4 },
  { value: 'bandage', weight: 0.3 },
  { value: 'flashbang', weight: 0.2 },
  { value: 'grenade', weight: 0.1 },
];

// 위협 그룹(§9) → 몬스터 매핑. ThreatRoster/ThreatRuntimeState는 sectorId+size만 갖고 실제
// monsterIds를 갖지 않는다(구현 명세 미기재 갭) — 기존 8층 맵의 조우 풀을 그대로 재사용한다.
// 몬스터 로스터 자체는 원래 구 8층 "과성장 폐허" 테마용이라 시설맵 4구역(입구·관리동/실험동/
// 보안·격리동/동력·정비동)에 딱 맞는 오리지널 콘텐츠는 아니다 — 이름/설정에서 유추한 임의
// 배분(construct/effigy류는 보안·격리동, 기생·슬라임류는 실험동, 덩굴/안개류는 동력·정비동,
// 소형·잡졸류는 입구·관리동)으로 최소한의 구역색만 부여한 간이 v1이며, 정밀 밸런싱·정식 로스터
// 교체는 후속 과제.
/** @type {Record<import('../engine/types.js').FacilitySectorId, {normal: string[][], elite: string[][]}>} */
export const SECTOR_THREAT_POOLS = {
  entrance: {
    normal: [
      ['nibbit', 'nibbit'],
      ['inklet', 'inklet', 'inklet'],
      ['shrinker_beetle'],
    ],
    elite: [['byrdonis']],
  },
  labs: {
    normal: [
      ['shrinker_beetle', 'fuzzy_wurm_crawler'],
      ['mawler'],
      ['flyconid', 'leaf_slime_m'],
      ['leaf_slime_m', 'twig_slime_m'],
    ],
    elite: [['phrog_parasite']],
  },
  security: {
    normal: [
      ['cubex_construct'],
    ],
    elite: [['bygone_effigy']],
  },
  power: {
    normal: [
      ['vine_shambler'],
      ['fogmog'],
      ['slithering_strangler', 'snapping_jaxfruit'],
    ],
    elite: [['bygone_effigy']],
  },
  // 아래 4구역(격납고·물류창고/폐기물 처리장/통신·관제탑/거주동)은 인프라 확장(8구역화)으로
  // 추가됨 — 새 몬스터 콘텐츠를 만들지 않고 기존 로스터를 구역 테마에 맞게 재배분한 v1.
  hangar: {
    normal: [
      ['mawler'],
      ['cubex_construct', 'cubex_construct'],
      ['mawler', 'shrinker_beetle'],
    ],
    elite: [['bygone_effigy']],
  },
  waste: {
    normal: [
      ['fogmog', 'fogmog'],
      ['slithering_strangler'],
      ['vine_shambler', 'snapping_jaxfruit'],
    ],
    elite: [['phrog_parasite']],
  },
  comms: {
    normal: [
      ['cubex_construct'],
      ['flyconid', 'flyconid'],
      ['inklet', 'cubex_construct'],
    ],
    elite: [['bygone_effigy']],
  },
  residential: {
    normal: [
      ['nibbit', 'nibbit'],
      ['inklet', 'shrinker_beetle'],
      ['twig_slime_m', 'leaf_slime_m'],
    ],
    elite: [['byrdonis']],
  },
};

/** @type {{normal: string[][], elite: string[][]}} 구역 무관 폴백/증원 풀 — 전체 위 4구역 풀을 합친 것. */
const ALL_THREAT_ENCOUNTER_TEMPLATES = {
  normal: Object.values(SECTOR_THREAT_POOLS).flatMap((p) => p.normal),
  elite: Object.values(SECTOR_THREAT_POOLS).flatMap((p) => p.elite),
};

/**
 * @param {import('../engine/rng.js').RngState} rngState
 * @param {import('../engine/types.js').FacilitySectorId} sectorId
 * @param {2|3|4} size
 * @returns {{monsterIds: string[], rngState: import('../engine/rng.js').RngState}}
 */
export function pickThreatEncounter(rngState, sectorId, size) {
  const sectorPool = SECTOR_THREAT_POOLS[sectorId] || ALL_THREAT_ENCOUNTER_TEMPLATES;
  const pool = size >= 4 ? sectorPool.elite : sectorPool.normal;
  const { value: monsterIds, state } = pick(rngState, pool.length ? pool : ALL_THREAT_ENCOUNTER_TEMPLATES.normal);
  return { monsterIds, rngState: state };
}

const REINFORCEMENT_MONSTER_POOL = ALL_THREAT_ENCOUNTER_TEMPLATES.normal.flat();

/**
 * 증원(§9.1)으로 한 개체씩 합류하는 몬스터를 뽑는다 — pickThreatEncounter는 그룹 전체를
 * 뽑으므로 단일 개체 합류엔 맞지 않는다.
 * @param {import('../engine/rng.js').RngState} rngState
 * @returns {{monsterId: string, rngState: import('../engine/rng.js').RngState}}
 */
export function pickReinforcementMonster(rngState) {
  const { value, state } = pick(rngState, REINFORCEMENT_MONSTER_POOL);
  return { monsterId: value, rngState: state };
}
