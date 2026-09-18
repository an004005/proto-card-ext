import { html } from '../lib.js';
import { STATUS_LABELS } from '../data/statusEffects.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import { computeDamage, computeBlock } from '../engine/statusEngine.js';
import { Tooltip } from './Tooltip.js';

/**
 * 적 공격/방어 인텐트 표시용 최종 수치 — combatEngine의 executeEnemyAction/applyOneEffect가
 * 실제로 적용하는 것과 동일한 공식(단계 배율 없음, 공격자 atkBonus/약화, 대상 취약, 자신
 * 손상)을 그대로 재사용해 "실제로 맞았을 때 값"을 미리 보여준다.
 *
 * `kind`는 아이콘 하나를 고르기 위한 분류일 뿐이고, 배지에 적히는 글자는 언제나 `tooltip`에서
 * 잘라 쓴다 — 라벨 표를 두 벌 두면 배지와 툴팁이 서로 다른 말을 하게 된다.
 * @param {import('../engine/types.js').Move} move
 * @param {import('../engine/types.js').Statuses} enemyStatuses
 * @param {boolean} playerVulnerable
 * @returns {{isAttack: boolean, kind: string, value: ?number, tooltip: string}}
 */
export function describeIntent(move, enemyStatuses = {}, playerVulnerable = false) {
  if (!move) return { isAttack: false, kind: 'other', value: null, tooltip: '' };
  if (move.damage) {
    const perHit = computeDamage(move.damage, {
      stage: 0, scalesWithStage: false, flatBonus: enemyStatuses.atkBonus || 0, weak: !!enemyStatuses.weak,
      vulnerable: playerVulnerable,
    });
    const hits = move.hits || 1;
    const total = perHit * hits;
    return { isAttack: true, kind: 'attack', value: total, tooltip: `공격 ${total}${hits > 1 ? ` (${perHit} × ${hits}회)` : ''}` };
  }
  const effects = move.effects || [];
  const blockEffect = effects.find((e) => e.kind === 'block');
  if (blockEffect) {
    const gained = computeBlock(blockEffect.value, { stage: 0, scalesWithStage: false, flatBonus: 0, fragile: !!enemyStatuses.fragile });
    return { isAttack: false, kind: 'block', value: gained, tooltip: `방어도 ${gained} 획득` };
  }
  const debuffEffect = effects.find((e) => e.kind === 'applyStatus' && (e.status === 'weak' || e.status === 'vulnerable'));
  if (debuffEffect) {
    const label = STATUS_LABELS[debuffEffect.status] || debuffEffect.status;
    return { isAttack: false, kind: 'debuff', value: debuffEffect.amount, tooltip: `${label} ${debuffEffect.amount} 부여` };
  }
  const statusEffect = effects.find((e) => e.kind === 'applyStatus');
  if (statusEffect) {
    const label = STATUS_LABELS[statusEffect.status] || statusEffect.status;
    return { isAttack: false, kind: 'buff', value: statusEffect.amount, tooltip: `${label} ${statusEffect.amount} 부여` };
  }
  if (move.flee) return { isAttack: false, kind: 'flee', value: null, tooltip: '도주' };
  if (move.insertStatusCard) {
    const count = move.insertStatusCardCount || 1;
    return { isAttack: false, kind: 'other', value: null, tooltip: `상태이상 카드 삽입${count > 1 ? ` ×${count}` : ''}` };
  }
  if (move.summon) return { isAttack: false, kind: 'other', value: null, tooltip: `소환: ${MONSTER_DEFINITIONS[move.summon]?.name || move.summon}` };
  if (move.selfDestruct) return { isAttack: false, kind: 'other', value: null, tooltip: '자폭' };
  if (move.stealCurrency) return { isAttack: false, kind: 'other', value: null, tooltip: '환금템 강탈' };
  return { isAttack: false, kind: 'other', value: null, tooltip: move.id || '' };
}

/** 20px 선 아이콘. 색은 배지에서 물려받으므로(stroke: currentColor) 종류별 색을 따로 두지 않는다. */
function intentGlyph(kind) {
  const svg = (children) => html`
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"
      style=${{ flex: '0 0 auto' }}>${children}</svg>
  `;
  switch (kind) {
    case 'attack': // 칼날 — 오른쪽 위로 뻗은 사선에 손잡이
      return svg(html`<path d="M17 3 L8 12" /><path d="M13 3 H17 V7" /><path d="M4 16 L8 12" /><path d="M3 13 L7 17" />`);
    case 'block': // 방패
      return svg(html`<path d="M10 3 L16 5 V10 C16 14 13 16.2 10 17 C7 16.2 4 14 4 10 V5 Z" />`);
    case 'debuff': // 원 안의 아래 화살표
      return svg(html`<circle cx="10" cy="10" r="7" /><path d="M10 6 V13.5" /><path d="M7 10.5 L10 13.5 L13 10.5" />`);
    case 'buff': // 위 화살표
      return svg(html`<path d="M10 17 V4" /><path d="M5 9 L10 4 L15 9" />`);
    case 'flee': // 문
      return svg(html`<path d="M4 3 H12 V17 H4 Z" /><path d="M9.5 10 H10.5" /><path d="M14 10 H18" /><path d="M16 8 L18 10 L16 12" />`);
    default: // 그 밖의 인텐트 — 무언가 한다는 표시만
      return svg(html`<circle cx="10" cy="10" r="6.5" />`);
  }
}

/**
 * 툴팁 문장에서 배지에 적을 짧은 꼬리표를 자른다 — `공격 12 (4 × 3회)` → `공격 12`,
 * `방어도 5 획득` → `방어도 5`. 표를 새로 만들지 않으므로 툴팁을 고치면 배지도 함께 바뀐다.
 */
export function badgeLabel(tooltip) {
  return tooltip.replace(/\s*\([^)]*\)\s*/, '').replace(/\s*(획득|부여)$/, '').trim();
}

// 예전에는 작은 삼각형 하나에 숫자만 붙어 있어서, 저 적이 때리려는 것인지 막으려는 것인지를
// 색과 방향으로 유추해야 했다. 지금은 아이콘 + 글자 배지라 무엇을 할지 그대로 읽힌다.
// 공격만 accent 색을 쓰고 나머지는 중립이다 — 내 HP가 줄어드는 인텐트 하나만 눈에 띄어야 한다.
export function IntentIcon({ intent, enemyStatuses = {}, playerVulnerable = false }) {
  const { isAttack, kind, tooltip } = describeIntent(intent, enemyStatuses, playerVulnerable);
  const label = badgeLabel(tooltip);
  const body = html`
    <span class=${`tag ${isAttack ? 'tag-accent' : 'tag-neutral'}`} style=${{
      gap: '5px', padding: '3px 8px', fontWeight: 800, fontSize: '11.5px', whiteSpace: 'nowrap',
      ...(isAttack
        ? { background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', border: '1px solid var(--color-accent-300)' }
        : { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-800)', border: '1px solid var(--color-neutral-300)' }),
    }}>
      ${intentGlyph(kind)}
      ${label ? html`<span>${label}</span>` : null}
    </span>
  `;
  if (!tooltip) return body;
  return html`<${Tooltip} width=${180} content=${tooltip}>${body}<//>`;
}
