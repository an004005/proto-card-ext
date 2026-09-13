import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { RUN_COLLAPSE_TIME } from '../data/facilityLayout.js';
import { computeInventoryScore, computeContractOutcome, startNewRun } from './runEndHelpers.js';

export function ExtractionCompleteScreen() {
  const snapshot = snapshotSignal.value;
  const ps = snapshot.playerState;
  const run = snapshot.facilityRunState;
  const outcome = computeContractOutcome(run);
  const score = computeInventoryScore(ps.inventory) + (outcome?.scoreDelta ?? 0);

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', background: 'var(--color-accent)', color: 'var(--color-bg)' }}>
      <h6 style=${{ color: 'var(--color-bg)', opacity: 0.8 }}>EXTRACTION SUCCESSFUL · 탈출 성공</h6>
      <h1 style=${{ margin: 0, fontSize: '64px' }}>탈출 성공</h1>
      <div style=${{ display: 'flex', gap: 'var(--space-8)', margin: 'var(--space-4) 0', fontSize: '14px' }}>
        <span>붕괴까지 <strong>${Math.max(0, RUN_COLLAPSE_TIME - (run ? run.time : 0))}</strong>칸 남기고 탈출 (시각 ${run ? run.time : 0} / ${RUN_COLLAPSE_TIME})</span>
        <span>최종 체력 HP <strong>${ps.hp}</strong>/${ps.maxHp}</span>
        <span>회수 점수 <strong>${score}</strong>cr</span>
      </div>
      ${outcome ? html`
        <p style=${{ fontSize: '12px', opacity: 0.85, margin: 0 }}>
          계약 「${outcome.contract.name}」 ${outcome.completed ? '완료' : '미완수'} —
          ${outcome.completed ? `보상 +${outcome.scoreDelta}` : `위약 ${outcome.scoreDelta}`}cr
        </p>
      ` : null}
      <button class="btn btn-secondary" style=${{ padding: '12px 40px', background: 'var(--color-bg)', borderColor: 'var(--color-bg)' }} onClick=${startNewRun}>새 런 시작</button>
    </div>
  `;
}
