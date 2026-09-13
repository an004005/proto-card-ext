// Status metadata for the Card Extraction ruleset (docs/terminology.md).
// weak/vulnerable decay at the end of the holder's own turn (same rule as before).
// armor converts to block right before the holder would be attacked — end of the player's own
// turn, or start of an enemy's own turn — then decays by 1.
// stun causes the holder to skip their next action; their already-rolled move carries over
// to the following turn instead of being re-rolled (enemies only in this prototype).
// reflect is consumed the next time its holder takes damage (튕겨내기), not turn-based decay.
import { MODULE_POWER_STAGE_TABLES } from './modules.js';

/** `0단계 +1 / 1단계 +2 / 2단계 +2` — 설명문이 실제 표를 읽어 쓰도록.
 * @param {string} power @returns {string} */
function stageBonusText(power) {
  return MODULE_POWER_STAGE_TABLES[power]
    .slice(0, OVERLOAD_STAGE_NAMES.length)
    .map((bonus, stage) => `${stage}단계 +${bonus}`)
    .join(' / ');
}

/**
 * 과부화 단계의 공식 이름. 카드 툴팁·과부화 게이지·용어집이 전부 이 한 벌을 쓴다 — 같은 단계를
 * 화면마다 다르게 부르면 플레이어는 그것이 같은 것인 줄 모른다(리뷰 B7).
 * @type {string[]}
 */
export const OVERLOAD_STAGE_NAMES = ['노멀', '강화', '과열'];
/** 게이지·툴팁이 쓰는 긴 표기. 2단계의 대가(코스트 +1)를 이름에 달고 다닌다. */
export const OVERLOAD_STAGE_LABELS = ['0단계 노멀', '1단계 강화', '2단계 과열(비용 +1)'];

/** @type {string[]} */
export const DECAYING_STATUSES = ['weak', 'vulnerable', 'fragile', 'entangled'];
/** 디버프로 취급되어 인공물(artifact)이 스택당 1회 무시할 수 있는 상태이상. */
export const DEBUFF_STATUSES = ['weak', 'vulnerable', 'fragile', 'entangled', 'constrict', 'stun', 'poison'];
/** @type {Object.<string, string>} */
export const STATUS_LABELS = {
  weak: '약화',
  vulnerable: '취약',
  armor: '갑옷',
  stun: '스턴',
  reflect: '반사',
  atkBonus: '공격력+',
  fragile: '손상',
  entangled: '뒤얽힘',
  constrict: '조이기',
  artifact: '인공물',
  strength: '힘',
  dexterity: '민첩',
  poison: '중독',
};

// Active module powers — not part of `statuses`, but still worth surfacing during combat so
// the player can see what's currently boosting their cards. forcefieldDefense (역장 방어) isn't
// tracked here — casting it just grants a plain 갑옷(armor) stack, nothing power-like lingers.
/** @type {Object.<string, string>} */
export const POWER_LABELS = {
  neuralBoost: '신경 강화',
  bodyBoost: '신체 강화',
  spatialAwareness: '공간 지각',
  // 화면에 내부 키('sandevistan')가 그대로 뜨던 자리(리뷰 B2).
  sandevistan: '산데비스탄',
};
/**
 * 설명문에는 문서 절 번호가 아니라 실제 수치를 적는다 — "§9 참고"는 플레이 중에 확인할 수
 * 없는 안내다(리뷰 B2). 수치는 MODULE_POWER_STAGE_TABLES 한 자리에서만 나온다.
 * @type {Object.<string, string>}
 */
export const POWER_DESCRIPTIONS = {
  neuralBoost: `모든 방어 획득에 과부화 단계별 보너스: ${stageBonusText('neuralBoost')}.`,
  bodyBoost: `근접 공격 피해에 과부화 단계별 보너스: ${stageBonusText('bodyBoost')}.`,
  spatialAwareness: `원거리 공격 피해에 과부화 단계별 보너스: ${stageBonusText('spatialAwareness')}.`,
  sandevistan: '활성화 동안 매 턴 에너지 +1.',
};

/** @type {Object.<string, string>} */
export const STATUS_DESCRIPTIONS = {
  weak: '주는 피해 0.75배. 보유자 턴 종료 시 스택 1 감소.',
  vulnerable: '받는 피해 1.5배. 보유자 턴 종료 시 스택 1 감소.',
  armor: '보유자 턴이 끝날 때(플레이어) 또는 시작할 때(적) 스택만큼 방어도 획득, 이후 스택 1 감소.',
  stun: '이번 행동을 건너뜀. 원래 하려던 행동은 다음 턴에 수행.',
  reflect: '피격 시 스택만큼 공격자에게 반사 피해, 이후 소멸.',
  atkBonus: '이 대상이 가하는 피해에 고정 보너스로 합산됨.',
  fragile: '카드로 얻는 방어도 0.75배. 보유자 턴 종료 시 스택 1 감소.',
  entangled: '공격 카드 코스트에 스택만큼 가산. 보유자 턴 종료 시 스택 1 감소.',
  constrict: '보유자(플레이어) 턴 종료 시 고정 1피해(방어도로 막을 수 있음). 시전한 적이 죽으면 소멸, 그 외엔 감소하지 않음.',
  artifact: '디버프(약화/취약/손상/뒤얽힘/조이기/스턴/중독)를 부여받을 때마다 스택 1을 소모해 대신 무효화.',
  strength: '가하는 공격 피해에 스택만큼 고정 보너스. 감소하지 않음(전투 종료까지 유지).',
  dexterity: '획득하는 방어도에 스택만큼 고정 보너스. 감소하지 않음(전투 종료까지 유지).',
  poison: '보유자 턴이 시작될 때 스택만큼 고정 피해(방어도 무시), 이후 스택 1 감소.',
};
