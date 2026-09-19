import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { getEffectiveCost, explainEffectiveCost, resolveCard } from '../engine/combatEngine.js';
import { getStage, applyStageScale } from '../engine/overloadEngine.js';
import { computeDamage } from '../engine/statusEngine.js';
import { STATUS_LABELS, POWER_LABELS, OVERLOAD_STAGE_NAMES, OVERLOAD_STAGE_LABELS } from '../data/statusEffects.js';
import { MODULE_POWER_STAGE_TABLES } from '../data/modules.js';
import { WEAPON_DEFINITIONS } from '../data/equipment.js';
import { describeItem } from '../data/itemDisplay.js';
import { Tooltip } from './Tooltip.js';
import { COMBAT_NOISE_ENABLED } from '../engine/combatMapIntegration.js';

export const TYPE_INFO = {
  attack: { color: 'var(--color-accent)', label: 'ATTACK · 공격', cls: 'tag-accent' },
  skill: { color: 'var(--color-neutral-700)', label: 'SKILL · 스킬', cls: 'tag-neutral' },
  power: { color: 'var(--color-accent-2-700)', label: 'POWER · 파워', cls: 'tag-accent-2' },
  status_card: { color: 'var(--color-status-700, #6d28d9)', label: 'STATUS CARD · 상태이상 카드', cls: 'tag-status' },
  burden: { color: 'var(--color-neutral-600)', label: 'BURDEN · 과적 카드', cls: 'tag-neutral' },
};

// 단계는 둘뿐이다(과부화 OFF/ON). 이름은 statusEffects.js의 한 벌을 그대로 쓴다
// (용어집「과부화 단계」, 리뷰 B7).
const STAGE_NAMES = OVERLOAD_STAGE_NAMES;
const STAGE_LABELS = OVERLOAD_STAGE_LABELS;

// What each "variable" module power actually boosts, for the per-stage bonus shown in the
// card detail overlay (§9 — MODULE_POWER_STAGE_TABLES holds the live per-stage numbers).
const WEAPON_NAMES = Object.fromEntries(Object.values(WEAPON_DEFINITIONS).map((def) => [def.id, def.name]));

const VARIABLE_POWER_BONUS_LABELS = {
  neuralBoost: '방어력 획득 시',
  bodyBoost: '근접 공격 피해',
  spatialAwareness: '원거리 공격 피해',
};

function describeEffect(effect, def, stage) {
  const scale = (v) => (def.stageTable ? v : applyStageScale(v, stage, def.scalesWithStage));
  const scaleDamage = (v) => (def.stageTable ? v : computeDamage(v, { stage, scalesWithStage: def.scalesWithStage }));
  switch (effect.kind) {
    case 'damage':
      return (effect.target === 'all_enemies' ? '광역 피해 ' : '피해 ') + scaleDamage(effect.value);
    case 'block':
      return '방어 ' + scale(effect.value);
    case 'applyStatus': {
      const label = STATUS_LABELS[effect.status] || effect.status;
      const who = effect.target === 'self' ? '자신' : effect.target === 'all_enemies' ? '전체 적' : '적';
      return `${who} ${label} ${effect.amount}`;
    }
    case 'applyStun':
      return `기계 스턴 ${effect.amount}`;
    case 'draw':
      return `드로우 ${effect.count}장`;
    case 'discardRandomFromHand':
      return '무작위 카드 버리기';
    case 'activatePower':
    case 'activateFixedPower': {
      const label = POWER_LABELS[effect.power] || effect.power;
      const table = MODULE_POWER_STAGE_TABLES[effect.power];
      if (table) {
        const bonusLabel = VARIABLE_POWER_BONUS_LABELS[effect.power] || '효과';
        return `${label} 활성화 (${bonusLabel} +${table[stage]})`;
      }
      return `${label} 활성화`;
    }
    case 'grantNextRangedBonus':
      return `다음 원거리 피해 +${effect.amount}${effect.ignoresBlock ? ' (방어 무시)' : ''}`;
    case 'reload':
      return '재장전';
    case 'removeInventoryItem':
      return '아이템 영구 소멸';
    default:
      return effect.kind;
  }
}

function buildStageRows(def, statuses) {
  return STAGE_LABELS.map((label, stage) => {
    const resolved = resolveCard(def, stage);
    const parts = [];
    // 코스트는 stageTable 카드만이 아니라 모든 카드의 단계 행에 적는다 — 단계마다 코스트가
    // 달라지는 카드가 있어서, 표에서 바로 보여야 한다(리뷰 B5).
    if (!def.unplayable) parts.push(`코스트 ${explainEffectiveCost(def, stage, statuses).total}`);
    if (resolved.armorPerTurn !== undefined) parts.push(`매턴 갑옷 +${resolved.armorPerTurn}`);
    for (const effect of resolved.effects) parts.push(describeEffect(effect, def, stage));
    return { stage, label, effect: parts.filter(Boolean).join(' · ') || '효과 없음' };
  });
}

/**
 * 이 카드에 붙은 "조건"을 배지로. 설명문을 끝까지 읽지 않아도 왜 못 내는지/무엇이 다른지
 * 한눈에 보이게 한다(리뷰 B5).
 */
