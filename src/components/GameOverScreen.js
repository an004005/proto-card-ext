import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { RUN_COLLAPSE_TIME, TOTAL_NODES } from '../data/facilityLayout.js';
import { computeInventoryScore, startNewRun } from './runEndHelpers.js';

function causeOfDeath(facilityRunState) {
  if (facilityRunState?.phase === 'meltdown') return '과부화 멜트다운';
  if (facilityRunState?.phase === 'collapsed') return '시설 붕괴';
  return '전투 불능';
}

export function GameOverScreen() {
  const snapshot = snapshotSignal.value;
  const run = snapshot.facilityRunState;
  const visitedCount = run ? run.visitedNodeIds.length : 0;
  const score = computeInventoryScore(snapshot.playerState.inventory);

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', background: 'var(--color-neutral-900)', color: 'var(--color-bg)' }}>
      <h6 style=${{ color: 'var(--color-accent-400)' }}>EXTRACTION FAILED · 탈출 실패</h6>
      <h1 style=${{ margin: 0, fontSize: '64px' }}>사망</h1>
      <div style=${{ display: 'flex', gap: 'var(--space-8)', margin: 'var(--space-4) 0', fontSize: '14px' }}>
        <span>사인 <strong>${causeOfDeath(run)}</strong></span>
        <span>경과 시간 <strong>${run ? run.time : 0}</strong>/${RUN_COLLAPSE_TIME}</span>
        <span>탐사 노드 <strong>${visitedCount}</strong>/${TOTAL_NODES}</span>
      </div>
      <p style=${{ fontSize: '12px', opacity: 0.6 }}>미회수 점수: ${score}크레드</p>
      <button class="btn btn-primary" style=${{ padding: '12px 40px' }} onClick=${startNewRun}>새 런 시작</button>
    </div>
  `;
}
