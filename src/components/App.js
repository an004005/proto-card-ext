import { html } from '../lib.js';
import { snapshotSignal } from '../state/runState.js';
import { LoadoutScreen } from './LoadoutScreen.js';
import { StageScreen } from './StageScreen.js';
import { CombatScreen } from './CombatScreen.js';
import { PostCombatScreen } from './PostCombatScreen.js';
import { LootChoiceScreen } from './LootChoiceScreen.js';
import { GameOverScreen } from './GameOverScreen.js';
import { ExtractionCompleteScreen } from './ExtractionCompleteScreen.js';

const SCREENS = {
  loadout: LoadoutScreen,
  stage: StageScreen,
  combat: CombatScreen,
  loot_choice: LootChoiceScreen,
  post_combat: PostCombatScreen,
  gameOver: GameOverScreen,
  extractionComplete: ExtractionCompleteScreen,
};

export function App() {
  const screen = snapshotSignal.value.currentScreen;
  const ScreenComponent = SCREENS[screen];
  return html`
    <div style=${{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <${ScreenComponent} />
    </div>
  `;
}
