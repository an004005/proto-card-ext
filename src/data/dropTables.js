// Drop tables (기획서 §12.1, §14b). 전투 승리 후 자동 지급 방식은 rewardEngine.js(§신규
// 보상 화면)로 대체됨 — 이 파일에는 미지의 방 2택1에 쓰이는 기습 확률/소모품 가중치만 남는다.
/** @type {{value: string, weight: number}[]} */
export const CONSUMABLE_DROP_WEIGHTS = [
  { value: 'stabilizer', weight: 0.4 },
  { value: 'bandage', weight: 0.3 },
  { value: 'flashbang', weight: 0.2 },
  { value: 'grenade', weight: 0.1 },
];

/**
 * 미지의 방 2택1 (§13.1을 대체): 휴식(10%회복) / 파밍(효과 없음), 둘 다 기습 위험을 감수.
 * @type {Object.<string, {ambushChance: number, hpRestorePercent?: number, overloadReduce?: number}>}
 */
export const POST_COMBAT_CHOICES = {
  farm: { ambushChance: 0.3 },
  rest: { ambushChance: 0.15, hpRestorePercent: 0.1, overloadReduce: 30 },
};
