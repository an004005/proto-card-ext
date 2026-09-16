# 01. 런의 흐름

## 이 시스템이 하는 일

한 번의 플레이(런)는 계약 선택 → 출격 준비 → 시설 침투 → 탈출 또는 사망 → 정산으로 이어지는 한 줄기다. 준비 화면은 런 시작에 한 번만 지나가고, 시설에 들어간 뒤로는 창고에 손이 닿지 않는다. 시설 안에서 카드 전투와 맵 탐색은 같은 시계(맵 시간, 칸)를 공유하며 자원(HP·탄약·내구도·과부화 토글)도 그대로 오간다.

## 규칙과 수치

### 화면과 전이

화면 키는 `GameSnapshot.currentScreen`이며, 전이는 `src/engine/gameReducer.js`가 각 하위 reducer로 넘긴다.

| 순서 | 화면 키 | 하는 일 | 나가는 커맨드 |
|---|---|---|---|
| 1 | `contract` | 계약 3장 중 하나 수락 | `ACCEPT_CONTRACT` |
| 2 | `loadout` | 창고 ⇄ 인벤토리 이동, 장비 장착 | `CONFIRM_LOADOUT` |
| 3 | `map` | 시설 침투 — 이동·정찰·파밍·장치·계약 작업 | 다수(아래) |
| 4 | `combat` | 카드 전투 | `END_TURN` / `RESOLVE_DISENGAGE` |
| 5 | `reward` | 전투 승리 보상 3택 1 | `CONFIRM_REWARDS` → `map` |
| 끝 | `extractionComplete` | 탈출 성공 정산 | `NEW_RUN` |
| 끝 | `gameOver` | 사망 또는 붕괴 정산 | `NEW_RUN` |

### 1단계 — 런 시작과 계약 제안

- `NEW_RUN`이 시드 하나로 모든 것을 결정론적으로 만든다(`newRun`, `src/engine/loadoutReducer.js`).
- 계약은 **여덟 구역 전부**의 계약에서 유형별(회수/파괴/정보) 한 장씩, **언제나 세 장** 제안된다(`offerContracts`). 자세한 내용은 [02 계약과 구역](./02-contracts-and-sectors.md).
- 이 시점에 구역은 아직 뽑히지 않았다. `runSectorIds`는 `null`이다.

### 2단계 — 계약 수락

`acceptContractCommand` (`src/engine/contractReducer.js`)가 세 가지를 한 번에 한다.

1. 선불 재화(`prepaymentCurrency`, 10~25)를 인벤토리에 넣는다.
2. **이 런의 네 구역을 뽑는다**(`selectRunSectorIds`). 시작 구역 + 수락한 계약의 목표 구역 + 나머지 둘.
3. 화면을 `loadout`으로 넘긴다.

계약 수락은 되돌릴 수 없고, 목표부(그 구역의 랜드마크) 위치는 시설 생성 시점에 지도에 미리 공개된다.

### 3단계 — 출격 준비(로드아웃)

- 슬롯 정원(`SLOT_LIMITS`, `src/engine/inventoryReducer.js` + `CONSUMABLE_SLOT_COUNT`): 무기 2 · 상의 1 · 하의 1 · 모듈 2 · 임플란트 3 · 소모품 퀵슬롯 3.
- 기본 최대 HP `BASE_MAX_HP` = 40, 기본 인벤토리 용량 `BASE_INVENTORY_CAPACITY` = 10칸(`src/engine/loadoutReducer.js`).
- 창고(`warehouse`)는 용량이 무제한(`Infinity`)이고 인벤토리와 별개다. 시작 탄약은 `STARTING_AMMO` = 16발이며 **창고에 있다** — 플레이어가 직접 인벤토리로 옮겨야 런에 들고 나간다. 탄약 한 더미는 `AMMO_STACK_SIZE` = 10발까지 담기므로 16발은 두 칸이다.
- 아무것도 장착하지 않은 상태로 시작한다(`defaultLoadout`). 빈 무기 슬롯마다 `맨손공격` 3장, 빈 상의·하의 슬롯마다 `어설픈 회피` 3장이 덱에 들어간다(`EMPTY_SLOT_FILLER_COUNT` = 3, `src/engine/equipmentEngine.js`).
- `CONFIRM_LOADOUT`이 시설 그래프를 생성하고(`generateFacilityGraph`) 맵 화면으로 넘어간다. **이 시점 이후 창고에는 손이 닿지 않는다.**

