// 맵 시계 — 현재 시각, 붕괴까지, 표준 출구 A/B의 지금 상태. 맵 화면과 전투 화면이 **같은
// 컴포넌트**를 쓴다. 전투 중에도 맵 시계는 계속 흐르므로(턴마다 칸이 나간다) 전투 화면에서만
// 시계가 사라지면 플레이어는 몇 칸을 쓰고 있는지 모른 채 카드를 낸다.
//
// 숫자는 전부 mapTimeline.runCountdowns에서 온다 — 여기서 다시 세면 두 화면이 다른 시각을
// 말하게 된다.
import { html } from '../lib.js';
import { RUN_COLLAPSE_TIME } from '../data/facilityLayout.js';
import { runCountdowns } from '../engine/mapTimeline.js';
import { Tooltip } from './Tooltip.js';

export function IconClock() {
  return html`<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>`;
}

/**
 * 마감이 가까울수록 강해지는 세 단계. 60칸 밖은 중립, 30 이하는 경고색, 10 이하는 반전이다 —
 * 숫자만 바뀌면 "지금부터 급한가"를 매번 다시 계산해야 한다.
 * @param {number} ticks
 */
export function deadlineStyle(ticks) {
  if (ticks <= 10) return { color: 'var(--color-bg)', background: 'var(--color-negative, #dd2b0f)', fontWeight: 800, padding: '0 4px' };
  if (ticks <= 30) return { color: 'var(--color-negative, #dd2b0f)', fontWeight: 800 };
  return { color: 'var(--color-neutral-600)' };
}

/**
 * 지금 가장 먼저 닥치는 마감 하나. 줄 맨 앞에 한 번 더 적기 위한 것이다 — 세 숫자를 매번
 * 눈으로 비교하게 하면 가장 급한 것을 놓친다.
 * @param {{collapseIn: number, exits: {exitId: string, closed: boolean, inTicks: number, text: string}[]}} countdowns
 * @returns {{label: string, ticks: number}}
 */
export function nearestDeadline(countdowns) {
  const candidates = [{ label: '붕괴', ticks: countdowns.collapseIn }];
  for (const exit of countdowns.exits) {
    if (!exit.closed) candidates.push({ label: `출구 ${exit.exitId} 폐쇄`, ticks: exit.inTicks });
  }
  return candidates.sort((a, b) => a.ticks - b.ticks)[0];
}

/**
 * @param {{run: import('../engine/types.js').FacilityRunState, countdowns?: object, compact?: boolean}} props
 */
export function MapClock({ run, countdowns = runCountdowns(run), compact = false }) {
  const nearest = nearestDeadline(countdowns);
  const tip = `현재 시각 ${run.time} / ${RUN_COLLAPSE_TIME}칸. ${RUN_COLLAPSE_TIME}칸에 도달하면 즉시 런이 종료됩니다(탈출 실패). 표준 출구 A는 정해진 시각 뒤로 새 개방 요청을 받지 않습니다 — 이미 시작된 대기와 열린 창은 끝까지 갑니다. 봉쇄는 이 시각을 앞당기지 않습니다.`;
  return html`
    <${Tooltip} width=${300} content=${tip}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', padding: compact ? 0 : '0 var(--space-3)', borderRight: compact ? undefined : '1px solid var(--color-divider)', fontSize: '13px' }}>
        <${IconClock} />
        <span>
          <span style=${deadlineStyle(nearest.ticks)}>가장 이른 마감 ${nearest.label} <strong>${nearest.ticks}</strong>칸</span>
          <span style=${{ marginLeft: '8px', color: 'var(--color-neutral-600)' }}>시각 ${run.time} / ${RUN_COLLAPSE_TIME}</span>
          <span style=${{ marginLeft: '8px', ...deadlineStyle(countdowns.collapseIn) }}>붕괴까지 <strong>${countdowns.collapseIn}</strong>칸</span>
          ${countdowns.exits.map((exit) => html`
            <span key=${exit.exitId} style=${{ marginLeft: '8px', ...(exit.closed ? { color: 'var(--color-neutral-500)' } : deadlineStyle(exit.inTicks)) }}>
              ${exit.exitId} ${exit.text}
            </span>
          `)}
        </span>
      </div>
    <//>
  `;
}