function conditionBadges(def) {
  const badges = [];
  if (def.requiresWeapon) badges.push(`${WEAPON_NAMES[def.requiresWeapon] || def.requiresWeapon} 필요`);
  if (def.requiresLoadedAtMost !== undefined) badges.push(`장전 ≤${def.requiresLoadedAtMost}일 때만`);
  if ((def.effects || []).some((e) => e.ignoresBlock)) badges.push('방어 무시');
  if (def.volatile) badges.push('휘발성');
  if (def.retain) badges.push('보존');
  if (def.innate) badges.push('선천성');
  if (def.mapTags?.disengageProgress) badges.push(`이탈 +${def.mapTags.disengageProgress}`);
  return badges;
}

/**
 * 현재 상태(힘·약화·취약)를 반영한 실제 피해량. 기본값과 다르면 툴팁이 둘을 같이 보여준다 —
 * 지금 이 카드를 내면 몇이 들어가는지가 결정의 근거이고, 기본값은 참고다(리뷰 B5).
 */
function actualDamageFor(value, def, stage, player, target) {
  return computeDamage(value, {
    stage, scalesWithStage: def.scalesWithStage,
    flatBonus: (player?.statuses?.strength || 0) + (player?.statuses?.atkBonus || 0),
    weak: !!player?.statuses?.weak,
    vulnerable: !!target?.statuses?.vulnerable,
  });
}

export function CardDetailTooltip({ def, cost, type, overloadActive = false, item, powers = {}, statuses = {}, player = null, target = null }) {
  const stage = getStage(overloadActive);
  const rows = buildStageRows(def, statuses);
  const itemInfo = item ? describeItem(item) : null;
  const badges = conditionBadges(def);
  const costBreakdown = def.unplayable ? null : explainEffectiveCost(def, stage, statuses);
  // 지금 이 카드를 내면 실제로 몇이 들어가는가 — 기본값과 다를 때만 둘을 나란히 보여준다.
  const damageRows = (resolveCard(def, stage).effects || [])
    .filter((effect) => effect.kind === 'damage')
    .map((effect) => ({
      base: computeDamage(effect.value, { stage, scalesWithStage: def.stageTable ? false : def.scalesWithStage }),
      actual: def.stageTable ? effect.value : actualDamageFor(effect.value, def, stage, player, target),
      area: effect.target === 'all_enemies',
    }))
    .filter((row) => row.actual !== row.base);
  return html`
    <div style=${{ width: '260px' }}>
      <div style=${{ display: 'flex', gap: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--color-neutral-700)', marginBottom: '10px' }}>
        <div style=${{ width: '50px', height: '66px', border: `2px solid ${type.color}`, background: 'var(--color-surface)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style=${{ width: '22px', height: '22px', background: type.color }}></span>
        </div>
        <div>
          <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '14px' }}>${def.name}</div>
          <span class=${`tag ${type.cls}`} style=${{ marginTop: '4px' }}>${type.label}</span>
          <div style=${{ fontSize: '10px', marginTop: '6px', opacity: 0.85 }}>
            ${def.unplayable ? '사용 불가' : `코스트 ${costBreakdown.total}`}${def.ammoCost ? ` · 총알 ${def.ammoCost}` : ''}
          </div>
          ${costBreakdown && costBreakdown.parts.length > 0 ? html`
            <div style=${{ fontSize: '10px', marginTop: '2px', color: 'var(--color-accent-400, #f59e0b)' }}>
              코스트 ${costBreakdown.total} = 기본 ${costBreakdown.base}${costBreakdown.parts.map((part) => ` + ${part.label} ${part.amount}`).join('')}
            </div>
          ` : null}
          ${COMBAT_NOISE_ENABLED && def.mapTags?.noise ? html`<div style=${{ fontSize: '10px', marginTop: '2px', opacity: 0.8 }}>소음 게이지 +${def.mapTags.noise}</div>` : null}
        </div>
      </div>

      ${def.description ? html`
        <div style=${{ fontSize: '11px', marginBottom: '8px', opacity: 0.9 }}>${def.description}</div>
      ` : null}

      ${badges.length > 0 ? html`
        <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
          ${badges.map((badge) => html`
            <span key=${badge} style=${{ fontSize: '9px', fontWeight: 800, padding: '2px 5px', border: '1px solid currentColor', opacity: 0.9 }}>${badge}</span>
          `)}
        </div>
      ` : null}

      ${damageRows.length > 0 ? html`
        <div style=${{ fontSize: '11px', marginBottom: '8px' }}>
          ${damageRows.map((row, index) => html`
            <div key=${index}>
              ${row.area ? '광역 피해' : '피해'} <strong style=${{ fontSize: '13px' }}>${row.actual}</strong>
              <span style=${{ opacity: 0.55 }}> (기본 ${row.base})</span>
            </div>
          `)}
        </div>
      ` : null}

      ${itemInfo ? html`
        <div style=${{ fontSize: '10px', padding: '6px 8px', marginBottom: '10px', border: `1px solid ${itemInfo.color}`, background: 'var(--color-surface)' }}>
          연결된 아이템: <strong>${itemInfo.name}</strong>${itemInfo.sub ? ` — ${itemInfo.sub}` : ''}
        </div>
      ` : null}

      <div>
        ${rows.map((row) => html`
          <div key=${row.stage} style=${{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
            padding: '6px 8px', marginBottom: '4px',
            background: row.stage === stage ? 'var(--color-neutral-800)' : 'transparent',
            borderLeft: `3px solid ${row.stage === stage ? 'var(--color-accent-400)' : 'transparent'}`,
          }}>
            <span style=${{ fontSize: '11px', fontWeight: row.stage === stage ? 800 : 400 }}>${row.label}</span>
            <span style=${{ fontSize: '11px', fontWeight: row.stage === stage ? 800 : 400, textAlign: 'right' }}>${row.effect}</span>
          </div>
        `)}
      </div>

      <div style=${{ marginTop: '8px' }}>
        <div style=${{ fontSize: '10px', opacity: 0.75 }}>
          이 카드는 지금 <strong>${STAGE_NAMES[stage]}</strong> 단계로 발동
        </div>
      </div>

      <div style=${{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px', opacity: 0.75 }}>
        ${def.exhausts ? html`<div style=${{ fontSize: '10px' }}>사용 후 소진</div>` : null}
        ${def.unplayable ? html`<div style=${{ fontSize: '10px' }}>과적(짐) 상태일 때만 사용 가능</div>` : null}
      </div>
    </div>
  `;
}