### 4단계 — 시설맵

맵에서 쓸 수 있는 커맨드는 `src/engine/gameReducer.js`의 dispatch 표에 전부 있다. 대표적인 것:

| 분류 | 커맨드 | 비용 |
|---|---|---|
| 이동 | `MOVE_TO_NODE` | 1칸 (통로·Mobility 무관) |
| 정보 | `BASIC_RECON` | 4칸 |
| 대기 | `WAIT` / `WAIT_BATCH` | 1칸 / 최대 5칸 |
| 파밍 | `USE_OPPORTUNITY`, `SELECT_FARM_REWARD` | 5 / 10 / 13칸 |
| 장치 | `HACK_CAMERA`, `DESTROY_CAMERA`, `HACK_ACCESS_INTERFACE`, `DISABLE_GENERATOR`, `OPEN_SPECIAL_EDGE` | 행동별 |
| 계약 | `ACQUIRE_CONTRACT_GOODS`, `DESTROY_CONTRACT_TARGET`, `DETONATE_CONTRACT_CHARGE`, `ACQUIRE_CONTRACT_INTEL`, `TRANSMIT_CONTRACT_INTEL` | 6 / 9 / 2 / 6 / 5칸 |
| 수습 | `DISPOSE_CORPSE`, `CLEAN_TRACES`, `CUT_POWER`, `BROADCAST_FALSE_TARGET`, `PLANT_FAKE_NOISE`, `HACK_CONTROL_ROOM` | 5 / 4~8 / 6 / 7 / 3 / 8칸 |
| 조우 | `ENCOUNTER_AMBUSH`, `ENCOUNTER_IGNORE`, `ENCOUNTER_EVADE`, `ENCOUNTER_DECEIVE`, `ENCOUNTER_FIGHT` | 0 / 0 / 1 / 0 / 0 또는 3칸 |
| 장비 | `EQUIP_ITEM`, `UNEQUIP_ITEM`(맵에서) | 건당 `MAP_EQUIP_TIME_COST` = 3칸 |
| 소모품 | `USE_MAP_CONSUMABLE` | `MAP_CONSUMABLE_TIME_COST` = 2칸 |
| 탈출 | `REQUEST_EXTRACTION` | 탈출구 가동 9~4칸(Hacking) |
| 과부화 | `TOGGLE_OVERLOAD` | 0칸 |

이동을 뺀 모든 유료 행동은 **1칸으로 가동 → 그 자리에서 대기로 게이지 채우기 → 완료 시각에 한 번에 확정**이다. 위 표의 칸 수는 전체 소요이고, 자리를 뜨면 작업을 포기한다. 자세한 처리 순서는 [03 맵 시간과 마감](./03-map-time-and-deadlines.md).

### 5단계 — 전투와 보상

- 위협 마커와 같은 노드에 서면 조우 판정이 열린다([06](./06-threats-alert-and-recovery.md)).
- 전투는 `combat` 화면에서 돌고, 1라운드마다 맵 시간 `COMBAT_ROUND_TIME_COST` = 3칸이 청구된다. 적 기습은 별도로 `COMBAT_ENEMY_AMBUSH_TIME_COST` = 3칸을 더 받는다.
- 승리하면 `reward` 화면에서 슬롯마다 3택 1을 고르고 맵으로 돌아온다. 이긴 노드에는 **시체**가 남는다(`corpses`, `src/engine/combatReducer.js`).
- 이탈(`RESOLVE_DISENGAGE`)은 위협을 제거하지 않고 맵으로 돌아간다.

