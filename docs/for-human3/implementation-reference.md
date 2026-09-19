# 구현 참조 부록

이 파일은 기획서의 사실 확인용이다. 본문의 목적·감정·디자인 축은 아래 규칙에서 추론한 해석이며, 코드가 원래 의도를 증명한다는 뜻은 아니다.

## 조사 범위와 우선순위

- 현재 작업 폴더의 실행 소스와 데이터를 우선했다. 변경 중인 폴더이므로 특정 커밋 전체와 동일하다고 가정하지 않는다.
- 시작·계약·지도·전투·보상·종료 화면 연결을 확인했다. 주석의 과거 설명보다 실제 호출과 값을 우선했다.
- `docs/for-human`에서는 README와 미해결 항목을 보조 대조했다. 내용을 옮겨 쓰는 대신 코드에서 확인된 규칙으로 본문을 새로 구성했다.
- [미구현 계획](../planned.md)은 현재 기능과 향후 계획을 구분하는 데 사용했다. 그 문서의 수치·설명도 실행 코드와 어긋날 수 있다.
- 기존 `docs/for-human2`와 `.claude`의 미추적 파일은 수정하지 않았다. 새 문서는 `docs/for-human3`에만 추가했다.

## 핵심 주장과 확인 위치

| 기획서의 주장 | 구현 근거 / 확인할 부분 |
|---|---|
| 계약 세 유형 제안, 수락 후 목표 구역 보장 | [계약 선택](../../src/engine/contractReducer.js)의 offerContracts·acceptContractCommand, [계약 데이터](../../src/data/contracts.js), [시설 구성](../../src/engine/facilityGraph.js)의 selectRunSectorIds |
| 새 판마다 체력·창고 초기화, 전 장비 제공 | [출격 준비](../../src/engine/loadoutReducer.js)의 newRun·buildStartingWarehouse. 두 장비 풀을 모두 창고에 합친다 |
| 한 판은 네 구역, 지점 수 180~248 | [시설 데이터](../../src/data/facilityLayout.js)의 RUN_SECTOR_COUNT·SECTOR_LAYOUTS. 입구 68에 나머지 셋의 최소 28+36+48, 최대 56+60+64를 더한 범위 |
| 일반 출구 하나, 계약 목표 구역과 분리 | [시설 구성](../../src/engine/facilityGraph.js)의 placeStartAndExits. A와 key만 배치한다 |
| 정보의 깊이와 무료 관측 차이(무료 시야는 위협 수·모드·내용물 존재까지, 카메라 위치는 상시 공개) | [시설 데이터](../../src/data/facilityLayout.js)의 PERCEPTION_INFO_TABLE·FREE_OBSERVATION_DETAIL_LEVEL, [현장 규칙](../../src/engine/runEngine.js)의 refreshLocalObservations·basicRecon |
| 잠금·고지대와 부족 수행 비용 | [행동 비용](../../src/engine/actionCosts.js), [능력 비용](../../src/engine/capabilityCosts.js), [현장 규칙](../../src/engine/runEngine.js)의 openSpecialEdge·highGroundMobility |
| 조우 우위·동률·열세와 마지막 행동 기회 | [현장 규칙](../../src/engine/runEngine.js)의 computeEncounterTier·explainEffectiveStealth, [현장 행동](../../src/engine/facilityReducer.js)의 triggerCombatIfNeeded 및 encounter 계열 |
| 구역 경계 압력과 개별 추적 감쇠는 별개, 3단계는 추적자 | [시설 데이터](../../src/data/facilityLayout.js)의 ALERT_GAUGE_CAPACITY·ALERT_PRESSURE·감쇠 상수·HUNTER_*, [현장 규칙](../../src/engine/runEngine.js)의 escalateSectorAlert·describeThreatDecay·syncHunters·describeHunters |
| 목표 확보 시 봉쇄, 출구 폐쇄는 당기지 않음 | [현장 규칙](../../src/engine/runEngine.js)의 계약 작업 완료·activateLockdown. 과거 ‘125칸 유예’ 주석은 현행 규칙으로 채택하지 않음 |
| 회수는 물품 보유 탈출, 파괴는 떨어져 기폭, 정보는 이웃 구역 송출 | [현장 행동](../../src/engine/facilityReducer.js)의 withFacilityRunState, [현장 규칙](../../src/engine/runEngine.js)의 acquireContractGoods·detonateContractCharge·transmitContractIntel |
| 기본 손패 5, 행동력 3, 장전탄과 예비탄 | [전투 규칙](../../src/engine/combatEngine.js)의 HAND_SIZE·BASE_ENERGY·createCombatState·reload 효과 |
| 한 라운드 1칸, 외부 시설 진행, 카드 소음 꺼짐 | [전투와 지도 연결](../../src/engine/combatMapIntegration.js)의 COMBAT_NOISE_ENABLED=false·applyCombatRoundTimeToRunState, [전투 진행](../../src/engine/combatReducer.js)의 settleCombatRound·finalizeIfCombatEnded |
| 과부화 비용 없음, 두 단계 강화 | [과부화](../../src/engine/overloadEngine.js), [전투 진행](../../src/engine/combatReducer.js)의 toggleOverloadCommand. 일반 보정은 25%이며 개별 카드 단계표는 별도 |
| 장비가 카드와 여섯 능력을 함께 제공 | [장비 카드 구성](../../src/engine/equipmentEngine.js)의 buildDeckFromLoadout, [침투 능력 데이터](../../src/data/facilityEquipmentCapabilities.js), [능력 합산](../../src/engine/capabilityEngine.js) |
| 과적 물품만 짐 카드가 됨 | [전투 진행](../../src/engine/combatReducer.js)의 getDeckEntries. [인벤토리](../../src/engine/inventoryEngine.js)의 획득 순서 기준 과적 판정과 탄약 사용 가능 범위 |
| 내구도 10, 4 미만 손상 카드, 카드 사용당 1% 손상 | [장비 규칙](../../src/engine/equipmentEngine.js), [전투 규칙](../../src/engine/combatEngine.js)의 DURABILITY_DECAY_CHANCE와 playCard |
| 장비 보상 보장과 추가 보상, 현장 3택 1 | [전투 보상](../../src/engine/rewardEngine.js), [보상 지급](../../src/engine/rewardReducer.js), [현장 전리품](../../src/engine/fieldLoot.js), [현장 행동](../../src/engine/facilityReducer.js)의 selectFarmRewardCommand |
| 통제실·흔적·시체·전원·유인의 다른 역할 | [수습](../../src/engine/recovery.js), [현장 규칙](../../src/engine/runEngine.js)의 hackControlRoom·disposeCorpse·작업 완료 효과 |
| 새 탈출구 가동 마감 150, 붕괴 240, 가동 게이지 5~2, 열린 창 5 | [시설 데이터](../../src/data/facilityLayout.js)의 EXIT_A_DISABLED_AT·RUN_COLLAPSE_TIME·EXIT_ACTIVATE_TIME_BY_HACKING·EXIT_OPEN_WINDOW, [현장 규칙](../../src/engine/runEngine.js)의 requestExtraction·isAtOpenExit·advanceTime·applyExpiryBoundary. 150 전에 시작한 가동은 개방까지 진행되고 열린 창도 유지됨 |
| 점수는 물품 value 합과 계약 결과 | [정산](../../src/components/runEndHelpers.js), [계약 결과](../../src/engine/contractReducer.js)의 computeContractOutcome, [탈출 화면](../../src/components/ExtractionCompleteScreen.js), [실패 화면](../../src/components/GameOverScreen.js) |
| 보스는 현재 시설 편성에서 제외 | [적 데이터](../../src/data/monsters.js)와 [구역별 편성](../../src/data/dropTables.js)의 SECTOR_THREAT_POOLS 비교. 규모 표시는 실제 마릿수와 동일하지 않음 |

