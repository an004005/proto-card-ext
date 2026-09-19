// Pure combat state machine for the Card Extraction ruleset. Every export is
// (state, ...args) => newState — no DOM/Preact, runnable headlessly under `node --test`.
import * as cardEngine from './cardEngine.js';
import { computeDamage, computeBlock, applyDamage, applyVulnerableDamage, decayStatusesAtTurnEnd, applyStatus, applyArmorAtTurnStart, applyPoisonAtTurnStart } from './statusEngine.js';
import { getStage } from './overloadEngine.js';
import { currentMove, advanceAiState, createInitialAiState } from './monsterAI.js';
import { isItemBurdenGivenOrder } from './inventoryEngine.js';
import { nextInt, nextFloat } from './rng.js';
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

export const HAND_SIZE = 5;
export const BASE_ENERGY = 3;
export const DURABILITY_DECAY_CHANCE = 0.01;

// ---- card resolution helpers ----

/**
 * @param {CardDef} def
 * @param {number} stage 0(노멀) 또는 1(과부화).
 * @returns {{cost: number, effects: CardEffect[], armorPerTurn?: number}}
 */
export function resolveCard(def, stage) {
  if (def.stageTable) {
    const row = def.stageTable[stage];
    return { cost: row.cost, effects: row.effects || [], armorPerTurn: row.armorPerTurn };
  }
  // stageTable이 없는 카드는 언제나 cost를 적는다 — `?? 0`은 타입만 좁힌다.
  return { cost: def.cost ?? 0, effects: def.effects || [] };
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
 * Effective energy cost for UI display (hand cards show this, not the flat def.cost —
 * stageTable costs vary with the current 과부화 단계).
 * @param {CardDef} def
 * @param {number} stage
 * @param {Statuses} [statuses]
 * @returns {number}
 */
export function getEffectiveCost(def, stage, statuses = {}) {
  return explainEffectiveCost(def, stage, statuses).total;
}

/**
 * 같은 계산을 "왜 이 값인가"까지 돌려준다 — 툴팁이 `코스트 3 = 기본 1 + 뒤얽힘 2`로
 * 풀어 쓸 수 있도록. 화면이 코스트를 따로 계산하면 엔진과 어긋나므로 여기 한 자리에만 둔다.
 * @param {CardDef} def
 * @param {number} stage
 * @param {Statuses} [statuses]
 * @returns {{total: number, base: number, parts: {label: string, amount: number}[]}}
 */
export function explainEffectiveCost(def, stage, statuses = {}) {
  const base = resolveCard(def, stage).cost;
  const parts = [];
  const entangled = getCostModifierFromStatuses(def, statuses);
  if (entangled) parts.push({ label: '뒤얽힘', amount: entangled });
  const total = Math.max(0, base + parts.reduce((sum, part) => sum + part.amount, 0));
  return { total, base, parts };
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
 * @param {'melee'|'ranged'|null|undefined} attackKind
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
  const stage = getStage(state.overloadActive);
  const cost = getEffectiveCost(def, stage, state.player.statuses);
  if (state.player.energy < cost) return false;
  if (def.ammoCost && state.player.loaded < def.ammoCost) return false;
  if (def.requiresLoadedAtMost !== undefined && state.player.loaded > def.requiresLoadedAtMost) return false;
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
 * @param {number|undefined} hpMultiplier
 * @param {boolean|undefined} doubleActionActive
 * @param {RngState} rngState
 * @returns {{enemy: EnemyState, rngState: RngState}}
 */
export function createEnemyInstance(defId, idSuffix, staggerIndex, hpMultiplier, doubleActionActive, rngState) {
  const def = MONSTER_DEFINITIONS[defId];
  if (!def) throw new Error(`Unknown monster defId "${defId}"`);
  const hp = Math.round(def.hp * (hpMultiplier || 1));
  const created = createInitialAiState(defId, staggerIndex, rngState);
  /** @type {EnemyState} */
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
 * @param {{defId: string, itemId?: string, equipmentInstanceId?: string}[]} params.deckEntries
 * @param {string[]} params.monsterIds
 * @param {number} [params.hpMultiplier]
 * @param {number} params.playerHp
 * @param {number} params.playerMaxHp
 * @param {number} params.usableAmmo total ammo pulled in from inventory reserve at combat start
 * @param {number} params.maxLoad cap on player.loaded, sum of equipped weapons' maxLoadBonus
 * @param {boolean} params.overloadActive
 * @param {number} [params.extraDrawPerTurn]
 * @param {number} [params.turnStartAoeDamage]
 * @param {string[]} [params.inventoryItemIdsInOrder]
 * @param {number} [params.inventoryCapacity]
 * @param {boolean} [params.hasBurdenItems]
 * @param {RngState} params.rngState
 * @returns {CombatState} phase 'setup' — caller must run beginPlayerFirst() or beginEnemyFirst()
 */
export function createCombatState({
  deckEntries, monsterIds, hpMultiplier, playerHp, playerMaxHp, usableAmmo, maxLoad,
  overloadActive, extraDrawPerTurn, turnStartAoeDamage,
  inventoryItemIdsInOrder, inventoryCapacity, hasBurdenItems, rngState,
}) {
  const piles = cardEngine.createEmptyPiles();
  const deck = cardEngine.buildDeck(deckEntries);
  const shuffled = cardEngine.shuffleIntoDrawPile(piles, deck, rngState);
  shuffled.piles = cardEngine.moveInnateCardsToFront(shuffled.piles, (defId) => !!CARD_DEFINITIONS[defId].innate);

  /** @type {Object.<string, number>} */
  const staggerCounts = {};
  /** @type {EnemyState[]} */
  const enemies = [];
  let rng = shuffled.rngState;
  monsterIds.forEach((defId, index) => {
    const stagger = staggerCounts[defId] || 0;
    staggerCounts[defId] = stagger + 1;
    const created = createEnemyInstance(defId, index, stagger, hpMultiplier, hasBurdenItems, rng);
    enemies.push(created.enemy);
    rng = created.rngState;
  });

  // 전투 시작 시 장전을 최대치로 채우고 진입(재고가 허락하는 한) — 나머지는 reserve로 남는다.
  const loaded = Math.min(maxLoad, usableAmmo);
  const reserve = usableAmmo - loaded;

  // phase 'setup' — caller must run beginPlayerFirst() or beginEnemyFirst() (ambush, §7.3)
  // to actually open the combat; neither has happened yet.
  return {
    phase: 'setup',
    turn: 1,
    overloadActive: !!overloadActive,
    player: {
      hp: playerHp, maxHp: playerMaxHp, block: 0,
      energy: BASE_ENERGY, maxEnergy: BASE_ENERGY, loaded, reserve, maxLoad,
      statuses: {}, powers: {}, temporaryEffects: {},
      extraDrawPerTurn: extraDrawPerTurn || 0,
      turnStartAoeDamage: turnStartAoeDamage || 0,
      inventoryItemIdsInOrder: inventoryItemIdsInOrder || [],
      inventoryCapacity: inventoryCapacity || 30,
      removedItemIds: [],
      durabilityDecayInstanceIds: [],
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
  /** @type {CombatState} */
  let s = { ...state, phase: 'enemy_turn' };
  s = resolveEnemyTurn(s);
  if (s.phase !== 'enemy_turn') return s; // defeated before ever taking a turn
  s = { ...s, turn: s.turn + 1 };
  return startPlayerTurn(s);
}

/** @param {CombatState} state @returns {CombatState} */
export function startPlayerTurn(state) {
  let player = { ...state.player, block: 0, energy: state.player.maxEnergy + (state.player.powers.sandevistan?.active ? 1 : 0) };
  player = applyPoisonAtTurnStart(player);
  const opening = checkWinLoss({ ...state, player });
  if (opening.phase === 'defeat') return opening;

  const drawCount = HAND_SIZE + (player.extraDrawPerTurn || 0);
  const drawn = cardEngine.drawCards(state.piles, drawCount, state.rngState);

  let piles = drawn.piles;
  if (player.powers.mantisBlades?.active) {
    piles = { ...piles, hand: [...piles.hand, cardEngine.createCardInstance('mantis_blade_slash')] };
  }
  /** @type {CombatState} */
  let s = { ...state, player, piles, rngState: drawn.rngState, phase: 'player_turn' };

  // 임플란트⑥ 매턴 시작 광역 3 피해 (§10) — flat, unaffected by weak/vulnerable (implant, not a card).
  if (s.player.turnStartAoeDamage) {
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.hp > 0 ? applyDamage(e, s.player.turnStartAoeDamage ?? 0, false) : e)),
    };
    s = checkWinLoss(s);
  }
  return s;
}

// ---- effect interpreter ----

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {string|null|undefined} enemyId
 * @returns {PlayerCombatState|EnemyState|undefined}
 */
function getCombatant(state, scope, enemyId) {
  return scope === 'player' ? state.player : state.enemies.find((e) => e.id === enemyId);
}

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {string|null|undefined} enemyId
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
 * @returns {{scope: 'player'} | {scope: 'enemy', enemyId?: ?string} | {scope: 'all_enemies'}}
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
  const created = createInitialAiState(enemy.defId, 0, state.rngState, 2);
  let s = setCombatant(state, 'enemy', enemyId, {
    ...enemy, phase: 2, phaseTransitioned: true, aiState: created.aiState,
    intent: currentMove(enemy.defId, created.aiState, 2),
  });
  s = { ...s, rngState: created.rngState };
  let piles = s.piles;
  for (let i = 0; i < (def.phaseTransitionInsertCount || 0); i++) {
    piles = cardEngine.insertCardToDiscard(piles, def.phaseTransitionInsertStatusCard ?? '');
  }
  return { ...s, piles };
}

/**
 * @param {CombatState} state
 * @param {'player'|'enemy'} scope
 * @param {string|null|undefined} enemyId
 * @param {number} amount
 * @param {boolean} ignoresBlock
 * @param {string|null|undefined} sourceEnemyIdForReflect
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
    s = checkBossPhaseTransition(s, enemyId ?? '');
    // 조이기(constrict) 시전자가 죽으면 플레이어의 조이기 상태를 해제한다.
    const dead = s.enemies.find((e) => e.id === enemyId);
    if (dead && dead.hp <= 0 && dead.isConstrictSource && s.player.statuses.constrict) {
      s = { ...s, player: { ...s.player, statuses: applyStatus(s.player.statuses, 'constrict', -s.player.statuses.constrict) } };
    }
  }
  return s;
}

/**
 * 조건부 스케일링(scalesBy): handSize/exhaustPileSize/discardPileSize/strengthStacks/playerBlock/
 * targetVulnerableStacks/targetPoisonStacks 카운트 × scalesByAmount 만큼을 flat 보너스로 더한다 —
 * 스테이지 스케일링과 무관하게 그대로 가산.
 * @param {CardEffect} effect
 * @param {CombatState} state
 * @param {EffectContext} context
 * @returns {number}
 */
function computeScalesByBonus(effect, state, context) {
  if (!effect.scalesBy) return 0;
  const per = effect.scalesByAmount ?? 1;
  let count = 0;
  switch (effect.scalesBy) {
    case 'handSize': count = state.piles.hand.length; break;
    case 'exhaustPileSize': count = state.piles.exhaustPile.length; break;
    case 'discardPileSize': count = state.piles.discardPile.length; break;
    case 'strengthStacks': count = context.source === 'player' ? (state.player.statuses.strength || 0) : ((context.sourceStatuses && context.sourceStatuses.strength) || 0); break;
    case 'playerBlock': count = state.player.block; break;
    case 'targetVulnerableStacks': {
      const enemy = state.enemies.find((e) => e.id === context.cardTargetId);
      count = (enemy && enemy.statuses.vulnerable) || 0;
      break;
    }
    case 'targetPoisonStacks': {
      const enemy = state.enemies.find((e) => e.id === context.cardTargetId);
      count = (enemy && enemy.statuses.poison) || 0;
      break;
    }
    case 'loadedAmmo': count = state.player.loaded; break;
    default: count = 0;
  }
  return count * per;
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
      let s = state;
      const hitsCount = effect.hits || 1;
      for (let hit = 0; hit < hitsCount; hit++) {
        const target = resolveTargetScope(effect, context);
        const stage = getStage(s.overloadActive);
        let flatBonus = 0;
        if (context.source === 'player') {
          flatBonus = getModuleDamageBonus(effect.attackKind, stage, s.player.powers) + (s.player.statuses.strength || 0);
          if (effect.attackKind === 'ranged' && s.player.temporaryEffects.nextRangedBonus) {
            flatBonus += s.player.temporaryEffects.nextRangedBonus.amount;
          }
        } else {
          flatBonus = (context.sourceStatuses && ((context.sourceStatuses.atkBonus || 0) + (context.sourceStatuses.strength || 0))) || 0;
        }
        flatBonus += computeScalesByBonus(effect, s, context);
        const weak = context.source === 'player' ? !!s.player.statuses.weak : !!context.sourceStatuses?.weak;
        const amount = computeDamage(effect.value ?? 0, {
          stage, scalesWithStage: !!context.scalesWithStage, flatBonus, weak,
          vulnerable: false, // vulnerable is resolved per-target below (depends on defender)
        });
        const ignoresBlock = !!(context.ignoresBlock || effect.ignoresBlock) && effect.attackKind === 'ranged';

        if (target.scope === 'all_enemies') {
          for (const enemy of livingEnemies(s)) {
            const vulnerableAmount = applyVulnerableDamage(amount, !!enemy.statuses.vulnerable);
            s = damageTarget(s, 'enemy', enemy.id, vulnerableAmount, ignoresBlock, null);
          }
        } else if (target.scope === 'enemy') {
          const enemy = s.enemies.find((e) => e.id === target.enemyId);
          if (enemy && enemy.hp > 0) {
            const vulnerableAmount = applyVulnerableDamage(amount, !!enemy.statuses.vulnerable);
            s = damageTarget(s, 'enemy', target.enemyId, vulnerableAmount, ignoresBlock, null);
          }
        } else if (target.scope === 'player') {
          if (s.player.hp > 0) {
            const vulnerableAmount = applyVulnerableDamage(amount, !!s.player.statuses.vulnerable);
            s = damageTarget(s, 'player', null, vulnerableAmount, false, context.enemyId);
          }
        }
      }
      return s;
    }
    case 'block': {
      const target = resolveTargetScope(effect, context);
      const stage = getStage(state.overloadActive);
      if (target.scope === 'player') {
        const flatBonus = getModuleBlockBonus(stage, state.player.powers) + (state.player.statuses.dexterity || 0) + computeScalesByBonus(effect, state, context);
        const fragile = !!state.player.statuses.fragile;
        const gained = computeBlock(effect.value ?? 0, { stage, scalesWithStage: !!context.scalesWithStage, flatBonus, fragile });
        return { ...state, player: { ...state.player, block: state.player.block + gained } };
      }
      if (target.scope === 'enemy') {
        const enemy = state.enemies.find((e) => e.id === target.enemyId);
        if (!enemy) return state;
        const fragile = !!enemy.statuses.fragile;
        const gained = computeBlock(effect.value ?? 0, { stage: 0, scalesWithStage: false, flatBonus: 0, fragile });
        return setCombatant(state, 'enemy', target.enemyId, { ...enemy, block: enemy.block + gained });
      }
      return state;
    }
    case 'applyStatus': {
      const target = resolveTargetScope(effect, context);
      if (target.scope === 'all_enemies') {
        let s = state;
        for (const enemy of livingEnemies(s)) {
          s = setCombatant(s, 'enemy', enemy.id, { ...enemy, statuses: applyStatus(enemy.statuses, effect.status ?? '', effect.amount ?? 0) });
        }
        return s;
      }
      if (target.scope === 'player') {
        let s = { ...state, player: { ...state.player, statuses: applyStatus(state.player.statuses, effect.status ?? '', effect.amount ?? 0) } };
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
        return setCombatant(state, 'enemy', target.enemyId, { ...enemy, statuses: applyStatus(enemy.statuses, effect.status ?? '', effect.amount ?? 0) });
      }
      return state;
    }
    case 'applyStun': {
      const enemy = state.enemies.find((e) => e.id === context.cardTargetId);
      if (!enemy || enemy.hp <= 0) return state;
      return setCombatant(state, 'enemy', enemy.id, { ...enemy, statuses: applyStatus(enemy.statuses, 'stun', effect.amount ?? 0) });
    }
    case 'draw': {
      const drawn = cardEngine.drawCards(state.piles, effect.count ?? 0, state.rngState);
      return { ...state, piles: drawn.piles, rngState: drawn.rngState };
    }
    case 'discardRandomFromHand': {
      if (state.piles.hand.length === 0) return state;
      const { value: index, state: rng } = nextInt(state.rngState, state.piles.hand.length);
      const card = state.piles.hand[index];
      const nextHand = state.piles.hand.filter((_, idx) => idx !== index);
      const s = { ...state, piles: { ...state.piles, hand: nextHand }, rngState: rng };
      return discardCardWithSlyTrigger(s, card, context);
    }
    case 'activatePower':
      return { ...state, player: { ...state.player, powers: { ...state.player.powers, [effect.power ?? '']: { active: true } } } };
    case 'grantNextRangedBonus':
      return {
        ...state,
        player: { ...state.player, temporaryEffects: { ...state.player.temporaryEffects, nextRangedBonus: { amount: effect.amount ?? 0, ignoresBlock: !!effect.ignoresBlock } } },
      };
    case 'removeInventoryItem': {
      if (!context.itemId) return state;
      return { ...state, player: { ...state.player, removedItemIds: [...state.player.removedItemIds, context.itemId] } };
    }
    case 'reload': {
      const gained = Math.min(state.player.maxLoad - state.player.loaded, state.player.reserve, effect.count ?? Infinity);
      if (gained <= 0) return state;
      return { ...state, player: { ...state.player, loaded: state.player.loaded + gained, reserve: state.player.reserve - gained } };
    }
    default:
      throw new Error(`Unsupported effect kind: ${effect.kind}`);
  }
}

