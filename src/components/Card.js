import { html } from '../lib.js';
import { CARD_DEFINITIONS } from '../data/cards.js';
import { getEffectiveCost, resolveCard } from '../engine/combatEngine.js';
import { getStage, applyStageScale } from '../engine/overloadEngine.js';
import { STATUS_LABELS, POWER_LABELS } from '../data/statusEffects.js';
import { MODULE_POWER_STAGE_TABLES } from '../data/modules.js';
import { describeItem } from '../data/itemDisplay.js';
import { Tooltip } from './Tooltip.js';
import { OverloadGauge } from './OverloadGauge.js';

export const TYPE_INFO = {
  attack: { color: 'var(--color-accent)', label: 'ATTACK · 공격', cls: 'tag-accent' },
  skill: { color: 'var(--color-neutral-700)', label: 'SKILL · 스킬', cls: 'tag-neutral' },
  power: { color: 'var(--color-accent-2-700)', label: 'POWER · 파워', cls: 'tag-accent-2' },
  curse: { color: 'var(--color-neutral-500)', label: 'CURSE · 저주', cls: 'tag-neutral' },
  status: { color: 'var(--color-neutral-600)', label: 'STATUS · 상태이상', cls: 'tag-neutral' },
};

const STAGE_LABELS = ['0단계 (노멀)', '1단계 (최적)', '2단계 (과열)', '3단계 (멜트다운)'];
const STAGE_ZONE_LABELS = ['노멀', '최적', '과열', '멜트다운'];

// What each "variable" module power actually boosts, for the per-stage bonus shown in the
// card detail overlay (§9 — MODULE_POWER_STAGE_TABLES holds the live per-stage numbers).
const VARIABLE_POWER_BONUS_LABELS = {
  neuralBoost: '방어력 획득 시',
  bodyBoost: '근접 공격 피해',
  spatialAwareness: '원거리 공격 피해',
};

function describeEffect(effect, def, stage) {
  const scale = (v) => (def.stageTable ? v : applyStageScale(v, stage, def.scalesWithStage));
  switch (effect.kind) {
    case 'damage':
      return (effect.target === 'all_enemies' ? '광역 피해 ' : '피해 ') + scale(effect.value);
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
    case 'removeInventoryItem':
      return '아이템 영구 소멸';
    default:
      return effect.kind;
  }
}

function buildStageRows(def) {
  return STAGE_LABELS.map((label, stage) => {
    const resolved = resolveCard(def, stage);
    const parts = [];
    if (def.stageTable) parts.push(`코스트 ${resolved.cost}`);
    if (resolved.armorPerTurn !== undefined) parts.push(`매턴 갑옷 +${resolved.armorPerTurn}`);
    for (const effect of resolved.effects) parts.push(describeEffect(effect, def, stage));
    return { stage, label, effect: parts.filter(Boolean).join(' · ') || '효과 없음' };
  });
}

export function CardDetailTooltip({ def, cost, type, overload, item }) {
  const stage = getStage(overload ?? 0);
  const rows = buildStageRows(def);
  const itemInfo = item ? describeItem(item) : null;
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
            ${!def.stageTable ? `코스트 ${cost}` : ''}${def.ammoCost ? ` · 총알 ${def.ammoCost}` : ''}
          </div>
          ${def.overloadGain ? html`<div style=${{ fontSize: '10px', marginTop: '2px', opacity: 0.75 }}>과부화 부여 +${def.overloadGain}</div>` : null}
        </div>
      </div>

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
        <div style=${{ fontSize: '10px', opacity: 0.75, marginBottom: '4px' }}>
          현재 과부화 — 이 카드는 <strong>${STAGE_ZONE_LABELS[Math.min(stage, 3)]}</strong> 단계로 발동
        </div>
        <${OverloadGauge} overload=${overload ?? 0} floor=${0} compact=${true} />
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
  draggable = false, onDragStart, onDragEnd, stage = 0, overload = 0, powers = {}, inventory = null,
}) {
  const def = CARD_DEFINITIONS[card.defId];
  const type = TYPE_INFO[def.type] || TYPE_INFO.skill;
  const classNames = ['hand-card', !playable && 'hand-card-disabled', armed && 'hand-card-armed']
    .filter(Boolean).join(' ');
  const isDraggable = draggable && playable;
  const cost = getEffectiveCost(def, stage, powers);
  const item = card.itemId && inventory ? inventory.items.find((i) => i.id === card.itemId) : null;

  return html`
    <${Tooltip} width=${280} content=${html`<${CardDetailTooltip} def=${def} cost=${cost} type=${type} overload=${overload} item=${item} />`}>
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
        }}>${cost}</span>
        ${def.ammoCost ? html`
          <span style=${{ position: 'absolute', top: '-2px', right: '-2px', fontSize: '10px', background: 'var(--color-neutral-800)', color: 'var(--color-bg)', padding: '2px 5px', fontWeight: 700 }}>
            탄 ${def.ammoCost}
          </span>
        ` : null}
        <div style=${{ marginTop: '20px', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px' }}>${def.name}</div>
        <span class=${`tag ${type.cls}`} style=${{ alignSelf: 'flex-start' }}>${type.label}</span>
        <p style=${{ fontSize: '11px', margin: 0, flex: 1, opacity: 0.85 }}>${def.description}</p>
      </div>
    <//>
  `;
}