## 이탈 관련 구현 불일치의 근거

[전투 진행](../../src/engine/combatReducer.js)의 `finalizeIfCombatEnded`는 승리 후 다음을 반영한다.

- 전투에서 버린 물품 제거.
- 시작 탄약과 남은 장전탄·예비탄의 차이를 가방에서 차감.
- 사용 중 쌓인 내구도 손실 반영.
- 위협 제거, 시체와 보상 생성.

반면 `resolveDisengageCommand`는 라운드 시간, 체력·과부화, 교전 해제를 반영한 뒤 전투 상태를 지운다. 물품·탄약·내구도에 같은 정산을 하지 않으며, 적의 남은 체력도 위협에 옮기지 않는다. 보상·처치가 없는 것은 자연스럽지만 실제 지출까지 달라지는 것은 별도 규칙 결정이 필요하다.

이 판단은 코드 경로 비교에 근거한다. 이탈 직전 모든 자원 조합을 구성한 별도 재현 테스트는 이번 문서 작업에서 추가하지 않았다. 따라서 플레이 빈도나 악용 빈도까지 검증했다고 보지는 않는다.

## 데이터와 에셋 조사

| 범위 | 확인한 내용 | 기획서에 반영한 의미 |
|---|---|---|
| 장비 | 무기 9종, 상의 2종, 하의 2종, 모듈 7종, 임플란트 6종 | 카드 목록보다 전투와 침투의 교환 관계를 설명 |
| 소모품 | 붕대·수류탄·섬광탄 3종 | 회복·광역 공격·약화 및 이탈 보조 |
| 계약 | 회수 3종, 파괴 3종, 정보 3종 | 같은 유형 안의 개별 설명을 미구현 특수 효과로 확대 해석하지 않음 |
| 적 | 일반·정예·보스·소환 하수인 정의와 구역별 실제 편성 대조 | 데이터 존재와 일반 플레이 출현을 구분 |
| 실행 화면 | 지도·장비·카드·적 의도·보상·정산 표현 조사 | 지도와 카드 패널을 통한 판단 중심 게임으로 설명 |
| `src`, `electron` | 독립 이미지·음원·폰트 에셋 파일 없음. 화면은 마크업과 스타일 중심 | 캐릭터 외형·음악·완성된 연출을 현재 콘텐츠로 묘사하지 않음 |
| [게임 UI 목업 디자인](../../게임%20UI%20목업%20디자인/) | HTML 시안, 스타일 묶음, 참고 PNG 2개 | UI 탐색 자료이며 게임에 통합된 완성 아트로 간주하지 않음 |

## 검증 결과와 한계

기존 테스트 중 계약, 전투·지도 연결, 수납, 과부화, 구역 선택, 현장 시간·탈출 규칙을 실행했다.

```text
node --test test/contractReducer.test.js test/combatMapIntegration.test.js test/inventoryEngine.test.js test/overloadEngine.test.js test/sectorSelection.test.js test/runEngine.test.js

tests 92 / pass 92 / fail 0
```

테스트는 규칙 해석을 대조하는 보조 근거다. 이번 작업에서 전체 테스트 실행, 실제 UI를 이용한 한 판 완주, 사람의 플레이 시간 측정, 장비별 승률 분석은 하지 않았다. 본문의 20~60초 장면은 설명용 예시이며 성능·플레이 시간 측정치가 아니다.

현재 재미의 강도, 적정 난이도, 정답 조합의 존재는 테스트 통과만으로 결론낼 수 없다. 본문 9장의 제안은 이 구분을 전제로 한다.
