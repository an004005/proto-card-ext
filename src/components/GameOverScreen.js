import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { RUN_COLLAPSE_TIME } from '../data/facilityLayout.js';
import { computeInventoryScore, computeContractOutcome, startNewRun } from './runEndHelpers.js';

// 사인은 둘뿐이다 — 죽은 분기를 남겨두면 화면이 존재하지 않는 사인을 말할 수 있는 것처럼
// 읽힌다(리뷰 B7).
function causeOfDeath(facilityRunState) {
  if (facilityRunState?.phase === 'collapsed') return '시설 붕괴';
  return '전투 불능';
}

export function GameOverScreen() {
  const snapshot = snapshotSignal.value;
  const run = snapshot.facilityRunState;
  const visitedCount = run ? run.visitedNodeIds.length : 0;
  // 노드 총수는 런마다 다르다 — 구역이 런 시작에 뽑히기 때문이다(ADR-0081).
  const totalNodes = run ? run.graph.nodes.length : 0;
  const outcome = computeContractOutcome(run);
  const score = computeInventoryScore(snapshot.playerState.inventory) + (outcome?.scoreDelta ?? 0);

  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', background: 'var(--color-neutral-900)', color: 'var(--color-bg)' }}>
      <h6 style=${{ color: 'var(--color-accent-400)' }}>EXTRACTION FAILED · 탈출 실패</h6>
      <h1 style=${{ margin: 0, fontSize: '64px' }}>사망</h1>
      <div style=${{ display: 'flex', gap: 'var(--space-8)', margin: 'var(--space-4) 0', fontSize: '14px' }}>
        <span>사인 <strong>${causeOfDeath(run)}</strong></span>
        <span>붕괴까지 <strong>${Math.max(0, RUN_COLLAPSE_TIME - (run ? run.time : 0))}</strong>칸 남은 시점 (시각 ${run ? run.time : 0} / ${RUN_COLLAPSE_TIME})</span>
        <span>탐사 노드 <strong>${visitedCount}</strong>/${totalNodes}</span>
      </div>
      <p style=${{ fontSize: '12px', opacity: 0.6 }}>미회수 점수: ${score}cr</p>
      ${outcome ? html`
        <p style=${{ fontSize: '12px', opacity: 0.6 }}>
          계약 「${outcome.contract.name}」 ${outcome.completed ? '완료' : '미완수'} —
          ${outcome.completed ? `보상 +${outcome.scoreDelta}` : `위약 ${outcome.scoreDelta}`}cr
        </p>
      ` : null}
      <button class="btn btn-primary" style=${{ padding: '12px 40px' }} onClick=${startNewRun}>새 런 시작</button>
    </div>
  `;
}
