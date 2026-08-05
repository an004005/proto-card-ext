import { DECAYING_STATUSES } from '../data/statusEffects.js';
import { applyStageScale } from './overloadEngine.js';

export function getStacks(statuses, key) {
  return statuses[key] || 0;
}

export function applyStatus(statuses, key, amount) {
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

// weak/vulnerable decay by 1 at the end of the holder's own turn (기획서 §7.1).
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

// 갑옷: 턴 시작 시 스택만큼 방어도 획득, 매턴 스택 1 감소 (기획서 §7.1).
export function applyArmorAtTurnStart(combatant) {
  const armorStacks = getStacks(combatant.statuses, 'armor');
  if (armorStacks <= 0) return combatant;
  const nextArmor = armorStacks - 1;
  const statuses = { ...combatant.statuses };
  if (nextArmor <= 0) delete statuses.armor;
  else statuses.armor = nextArmor;
  return { ...combatant, block: combatant.block + armorStacks, statuses };
}

// Damage formula: stage-scale base -> + flat module/atk bonuses -> weak (x0.75) -> vulnerable (x1.5).
export function computeDamage(baseValue, { stage, scalesWithStage, flatBonus = 0, weak = false, vulnerable = false }) {
  let amount = applyStageScale(baseValue, stage, scalesWithStage) + flatBonus;
  if (weak) amount = Math.floor(amount * 0.75);
  if (vulnerable) amount = Math.floor(amount * 1.5);
  return Math.max(0, amount);
}

// Block formula: stage-scale base -> + flat module bonus. No frail-equivalent in this ruleset.
export function computeBlock(baseValue, { stage, scalesWithStage, flatBonus = 0 }) {
  const amount = applyStageScale(baseValue, stage, scalesWithStage) + flatBonus;
  return Math.max(0, amount);
}

// Block absorbs 1:1 and excess is lost, unless ignoresBlock (§9 투시 1단계) bypasses it entirely.
export function applyDamage(target, amount, ignoresBlock = false) {
  if (ignoresBlock) {
    return { ...target, hp: Math.max(0, target.hp - amount) };
  }
  const absorbed = Math.min(target.block, amount);
  const overflow = amount - absorbed;
  return { ...target, block: target.block - absorbed, hp: Math.max(0, target.hp - overflow) };
}
