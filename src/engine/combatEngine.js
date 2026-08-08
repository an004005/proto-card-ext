// Pure combat state machine for the Card Extraction ruleset. Every export is
// (state, ...args) => newState — no DOM/Preact, runnable headlessly under `node --test`.
import * as cardEngine from './cardEngine.js';
import { computeDamage, computeBlock, applyDamage, decayStatusesAtTurnEnd, applyStatus, applyArmorAtTurnStart } from './statusEngine.js';
import { getStage, gainOverload, isLethalOverload } from './overloadEngine.js';
import { currentMove, advanceAiState, createInitialAiState } from './monsterAI.js';
import { isItemBurdenGivenOrder } from './inventoryEngine.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import { MODULE_POWER_STAGE_TABLES } from '../data/modules.js';

/** @typedef {import('./types.js').RngState} RngState */
/** @typedef {import('./types.js').CombatState} CombatState */
/** @typedef {import('./types.js').PlayerCombatState} PlayerCombatState */
/** @typedef {import('./types.js').EnemyState} EnemyState */
/** @typedef {import('./types.js').CardDef} CardDef */
/** @typedef {import('./types.js').CardEffect} CardEffect */
/** @typedef {import('./types.js').Move} Move */
/** @typedef {import('./types.js').Statuses} Statuses */
/** @typedef {import('./types.js').EffectContext} EffectContext */

const HAND_SIZE = 5;

// ---- card resolution helpers ----

/**
 * @param {CardDef} def
 * @param {number} stage
 * @returns {{cost: number, effects: CardEffect[], armorPerTurn?: number}}
 */
export function resolveCard(def, stage) {
  if (def.stageTable) {
    const row = def.stageTable[Math.min(stage, 3)];
    return { cost: row.cost, effects: row.effects || [], armorPerTurn: row.armorPerTurn };
  }
  return { cost: def.cost, effects: def.effects || [] };
}

/**
 * @param {CardDef} def
 * @param {number} stage
 * @param {Object.<string, {active: boolean}>} powers
 * @returns {number}
 */
function getCostModifierFromPowers(def, stage, powers) {
  let mod = 0;
  if (powers.neuralBoost && stage === 3 && def.type === 'skill') mod += 1;
  if (powers.bodyBoost && stage === 3 && def.attackKind === 'melee') mod += 1;
  if (powers.spatialAwareness && (stage === 2 || stage === 3) && def.attackKind === 'ranged') mod += 1;
  return mod;
}

/**
 * 뒤얽힘(entangled): 부여된 턴 동안 공격 카드 코스트에 스택만큼 가산.
 * @param {CardDef} def
 * @param {Statuses} statuses
 * @returns {number}
 */
function getCostModifierFromStatuses(def, statuses) {
  if (def.type !== 'attack') return 0;
  return (statuses && statuses.entangled) || 0;
}

/**
 * Effective energy cost for UI display (hand cards show this, not the flat def.cost — module
 * power cost surcharges and stageTable costs both vary with the current overload stage).
 * @param {CardDef} def
 * @param {number} stage
 * @param {Object.<string, {active: boolean}>} powers
 * @param {Statuses} [statuses]
 * @returns {number}
 */
export function getEffectiveCost(def, stage, powers, statuses = {}) {
  const resolved = resolveCard(def, stage);
  return Math.max(0, resolved.cost + getCostModifierFromPowers(def, stage, powers) + getCostModifierFromStatuses(def, statuses));
}

/**
 * @param {number} stage
 * @param {Object.<string, {active: boolean}>} powers
 * @returns {number}
 */
function getModuleBlockBonus(stage, powers) {
  return powers.neuralBoost ? MODULE_POWER_STAGE_TABLES.neuralBoost[stage] : 0;
}

/**
 * @param {?('melee'|'ranged')} attackKind
 * @param {number} stage
 * @param {Object.<string, {active: boolean}>} powers
 * @returns {number}
 */
