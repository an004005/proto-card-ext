import { html } from '../lib.js';
import { POWER_LABELS, POWER_DESCRIPTIONS } from '../data/statusEffects.js';
import { MODULE_POWER_STAGE_TABLES } from '../data/modules.js';
import { getStage } from '../engine/overloadEngine.js';
import { PileCounts } from './PileCounts.js';
import { OverloadGauge } from './OverloadGauge.js';
import { useDamagePopups, DamagePopupLayer } from './DamagePopup.js';
import { StatusTag } from './StatusTag.js';
import { Tooltip } from './Tooltip.js';

// Live per-stage bonus for each active variable power (neuralBoost/bodyBoost/spatialAwareness),
// so the player can see the actual number it's currently granting, re-read every render.
// forcefieldDefense isn't tracked as a power at all — it just grants an armor stack on cast.
function powerBonus(key, stage) {
  const table = MODULE_POWER_STAGE_TABLES[key];
  return table ? table[stage] : null;
}

export function PlayerStatusBar({ player, overload, overloadFloor, pileCounts }) {
  const hpPct = Math.max(0, Math.round((player.hp / player.maxHp) * 100));
  const stage = getStage(overload);
  const statusEntries = Object.entries(player.statuses).filter(([, v]) => v);
  const powerEntries = Object.keys(player.powers || {});
  const hasNextRangedBonus = !!player.temporaryEffects?.nextRangedBonus;
  const energyPips = Array.from({ length: player.maxEnergy }, (_, i) => i < player.energy);
  const popups = useDamagePopups(player.hp);

  return html`
    <div style=${{ width: '200px', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--color-surface)' }}>
      <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '14px' }}>플레이어</div>
      <div style=${{ height: '14px', background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)', position: 'relative' }}>
        <div style=${{ height: '100%', background: 'var(--color-accent-600)', width: `${hpPct}%` }}></div>
        <span style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
          ${player.hp}/${player.maxHp}
        </span>
        <${DamagePopupLayer} popups=${popups} />
      </div>
      <${OverloadGauge} overload=${overload} floor=${overloadFloor} />
      <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        ${player.block > 0 ? html`<span class="tag tag-neutral">방어 ${player.block}</span>` : null}
        ${statusEntries.map(([key, value]) => html`<${StatusTag} key=${key} statusKey=${key} value=${value} cls="tag-outline" />`)}
        ${powerEntries.map((key) => {
          const bonus = powerBonus(key, stage);
          return html`
            <${Tooltip} key=${key} width=${180} content=${POWER_DESCRIPTIONS[key] || ''}>
              <span class="tag tag-accent-2">${POWER_LABELS[key] || key}${bonus !== null ? ` +${bonus}` : ''}</span>
            <//>
          `;
        })}
        ${hasNextRangedBonus ? html`
          <${Tooltip} width=${180} content=${`다음 원거리 공격에 +${player.temporaryEffects.nextRangedBonus.amount} 피해${player.temporaryEffects.nextRangedBonus.ignoresBlock ? ' (방어 무시)' : ''}`}>
            <span class="tag tag-accent-2">투시 대기중</span>
          <//>
        ` : null}
      </div>
      <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
        <div>
          <div style=${{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, marginBottom: '4px' }}>에너지</div>
          <div style=${{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            ${energyPips.map((filled, i) => html`
              <span key=${i} style=${{
                width: '20px', height: '20px',
                background: filled ? 'var(--color-accent)' : 'transparent',
                border: filled ? 'none' : '2px solid var(--color-divider)',
              }}></span>
            `)}
          </div>
        </div>
        <div style=${{ textAlign: 'right' }}>
          <div style=${{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, marginBottom: '4px' }}>총알</div>
          <div style=${{ fontWeight: 800, fontSize: '16px' }}>${player.ammo}</div>
        </div>
      </div>
      <${PileCounts} counts=${pileCounts} />
    </div>
  `;
}
