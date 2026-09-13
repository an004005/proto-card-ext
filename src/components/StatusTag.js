import { html } from '../lib.js';
import { Tooltip } from './Tooltip.js';
import { STATUS_LABELS, STATUS_DESCRIPTIONS } from '../data/statusEffects.js';

/**
 * 스택 수가 의미 없는 상태 — 조이기는 시전자가 살아 있는 한 매턴 고정 1피해이고 스택으로
 * 커지지도 줄지도 않는다. 숫자를 붙이면 "3이면 3피해"로 읽히므로 아예 감춘다(리뷰 B7).
 */
const STACKLESS_STATUSES = new Set(['constrict']);

export function StatusTag({ statusKey, value, cls = 'tag-accent' }) {
  const label = STATUS_LABELS[statusKey] || statusKey;
  const description = STATUS_DESCRIPTIONS[statusKey];
  const showsValue = value !== undefined && !STACKLESS_STATUSES.has(statusKey);
  if (!description) return html`<span class=${`tag ${cls}`}>${label}${showsValue ? ` ${value}` : ''}</span>`;
  // 설명이 달린 태그는 버튼이 아니므로 스스로 탭 정지점이 되어야 한다 — 그러지 않으면 키보드로
  // 훑는 사람에게는 이 설명이 존재하지 않는 정보다. 점선 밑줄은 "여기 더 있다"는 표시다(리뷰 B7).
  const tag = html`<span class=${`tag ${cls}`} tabIndex="0" style=${{ textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>${label}${showsValue ? ` ${value}` : ''}</span>`;
  return html`<${Tooltip} width=${180} content=${description}>${tag}<//>`;
}
