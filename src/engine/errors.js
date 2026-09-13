/**
 * "그 행동은 규칙상 할 수 없다"는 거절. 리듀서(facilityReducer.withFacilityRunState)는 이
 * 예외만 조용히 흡수해 스냅샷을 그대로 돌려준다 — UI가 유효한 행동만 노출하는 것이 정상
 * 경로이고, 그래도 새어 들어온 무효 커맨드는 no-op이면 충분하기 때문이다.
 *
 * 반대로 TypeError 같은 진짜 버그까지 같은 catch가 삼키면 화면은 "버튼이 아무 반응도 없다"만
 * 보여주고 원인은 영영 드러나지 않는다(리뷰 A8). 그래서 규칙 위반은 반드시 이 클래스로 던지고,
 * 그 밖의 예외는 리듀서가 console.error로 남긴 뒤 다시 던진다.
 *
 * 의존성이 없는 잎 모듈로 둔다 — runEngine·recovery·actionCosts가 모두 가져다 쓰므로,
 * 어느 한쪽에 두면 순환 의존이 생긴다.
 */
export class RuleViolation extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RuleViolation';
  }
}
