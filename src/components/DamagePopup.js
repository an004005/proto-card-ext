// Floating "-N" text over a combatant's HP bar whenever their hp drops. Pure visual feedback,
// derived by watching hp change — combatEngine itself has no notion of "damage events".
import { html, useEffect, useRef, useState } from '../lib.js';

let nextPopupId = 0;
const POPUP_LIFETIME_MS = 700;

export function useDamagePopups(hp) {
  const prevHp = useRef(hp);
  const [popups, setPopups] = useState([]);

  useEffect(() => {
    if (hp >= prevHp.current) { prevHp.current = hp; return undefined; }
    const amount = prevHp.current - hp;
    const id = ++nextPopupId;
    prevHp.current = hp;
    setPopups((list) => [...list, { id, amount }]);
    // 적이 죽어 이 행이 사라지는 순간에도 타이머는 살아 있다 — 언마운트 뒤에 setState를
    // 부르지 않도록 반드시 걷어낸다(리뷰 A8).
    const timer = setTimeout(() => setPopups((list) => list.filter((p) => p.id !== id)), POPUP_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [hp]);

  return popups;
}

export function DamagePopupLayer({ popups }) {
  if (popups.length === 0) return null;
  return html`
    <div style=${{ position: 'absolute', top: 0, left: '50%', width: 0, pointerEvents: 'none' }}>
      ${popups.map((p) => html`
        <span key=${p.id} class="damage-popup">-${p.amount}</span>
      `)}
    </div>
  `;
}
