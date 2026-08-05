// Status metadata for the Card Extraction ruleset (기획서 §7.1).
// weak/vulnerable decay at the end of the holder's own turn (same rule as before).
// armor converts to block right before the holder would be attacked — end of the player's own
// turn, or start of an enemy's own turn — then decays by 1 (§7.1).
// stun causes the holder to skip their next action; their already-rolled move carries over
// to the following turn instead of being re-rolled (§7.1, enemies only in this prototype).
// reflect is consumed the next time its holder takes damage (튕겨내기), not turn-based decay.
export const DECAYING_STATUSES = ['weak', 'vulnerable'];
export const STATUS_LABELS = {
  weak: '약화',
  vulnerable: '취약',
  armor: '갑옷',
  stun: '스턴',
  reflect: '반사',
  atkBonus: '공격력+',
};

// Active module powers / one-shot buffs — not part of `statuses`, but still worth surfacing
// during combat so the player can see what's currently boosting their cards.
export const POWER_LABELS = {
  neuralBoost: '신경 강화',
  bodyBoost: '신체 강화',
  spatialAwareness: '공간 지각',
  forcefieldDefense: '역장 방어',
};
export const POWER_DESCRIPTIONS = {
  neuralBoost: '모든 방어 획득에 현재 과부화 단계 기준 보너스가 붙습니다 (단계별 수치는 §9 참고).',
  bodyBoost: '근접 공격 피해에 현재 과부화 단계 기준 보너스가 붙습니다.',
  spatialAwareness: '원거리 공격 피해에 현재 과부화 단계 기준 보너스가 붙습니다.',
  forcefieldDefense: '사용 시점에 고정된 만큼 갑옷 스택을 1회 획득합니다 (턴 종료 시 방어도로 전환).',
};

export const STATUS_DESCRIPTIONS = {
  weak: '주는 피해 0.75배. 보유자 턴 종료 시 스택 1 감소.',
  vulnerable: '받는 피해 1.5배. 보유자 턴 종료 시 스택 1 감소.',
  armor: '보유자 턴이 끝날 때(플레이어) 또는 시작할 때(적) 스택만큼 방어도 획득, 이후 스택 1 감소.',
  stun: '이번 행동을 건너뜀. 원래 하려던 행동은 다음 턴에 수행.',
  reflect: '피격 시 스택만큼 공격자에게 반사 피해, 이후 소멸.',
  atkBonus: '이 대상이 가하는 피해에 고정 보너스로 합산됨.',
};
