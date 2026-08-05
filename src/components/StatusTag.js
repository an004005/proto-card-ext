import { html } from '../lib.js';
import { Tooltip } from './Tooltip.js';
import { STATUS_LABELS, STATUS_DESCRIPTIONS } from '../data/statusEffects.js';

export function StatusTag({ statusKey, value, cls = 'tag-accent' }) {
  const label = STATUS_LABELS[statusKey] || statusKey;
  const description = STATUS_DESCRIPTIONS[statusKey];
  const tag = html`<span class=${`tag ${cls}`}>${label}${value !== undefined ? ` ${value}` : ''}</span>`;
  if (!description) return tag;
  return html`<${Tooltip} width=${180} content=${description}>${tag}<//>`;
}