### 6단계 — 탈출과 정산

- 탈출 판정은 **유료 행동이 끝나는 칸**에 한 번 한다(`isAtOpenExit`, `src/engine/runEngine.js`). 열린 출구 위에 있으면 같은 칸의 도착 조우보다 탈출이 우선한다.
- 탈출하면 `extractionComplete`, HP 0 또는 시각 `RUN_COLLAPSE_TIME` = 80 도달이면 `gameOver`.
- 회수 점수 = 인벤토리에 든 아이템의 `value` 합 + 계약 결과(`computeInventoryScore` + `computeContractOutcome`).
  - 계약 완료: `completionRewardValue`를 더한다(회수 계약은 물건 자체의 값으로 이미 반영되므로 0).
  - 미완수: `penaltyValue`를 뺀다. 미완수 탈출도 생존으로는 성공이다.
- 사망 화면도 같은 점수를 "미회수 점수"로 보여준다.

### 런 사이에 남는 것

| 항목 | 런 사이 | 근거 |
|---|---|---|
| 창고 내용물 | **남지 않는다** — `NEW_RUN`이 매번 `buildStartingWarehouse`로 새로 만든다 | `src/engine/loadoutReducer.js`(코드에서 확인) |
| 회수 점수 | 화면 표시용이며 저장되지 않는다 | `src/components/runEndHelpers.js`(코드에서 확인) |
| 장비 수리·부품·메타 진행 | 아직 없다 | [docs/planned.md](../planned.md) |

즉 **현재 빌드에는 메타 진행이 없다.** 매 런이 같은 창고에서 시작한다. 창고가 "홈베이스"라는 표현은 런 **안에서** 손이 닿지 않는다는 뜻이지, 런을 넘겨 축적된다는 뜻이 아니다.

### 런 안에서 유지되는 것

시설에 들어간 뒤 전투와 맵을 함께 오가는 값: HP, 인벤토리(탄약·소모품·전리품), 장비 내구도, 과부화 토글(`overloadActive`), 시설 상태 전체(시간·경계도·위협 위치·소음·증거·쿨다운).

## 기획 의도

- **계약을 먼저 고르게 한 것**은 "무엇을 할지 알아야 무엇을 챙길지 정할 수 있다"는 순서다. 그리고 계약 수락이 구역 추첨을 돌리므로, 계약 선택은 곧 **이번 판에 어떤 시설을 볼지 고르는 것**이 된다(ADR-0083).
- **런 중 창고 차단**은 준비 화면의 선택에 무게를 준다. 임플란트의 유일한 대가가 슬롯 3칸뿐인 것도 이 규칙이 있기 때문이다(ADR-0080 결과 문단).
- **탈출이 목표이고 완전 탐색은 선택**이라는 것이 제품의 불변 핵심 중 하나다([game-core-and-variables.md](../game-core-and-variables.md) 6번). 미완수 탈출도 생존 성공으로 처리하는 것, 정산이 점수 하나로 끝나는 것이 그 방향이다.
- **결정론**이 설계 원칙이다. 그래프·전투·보상 모두 명시적으로 전달되는 난수 상태(`rngState`)로 재현된다. 같은 시드면 아이템 id까지 같다(`createInventory` 주석).

## 관련 코드

- `src/engine/gameReducer.js` — 커맨드 dispatch 표
- `src/engine/loadoutReducer.js` — `newRun`, `buildStartingWarehouse`, `confirmLoadout`
- `src/engine/contractReducer.js` — `offerContracts`, `acceptContractCommand`, `computeContractOutcome`
- `src/engine/facilityReducer.js` — 맵 커맨드 래퍼(탈출·사망 판정 포함)
- `src/engine/combatReducer.js` — 전투 시작·종료, 시체 생성
- `src/components/App.js`, `ExtractionCompleteScreen.js`, `GameOverScreen.js`, `runEndHelpers.js`
