import { html } from '../lib.js';
import { DEV_SCENARIO_GROUPS, findDevScenario } from '../dev/devScenarios.js';

// 데브맵 선택기 — `?devScenario=`가 붙어 있을 때만 뜬다. 정상 플레이에는 나타나지 않는다.
// 시나리오마다 "무엇을 봐야 하는가"를 함께 띄우는 것이 요점이다. 상태를 재현해 주기만 하면
// 무엇이 잘못된 것인지는 매번 다시 떠올려야 하는데, 그러면 확인이 빠진 채로 지나간다.
export function DevScenarioPicker() {
  const params = new URLSearchParams(window.location.search);
  const current = params.get('devScenario');
  if (!current) return null;
  const scenario = findDevScenario(current);

  const go = (name) => {
    const next = new URLSearchParams(window.location.search);
    next.set('devScenario', name);
    window.location.search = next.toString();
  };

  return html`
    <div style=${{
      position: 'fixed', right: '10px', bottom: '10px', zIndex: 50, width: '260px',
      border: '2px solid var(--color-accent-2-700)', background: 'var(--color-surface)',
      boxShadow: 'var(--shadow-lg)', fontSize: '11px', maxHeight: '70vh', overflowY: 'auto',
    }}>
      <div style=${{ padding: '6px 8px', background: 'var(--color-accent-2-700)', color: 'var(--color-bg)', fontWeight: 800, letterSpacing: '0.04em' }}>
        데브맵 — ${scenario ? scenario.label : current}
      </div>
      ${scenario ? html`
        <div style=${{ padding: '6px 8px', borderBottom: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)' }}>
          <strong>확인할 것</strong><br />${scenario.watch}
        </div>
      ` : null}
      <div style=${{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        ${DEV_SCENARIO_GROUPS.map((group) => html`
          <div key=${group.stage}>
            <div style=${{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-neutral-600)', marginBottom: '3px' }}>${group.stage}</div>
            ${group.items.map((item) => html`
              <button
                key=${item.name}
                class="btn btn-secondary"
                style=${{
                  fontSize: '11px', width: '100%', textAlign: 'left', marginBottom: '2px',
                  background: item.name === current ? 'var(--color-accent-100)' : undefined,
                  fontWeight: item.name === current ? 800 : undefined,
                }}
                onClick=${() => go(item.name)}
              >${item.label}</button>
            `)}
          </div>
        `)}
      </div>
    </div>
  `;
}
