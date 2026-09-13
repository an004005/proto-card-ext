import { html } from '../lib.js';
import { NOISE_GAUGE_CAPACITY } from '../engine/combatMapIntegration.js';
import { ThinGauge } from './ThinGauge.js';

// 전투 소음 게이지 — 얇은 바(ThinGauge)를 쓴다. gauge는 0..CAPACITY-1(다음 카드로 다 차면 그
// 즉시 소음 이벤트 발생 후 0으로 리셋), intensity는 이번 전투에서 마지막으로 발생한 소음
// 강도(1~2~3, 3에서 유지, 아직 한 번도 안 났으면 0).
export function NoiseGauge({ gauge, intensity }) {
  const tip = `카드를 낼 때마다 그 카드의 소음(0~3)이 쌓입니다. ${NOISE_GAUGE_CAPACITY}이 되면 지금 있는 노드에서 소음이 한 번 울리고 게이지는 0으로 돌아갑니다 — 근처 위협이 그 자리로 옵니다.`
    + ` 이번 전투에서 울릴 때마다 강도가 1 → 2 → 3으로 올라가고 3에서 유지됩니다(게이지가 0이 돼도 강도는 내려가지 않습니다).`
    + `${intensity ? ` 지금까지 ${intensity}단계까지 울렸습니다.` : ' 아직 한 번도 울리지 않았습니다.'}`;
  return html`
    <${ThinGauge}
      label="전투 소음" value=${gauge} max=${NOISE_GAUGE_CAPACITY}
      valueText=${`${gauge}/${NOISE_GAUGE_CAPACITY}${intensity ? ` · 강도 ${intensity}` : ''}`}
      tip=${tip}
    />
  `;
}