function getModuleDamageBonus(attackKind, stage, powers) {
  if (attackKind === 'melee' && powers.bodyBoost) return MODULE_POWER_STAGE_TABLES.bodyBoost[stage];
  if (attackKind === 'ranged' && powers.spatialAwareness) return MODULE_POWER_STAGE_TABLES.spatialAwareness[stage];
  return 0;
}

/**
 * Card definitions carry per-effect targets (e.g. all_enemies on an AoE damage effect) rather
 * than one flat card.target — this scans them once so the UI knows how to route a drag/drop.
 * @param {CardDef} def
 * @returns {'machine_enemy'|'enemy'|'all_enemies'|'none'}
 */
export function getCardTargetKind(def) {
  const effects = def.stageTable ? (def.stageTable[0].effects || []) : (def.effects || []);
  for (const e of effects) {
    if (e.kind === 'applyStun') return e.target === 'machine_enemy' ? 'machine_enemy' : 'enemy';
    if (e.target === 'all_enemies') return 'all_enemies';
    if (e.kind === 'damage' && !e.target) return 'enemy';
    if (e.kind === 'applyStatus' && e.target === 'enemy') return 'enemy';
  }
  return 'none';
}

/**
 * @param {CombatState} state
 * @param {string} instanceId
 * @returns {boolean}
 */
export function isCardPlayable(state, instanceId) {
  const card = state.piles.hand.find((c) => c.instanceId === instanceId);
  if (!card) return false;
  const def = CARD_DEFINITIONS[card.defId];
  if (def.unplayable) {
    if (!card.itemId) return false;
    if (!isItemBurdenGivenOrder(state.player.inventoryItemIdsInOrder, state.player.removedItemIds, state.player.inventoryCapacity, card.itemId)) return false;
  }
  const stage = getStage(state.overload);
  const resolved = resolveCard(def, stage);
  const cost = resolved.cost + getCostModifierFromStatuses(def, state.player.statuses);
  if (state.player.energy < cost) return false;
  if (def.ammoCost && state.player.ammo < def.ammoCost) return false;
  return true;
}

// ---- combat creation ----

/**
 * Reused both for the initial roster (createCombatState) and for mid-combat summons
 * (move.summon, e.g. 포그모그's 톱니눈) — both need a fresh, uniquely-id'd enemy instance with
 * its AI state (and any `random` first-move branch) resolved via rngState.
 * @param {string} defId
 * @param {number|string} idSuffix
 * @param {number} staggerIndex
 * @param {number} [hpMultiplier]
 * @param {boolean} [doubleActionActive]
 * @param {RngState} rngState
 * @returns {{enemy: EnemyState, rngState: RngState}}
 */
function createEnemyInstance(defId, idSuffix, staggerIndex, hpMultiplier, doubleActionActive, rngState) {
  const def = MONSTER_DEFINITIONS[defId];
  if (!def) throw new Error(`Unknown monster defId "${defId}"`);
  const hp = Math.round(def.hp * (hpMultiplier || 1));
  const created = createInitialAiState(defId, staggerIndex, rngState);
  const enemy = {
    id: `${defId}-${idSuffix}`, defId, name: def.name,
    hp, maxHp: hp, block: 0, statuses: { ...(def.startingStatuses || {}) },
    isMachine: !!def.isMachine, phase: 1, phaseTransitioned: false,
    doubleActionActive: !!(def.doubleActionIfPlayerHasBurden && doubleActionActive),
    aiState: created.aiState, intent: currentMove(defId, created.aiState, 1),
  };
  return { enemy, rngState: created.rngState };
}

/**
 * @param {Object} params
 * @param {{defId: string, itemId?: string}[]} params.deckEntries
 * @param {string[]} params.monsterIds
 * @param {number} [params.hpMultiplier]
 * @param {number} params.playerHp
 * @param {number} params.playerMaxHp
 * @param {number} params.ammo
 * @param {number} params.overload
 * @param {number} params.overloadFloor
 * @param {number} params.overloadGainMultiplier
 * @param {number} [params.extraDrawPerTurn]
 * @param {number} [params.turnStartAoeDamage]
 * @param {string[]} [params.inventoryItemIdsInOrder]
 * @param {number} [params.inventoryCapacity]
 * @param {boolean} [params.hasBurdenItems]
 * @param {RngState} params.rngState
 * @returns {CombatState} phase 'setup' — caller must run beginPlayerFirst() or beginEnemyFirst()
 */
