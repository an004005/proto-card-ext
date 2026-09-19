# 09. 구현 참고

기획서 본문은 코드 이름을 쓰지 않았다. 이 문서는 프로그래머가 본문의 규칙을 코드에서 찾을 때 쓰는 짧은 안내다. 상세한 상수 이름과 함수는 [`docs/for-human/`](../for-human/README.md) 각 문서 끝의 "관련 코드" 절에 있다.

## 프로젝트 형태

- 순수 JavaScript, 프레임워크 없음. 브라우저와 Electron으로 실행.
- 상태는 불변 객체이고 모든 변경은 커맨드 → 리듀서 경로를 지난다. 되돌리기 이력이 이 구조 위에 있다.
- 난수는 명시적으로 전달되는 상태다. 같은 시드는 같은 시설, 같은 적, 같은 보상을 만든다.
- 테스트는 `node --test`. 40여 개 파일이 엔진 규칙을 검증한다.
- 콘텐츠 데이터에서 엑셀을 자동 생성한다(`npm run docs:reference`). 문서 동기화 검사는 `npm run docs:check`.

## 본문 규칙 → 코드 위치

| 본문의 규칙 | 코드 |
|---|---|
| 시간 상수(붕괴 240, 폐쇄 150, 이동 간격, 소음 지속) | `src/data/facilityLayout.js` |
| 행동별 시간·소음·요구 능력 표 | `src/engine/actionCosts.js` |
| 층계 단계와 통화 | `src/engine/capabilityCosts.js` |
| 장비별 능력 보정과 현장 행동 | `src/data/facilityEquipmentCapabilities.js` |
| 시설 생성(구역 추첨, 출구 배치, 위협 배치) | `src/engine/facilityGraph.js`, `src/engine/layoutArchetypes.js` |
| 시간 진행, 위협 이동, 조우 판정, 경계도, 관측 | `src/engine/runEngine.js` |
| 수습 수단 | `src/engine/recovery.js` |
| 카드 전투 규칙 | `src/engine/combatEngine.js`, `src/engine/statusEngine.js` |
| 전투 ↔ 맵 연결(라운드 시간, 이탈, 소음 게이지) | `src/engine/combatMapIntegration.js` |
| 몬스터 정의와 행동열 | `src/data/monsters.js`, `src/engine/monsterAI.js` |
| 구역별 적 편성 | `src/data/dropTables.js` |
| 카드·장비·모듈·임플란트·소모품 | `src/data/cards.js`, `equipment.js`, `modules.js`, `implants.js`, `consumables.js` |
| 계약 아홉 장 | `src/data/contracts.js` |
| 파밍과 보상 | `src/engine/fieldLoot.js`, `src/engine/rewardEngine.js` |
| 인벤토리와 과적 | `src/engine/inventoryEngine.js` |
| 창고와 출격 준비 | `src/engine/loadoutReducer.js`, `src/data/loadoutPool.js` |
| 밸런스 측정(시드 30개) | `scripts/measure-map-balance.mjs` (`npm run balance:map`) |

## 07에서 지적한 문제의 코드 위치

| 문제 | 어디를 보나 |
|---|---|
| 전투 소음 꺼짐 | `src/engine/combatMapIntegration.js`의 `COMBAT_NOISE_ENABLED = false` |
| 창고에 전 장비 | `src/engine/loadoutReducer.js`의 `buildStartingWarehouse`가 두 풀을 모두 넣는다 |
| 보스 미등장 | `src/data/dropTables.js`의 구역 편성 풀에 보스가 없다 |
| 과부화 대가 없음 | `TOGGLE_OVERLOAD` 커맨드, `src/engine/overloadEngine.js` |
| 이탈 뒤처리 없음 | `docs/planned.md` 첫 항목 |
| 열쇠 1% | `src/data/facilityLayout.js`의 `KEY_DROP_CHANCE` |

## 설계 결정의 이유를 찾을 때

`docs/adr/`에 95개의 결정 기록이 있다. 본문의 "왜 이런 규칙인가"는 대부분 여기서 왔다. 자주 참조되는 것:

| 주제 | ADR |
|---|---|
| 정수 칸 시계 | 0075 |
| 계약이 구역을 정한다, 출구 하나 + 열쇠, 시간 예산 70% | 0083 |
| 조우 3단계 판정 | 0077 |
| 상황 보정과 위협 경계 감쇠 | 0079 |
| 경계도 게이지 | 0082 |
| 경계도는 시간으로 안 내려감 | 0069, 0073 |
| 무상 보너스 금지 | 0053 |
| 과부화 토글화와 대가 유보 | 0080 |
| 능력 층계 | 0075 (D8) |
| 마감을 세 배로, 구역을 두 배로 | 0087, 0088 |
| 게이지 행동 시간 절반, 전투 라운드 1칸 | 0094, 0095 |
| 무료 관측이 내용물 존재까지, 카메라 발각은 행동 뒤 | 0090, 0091 |
| 경계도 3단계의 추적자, HP가 줄면 능력이 내려감 | 0092, 0093 |
| 능력별 성격(해킹 조용·임시, 파괴 확실·시끄러움, 기만 가짜 출처) | 0056, 0057, 0058 |

## 문서 권위 순서

코드 → 자동 생성 엑셀 → 현재 구현 문서(`docs/*.md`, `docs/for-human/`) → 확정 미구현(`docs/planned.md`) → 미확정 제안(`docs/proposals/`) → 결정 이력(`docs/adr/`). 이 기획서(`docs/for-human2/`)는 세 번째 층에 속한다. 코드와 어긋나면 이 문서를 고친다.