/**
 * 교활(Sly): 손패에서 "플레이된 것이 아니라 버려진" 카드가 sly 카드면, 버림 더미로 가기 전에
 * 무료(0코스트)로 즉시 효과를 발동시킨다. 발동 중 또 다른 discardRandomFromHand 효과가 트리거되면
 * 자연스럽게 재귀 호출된다(교활 카드가 교활 카드를 버리는 연쇄).
 * @param {CombatState} state
 * @param {import('./types.js').CardInstance} card
 * @param {EffectContext} context
 * @returns {CombatState}
 */
function discardCardWithSlyTrigger(state, card, context) {
  const def = CARD_DEFINITIONS[card.defId];
  if (!def.sly) {
    return { ...state, piles: cardEngine.moveToDiscard(state.piles, card) };
  }
  const resolved = resolveCard(def, getStage(state.overloadActive));
  let s = applyEffects(state, resolved.effects, {
    source: 'player', cardTargetId: context.cardTargetId,
    ignoresBlock: false, itemId: card.itemId,
  });
  s = checkWinLoss(s);
  if (s.phase !== 'player_turn') return s;
  s = { ...s, piles: def.exhausts ? cardEngine.moveToExhaust(s.piles, card) : cardEngine.moveToDiscard(s.piles, card) };
  return s;
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

/**
 * 패배 조건은 HP 0 이하 하나뿐이다.
 * @param {CombatState} state @returns {CombatState}
 */
export function checkWinLoss(state) {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  if (state.player.hp <= 0) return { ...state, phase: 'defeat' };
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
  const stage = getStage(state.overloadActive);
  const resolved = resolveCard(def, stage);

  let s = {
    ...state,
    piles: pilesAfterRemoval,
    player: {
      ...state.player,
      energy: state.player.energy - getEffectiveCost(def, stage, state.player.statuses),
      loaded: def.ammoCost ? state.player.loaded - def.ammoCost : state.player.loaded,
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

  // 장비 내구도(§신규): 이 카드가 장비 인스턴스 소속이면(손상 상태이상 카드/필러/과적 카드는 제외)
  // 1% 확률로 그 인스턴스에 감소 1회 축적 — 실제 적용은 전투 종료 후(finalizeIfCombatEnded).
  if (card.equipmentInstanceId) {
    const roll = nextFloat(s.rngState);
    s = { ...s, rngState: roll.state };
    if (roll.value < DURABILITY_DECAY_CHANCE) {
      s = { ...s, player: { ...s.player, durabilityDecayInstanceIds: [...s.player.durabilityDecayInstanceIds, card.equipmentInstanceId] } };
    }
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
  // 보존(retain) 카드는 버려지지도 소진되지도 않고 손패에 그대로 유지된다.
  const volatileCards = s.piles.hand.filter((c) => CARD_DEFINITIONS[c.defId].volatile && !CARD_DEFINITIONS[c.defId].retain);
  const retainedCards = s.piles.hand.filter((c) => CARD_DEFINITIONS[c.defId].retain);
  const discardableCards = s.piles.hand.filter((c) => !CARD_DEFINITIONS[c.defId].volatile && !CARD_DEFINITIONS[c.defId].retain);
  let piles = cardEngine.discardHand({ ...s.piles, hand: discardableCards });
  for (const c of volatileCards) piles = cardEngine.moveToExhaust(piles, c);
  piles = { ...piles, hand: retainedCards };

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
  if (!enemy) return s; // 호출부가 살아 있는 적의 id만 넘긴다.
  const def = MONSTER_DEFINITIONS[enemy.defId];
  const move = currentMove(enemy.defId, enemy.aiState, enemy.phase);

  if (move.damage) {
    /** @type {EffectContext} */
    const context = { source: 'enemy', enemyId, scalesWithStage: false, sourceStatuses: enemy.statuses };
    const repeated = move.hits || 1;
    for (let i = 0; i < repeated; i++) {
      s = applyOneEffect(s, { kind: 'damage', value: move.damage, target: 'player' }, context);
    }
  }
  if (move.effects) {
    s = applyEffects(s, move.effects, { source: 'enemy', enemyId, scalesWithStage: false, sourceStatuses: enemy.statuses });
  }
  if (move.insertStatusCard) {
    let piles = s.piles;
    const count = move.insertStatusCardCount || 1;
    for (let i = 0; i < count; i++) piles = cardEngine.insertCardToDiscard(piles, move.insertStatusCard);
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
  if (!enemy) return s; // 방금 소환 처리를 지났을 뿐 이 적은 아직 목록에 있다.
  if (move.selfDestruct) {
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, hp: 0 });
  } else if (move.flee) {
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, hp: 0, fled: true });
  }
  return s;
}

/**
 * 턴 해결의 단일 구현은 advanceTurnWithSteps다 — 여기서는 연출용 스냅샷만 버린다.
 * 예전에는 같은 규칙을 resolveEnemyTurn과 advanceTurnWithSteps 두 벌로 들고 있었고, 한쪽만
 * 고치면 "헤드리스 시뮬레이션과 화면에 보이는 전투가 다르게 끝나는" 사고가 났다(리뷰 A5).
 * @param {CombatState} state
 * @returns {CombatState}
 */
export function advanceTurn(state) {
  return advanceTurnWithSteps(state).state;
}

/**
 * @typedef {Object} CombatStep 눈에 보이는 전투 행동 하나가 끝난 직후의 스냅샷.
 * @property {CombatState} state
 * @property {'player'|'enemy'} actor
 * @property {string} [actorId]
 * @property {string} label
 * @property {'attack'|'action'} kind
 */

/**
 * 한 턴을 해결하면서 눈에 보이는 행동마다 스냅샷을 남긴다. 규칙은 advanceTurn과 "같은" 것이
 * 아니라 말 그대로 하나다 — advanceTurn이 이 함수를 호출하고 steps만 버린다.
 *
 * @param {CombatState} state
 * @returns {{state: CombatState, steps: CombatStep[]}}
 */
export function advanceTurnWithSteps(state) {
  /** @type {CombatStep[]} */
  const steps = [];
  let s = endPlayerTurn(state);
  steps.push({ state: s, actor: 'player', label: '턴 종료', kind: 'action' });
  if (s.phase !== 'enemy_turn') return { state: s, steps };
  s = resolveEnemyTurn(s, steps);
  if (s.phase !== 'enemy_turn') return { state: s, steps };
  s = { ...s, turn: s.turn + 1 };
  s = startPlayerTurn(s);
  steps.push({ state: s, actor: 'player', label: '새 턴', kind: 'action' });
  return { state: s, steps };
}

/**
 * 적 턴 전체를 해결한다. `steps`를 주면 눈에 보이는 행동 하나마다 스냅샷을 쌓는다 — 연출
 * 재생과 헤드리스 시뮬레이션이 같은 코드를 지나도록 하는 유일한 구현이다.
 * @param {CombatState} state
 * @param {CombatStep[]} [steps] 있으면 제자리에서 채운다
 * @returns {CombatState}
 */
export function resolveEnemyTurn(state, steps) {
  if (state.phase !== 'enemy_turn') return state;
  let s = state;
  /** @param {CombatStep} step */
  const record = (step) => { if (steps) steps.push(step); };
  const actingOrder = s.enemies.map((e) => e.id);
  for (const enemyId of actingOrder) {
    if (s.player.hp <= 0) break;
    let enemy = s.enemies.find((e) => e.id === enemyId);
    if (!enemy || enemy.hp <= 0) continue;

    enemy = { ...enemy, block: 0 };
    const standingArmor = MONSTER_DEFINITIONS[enemy.defId].standingArmor;
    if (standingArmor && (enemy.statuses.armor || 0) < standingArmor) {
      enemy = { ...enemy, statuses: { ...enemy.statuses, armor: standingArmor } };
    }
    enemy = applyArmorAtTurnStart(enemy);
    const poisonedBefore = (enemy.statuses.poison || 0) > 0;
    enemy = applyPoisonAtTurnStart(enemy);
    s = setCombatant(s, 'enemy', enemyId, enemy);
    s = checkWinLoss(s);
    if (poisonedBefore) record({ state: s, actor: 'enemy', actorId: enemyId, label: '중독', kind: 'action' });
    if (s.phase !== 'enemy_turn') return s;

    const actionsThisTurn = enemy.doubleActionActive ? 2 : 1;
    for (let action = 0; action < actionsThisTurn; action++) {
      enemy = s.enemies.find((e) => e.id === enemyId);
      if (!enemy || enemy.hp <= 0) break;
      if ((enemy.statuses.stun || 0) > 0) {
        s = setCombatant(s, 'enemy', enemyId, { ...enemy, statuses: applyStatus(enemy.statuses, 'stun', -1) });
        record({ state: s, actor: 'enemy', actorId: enemyId, label: '기절', kind: 'action' });
        continue;
      }
      const move = currentMove(enemy.defId, enemy.aiState, enemy.phase);
      s = executeEnemyAction(s, enemyId);
      s = checkWinLoss(s);
      record({ state: s, actor: 'enemy', actorId: enemyId, label: move.id, kind: move.damage ? 'attack' : 'action' });
      if (s.phase !== 'enemy_turn') return s;
    }

    enemy = s.enemies.find((e) => e.id === enemyId);
    if (!enemy || enemy.hp <= 0) continue;
    enemy = { ...enemy, statuses: decayStatusesAtTurnEnd(enemy.statuses) };
    const advanced = advanceAiState(enemy.defId, enemy.aiState, enemy.phase, s.rngState);
    s = setCombatant(s, 'enemy', enemyId, { ...enemy, aiState: advanced.aiState, intent: currentMove(enemy.defId, advanced.aiState, enemy.phase) });
    s = { ...s, rngState: advanced.rngState };
  }
  return s;
}