export function createCombatState({
  deckEntries, monsterIds, hpMultiplier, playerHp, playerMaxHp, ammo,
  overload, overloadFloor, overloadGainMultiplier, extraDrawPerTurn, turnStartAoeDamage,
  inventoryItemIdsInOrder, inventoryCapacity, hasBurdenItems, rngState,
}) {
  const piles = cardEngine.createEmptyPiles();
  const deck = cardEngine.buildDeck(deckEntries);
  const shuffled = cardEngine.shuffleIntoDrawPile(piles, deck, rngState);

  const staggerCounts = {};
  const enemies = [];
  let rng = shuffled.rngState;
  monsterIds.forEach((defId, index) => {
    const stagger = staggerCounts[defId] || 0;
    staggerCounts[defId] = stagger + 1;
    const created = createEnemyInstance(defId, index, stagger, hpMultiplier, hasBurdenItems, rng);
    enemies.push(created.enemy);
    rng = created.rngState;
  });

  // phase 'setup' — caller must run beginPlayerFirst() or beginEnemyFirst() (ambush, §7.3)
  // to actually open the combat; neither has happened yet.
  return {
    phase: 'setup',
    turn: 1,
    overload, overloadFloor, overloadGainMultiplier,
    player: {
      hp: playerHp, maxHp: playerMaxHp, block: 0,
      energy: 3, maxEnergy: 3, ammo,
      statuses: {}, powers: {}, temporaryEffects: {},
      extraDrawPerTurn: extraDrawPerTurn || 0,
      turnStartAoeDamage: turnStartAoeDamage || 0,
      inventoryItemIdsInOrder: inventoryItemIdsInOrder || [],
      inventoryCapacity: inventoryCapacity || 30,
      removedItemIds: [],
    },
    enemies,
    piles: shuffled.piles,
    rngState: rng,
  };
}

/** 정상 진입: 플레이어 턴부터 시작. @param {CombatState} state @returns {CombatState} */
export function beginPlayerFirst(state) {
  return startPlayerTurn(state);
}

/** 기습(§7.3): 적 선공 1턴 — 첫 인텐트를 즉시 실행한 뒤 플레이어 턴으로 넘어감. @param {CombatState} state @returns {CombatState} */
export function beginEnemyFirst(state) {
  let s = { ...state, phase: 'enemy_turn' };
  s = resolveEnemyTurn(s);
  if (s.phase !== 'enemy_turn') return s; // defeated before ever taking a turn
  s = { ...s, turn: s.turn + 1 };
  return startPlayerTurn(s);
}

/** @param {CombatState} state @returns {CombatState} */
export function startPlayerTurn(state) {
  let player = { ...state.player, block: 0, energy: state.player.maxEnergy };

  const drawCount = HAND_SIZE + (player.extraDrawPerTurn || 0);
  const drawn = cardEngine.drawCards(state.piles, drawCount, state.rngState);

  let s = { ...state, player, piles: drawn.piles, rngState: drawn.rngState, phase: 'player_turn' };

  // 임플란트⑥ 매턴 시작 광역 3 피해 (§10) — flat, unaffected by weak/vulnerable (implant, not a card).
  if (s.player.turnStartAoeDamage) {
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.hp > 0 ? applyDamage(e, s.player.turnStartAoeDamage, false) : e)),
    };
    s = checkWinLoss(s);
  }
  return s;
}

// ---- effect interpreter ----

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {?string} enemyId
 * @returns {PlayerCombatState|EnemyState|undefined}
 */
function getCombatant(state, scope, enemyId) {
  return scope === 'player' ? state.player : state.enemies.find((e) => e.id === enemyId);
}

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {?string} enemyId
 * @param {PlayerCombatState|EnemyState} updated
 * @returns {CombatState}
 */
