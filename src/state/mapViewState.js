// 지도에서 "지금 어디를 보고 있는가"(팬·줌)와 디버그 전체보기 토글. 게임 상태가 아니라 화면
// 상태이므로 스냅샷·히스토리에는 절대 넣지 않는다 — 되감기가 카메라를 움직이면 안 된다.
//
// 그런데 MapScreen은 전투·보상·인벤토리 팝업이 열릴 때마다 통째로 언마운트된다. 뷰를
// useState에 두면 전투 한 번에 줌과 위치가 초기값으로 돌아가, 플레이어는 매번 자기 자리를
// 다시 찾아야 한다. 그래서 컴포넌트 밖의 시그널에 둔다.
import { signal } from '../lib.js';

/** 지도를 처음 열었을 때의 뷰 — 확대 없음, 중앙. */
export const DEFAULT_MAP_VIEW = { x: 0, y: 0, scale: 1 };

/** 현재 팬·줌. {x, y, scale} */
export const mapViewSignal = signal(DEFAULT_MAP_VIEW);

/** 디버그: 안개를 무시하고 전부 표시. 뷰와 같은 이유로 화면 밖에 둔다 — 전투 한 번에 꺼지면
 * 디버그로 무엇을 보려던 것인지 매번 다시 켜야 한다. */
export const mapDebugRevealSignal = signal(false);

/** 새 런이 시작될 때만 부른다(state/dispatch.js). 지도가 통째로 바뀌므로 이전 런의 카메라
 * 위치는 의미가 없고, 디버그 토글도 런 사이에 끌고 다닐 이유가 없다. */
export function resetMapView() {
  mapViewSignal.value = DEFAULT_MAP_VIEW;
  mapDebugRevealSignal.value = false;
}
