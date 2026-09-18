# 프로젝트 데이터 인덱스

이 파일은 카드 익스트랙션의 확정 데이터가 어디에 있는지 안내하고, 코드와 문서가 함께 최신 상태를 유지하도록 하는 작업 규칙이다.

## 권위 순서

1. 현재 작업 트리의 `src/` 코드와 이를 검증하는 `test/`
2. 코드에서 자동 생성한 `docs/card-extraction-reference.xlsx`
3. 현재 구현을 설명하는 `docs/` 문서
4. `docs/planned.md`와 `docs/proposals/`의 미구현 내용
5. `docs/adr/`의 의사결정 이력

상위 항목과 충돌하는 하위 문서는 현재 동작의 근거로 사용하지 않는다. ADR은 당시의 판단을 보존하는 로그이며 현재 수치의 권위가 아니다.

## 데이터 위치

| 데이터 | 코드 | 설명 문서 |
|---|---|---|
| 게임 규칙과 전투 처리 | `src/engine/`, `src/state/` | `docs/game-rules.md`, `docs/combat-reference.md` |
| 카드 | `src/data/cards.js` | `docs/card-map-tag-mapping.md`, 엑셀 `카드 일람` |
| 무기·방어구 | `src/data/equipment.js` | 엑셀 `무기`, `방어구` |
| 모듈 | `src/data/modules.js` | 엑셀 `모듈` |
| 임플란트 | `src/data/implants.js` | 엑셀 `임플란트` |
| 장비 Capability | `src/data/facilityEquipmentCapabilities.js` | `docs/map-equipment-capability-mapping.md`, 장비별 엑셀 시트 |
| 출격 준비 역할군 프리셋 | `src/data/loadoutPresets.js` | `docs/game-rules.md` 「런 준비」, 엑셀 `프리셋` |
| 몬스터와 행동 | `src/data/monsters.js`, `src/engine/monsterAI.js` | 엑셀 `몬스터 스펙`, `몬스터 행동` |
| 맵 구성과 수치 | `src/data/facilityLayout.js`, `src/engine/facilityGraph.js`, `src/engine/runEngine.js` | `docs/extraction-map-implementation-spec.md`, 엑셀 `맵 구성요소` |
| 상태 효과 | `src/data/statusEffects.js`, `src/engine/statusEngine.js` | `docs/terminology.md`, `docs/combat-reference.md` |
| 확정됐지만 미구현 | 해당 없음 | `docs/planned.md` |
| 미확정 제안 | 해당 없음 | `docs/proposals/design-backlog.md` |
| 결정 이력 | 해당 없음 | `docs/adr/` |

## 변경 규칙

- 게임 콘텐츠, 규칙, 수치 또는 이름을 변경하면 같은 변경에서 관련 테스트와 `docs/` 문서를 갱신한다.
- 콘텐츠 데이터나 규칙 상수를 변경하면 `npm run docs:reference`로 엑셀을 다시 생성하고 `npm run docs:check`로 동기화를 확인한다.
- 현재 문서에는 현재 코드로 확인되는 최신 정보만 쓴다. 오래된 값, 변경 이력, 삭선, 선택 중인 안은 남기지 않는다.
- 확정됐지만 아직 동작하지 않는 내용은 `docs/planned.md`에만 쓴다.
- 결론이 나지 않은 내용은 `docs/proposals/`에만 쓴다.
- 과거 결정의 이유가 필요하면 ADR을 추가하거나 상태를 갱신하되 기존 ADR 본문을 현재 규칙처럼 고쳐 쓰지 않는다.