function setCombatant(state, scope, enemyId, updated) {
  if (scope === 'player') return { ...state, player: /** @type {PlayerCombatState} */ (updated) };
  return { ...state, enemies: state.enemies.map((e) => (e.id === enemyId ? /** @type {EnemyState} */ (updated) : e)) };
}

/** @param {CombatState} state @returns {EnemyState[]} */
function livingEnemies(state) {
  return state.enemies.filter((e) => e.hp > 0 && !e.fled);
}

/**
 * @param {CardEffect} effect
 * @param {EffectContext} context
 * @returns {{scope: 'player'} | {scope: 'enemy', enemyId: ?string} | {scope: 'all_enemies'}}
 */
function resolveTargetScope(effect, context) {
  let targetSpec = effect.target;
  if (!targetSpec) {
    if (effect.kind === 'block') targetSpec = 'self';
    else if (effect.kind === 'applyStatus') targetSpec = 'self';
    else if (effect.kind === 'damage') targetSpec = context.source === 'player' ? 'enemy' : 'player';
    else targetSpec = 'self';
  }
  if (targetSpec === 'self') return context.source === 'player' ? { scope: 'player' } : { scope: 'enemy', enemyId: context.enemyId };
  if (targetSpec === 'player') return { scope: 'player' };
  if (targetSpec === 'all_enemies') return { scope: 'all_enemies' };
  if (targetSpec === 'enemy' || targetSpec === 'machine_enemy') return { scope: 'enemy', enemyId: context.cardTargetId };
  throw new Error(`Unresolvable target: ${JSON.stringify(effect)}`);
}

/**
 * @param {CombatState} state
 * @param {string} enemyId
 * @returns {CombatState}
 */
function checkBossPhaseTransition(state, enemyId) {
  const enemy = state.enemies.find((e) => e.id === enemyId);
  if (!enemy) return state;
  const def = MONSTER_DEFINITIONS[enemy.defId];
  if (!def || !def.phaseTransitionHpFraction || enemy.phaseTransitioned) return state;
  if (enemy.hp > enemy.maxHp * def.phaseTransitionHpFraction) return state;
  const created = createInitialAiState(enemy.defId, 0, state.rngState);
  let s = setCombatant(state, 'enemy', enemyId, {
    ...enemy, phase: 2, phaseTransitioned: true, aiState: created.aiState,
    intent: currentMove(enemy.defId, created.aiState, 2),
  });
  s = { ...s, rngState: created.rngState };
  let piles = s.piles;
  for (let i = 0; i < (def.phaseTransitionInsertCount || 0); i++) {
    piles = cardEngine.insertCardToDiscard(piles, def.phaseTransitionInsertCurse);
  }
  return { ...s, piles };
}

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {?string} enemyId
 * @param {number} amount
 * @param {boolean} ignoresBlock
 * @param {?string} sourceEnemyIdForReflect
 * @returns {CombatState}
 */
function damageTarget(state, scope, enemyId, amount, ignoresBlock, sourceEnemyIdForReflect) {
  const target = getCombatant(state, scope, enemyId);
  if (!target || target.hp <= 0) return state;
  let updated = applyDamage(target, amount, ignoresBlock);
  let s = setCombatant(state, scope, enemyId, updated);

  if (scope === 'player' && (updated.statuses.reflect || 0) > 0 && sourceEnemyIdForReflect) {
    const reflectAmount = updated.statuses.reflect;
    const clearedPlayer = { ...updated, statuses: applyStatus(updated.statuses, 'reflect', -reflectAmount) };
    s = setCombatant(s, 'player', null, clearedPlayer);
    const enemyTarget = s.enemies.find((e) => e.id === sourceEnemyIdForReflect);
    if (enemyTarget && enemyTarget.hp > 0) {
      const reflected = applyDamage(enemyTarget, reflectAmount, false);
      s = setCombatant(s, 'enemy', sourceEnemyIdForReflect, reflected);
    }
  }
  if (scope === 'enemy') {
    s = checkBossPhaseTransition(s, enemyId);
    // 조이기(constrict) 시전자가 죽으면 플레이어의 조이기 상태를 해제한다.
    const dead = s.enemies.find((e) => e.id === enemyId);
    if (dead && dead.hp <= 0 && dead.isConstrictSource && s.player.statuses.constrict) {
      s = { ...s, player: { ...s.player, statuses: applyStatus(s.player.statuses, 'constrict', -s.player.statuses.constrict) } };
    }
  }
  return s;
}

