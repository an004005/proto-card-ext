import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { getCurrentStep } from '../engine/stageEngine.js';

function computeScore(inventory) {
  return inventory.items.reduce((sum, i) => sum + (i.value || 0), 0);
}

function startNewRun() {
  dispatch({ type: 'NEW_RUN', seed: Math.floor(Math.random() * 0xffffffff) });
}

export function GameOverScreen() {
  const snapshot = snapshotSignal.value;
  const step = getCurrentStep(snapshot.stageState);
  const floorReached = step ? step.floor : 10;
  const score = computeScore(snapshot.playerState.inventory);

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', background: 'var(--color-neutral-900)', color: 'var(--color-bg)' }}>
      <h6 style=${{ color: 'var(--color-accent-400)' }}>EXTRACTION FAILED · 탈출 실패</h6>
      <h1 style=${{ margin: 0, fontSize: '64px' }}>사망</h1>
      <div style=${{ display: 'flex', gap: 'var(--space-8)', margin: 'var(--space-4) 0', fontSize: '14px' }}>
        <span>도달 층 <strong>${floorReached}</strong>/10</span>
        <span>회수된 점수 <strong>0</strong> (사망 시 전부 손실)</span>
      </div>
      <p style=${{ fontSize: '12px', opacity: 0.6 }}>미회수 점수: ${score}크레드</p>
      <button class="btn btn-primary" style=${{ padding: '12px 40px' }} onClick=${startNewRun}>새 런 시작</button>
    </div>
  `;
}
