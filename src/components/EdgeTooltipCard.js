// 통로(엣지) 하나를 읽는 카드 — 지도 위 엣지 호버 툴팁이 쓴다.
// 설계는 게임 UI 목업 디자인/edge-tooltip(Main.dc.html · States.dc.html)을 그대로 따른다.
//
// 예전에는 `복도 ↔ 감시 지점 — 특수 엣지(전자 잠금) · 미개방 · Hacking 2이 표준`처럼 한 줄에
// ' — '로 이어 붙였다. 통로의 성격이 넷(잠금 / 고지대 / 방향 / 장벽)이나 되는데 그것이 전부
// 같은 굵기의 한 문장으로 오면, 지금 이 길을 지날 수 있는지조차 눈으로 가릴 수 없었다.
// 그래서 노드 카드(NodeTooltipCard)와 같은 뼈대로 나눈다: 머리(통로 종류 · 상태 배지 · 양 끝
// 노드) → 행(잠금 / 고지대 / 방향 / 장벽 / 이동) → 꼬리(규칙 한 줄 + 조작 힌트).
// 없는 행은 그리지 않는다.
//
// 내용(무엇을 말할 것인가)은 MapScreen.describeEdge가 정하고, 이 파일은 그리기만 한다.
import { html } from '../lib.js';

/** 행 종류별 14px 스트로크 아이콘. 모양이 곧 의미다 — 자물쇠는 잠금, 산은 고지대,
 * 화살표는 이동, 거꾸로 선 화살표는 일방통행, 격자는 임시 장벽. */
const ICONS = {
  lock: html`<rect x="3" y="7" width="10" height="7"></rect><path d="M5 7 V5 a3 3 0 0 1 6 0 V7"></path>`,
  highGround: html`<path d="M1.5 13.5 L6 5 L9 10 L11 7 L14.5 13.5 Z"></path>`,
  move: html`<path d="M2 8 H13 M10 4.5 L13.5 8 L10 11.5"></path>`,
  direction: html`<path d="M13 8 H3 M6 4.5 L2.5 8 L6 11.5"></path>`,
  barrier: html`<path d="M3 3 V13 M8 3 V13 M13 3 V13 M1.5 8 H14.5"></path>`,
};

function Icon({ name, color }) {
  return html`
    <div style=${{ width: '14px', height: '14px', flexShrink: 0, marginTop: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: color || 'var(--color-bg)' }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        ${ICONS[name] || ICONS.move}
      </svg>
    </div>
  `;
}

/** 보조 한 줄은 문자열이거나, 색을 입힐 조각의 배열이다 — `HP −8`이나 `적 1그룹`처럼 한 조각만
 * 붉어야 하는 문장이 있어서 통째로 한 색을 줄 수 없다. */
function Detail({ detail }) {
  const parts = Array.isArray(detail) ? detail : [{ text: detail }];
  return html`
    <div style=${{ fontSize: '10px', color: 'var(--color-neutral-300)', lineHeight: 1.45 }}>
      ${parts.map((part, index) => html`<span key=${index} style=${{ color: part.color || undefined, fontWeight: part.color ? 800 : undefined }}>${part.text}</span>`)}
    </div>
  `;
}

function Row({ row }) {
  return html`
    <div style=${{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <${Icon} name=${row.icon || row.kind} color=${row.color} />
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '1px', flexGrow: 1, minWidth: 0 }}>
        ${row.title ? html`
          <div style=${{ fontSize: '11px', fontWeight: 800, color: row.color || 'var(--color-bg)' }}>
            ${row.title}${row.titleSuffix ? html` <span style=${{ color: row.titleSuffix.color || undefined }}>${row.titleSuffix.text}</span>` : null}
          </div>
        ` : null}
        ${row.detail ? html`<${Detail} detail=${row.detail} />` : null}
      </div>
    </div>
  `;
}

/**
 * @param {{description: any, text?: string, width?: number}} props
 *   description은 MapScreen.describeEdge의 구조화된 결과, text는 그것을 한 문장으로 이은 사본
 *   (describeEdgeText — 보조 기술·렌더 테스트용).
 */
export function EdgeTooltipCard({ description, text = '', width = 300 }) {
  const { header, rows, footer } = description;
  const badge = header.badge;
  return html`
    <div style=${{
    width: `${width}px`, background: 'var(--color-neutral-900)', color: 'var(--color-bg)',
    display: 'flex', flexDirection: 'column',
  }}>
      ${/* 문자열 사본은 보이지 않게 항상 둔다 — NodeTooltipCard와 같은 이유로, 렌더 테스트와
          보조 기술이 카드의 내용을 같은 문장으로 읽을 수 있어야 한다. */ null}
      <span style=${{ display: 'none' }}>${text}</span>

      <div style=${{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '8px 10px', borderBottom: '1px solid rgba(243,242,242,0.18)' }}>
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style=${{ fontSize: '12px', fontWeight: 800, letterSpacing: '-0.01em', color: header.titleColor || 'var(--color-bg)' }}>${header.title}</div>
          ${badge ? html`<div style=${{
    fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', padding: '2px 6px', whiteSpace: 'nowrap',
    background: badge.background, color: badge.color, border: badge.border || undefined,
  }}>${badge.label}</div>` : null}
        </div>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', flexWrap: 'wrap' }}>
          ${header.ends.map((end, index) => html`
            <span key=${`end${index}`} style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              ${index > 0 ? html`<span style=${{ color: 'var(--color-neutral-500)' }}>${header.arrow}</span>` : null}
              <span style=${{ fontWeight: 800, color: 'var(--color-bg)' }}>${end.typeLabel}</span>
              ${end.note ? html`<span style=${{ color: 'var(--color-neutral-400)' }}>${end.note}</span>` : null}
            </span>
          `)}
        </div>
      </div>

      ${rows.length > 0 ? html`
        <div style=${{ display: 'flex', flexDirection: 'column', padding: '6px 10px 8px', gap: '6px' }}>
          ${rows.map((row, index) => html`<${Row} key=${`${row.kind}:${index}`} row=${row} />`)}
        </div>
      ` : null}

      ${(footer.rule || footer.hint) ? html`
        <div style=${{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
    padding: '6px 10px', borderTop: '1px solid rgba(243,242,242,0.18)',
    fontSize: '10px', color: 'var(--color-neutral-400)',
  }}>
          <span>${footer.rule}</span>
          ${footer.hint ? html`<span style=${{ color: 'var(--color-bg)', fontWeight: 800 }}>${footer.hint}</span>` : null}
        </div>
      ` : null}
    </div>
  `;
}