/**
 * @param {CombatState} state
 * @param {CardEffect} effect
 * @param {EffectContext} context
 * @returns {CombatState}
 */
function applyOneEffect(state, effect, context) {
  switch (effect.kind) {
    case 'damage': {
      const target = resolveTargetScope(effect, context);
      const stage = getStage(state.overload);
      let flatBonus = 0;
      if (context.source === 'player') {
        flatBonus = getModuleDamageBonus(effect.attackKind, stage, state.player.powers);
        if (effect.attackKind === 'ranged' && state.player.temporaryEffects.nextRangedBonus) {
          flatBonus += state.player.temporaryEffects.nextRangedBonus.amount;
        }
      } else {
        flatBonus = (context.sourceStatuses && context.sourceStatuses.atkBonus) || 0;
      }
      const weak = context.source === 'player' ? !!state.player.statuses.weak : !!context.sourceStatuses?.weak;
      const amount = computeDamage(effect.value, {
        stage, scalesWithStage: context.scalesWithStage, flatBonus, weak,
        vulnerable: false, // vulnerable is resolved per-target below (depends on defender)
      });
      const ignoresBlock = context.ignoresBlock && effect.attackKind === 'ranged';

      if (target.scope === 'all_enemies') {
        let s = state;
        for (const enemy of livingEnemies(s)) {
          const vulnerableAmount = enemy.statuses.vulnerable ? Math.floor(amount * 1.5) : amount;
          s = damageTarget(s, 'enemy', enemy.id, vulnerableAmount, ignoresBlock, null);
        }
        return s;
      }
      if (target.scope === 'enemy') {
        const enemy = state.enemies.find((e) => e.id === target.enemyId);
        if (!enemy || enemy.hp <= 0) return state;
        const vulnerableAmount = enemy.statuses.vulnerable ? Math.floor(amount * 1.5) : amount;
        return damageTarget(state, 'enemy', target.enemyId, vulnerableAmount, ignoresBlock, null);
      }
      if (target.scope === 'player') {
        if (state.player.hp <= 0) return state;
        const vulnerableAmount = state.player.statuses.vulnerable ? Math.floor(amount * 1.5) : amount;
        return damageTarget(state, 'player', null, vulnerableAmount, false, context.enemyId);
      }
      return state;
    }
    case 'block': {
      const target = resolveTargetScope(effect, context);
      const stage = getStage(state.overload);
      if (target.scope === 'player') {
        const flatBonus = getModuleBlockBonus(stage, state.player.powers);
        const fragile = !!state.player.statuses.fragile;
        const gained = computeBlock(effect.value, { stage, scalesWithStage: context.scalesWithStage, flatBonus, fragile });
        return { ...state, player: { ...state.player, block: state.player.block + gained } };
      }
      if (target.scope === 'enemy') {
        const enemy = state.enemies.find((e) => e.id === target.enemyId);
        if (!enemy) return state;
        const fragile = !!enemy.statuses.fragile;
        const gained = computeBlock(effect.value, { stage: 0, scalesWithStage: false, flatBonus: 0, fragile });
        return setCombatant(state, 'enemy', target.enemyId, { ...enemy, block: enemy.block + gained });
      }
      return state;
    }
    case 'applyStatus': {
      const target = resolveTargetScope(effect, context);
      if (target.scope === 'all_enemies') {
        let s = state;
        for (const enemy of livingEnemies(s)) {
          s = setCombatant(s, 'enemy', enemy.id, { ...enemy, statuses: applyStatus(enemy.statuses, effect.status, effect.amount) });
        }
        return s;
      }
      if (target.scope === 'player') {
        let s = { ...state, player: { ...state.player, statuses: applyStatus(state.player.statuses, effect.status, effect.amount) } };
        // 조이기(constrict): 시전한 적을 표식해두고, 그 적이 죽으면 상태를 해제한다(damageTarget 참고).
        if (effect.status === 'constrict' && context.source === 'enemy' && context.enemyId) {
          const caster = s.enemies.find((e) => e.id === context.enemyId);
          if (caster) s = setCombatant(s, 'enemy', context.enemyId, { ...caster, isConstrictSource: true });
        }
        return s;
      }
      if (target.scope === 'enemy') {
        const enemy = state.enemies.find((e) => e.id === target.enemyId);
        if (!enemy || enemy.hp <= 0) return state;
        return setCombatant(state, 'enemy', target.enemyId, { ...enemy, statuses: applyStatus(enemy.statuses, effect.status, effect.amount) });
      }
      return state;
    }
    case 'applyStun': {
      const enemy = state.enemies.find((e) => e.id === context.cardTargetId);
      if (!enemy || enemy.hp <= 0) return state;
      return setCombatant(state, 'enemy', enemy.id, { ...enemy, statuses: applyStatus(enemy.statuses, 'stun', effect.amount) });
    }
    case 'draw': {
      const drawn = cardEngine.drawCards(state.piles, effect.count, state.rngState);
      return { ...state, piles: drawn.piles, rngState: drawn.rngState };
    }
    case 'discardRandomFromHand': {
      const result = cardEngine.discardRandomFromHand(state.piles, state.rngState);
      return { ...state, piles: result.piles, rngState: result.rngState };
    }
    case 'activatePower':
      return { ...state, player: { ...state.player, powers: { ...state.player.powers, [effect.power]: { active: true } } } };
    case 'grantNextRangedBonus':
      return {
        ...state,
        player: { ...state.player, temporaryEffects: { ...state.player.temporaryEffects, nextRangedBonus: { amount: effect.amount, ignoresBlock: effect.ignoresBlock } } },
      };
    case 'removeInventoryItem': {
      if (!context.itemId) return state;
      return { ...state, player: { ...state.player, removedItemIds: [...state.player.removedItemIds, context.itemId] } };
    }
    default:
      throw new Error(`Unsupported effect kind: ${effect.kind}`);
  }
}

