import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { POST_COMBAT_CHOICES } from '../data/dropTables.js';

const CHOICES = [
  { id: 'farm', label: '추가 파밍', desc: `잡템·환금템 추가 획득. 기습 확률 ${Math.round(POST_COMBAT_CHOICES.farm.ambushChance * 100)}%.` },
  { id: 'rest', label: '휴식', desc: `체력 10% 회복, 과부화 ${POST_COMBAT_CHOICES.rest.overloadReduce} 감소. 기습 확률 ${Math.round(POST_COMBAT_CHOICES.rest.ambushChance * 100)}%.` },
  { id: 'move', label: '그냥 이동', desc: '아무 효과 없음. 유일한 안전 선택.' },
];

export function PostCombatScreen() {
  return html`
    <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-6)', padding: 'var(--space-8)' }}>
      <h2 style=${{ margin: 0 }}>전투 승리 — 다음 행동을 선택하세요</h2>
      <div class="hr" style=${{ width: '400px' }}></div>
      <div style=${{ display: 'flex', gap: 'var(--space-4)' }}>
        ${CHOICES.map((c) => html`
          <div
            key=${c.id} class="reward-card"
            style=${{ width: '200px', minHeight: '140px', background: 'var(--color-surface)', border: '2px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '10px', cursor: 'pointer' }}
            onClick=${() => dispatch({ type: 'POST_COMBAT_CHOICE', choice: c.id })}
          >
            <div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '16px' }}>${c.label}</div>
            <p style=${{ fontSize: '12px', margin: 0, flex: 1, opacity: 0.85 }}>${c.desc}</p>
          </div>
        `)}
      </div>
    </div>
  `;
}
