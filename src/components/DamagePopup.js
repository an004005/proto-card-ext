// Floating "-N" text over a combatant's HP bar whenever their hp drops. Pure visual feedback,
// derived by watching hp change — combatEngine itself has no notion of "damage events".
import { html, useEffect, useRef, useState } from '../lib.js';

let nextPopupId = 0;
const POPUP_LIFETIME_MS = 700;

export function useDamagePopups(hp) {
  const prevHp = useRef(hp);
  const [popups, setPopups] = useState([]);

  useEffect(() => {
    if (hp < prevHp.current) {
      const amount = prevHp.current - hp;
      const id = ++nextPopupId;
      setPopups((list) => [...list, { id, amount }]);
      setTimeout(() => setPopups((list) => list.filter((p) => p.id !== id)), POPUP_LIFETIME_MS);
    }
    prevHp.current = hp;
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
