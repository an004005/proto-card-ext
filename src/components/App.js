import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { LoadoutScreen } from './LoadoutScreen.js';
import { MapScreen } from './MapScreen.js';
import { CombatScreen } from './CombatScreen.js';
import { RewardScreen } from './RewardScreen.js';
import { GameOverScreen } from './GameOverScreen.js';
import { ExtractionCompleteScreen } from './ExtractionCompleteScreen.js';

const SCREENS = {
  loadout: LoadoutScreen,
  map: MapScreen,
  combat: CombatScreen,
  reward: RewardScreen,
  gameOver: GameOverScreen,
  extractionComplete: ExtractionCompleteScreen,
};

export function App() {
  const ScreenComponent = SCREENS[snapshotSignal.value.currentScreen];
  return html`
    <div style=${{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <${ScreenComponent} />
    </div>
  `;
}
