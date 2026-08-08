import { DECAYING_STATUSES, DEBUFF_STATUSES } from '../data/statusEffects.js';
import { applyStageScale } from './overloadEngine.js';

/** @typedef {import('./types.js').Statuses} Statuses */

/**
 * @param {Statuses} statuses
 * @param {string} key
 * @returns {number}
 */
export function getStacks(statuses, key) {
  return statuses[key] || 0;
}

/**
 * 인공물(artifact): 디버프(§DEBUFF_STATUSES) 부여를 스택당 1회 대신 무효화한다 — 부여 자체를
 * 막고 인공물 스택만 1 소모한다. 모든 상태 부여가 이 함수를 거치므로(적용 위치 무관) 여기
 * 한 곳에서만 처리하면 카드/소모품/몬스터 무브 전부 자동으로 규칙을 따른다.
 * @param {Statuses} statuses
 * @param {string} key
 * @param {number} amount
 * @returns {Statuses}
 */
export function applyStatus(statuses, key, amount) {
  if (amount > 0 && DEBUFF_STATUSES.includes(key) && (statuses.artifact || 0) > 0) {
    return applyStatus(statuses, 'artifact', -1);
  }
  const next = { ...statuses };
  const value = (next[key] || 0) + amount;
  if (DECAYING_STATUSES.includes(key)) {
    if (value <= 0) delete next[key];
    else next[key] = value;
  } else if (value <= 0) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/**
 * weak/vulnerable/fragile/entangled decay by 1 at the end of the holder's own turn (기획서 §7.1).
 * @param {Statuses} statuses
 * @returns {Statuses}
 */
export function decayStatusesAtTurnEnd(statuses) {
  const next = { ...statuses };
  for (const key of DECAYING_STATUSES) {
    if (next[key] === undefined) continue;
    const value = next[key] - 1;
    if (value <= 0) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * 갑옷: 턴 시작 시 스택만큼 방어도 획득, 매턴 스택 1 감소 (기획서 §7.1).
 * @template {{block: number, statuses: Statuses}} T
 * @param {T} combatant
 * @returns {T}
 */
export function applyArmorAtTurnStart(combatant) {
  const armorStacks = getStacks(combatant.statuses, 'armor');
  if (armorStacks <= 0) return combatant;
  const nextArmor = armorStacks - 1;
  const statuses = { ...combatant.statuses };
  if (nextArmor <= 0) delete statuses.armor;
  else statuses.armor = nextArmor;
  return { ...combatant, block: combatant.block + armorStacks, statuses };
}

/**
 * Damage formula: stage-scale base -> + flat module/atk bonuses -> weak (x0.75) -> vulnerable (x1.5).
 * @param {number} baseValue
 * @param {{stage: number, scalesWithStage: boolean, flatBonus?: number, weak?: boolean, vulnerable?: boolean}} opts
 * @returns {number}
 */
export function computeDamage(baseValue, { stage, scalesWithStage, flatBonus = 0, weak = false, vulnerable = false }) {
  let amount = applyStageScale(baseValue, stage, scalesWithStage) + flatBonus;
  if (weak) amount = Math.floor(amount * 0.75);
  if (vulnerable) amount = Math.floor(amount * 1.5);
  return Math.max(0, amount);
}

/**
 * Block formula: stage-scale base -> + flat module bonus -> fragile (x0.75, 손상).
 * @param {number} baseValue
 * @param {{stage: number, scalesWithStage: boolean, flatBonus?: number, fragile?: boolean}} opts
 * @returns {number}
 */
export function computeBlock(baseValue, { stage, scalesWithStage, flatBonus = 0, fragile = false }) {
  let amount = applyStageScale(baseValue, stage, scalesWithStage) + flatBonus;
  if (fragile) amount = Math.floor(amount * 0.75);
  return Math.max(0, amount);
}

/**
 * Block absorbs 1:1 and excess is lost, unless ignoresBlock (§9 투시 1단계) bypasses it entirely.
 * @template {{hp: number, block: number}} T
 * @param {T} target
 * @param {number} amount
 * @param {boolean} [ignoresBlock]
 * @returns {T}
 */
export function applyDamage(target, amount, ignoresBlock = false) {
  if (ignoresBlock) {
    return { ...target, hp: Math.max(0, target.hp - amount) };
  }
  const absorbed = Math.min(target.block, amount);
  const overflow = amount - absorbed;
  return { ...target, block: target.block - absorbed, hp: Math.max(0, target.hp - overflow) };
}
