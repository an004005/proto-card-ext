import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { getCurrentStep } from '../engine/stageEngine.js';
import { computeFloorOverload } from '../engine/equipmentEngine.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import { getBurdenItems } from '../engine/inventoryEngine.js';
import { OverloadGauge } from './OverloadGauge.js';

const TIER_LABELS = { elite: '정예', boss: '보스', normal: '일반' };

export function StageScreen() {
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const step = getCurrentStep(snapshot.stageState);
  const floor = computeFloorOverload(ps.loadout);
  const burdenCount = getBurdenItems(ps.inventory).length;

  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: '700px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>${step ? `${step.floor}층` : '탐사 완료'}</h2>
        <span style=${{ fontSize: '13px' }}>체력 HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
      </div>

      <div style=${{ display: 'flex', gap: 'var(--space-6)', fontSize: '13px', flexWrap: 'wrap' }}>
        <span>총알 <strong>${ps.ammo}</strong></span>
        <span>인벤토리 <strong>${ps.inventory.items.length}</strong>/${ps.inventory.capacity}${burdenCount > 0 ? ` (짐 ${burdenCount})` : ''}</span>
      </div>
      <div style=${{ width: '320px' }}>
        <${OverloadGauge} overload=${ps.overload} floor=${floor} />
      </div>

      <div class="hr" style=${{ margin: 0 }}></div>

      ${step && step.type === 'combat' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style=${{ margin: 0 }}>
            ${step.tier ? html`<span class="tag tag-accent">${TIER_LABELS[step.tier]}</span> ` : null}
            전투: ${step.monsterIds.map((id) => MONSTER_DEFINITIONS[id].name).join(', ')}
          </p>
          <button class="btn btn-primary" style=${{ padding: '10px 32px', alignSelf: 'flex-start' }} onClick=${() => dispatch({ type: 'ENTER_STEP' })}>
            전투 시작
          </button>
        </div>
      ` : null}

      ${step && step.type === 'unknown_room' ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style=${{ margin: 0 }}>미지의 방 — 전투 30% / 휴식 30% / 빈 방 40%. 결과는 입장 후 공개됩니다.</p>
          <div style=${{ display: 'flex', gap: 'var(--space-2)' }}>
            <button class="btn btn-primary" style=${{ padding: '10px 24px' }} onClick=${() => dispatch({ type: 'ENTER_STEP' })}>입장</button>
            <button class="btn btn-secondary" style=${{ padding: '10px 24px' }} onClick=${() => dispatch({ type: 'SKIP_UNKNOWN_ROOM' })}>지나치기</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}
