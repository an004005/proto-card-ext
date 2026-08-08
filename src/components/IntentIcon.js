import { html } from '../lib.js';
import { STATUS_LABELS } from '../data/statusEffects.js';
import { MONSTER_DEFINITIONS } from '../data/monsters.js';
import { computeDamage, computeBlock } from '../engine/statusEngine.js';
import { Tooltip } from './Tooltip.js';

/**
 * 적 공격/방어 인텐트 표시용 최종 수치 — combatEngine의 executeEnemyAction/applyOneEffect가
 * 실제로 적용하는 것과 동일한 공식(단계 배율 없음, 공격자 atkBonus/약화, 대상 취약, 자신
 * 손상)을 그대로 재사용해 "실제로 맞았을 때 값"을 미리 보여준다.
 * @param {import('../engine/types.js').Move} move
 * @param {import('../engine/types.js').Statuses} enemyStatuses
 * @param {boolean} playerVulnerable
 * @returns {{isAttack: boolean, value: ?number, tooltip: string}}
 */
function describeIntent(move, enemyStatuses = {}, playerVulnerable = false) {
  if (!move) return { isAttack: false, value: null, tooltip: '' };
  if (move.damage) {
    const perHit = computeDamage(move.damage, {
      stage: 0, scalesWithStage: false, flatBonus: enemyStatuses.atkBonus || 0, weak: !!enemyStatuses.weak,
      vulnerable: playerVulnerable,
    });
    const hits = move.hits || 1;
    const total = perHit * hits;
    return { isAttack: true, value: total, tooltip: `공격 ${total}${hits > 1 ? ` (${perHit} × ${hits}회)` : ''}` };
  }
  const effects = move.effects || [];
  const blockEffect = effects.find((e) => e.kind === 'block');
  if (blockEffect) {
    const gained = computeBlock(blockEffect.value, { stage: 0, scalesWithStage: false, flatBonus: 0, fragile: !!enemyStatuses.fragile });
    return { isAttack: false, value: gained, tooltip: `방어도 ${gained} 획득` };
  }
  const debuffEffect = effects.find((e) => e.kind === 'applyStatus' && (e.status === 'weak' || e.status === 'vulnerable'));
  if (debuffEffect) {
    const label = STATUS_LABELS[debuffEffect.status] || debuffEffect.status;
    return { isAttack: false, value: debuffEffect.amount, tooltip: `${label} ${debuffEffect.amount} 부여` };
  }
  const statusEffect = effects.find((e) => e.kind === 'applyStatus');
  if (statusEffect) {
    const label = STATUS_LABELS[statusEffect.status] || statusEffect.status;
    return { isAttack: false, value: statusEffect.amount, tooltip: `${label} ${statusEffect.amount} 부여` };
  }
  if (move.flee) return { isAttack: false, value: null, tooltip: '도주' };
  if (move.insertCurse) {
    const count = move.insertCurseCount || 1;
    return { isAttack: false, value: null, tooltip: `저주 카드 삽입${count > 1 ? ` ×${count}` : ''}` };
  }
  if (move.summon) return { isAttack: false, value: null, tooltip: `소환: ${MONSTER_DEFINITIONS[move.summon]?.name || move.summon}` };
  if (move.selfDestruct) return { isAttack: false, value: null, tooltip: '자폭' };
  if (move.stealCurrency) return { isAttack: false, value: null, tooltip: '환금템 강탈' };
  return { isAttack: false, value: null, tooltip: move.id || '' };
}

// 수치가 있는 인텐트(공격/방어/버프/디버프 등)는 아이콘 밑에 숫자를 바로 보여준다. 도주·저주
// 삽입처럼 단일 수치로 요약이 안 되는 것들은 숫자 없이 아이콘만 두고, 자세한 내용은 호버
// 툴팁으로만 보여준다.
export function IntentIcon({ intent, enemyStatuses = {}, playerVulnerable = false }) {
  const { isAttack, value, tooltip } = describeIntent(intent, enemyStatuses, playerVulnerable);
  const triangle = html`
    <div style=${{
      width: 0, height: 0, borderLeft: '11px solid transparent', borderRight: '11px solid transparent',
      borderBottom: `${isAttack ? '18px' : '14px'} solid ${isAttack ? 'var(--color-accent)' : 'var(--color-neutral-700)'}`,
      transform: isAttack ? 'none' : 'rotate(180deg)',
    }}></div>
  `;
  const body = html`
    <div style=${{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      ${triangle}
      ${value != null ? html`<span style=${{ fontSize: '11px', fontWeight: 800, marginTop: '2px' }}>${value}</span>` : null}
    </div>
  `;
  if (!tooltip) return body;
  return html`<${Tooltip} width=${160} content=${tooltip}>${body}<//>`;
}