/**
 * @param {CombatState} state
 * @param {CardEffect[]} effects
 * @param {EffectContext} context
 * @returns {CombatState}
 */
function applyEffects(state, effects, context) {
  let s = state;
  for (const effect of effects) s = applyOneEffect(s, effect, context);
  return s;
}

// ---- win/loss ----

/** @param {CombatState} state @returns {CombatState} */
export function checkWinLoss(state) {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  if (state.player.hp <= 0 || isLethalOverload(state.overload)) return { ...state, phase: 'defeat' };
  if (!state.enemies.some((e) => e.hp > 0)) return { ...state, phase: 'victory' };
  return state;
}

// ---- player actions ----

/**
 * @param {CombatState} state
 * @param {string} instanceId
 * @param {?string} targetId
 * @returns {CombatState}
 */
export function playCard(state, instanceId, targetId) {
  if (state.phase !== 'player_turn') return state;
  if (!isCardPlayable(state, instanceId)) return state;

  const removal = cardEngine.removeFromHand(state.piles, instanceId);
  if (!removal) return state;
  const { card, piles: pilesAfterRemoval } = removal;
  const def = CARD_DEFINITIONS[card.defId];
  const stage = getStage(state.overload);
  const resolved = resolveCard(def, stage);

  let s = {
    ...state,
    piles: pilesAfterRemoval,
    overload: gainOverload(state.overload, def.overloadGain || 0, state.overloadGainMultiplier),
    player: {
      ...state.player,
      energy: state.player.energy - resolved.cost - getCostModifierFromPowers(def, stage, state.player.powers) - getCostModifierFromStatuses(def, state.player.statuses),
      ammo: def.ammoCost ? state.player.ammo - def.ammoCost : state.player.ammo,
    },
  };

  if (def.powerKind === 'fixed' && resolved.armorPerTurn !== undefined) {
    // 역장 방어 (파워·고정, §9): 시전 시점에 갑옷을 1회 즉시 부여할 뿐, forcefieldDefense라는
    // 파워/상태를 별도로 남기지 않는다. 그 갑옷 스택은 (일반 갑옷 규칙에 따라) 턴 종료 시
    // 방어도로 전환되며 소모/감소한다.
    s = { ...s, player: { ...s.player, statuses: applyStatus(s.player.statuses, 'armor', resolved.armorPerTurn) } };
  } else {
    s = applyEffects(s, resolved.effects, {
      source: 'player', cardTargetId: targetId, scalesWithStage: !!def.scalesWithStage,
      ignoresBlock: !!s.player.temporaryEffects.nextRangedBonus?.ignoresBlock, itemId: card.itemId,
    });
  }

  // consume the one-shot ranged bonus if this card actually used it (any ranged attack effect)
  if (def.attackKind === 'ranged' && def.type === 'attack' && s.player.temporaryEffects.nextRangedBonus) {
    const { nextRangedBonus, ...rest } = s.player.temporaryEffects;
    s = { ...s, player: { ...s.player, temporaryEffects: rest } };
  }

  if (def.type !== 'power') {
    s = { ...s, piles: def.exhausts ? cardEngine.moveToExhaust(s.piles, card) : cardEngine.moveToDiscard(s.piles, card) };
  }

  return checkWinLoss(s);
}

