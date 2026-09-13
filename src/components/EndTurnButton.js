import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { COMBAT_ROUND_TIME_COST } from '../engine/combatMapIntegration.js';
import { Tooltip } from './Tooltip.js';

// 턴 하나는 공짜가 아니다 — 맵 시계가 COMBAT_ROUND_TIME_COST칸 나간다. 버튼에 그 값을 적지
// 않으면 전투가 길어질수록 출구가 닫히는 이유를 플레이어가 화면 어디에서도 읽을 수 없다.
export function EndTurnButton({ disabled }) {
  return html`
    <div style=${{ display: 'flex', justifyContent: 'center' }}>
      <${Tooltip} width=${240} content=${`턴을 넘기면 맵 시계가 ${COMBAT_ROUND_TIME_COST}칸 흐릅니다. 붕괴와 출구 폐쇄는 전투 중에도 그대로 다가옵니다.`}>
        <button
          class="btn btn-primary" style=${{ padding: '12px 40px', fontSize: '15px' }}
          disabled=${disabled}
          onClick=${() => dispatch({ type: 'END_TURN' })}
        >턴 종료 (맵 ${COMBAT_ROUND_TIME_COST}칸)</button>
      <//>
    </div>
  `;
}
