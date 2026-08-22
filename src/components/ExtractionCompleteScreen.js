import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { computeInventoryScore, startNewRun } from './runEndHelpers.js';

export function ExtractionCompleteScreen() {
  const ps = snapshotSignal.value.playerState;
  const score = computeInventoryScore(ps.inventory);

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', background: 'var(--color-accent)', color: 'var(--color-bg)' }}>
      <h6 style=${{ color: 'var(--color-bg)', opacity: 0.8 }}>EXTRACTION SUCCESSFUL · 탈출 성공</h6>
      <h1 style=${{ margin: 0, fontSize: '64px' }}>탈출 성공</h1>
      <div style=${{ display: 'flex', gap: 'var(--space-8)', margin: 'var(--space-4) 0', fontSize: '14px' }}>
        <span>최종 체력 HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
        <span>최종 과부화 <strong>${ps.overload}</strong>/100</span>
        <span>회수 점수 <strong>${score}</strong>크레드</span>
      </div>
      <button class="btn btn-secondary" style=${{ padding: '12px 40px', background: 'var(--color-bg)', borderColor: 'var(--color-bg)' }} onClick=${startNewRun}>새 런 시작</button>
    </div>
  `;
}