/** @param {CombatState} state @returns {CombatState} */
export function endPlayerTurn(state) {
  if (state.phase !== 'player_turn') return state;
  let s = checkWinLoss(state);
  if (s.phase !== 'player_turn') return s;

  // 갑옷: 턴 종료 시 스택만큼 방어도를 얻고 스택 1 감소, 그 다음 적의 공격이 실행됨 (§7.1).
  let player = applyArmorAtTurnStart(s.player);

  // 감염(감염 카드): 턴 종료 시 손패에 남아있으면 장당 damagePerTurnHeld만큼 피해(방어도로 막을 수 있음).
  const heldDamage = s.piles.hand.reduce((sum, c) => sum + (CARD_DEFINITIONS[c.defId].damagePerTurnHeld || 0), 0);
  if (heldDamage > 0) player = applyDamage(player, heldDamage, false);

  // 조이기(constrict): 시전자가 살아있는 한 매턴 고정 1피해(방어도로 막을 수 있음), 감소 없음.
  if (player.statuses.constrict) player = applyDamage(player, 1, false);

  // 어지러움처럼 휘발성(volatile) 카드는 손패에 남아있으면 버림 더미로 가지 않고 그대로 소진된다.
  const volatileCards = s.piles.hand.filter((c) => CARD_DEFINITIONS[c.defId].volatile);
  const keptHand = s.piles.hand.filter((c) => !CARD_DEFINITIONS[c.defId].volatile);
  let piles = cardEngine.discardHand({ ...s.piles, hand: keptHand });
  for (const c of volatileCards) piles = cardEngine.moveToExhaust(piles, c);

  player = { ...player, temporaryEffects: {}, statuses: decayStatusesAtTurnEnd(player.statuses) };
  return checkWinLoss({ ...s, piles, player, phase: 'enemy_turn' });
}

/**
 * @param {CombatState} state
 * @param {string} enemyId
 * @returns {CombatState}
 */