export function Card({
  card, playable = true, armed = false, width = 140, onClick,
  draggable = false, onDragStart, onDragEnd, overloadActive = false, powers = {}, inventory = null,
  statuses = {}, player = null,
}) {
  const def = CARD_DEFINITIONS[card.defId];
  // 과부화는 불리언 하나가 진실이다 — 단계는 여기서 한 번만 만든다(getStage).
  const stage = getStage(overloadActive);
  const type = TYPE_INFO[def.type] || TYPE_INFO.skill;
  const classNames = ['hand-card', !playable && 'hand-card-disabled', armed && 'hand-card-armed']
    .filter(Boolean).join(' ');
  const isDraggable = draggable && playable;
  // 뒤얽힘이 붙어 있으면 카드에 적힌 숫자와 실제로 나가는 에너지가 다르다 — 화면이 엔진과
  // 같은 값을 보여주려면 statuses까지 넘겨야 한다(리뷰 B1).
  const cost = getEffectiveCost(def, stage, statuses);
  const item = card.itemId && inventory ? inventory.items.find((i) => i.id === card.itemId) : null;
  const escapeProgress = def.mapTags?.disengageProgress || 0;

  return html`
    <${Tooltip} width=${280} content=${html`<${CardDetailTooltip} def=${def} cost=${cost} type=${type} overloadActive=${overloadActive} item=${item} powers=${powers} statuses=${statuses} player=${player} />`}>
      <div
        class=${classNames}
        style=${{
          width: `${width}px`, minHeight: '190px', background: 'var(--color-surface)',
          border: `2px solid ${type.color}`, padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative',
          cursor: isDraggable ? 'grab' : undefined,
        }}
        draggable=${isDraggable}
        onClick=${playable ? onClick : undefined}
        onDragStart=${isDraggable ? (e) => {
          e.dataTransfer.setData('text/plain', card.instanceId);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart && onDragStart(card);
        } : undefined}
        onDragEnd=${isDraggable ? () => onDragEnd && onDragEnd() : undefined}
      >
        <span style=${{
          position: 'absolute', top: '-2px', left: '-2px', width: '26px', height: '26px',
          background: type.color, color: 'var(--color-bg)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px',
        }}>${def.unplayable ? '—' : cost}</span>
        ${def.unplayable ? html`
          <span style=${{ position: 'absolute', top: '0', left: '28px', fontSize: '9px', fontWeight: 800, padding: '2px 4px', background: 'var(--color-neutral-700)', color: 'var(--color-bg)' }}>사용 불가</span>
        ` : null}
        ${def.ammoCost ? html`
          <span style=${{ position: 'absolute', top: '-2px', right: '-2px', fontSize: '10px', background: 'var(--color-neutral-800)', color: 'var(--color-bg)', padding: '2px 5px', fontWeight: 700 }}>
            탄 ${def.ammoCost}
          </span>
        ` : null}
        ${escapeProgress ? html`
          <span style=${{ position: 'absolute', top: '28px', right: '-2px', fontSize: '10px', background: 'var(--color-info)', color: '#fff', padding: '2px 5px', fontWeight: 800 }}>
            이탈 +${escapeProgress}
          </span>
        ` : null}
        <div style=${{ marginTop: '20px', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>${def.name}</div>
        <span class=${`tag ${type.cls}`} style=${{ alignSelf: 'flex-start' }}>${type.label}</span>
        <p style=${{ fontSize: '11px', margin: 0, flex: 1, opacity: 0.85 }}>${def.description}</p>
      </div>
    <//>
  `;
}
