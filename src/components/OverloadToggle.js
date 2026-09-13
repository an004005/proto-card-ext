import { html } from '../lib.js';
import { OVERLOAD_STAGE_LABELS } from '../data/statusEffects.js';
import { Tooltip } from './Tooltip.js';
import { dispatch } from '../state/dispatch.js';

// 색만 여기서 정한다 — 이름은 카드 툴팁과 같은 한 벌(statusEffects.OVERLOAD_STAGE_LABELS)을 쓴다.
// 같은 상태를 화면마다 다르게 부르면 플레이어는 그것이 같은 것인 줄 모른다(리뷰 B7).
const ON_COLOR = 'var(--color-accent-2-600)';
const OFF_COLOR = 'var(--color-neutral-500)';

export const OVERLOAD_ON_SUMMARY = '단계 보정 카드의 피해·방어도 +25%, 모듈 보정 상향';

/**
 * 과부화 ON/OFF 알약 버튼. 대가가 없으므로(ADR-0080) 누르는 데 조건도 확인창도 없다 —
 * 전투 중에는 플레이어 턴에만 받는다(리듀서가 최종 판정한다).
 */
export function OverloadToggle({ active, disabled = false, compact = false }) {
  const label = OVERLOAD_STAGE_LABELS[active ? 1 : 0];
  return html`
    <${Tooltip} width=${220} content=${`켜면 ${OVERLOAD_ON_SUMMARY}. 끄고 켜는 데 드는 대가는 없습니다.`}>
      <button
        type="button"
        disabled=${disabled}
        onClick=${() => dispatch({ type: 'TOGGLE_OVERLOAD' })}
        aria-pressed=${active}
        style=${{
          width: '100%',
          padding: compact ? '3px 8px' : '5px 10px',
          fontSize: compact ? '10px' : '11px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          borderRadius: '999px',
          border: `1px solid ${active ? ON_COLOR : 'var(--color-divider)'}`,
          background: active ? ON_COLOR : 'transparent',
          color: active ? 'var(--color-surface)' : OFF_COLOR,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >${label}</button>
    <//>
  `;
}