function executeEnemyAction(state, enemyId) {
  let s = state;
  let enemy = s.enemies.find((e) => e.id === enemyId);
  const def = MONSTER_DEFINITIONS[enemy.defId];
  const move = currentMove(enemy.defId, enemy.aiState, enemy.phase);

  if (move.damage) {
    const context = { source: 'enemy', enemyId, scalesWithStage: false, sourceStatuses: enemy.statuses };
    const repeated = move.hits || 1;
    for (let i = 0; i < repeated; i++) {
      s = applyOneEffect(s, { kind: 'damage', value: move.damage, target: 'player' }, context);
    }
  }
  if (move.effects) {
    s = applyEffects(s, move.effects, { source: 'enemy', enemyId, scalesWithStage: false, sourceStatuses: enemy.statuses });
  }
  if (move.insertCurse) {
    let piles = s.piles;
    const count = move.insertCurseCount || 1;
    for (let i = 0; i < count; i++) piles = cardEngine.insertCardToDiscard(piles, move.insertCurse);
    s = { ...s, piles };
  }
  if (move.stealCurrency) {
    s = { ...s, player: { ...s.player, stolenValueThisCombat: (s.player.stolenValueThisCombat || 0) + 1 } };
  }
  if (move.summon && !s.enemies.some((e) => e.defId === move.summon && e.hp > 0)) {
    const created = createEnemyInstance(move.summon, s.enemies.length, 0, 1, false, s.rngState);
    s = { ...s, enemies: [...s.enemies, created.enemy], rngState: created.rngState };
  }

  enemy = s.enemies.find((e) => e.id === enemyId);
  if (move.selfDestruct) {
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, hp: 0 });
  } else if (move.flee) {
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, hp: 0, fled: true });
  }
  return s;
}

/** @param {CombatState} state @returns {CombatState} */
export function resolveEnemyTurn(state) {
  if (state.phase !== 'enemy_turn') return state;
  let s = state;
  const actingOrder = state.enemies.map((e) => e.id);

  for (const enemyId of actingOrder) {
    if (s.player.hp <= 0 || isLethalOverload(s.overload)) break;
    let enemy = s.enemies.find((e) => e.id === enemyId);
    if (!enemy || enemy.hp <= 0) continue;

    enemy = { ...enemy, block: 0 };
    if (MONSTER_DEFINITIONS[enemy.defId].standingArmor && (enemy.statuses.armor || 0) < MONSTER_DEFINITIONS[enemy.defId].standingArmor) {
      enemy = { ...enemy, statuses: { ...enemy.statuses, armor: MONSTER_DEFINITIONS[enemy.defId].standingArmor } };
    }
    enemy = applyArmorAtTurnStart(enemy);
    s = setCombatant(s, 'enemy', enemyId, enemy);

    const actionsThisTurn = enemy.doubleActionActive ? 2 : 1;
    for (let action = 0; action < actionsThisTurn; action++) {
      enemy = s.enemies.find((e) => e.id === enemyId);
      if (enemy.hp <= 0) break;
      if ((enemy.statuses.stun || 0) > 0) {
        s = setCombatant(s, 'enemy', enemyId, { ...enemy, statuses: applyStatus(enemy.statuses, 'stun', -1) });
        continue; // skips acting this action-slot; intent carries over unchanged
      }
      s = executeEnemyAction(s, enemyId);
      s = checkWinLoss(s);
      if (s.phase !== 'enemy_turn') return s;
    }

    enemy = s.enemies.find((e) => e.id === enemyId);
    if (!enemy || enemy.hp <= 0) continue;

    enemy = { ...enemy, statuses: decayStatusesAtTurnEnd(enemy.statuses) };
    const advanced = advanceAiState(enemy.defId, enemy.aiState, enemy.phase, s.rngState);
    const nextIntent = currentMove(enemy.defId, advanced.aiState, enemy.phase);
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, aiState: advanced.aiState, intent: nextIntent });
    s = { ...s, rngState: advanced.rngState };
  }
  return s;
}

/** @param {CombatState} state @returns {CombatState} */
export function advanceTurn(state) {
  let s = endPlayerTurn(state);
  if (s.phase !== 'enemy_turn') return s;
  s = resolveEnemyTurn(s);
  if (s.phase !== 'enemy_turn') return s;
  s = { ...s, turn: s.turn + 1 };
  return startPlayerTurn(s);
}
