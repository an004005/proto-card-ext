// Shared JSDoc typedefs for src/engine + src/data (checkJs, see ../../tsconfig.json). No
// runtime code lives here — import types elsewhere with:
//   /** @typedef {import('./types.js').CombatState} CombatState */

/** @typedef {number} RngState Opaque mulberry32 seed state — always threaded, never re-seeded mid-run. */

// ---- inventory ----

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {'junk'|'currency'|'equipment'|'ammo'|'consumable'|'contractGoods'} kind
 * @property {number} [value] junk/currency/contractGoods only
 * @property {string} [equipmentId] equipment only
 * @property {number} [durability] equipment only — 0-MAX_DURABILITY, set uniformly on creation
 *   (see equipmentEngine.js). Only meaningful for weapon/top/bottom/module (decays via their
 *   cardList); implants carry the field too for creation-site uniformity but never read/decay it
 *   since they have no cardList (excluded from the durability system).
 * @property {number} [amount] ammo only (1-10 per stack)
 * @property {string} [defId] consumable only — 1 slot = 1 unit, no stacking
 * @property {string} [contractId] contractGoods only — which contract this unit counts toward.
 */

/**
 * @typedef {Object} Inventory
 * @property {number} capacity
 * @property {Item[]} items acquisition order — items past `capacity` are "burden"
 * @property {number} nextItemId
 * @property {string} idPrefix keeps ids unique across a player's separate collections (inventory vs warehouse)
 */

// ---- loadout / player (out-of-combat) ----

/**
 * @typedef {Object} Loadout
 * @property {Item[]} weapons equipped equipment Items pulled out of inventory whole (kind:
 *   'equipment'), so durability survives the round trip back to inventory on unequip — same
 *   pattern as consumableSlots below. Max 2.
 * @property {?Item} top
 * @property {?Item} bottom
 * @property {Item[]} modules max 2
 * @property {string[]} implantIds implants have no cardList so they're excluded from durability —
 *   stay plain defId strings, unlike the other equipment slots above
 * @property {(?Item)[]} consumableSlots 3 fixed 퀵슬롯 — equipped consumable Items pulled out of
 *   inventory whole (kind: 'consumable'), so their original itemId/defId survive the round trip
 *   back to inventory on unequip. null = empty slot.
 */

/**
 * @typedef {Object} PlayerState
 * @property {number} hp
 * @property {number} maxHp
 * @property {boolean} overloadActive 과부화 토글(ON이면 단계 1). 런 내내 유지되고 전투와 지도를 함께 오간다.
 * @property {number} overrideChips 오버라이드 칩 잔량. 지도와 전투가 **같은** 통을 쓴다 — 어느
 *   화면에서 쓰든 같은 수가 줄어야 "지금 쓸 것인가, 아껴 둘 것인가"가 한 번의 결정이 된다
 *   (ADR-0086). 과부화와 마찬가지로 런 내내 유지되며 전투와 지도를 함께 오간다.
 * @property {Loadout} loadout
 * @property {Inventory} inventory 용량 제한 있음 — 런에 들고 나가는 짐, 과적(짐) 규칙 적용 대상
 * @property {Inventory} warehouse 용량 무제한(capacity: Infinity) — 홈베이스 보관함, 과적 규칙 미적용
 */

// ---- facility graph (extraction map, docs/extraction-map-implementation-spec.md) ----
// These types describe the generated graph shape only (facilityGraph.js). The broader RunState
// from the spec (time, threats' live mode/alert, exits' request lifecycle, etc.) is added in a
// later phase once the time/threat engine lands.

/** @typedef {'entrance'|'labs'|'hangar'|'security'|'power'|'waste'|'comms'|'residential'} FacilitySectorId */

/**
 * 노드 유형 (D18). 유형은 세 축을 정한다 — 은엄폐와 시야, 현장 기회의 밀도와 등급, 그리고 그
 * 유형에만 있는 고유 행동. 축이 고정되어 있어 새 유형을 봐도 무엇을 확인해야 할지 안다.
 * 현재 구현은 앞의 두 축까지 반영한다(facilityLayout.js NODE_TYPE_* 가중치).
 *
 * - `corridor` 복도: 지나가는 곳. 은엄폐도 기회도 없다.
 * - `office` 사무·작업실: 보급품이 많은 평범한 방.
 * - `hall` 대공간: 시야가 트여 은엄폐가 없고 실효 Stealth가 깎인다.
 * - `vault` 봉인 격실: 닫혀 있고 값어치가 크다.
 * - `utility` 설비실: 발전기·배전반·서버가 놓이는 곳.
 * - `watch` 감시 지점: 멀리 보기 위한 자리.
 * - `refuge` 은신처: 몸을 숨기고 쉴 수 있다.
 * - `crawlway` 비인가 통로: 도면에 없는 길.
 * @typedef {'corridor'|'office'|'hall'|'vault'|'utility'|'watch'|'refuge'|'crawlway'} FacilityNodeType
 */

/**
 * @typedef {Object} FacilityNode
 * @property {string} id
 * @property {FacilitySectorId} sectorId
 * @property {FacilityNodeType} type
 * @property {boolean} [isGateway]
 * @property {boolean} [offPlan] 도면에 없는 노드. 비인가 통로와 거기 매달린 방이다(ADR-0072).
 *   직접 지나가거나 관측하기 전에는 지도에 뜨지 않는다. 인접 구역으로 넘어가는 관문. 구역 출입구라 도면에 그려져 있다.
 * @property {number} x 전역 기하학적 배치 좌표 (facilityLayout.js SECTOR_RING_RADIUS 기준) — 엣지
 *   시간 비용과 지도 렌더링 위치 계산에 쓰인다.
 * @property {number} y
 */

/** @typedef {'oneWay'|'blocked'|'electronic'|'highGround'} SpecialEdgeFeature */

/**
 * @typedef {Object} FacilityEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {boolean} bidirectional
 * @property {SpecialEdgeFeature[]} features 빈 배열 = 일반 복도.
 * @property {number} [requiredCapability] 이 엣지를 여는 데 필요한 Capability 수치. 없으면 1.
 *   통신·관제탑 승강기처럼 배치 원형이 구조적으로 두는 통로가 더 높은 값을 갖는다.
 * @property {true} [fromFloorPlan] 평면도가 낸 통로였는데 인접하지 않은 노드를 이어서 특수
 *   통로가 된 것(ADR-0097). 그 구역의 특수 엣지 정원에 포함된다.
 */

/**
 * @typedef {Object} ExitPlacement
 * @property {'A'|'key'} exitId
 * @property {string} nodeId
 * @property {FacilitySectorId} sectorId
 */

/**
 * @typedef {Object} ExitPlacementMeta 출구 배치가 어떻게 정해졌는지 (ADR-0076·ADR-0083).
 * @property {number} exitAWalkDistance 완성 그래프에서 시작점부터 출구 A까지의 홉수(=칸) —
 *   Capability 0이 아무것도 열지 않고 걸을 수 있는 간선만. A는 시작 구역도 계약 목표 구역도 아닌
 *   구역에서 이 거리가 가장 먼 노드다.
 */

/**
 * @typedef {Object} SectorLandmark
 * @property {string} id
 * @property {string} nodeId
 * @property {FacilitySectorId} sectorId
 * @property {string[]} approaches
 */

/**
 * @typedef {Object} Opportunity
 * @property {string} id
 * @property {string} nodeId
 * @property {boolean} keyEligible 맵 생성 시 고정된 1% 판정 결과 (§5.1.1).
 * @property {number} usesRemaining 맵 생성 시 고정된 1~3회(OPPORTUNITY_USES_WEIGHTS) — 0이 되면
 *   더 이상 파밍할 수 없다. 더 이상 "1회용"이 기본이 아니다.
 * @property {'supply'|'prize'} grade 보급품은 즉시 획득이고, 확보 대상은 후보 3개 중 하나를
 *   고른다(§5단계, D10). 구역당 소수만 확보 대상이다.
 * @property {'normal'|'elite'} [tier] 확보 대상 전용 등급. 정찰로 미리 보이며 높을수록 파밍
 *   시간과 소음이 크다(D11).
 * @property {'combat'|'infiltration'|'resource'} [axis] 확보 대상 전용 역할축. 지점마다 독립적으로
 *   굴리므로 한 구역의 확보 대상이 전부 같은 축일 수도 있다. 정찰로 보이는 "종류"가 이것이고,
 *   파밍하면 이 축 안에서 후보 3개가 나온다(D11).
 */

/**
 * @typedef {Object} ThreatRoster
 * @property {string} id
 * @property {FacilitySectorId} sectorId
 * @property {2|3|4} size
 * @property {string[]} patrolRoute 2~4개 노드, 순서대로 순회.
 */

/**
 * @typedef {Object} FacilityGraph
 * @property {FacilitySectorId[]} sectorIds 이 런이 실제로 쓰는 구역, 링 순서(ADR-0081). 구역을
 *   훑는 모든 코드는 전역 목록이 아니라 이것을 봐야 한다.
 * @property {FacilityNode[]} nodes
 * @property {FacilityEdge[]} edges
 * @property {string} startNodeId
 * @property {ExitPlacement[]} exits A/B/key 순서 무관, 3개.
 * @property {ExitPlacementMeta} exitPlacement
 * @property {SectorLandmark[]} landmarks
 * @property {Opportunity[]} opportunities
 * @property {Record<string, 1|2|3>} concealmentByNodeId 은엄폐가 있는 노드만 담는다(없으면 항목 자체가 없음).
 * @property {{id: string, nodeId: string}[]} cameras
 * @property {{id: string, nodeId: string}[]} accessInterfaces
 * @property {{id: string, nodeId: string, sectorId: FacilitySectorId}[]} generators
 * @property {ThreatRoster[]} threats
 */

// ---- run engine (§5, §7 시간 틱·위협 AI·소음/흔적/추적·탈출 상태 기계) ----
// PendingAction 기반의 일반 행동 처리(§5.1)는 아직 없다 — 현장 행동(§6)이 아직 없기 때문이다.
// 이 단계는 시간/위협/소음/탈출 상태 기계만 독립적으로 구현하고 테스트한다.

/**
 * @typedef {Object} NoiseEvent
 * @property {string} id
 * @property {string} sourceNodeId
 * @property {1|2|3} intensity
 * @property {number} createdAt
 * @property {number} expiresAt
 */

/** @typedef {NoiseEvent} FalseTarget 구조는 소음 사건과 동일하다 (§3.1). */

/**
 * @typedef {Object} CapabilityValues 유효 Capability, 각 -2..4 (구현 명세 §3.1, §6.3).
 * @property {number} perception
 * @property {number} stealth
 * @property {number} hacking
 * @property {number} mobility
 * @property {number} force
 * @property {number} deception
 */

/**
 * @typedef {Object} Evidence
 * @property {string} id
 * @property {string} nodeId
 * @property {1|2} tier 1=흔적, 2=강한 흔적.
 * @property {string} createdBySectorId
 */

/**
 * @typedef {Object.<string, number>} SectorAlertLevels 0~3.
 */

/**
 * @typedef {Object} SectorAlertState
 * @property {0|1|2|3} level
 * @property {number} pressure 0..ALERT_GAUGE_CAPACITY-1. 원인마다 쌓이고, 가득 차면 level이 1 오르고 남은 양만 남는다(ADR-0082). 단계를 낮추는 수습이 걸리면 0이 된다.
 * @property {string[]} resolvedEventIds 같은 소음 사건의 중복 상승 방지.
 */

/**
 * @typedef {{kind: 'player', nodeId: string}
 *   | {kind: 'exitSignal', exitId: 'A', nodeId: string, createdAt: number}
 *   | {kind: 'noise', eventId: string, nodeId: string, score: number, createdAt: number}
 *   | {kind: 'falseTarget', eventId: string, nodeId: string, score: number, createdAt: number}
 *   | {kind: 'patrol', nodeId: string}} ThreatTarget
 */

/**
 * @typedef {Object} ThreatRuntimeState
 * @property {string} id
 * @property {FacilitySectorId} sectorId
 * @property {1|2|3|4} size
 * @property {'hunter'} [kind] 추적자(ADR-0092)만 붙는 표식. 없으면 일반 위협 마커다.
 * @property {boolean} [alwaysVisible] 관측과 무관하게 지도·위협 패널에 항상 그려지는가(추적자).
 * @property {number} [lostTicks] 추적자가 연속으로 플레이어를 관측하지 못한 칸 수(HUNTER_LOSE_TICKS).
 *   스폰한 칸은 세지 않는다 — 그래야 "놓치기까지 M칸"이 태어난 칸에 정확히 HUNTER_LOSE_TICKS로 뜬다.
 * @property {number} [spawnedAt] 추적자가 나온 맵 시각(칸). 스폰한 칸을 미관측으로 세지 않기 위한 표식이다.
 * @property {boolean} [spawnedAfterSeizure] 이미 통제실을 장악한 구역에서 나온 추적자인가. 장악은
 *   그때 나와 있던 추적자를 떼는 조건이지 구역 면역이 아니므로, 이 표식이 붙은 추적자에게는
 *   장악 조건이 걸리지 않는다(ADR-0096).
 * @property {string[]} monsterIds 런 시작(또는 추적자 스폰) 때 한 번 뽑아 고정한 몬스터 구성 —
 *   조우 화면의 지각 산정과 실제 전투 진입이 같은 목록을 쓴다.
 * @property {string[]} patrolRoute
 * @property {number} patrolIndex
 * @property {string} nodeId 현재 위치.
 * @property {'patrol'|'investigate'|'alert'|'pursuit'|'exit_guard'} mode
 * @property {0|1|2|3} alert
 * @property {number} nextMoveAt
 * @property {string|null} lastKnownPlayerNodeId
 * @property {number|null} lastObservedPlayerAt 이 마커가 마지막으로 플레이어를 관측한 시각(ADR-0079).
 *   추적·조사 경계 감쇠 타이머의 기준점이며, 플레이어를 본 적이 없으면 null이다.
 * @property {0|1|2|3} pursuitStrength
 * @property {ThreatTarget|null} target
 * @property {{eventId: string, nodeId: string, expiresAt: number}|null} investigationMemory
 */

/**
 * @typedef {Object} KeyExitRuntimeState
 * @property {'key'} kind
 * @property {string} nodeId
 */

/**
 * @typedef {Object} StandardExitRuntimeState
 * @property {'standard'} kind
 * @property {'A'} exitId
 * @property {string} nodeId
 * @property {'closed'|'requesting'|'opening'|'open'|'disabled'} status
 * @property {number} disabledAt
 * @property {number|null} interactionEndsAt 탈출구 가동 게이지가 차는 시각(ADR-0084).
 * @property {number|null} opensAt
 * @property {number|null} openEndsAt
 * @property {string|null} requestId
 * @property {number|null} signalStartedAt
 */

/** @typedef {KeyExitRuntimeState | StandardExitRuntimeState} ExitRuntimeState */

/**
 * 노드 하나에 대해 "마지막으로 확인한 것". 무료 인접 관측·정찰·정밀 스캔·카메라가 각자 아는
 * 항목만 써 넣는 공용 노트이고, 쓰기는 runEngine.mergeObservation 하나로만 한다.
 * @typedef {Object} NodeObservation
 * @property {number} observedAt 이 기록을 **그 깊이로** 마지막으로 확인한 맵 시각(칸). 화면의
 *   "마지막 확인 · N칸 전"이 읽는 값이며, 기록보다 얕은 갱신은 이 값을 올리지 못한다(ADR-0096).
 * @property {number} [shallowObservedAt] 기록보다 **얕은** 갱신(무료 인접 시야 등)이 이 노드를
 *   마지막으로 스친 시각. 위협 유무처럼 그 얕은 깊이의 항목이 언제 갱신됐는지를 남길 뿐,
 *   기록 전체의 신선도는 아니다. 같은 깊이 이상으로 다시 보면 지워진다.
 * @property {boolean} hasThreat 그 시각에 위협이 그 노드에 있었는가.
 * @property {number} [threatCount] 그 시각 그 노드에 서 있던 위협 **그룹 수**. 무료 인접 시야가
 *   주는 정보다(ADR-0090) — 규모는 그보다 깊은 관측이 판다.
 * @property {string} [exitStatus] 표준 출구 노드일 때의 개폐 상태.
 * @property {number} [detailLevel] 이 기록을 **어느 깊이로** 봤는가(PERCEPTION_INFO_TABLE의 level, 0~6).
 *   무료 인접 1홉은 언제나 1(유무·그룹 수·모드), 서 있는 노드는 2(+규모), 무료 시야가 한 홉 더
 *   뻗는 두 번째 홉은 0(유무만)이고, 정찰은 그때의 실효 Perception이 정한다. 더 깊은 기록이 얕은
 *   갱신에 덮이지 않도록 병합은 최댓값을 남긴다. UI는 이 값보다 깊은 것을 그리지 않는다.
 * @property {1|2|3} [concealment] 정찰로 읽어낸 은엄폐 등급(Perception 2 이상).
 * @property {Record<string, {tier: 'normal'|'elite', axis: string|null}>} [opportunityGrades] 정찰로 읽어낸 확보 대상 등급(Perception 0 이상)과 역할축(1 이상, 그 전에는 null).
 * @property {{threatId: string, size: number, mode: string, monsterIds?: string[]}} [threat] 그 시각에 본 위협의 규모·모드(구성은 정찰로만).
 * @property {NodeContents} [contents] 그 노드에 **무엇이 놓여 있는가**. 관측이 닿으면 Perception과
 *   무관하게 전부 적힌다 — 깊이(detailLevel)가 가르는 것은 위협 상세·확보 대상 등급·은엄폐 값뿐이다.
 */

/**
 * @typedef {Object} ObservedDevice
 * @property {'camera'|'interface'|'generator'} kind
 * @property {string} id
 * @property {'active'|'hacked'|'destroyed'|'unknown'} status 관측 시점의 상태. 무료 인접 시야
 *   (깊이 `presence`)는 카메라만 상태까지 주고(ADR-0090), 접속 인터페이스·배터리 발전기는
 *   존재만 주므로 'unknown'이다(ADR-0096).
 */

/**
 * @typedef {Object} NodeContents
 * @property {{id: string, grade: 'supply'|'prize', usesRemaining?: number}[]} opportunities 남아 있는 현장 기회.
 *   `usesRemaining`은 값을 치른 관측과 서 있는 노드만 안다 — 무료 인접 시야는 **있다**까지다.
 * @property {ObservedDevice[]} devices 그 노드의 장치.
 */

/**
 * @typedef {Object} FacilityRunState
 * @property {FacilityGraph} graph
 * @property {number} time
 * @property {import('./rng.js').RngState} rngState
 * @property {'active'|'collapsed'} phase
 * @property {string|null} playerNodeId
 * @property {string[]} visitedNodeIds 탐사 안개(§10.2)용 — 시작 노드부터 포함.
 * @property {string[]} openedEdgeIds Capability로 연 'blocked'/'electronic' 특수 엣지.
 * @property {Record<string, NodeObservation>} observations 기본 정찰(§6.2) 및
 *   현재/인접 노드 자동 갱신(§10.2 — gameReducer.js가 매 행동 끝에 기록) 결과. 시야 밖으로 벗어나도
 *   지워지지 않고 "마지막으로 확인한 정보"로 남는다.
 * @property {Record<string, number>} fieldCooldowns instanceId -> readyAt (능동 현장 효과, §11.1).
 * @property {{edgeId: string, expiresAt: number}[]} activeBarriers 역장 강화 임시 장벽 — 적 이동만 막는다(§map-equipment-capability-mapping.md).
 * @property {{cameraId: string, expiresAt: number}[]} hackedCameras
 * @property {string[]} disabledCameraIds Cameras permanently destroyed with Force.
 * @property {string[]} hackedInterfaceIds Access interfaces already taken over by the player.
 * @property {string[]} disabledGeneratorIds
 * @property {{source: 'basic'|'camera', sourceNodeId: string, targetNodeIds: string[], expiresAt: number|null, detailLevel?: number}|null} activeRecon
 *   detailLevel은 세션이 시작될 때의 정보 깊이다 — 나중에 Perception이 올라도 이미 본 것이 소급해 깊어지지 않는다.
 * @property {number|null} lastWaitEndedAt 마지막 대기가 끝난 시각. null이 아니면 인접 노드의 무료
 *   실시간 관측이 끊긴 상태이며(대기 중에는 주변을 살피지 않는다), 다음 유료 행동이 끝나면 null로
 *   돌아간다. 화면의 fresh/stale 판정과 refreshLocalObservations가 같이 읽는다.
 * @property {{cameraId: string, nodeId: string, detectedAt: number}|null} lastCameraDetection
 * @property {{kind: 'farm', nodeId: string, opportunityId: string, status: 'completed'|'ambushed', completedAt: number, loot?: {kind: string, equipmentId?: string, defId?: string, value?: number, amount?: number}|null}|null} lastActionResult
 * @property {Record<'A'|'key', ExitRuntimeState>} exits
 * @property {Record<string, ThreatRuntimeState>} threats
 * @property {string[]} [hunterSpawnedSectorIds] 경계도 3단계에 올라 추적자를 이미 한 번 내보낸 구역(ADR-0092). 단계가 3 아래로 내려가면 빠진다.
 * @property {{at: number, sectorId: string, reason: 'lost'|'alertFell'|'controlRoom', text: string}[]} [hunterLog] 추적자가 무력화된 이력 한 줄씩.
 * @property {number} [playerStealth] 리듀서가 매 행동 앞에서 찍어 주는 실효 Stealth — 추적자 관측 판정이 읽는다.
 * @property {NoiseEvent[]} noiseEvents
 * @property {FalseTarget[]} falseTargets
 * @property {Evidence[]} evidence
 * @property {Record<FacilitySectorId, SectorAlertState>} sectorAlerts
 * @property {{threatId: string, nodeId: string}|null} combatTrigger 위협이 playerNodeId에 도착하면 채워진다.
 * @property {{nodeId: string, bonus: 1|2|3}|null} activeConcealment 은엄폐 사용 중인 노드와 그 임시 Stealth 보너스 — 다른 노드로 이동하면 초기화된다.
 * @property {string[]} revealedPatrolRouteSectorIds 통제실 해킹 레벨1+로 순찰경로가 영구 공개된 구역.
 * @property {EncounterState|null} encounter 콜리전으로 열린, 아직 해소되지 않은 조우 판정.
 * @property {string[]} deceivedThreatIds 조우 속이기(D)를 이미 한 번 쓴 위협. 위협당 한 번뿐이다.
 * @property {boolean} overrideArmed 오버라이드 칩을 사용 중인 상태. 참인 동안 맵 엔진의 모든
 *   Capability 판정이 여섯 값을 CAPABILITY_MAX로 읽고, 시간이 흐른 첫 유료 행동이 끝나면
 *   거짓으로 돌아간다(ADR-0086). 전투로 넘어가지 않도록 전투 진입 시에도 꺼진다.
 * @property {boolean} keyDiscovered 열쇠 대상 현장 기회를 파밍해 열쇠 탈출구 위치를 알아냈는지(§5.1.1). 한번 참이 되면 되돌아가지 않는다.
 * @property {ContractRuntimeState|null} contract 수락된 계약의 진행 상태(§3단계, D3·D4·D21).
 * @property {{startedAt: number}|null} lockdown 계약 목표 확보 순간 켜지는 봉쇄(D22) — 위협 이동과 증원이 빨라진다. 출구는 앞당겨 닫히지 않는다(ADR-0083).
 * @property {Corpse[]} corpses 전투에서 이긴 노드에 남은 시체(§4단계, D13). 위협이 밟으면 신고된다.
 * @property {Record<string, {nextAt: number, alertSeen: 0|1|2|3}>} reinforcements 구역별 다음 증원 예정
 *   시각과 마지막으로 관찰한 경계 레벨(D14) — 경계가 오르면 다음 교대를 앞당긴다.
 * @property {{sectorId: string, expiresAt: number}[]} powerCuts 전원이 끊긴 구역과 복구 시각(D12) — 그동안 경계도가 오르지 않는다.
 * @property {FarmChoice|null} pendingFarmChoice 확보 대상을 파밍한 뒤 아직 고르지 않은 후보
 * @property {number} pendingHpLoss Capability 층계(D8)가 물린 HP 대가 중 아직 playerState에
 *   반영되지 않은 몫. HP는 facilityRunState 바깥이라 여기 쌓아두고 facilityReducer가 정산한다.
 * @property {number} pendingDurabilityLoss 같은 이유로 쌓아두는 장비 내구도 대가.
 * @property {number} [pendingAmmoSpend] 같은 청구서 경로의 탄약 — 카메라 저격이 완료 시각에 쌓고,
 *   커맨드 래퍼(facilityReducer.settleCapabilityDues)가 인벤토리에서 뺀다. 맵에는 '장전된 탄'이 없어
 *   예비탄에서 바로 나간다(전투의 loaded는 전투 시작 때 인벤토리 탄약으로 만들어진다).
 *   3개(§5단계, D11). 고르기 전에는 아무것도 인벤토리에 들어오지 않는다.
 * @property {PendingTask|null} pendingTask 예약해 둔 현장 작업. 시작 시점에는 아무 효과도 없고,
 *   `completesAt` 칸 경계에서 종류별 완료 적용이 한 번에 확정된다.
 * @property {{kind: string, status: 'completed'|'interrupted', reason: 'threatContact'|'collapsed'|'abandoned'|null, startedAt: number, completedAt: number, params: Record<string, any>|null}|null} lastTaskOutcome
 *   방금 끝난 작업이 완료됐는지 중단됐는지. 인벤토리를 만지는 호출부(파밍 보상, 계약 물건,
 *   장비 교체)가 이 값으로 "줄지 말지"를 가른다 — 작업은 시작한 커맨드가 아니라 게이지를 채운
 *   대기에서 끝나므로, 그 호출부가 다시 읽을 수 있도록 `params`를 그대로 들고 나온다(ADR-0084).
 * @property {string|null} engagedThreatId 전투 중인 위협 — 그 전투가 끝날 때까지 맵에서 멈춘다.
 * @property {{requested: number, elapsed: number, reason: 'encounter'|'exitChange'|'runEnded'|'blocked'|'taskDone'|null, completedAt: number}|null} [lastWaitBatch]
 *   방금 끝난 묶음 대기가 몇 칸을 요청해 몇 칸을 실제로 썼고 왜 멈췄는지. 요청한 만큼 다 흘렀으면
 *   말할 것이 없으므로 화면은 모자랄 때만 읽는다.
 */

/**
 * 예약된 현장 작업. `params`는 종류마다 다른 완료 적용 파라미터이고, `cost`는 Capability
 * 층계가 정한 대가 중 완료 시각에 확정될 몫이다.
 * @typedef {Object} PendingTask
 * @property {string} kind
 * @property {string|null} nodeId 소음·흔적이 남고 완료 효과가 적용되는 자리.
 * @property {Partial<import('./capabilityCosts.js').CapabilityCost>|null} cost
 * @property {Record<string, any>} params 종류마다 모양이 다르므로 읽는 자리에서 좁힌다.
 * @property {number} startedAt
 * @property {number} completesAt
 * @property {string[]} ignoredThreatIds 시작 시점에 이미 같은 노드에 있던 위협 — 새 접촉이
 *   아니므로 이 작업을 중단시키지 않는다(그 조우는 이미 열려 있다).
 */

/**
 * @typedef {Object} FarmChoice
 * @property {string} opportunityId
 * @property {'normal'|'elite'} tier
 * @property {'combat'|'infiltration'|'resource'} axis 이 지점의 역할축 — 후보 3개가 전부 이 축이다.
 * @property {FarmChoiceOption[]} options 같은 축 안의 후보 3개.
 */

/**
 * @typedef {Object} FarmChoiceOption
 * @property {'equipment'|'consumable'|'ammo'|'currency'|'junk'} kind 'junk'는 보급품
 *   (rollSupplyLoot)에서만 나온다 — 확보 대상 후보 셋에는 들어가지 않는다.
 * @property {string} [equipmentId]
 * @property {string} [defId]
 * @property {number} [value]
 * @property {number} [amount]
 */

/**
 * @typedef {Object} Corpse
 * @property {string} id
 * @property {string} nodeId
 * @property {FacilitySectorId} sectorId
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ContractRuntimeState
 * @property {string} id
 * @property {import('../data/contracts.js').ContractType} type
 * @property {FacilitySectorId} sectorId 목표부가 있는 구역 — LANDMARKS_BY_SECTOR[sectorId]가 목표부다.
 * @property {string} name
 * @property {number} [goodsSlots] retrieval only.
 * @property {number} [goodsValuePerSlot] retrieval only.
 * @property {number} [completionRewardValue] destroy/intel only.
 * @property {number} penaltyValue
 * @property {'accepted'|'acquired'|'completed'} status
 * @property {number|null} acquiredAt
 * @property {number|null} completedAt
 */

/**
 * §신규 조우 시스템(perception vs stealth): tier는 매 재판정마다 갱신된다.
 * - 'advantage' (stealth > perception): 기습/무시/회피 모두 가능.
 * - 'even' (stealth === perception): 회피만 가능(무시 불가) — 다른 모든 맵 액션은 막힌다.
 * - 'disadvantage' (stealth < perception, 아직 행동권 있음): 행동 1회 허용, 그 행동 후 재판정.
 * - 'forced' (disadvantage에서 행동 1회를 다 쓰고도 여전히 낮음): 전투만 가능, 다른 모든 맵
 *   액션은 막힌다. 진입 시 항상 적 기습(beginEnemyFirst).
 * @typedef {Object} EncounterState
 * @property {string} threatId
 * @property {string} nodeId
 * @property {'advantage'|'even'|'disadvantage'|'forced'} tier
 * @property {boolean} graceUsed disadvantage 진입 후 행동을 1회 소모했는지.
 * @property {number} [stealthAtJudgement] 판정 당시의 실효 은신 — 화면이 그 시각의 근거를 고정해 보여주는 용도.
 * @property {number} [stealthBaseAtJudgement] 그 은신의 장비 합(상황 보정 전) — ADR-0079 분해 표시용.
 * @property {{label: string, delta: number}[]} [stealthPartsAtJudgement] 상황 보정 내역(은엄폐/대공간/카메라/전원 차단/봉쇄).
 * @property {number} [perceptionAtJudgement] 판정 당시의 위협 지각.
 */

// ---- cards ----

/**
 * @typedef {Object} CardEffect
 * @property {string} kind 'damage'|'block'|'applyStatus'|'applyStun'|'draw'|'discardRandomFromHand'|'activatePower'|'grantNextRangedBonus'|'removeInventoryItem'|'reload'
 * @property {number} [value]
 * @property {string} [status]
 * @property {number} [amount]
 * @property {string} [target] 'self'|'player'|'enemy'|'machine_enemy'|'all_enemies'
 * @property {?('melee'|'ranged')} [attackKind] null = 무기 종류를 가리지 않는 피해.
 * @property {number} [count]
 * @property {number} [hits] damage 효과 반복 타격 횟수(다단히트, 기본 1) — 매 타격마다 개별로 방어도에 흡수됨
 * @property {'handSize'|'exhaustPileSize'|'discardPileSize'|'strengthStacks'|'playerBlock'|'targetVulnerableStacks'|'targetPoisonStacks'|'loadedAmmo'} [scalesBy] damage/block 값에 조건부 고정 보너스를 더함
 * @property {number} [scalesByAmount] scalesBy 카운트 1당 보너스(기본 1)
 * @property {string} [power]
 * @property {boolean} [ignoresBlock]
 */

/**
 * @typedef {Object} CardStageRow
 * @property {number} cost
 * @property {CardEffect[]} [effects]
 * @property {number} [armorPerTurn]
 */

/**
 * @typedef {Object} CardDef
 * @property {string} id
 * @property {string} name
 * @property {'attack'|'skill'|'power'|'status_card'|'burden'} type 'status_card' = 상태이상 카드, 'burden' = 과적(짐) 카드 전용(§6)
 * @property {?('melee'|'ranged')} attackKind
 * @property {number} [cost] absent when `stageTable` is used instead
 * @property {number} [ammoCost]
 * @property {number} [requiresLoadedAtMost] Only playable while the current magazine has this many rounds or fewer.
 * @property {boolean} exhausts
 * @property {boolean} [scalesWithStage] `stageTable`로 단계를 직접 적는 카드는 생략한다(= false).
 * @property {CardEffect[]} [effects]
 * @property {CardStageRow[]} [stageTable]
 * @property {'variable'|'fixed'} [powerKind]
 * @property {string} [power] 파워 카드가 켜는 파워 id — powerKind가 있는 카드만.
 * @property {boolean} [unplayable]
 * @property {string} [requiresWeapon]
 * @property {number} [damagePerTurnHeld] 감염 상태이상 카드: 턴 종료 시 손패에 있으면 장당 이만큼 피해
 * @property {boolean} [volatile] 어지러움 상태이상 카드: 턴 종료 시 손패에 있으면 소진(버림 더미 대신)
 * @property {boolean} [retain] 보존(사일런트): 턴 종료 시 버려지지 않고 손패에 유지됨
 * @property {boolean} [innate] 선천성: 전투 시작 시 뽑기 더미 맨 앞에 배치되어 첫 턴에 반드시 잡힘
 * @property {boolean} [sly] 교활(사일런트): 턴 종료 전에 손패에서 버려지면(플레이된 것이 아니라) 무료로 자동 발동 후 버림 더미로 이동
 * @property {string} description
 * @property {MapTags} [mapTags] 맵 소음/이탈 태그 (구현 명세 §9.1, docs/card-map-tag-mapping.md). 실행 불가 카드(잡템/상태이상 카드 등) 제외, 실행 가능한 카드는 전부 명시 — 데이터 검증 테스트가 강제한다.
 */

/**
 * @typedef {Object} MapTags 구현 명세 §9.1.
 * @property {0|1|2|3} noise
 * @property {MapTrait[]} traits
 * @property {0|1} disengageProgress
 */

/** @typedef {'assassination'|'melee'|'firearm'|'explosive'|'hack'|'deception'|'escape'|'perception'|'electronic'|'healing'|'override'} MapTrait */

/**
 * @typedef {Object} CardInstance
 * @property {string} instanceId
 * @property {string} defId
 * @property {string} [itemId] 잡템/환금템/장비/탄약 상태이상 카드만 — 연결된 인벤토리 아이템 id
 * @property {string} [equipmentInstanceId] 장비(무기/상의/하의/모듈) cardList에서 온 카드만 — 그
 *   카드를 낸 장비 인스턴스(Item.id). 필러/과적/장비손상 상태이상 카드는 없음.
 */

/**
 * @typedef {Object} Piles
 * @property {CardInstance[]} drawPile
 * @property {CardInstance[]} hand
 * @property {CardInstance[]} discardPile
 * @property {CardInstance[]} exhaustPile
 */

// ---- combat ----

/** @typedef {Object.<string, number>} Statuses weak/vulnerable/armor/stun/reflect/atkBonus/fragile/entangled/constrict/strength/dexterity/poison — all optional numeric stacks. */

/**
 * @typedef {Object} PlayerCombatState
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} block
 * @property {number} energy
 * @property {number} maxEnergy
 * @property {number} loaded ammo actually spendable by ammoCost cards this combat
 * @property {number} reserve ammo held back, moved into `loaded` by the reload effect
 * @property {number} maxLoad cap on `loaded`, sum of equipped weapons' maxLoadBonus
 * @property {Statuses} statuses
 * @property {Object.<string, {active: boolean}>} powers
 * @property {{nextRangedBonus?: {amount: number, ignoresBlock: boolean}}} temporaryEffects
 * @property {number} extraDrawPerTurn
 * @property {number} turnStartAoeDamage
 * @property {string[]} inventoryItemIdsInOrder combat-start snapshot, for live burden checks
 * @property {number} inventoryCapacity
 * @property {string[]} removedItemIds burden cards played this combat (synced back post-combat)
 * @property {string[]} durabilityDecayInstanceIds equipmentInstanceId pushed once per successful
 *   1% decay roll this combat (may repeat) — resolved into actual durability loss post-combat
 * @property {number} [stolenValueThisCombat]
 */

/**
 * @typedef {Object} Move
 * @property {string} id
 * @property {0|1|2|3} mapNoise 맵 소음 (구현 명세 §9.1, docs/card-map-tag-mapping.md) — 피해 보정용 attackKind와는 별개.
 * @property {number} damage
 * @property {number} [hits]
 * @property {CardEffect[]} [effects]
 * @property {string} [insertStatusCard]
 * @property {number} [insertStatusCardCount] default 1
 * @property {boolean} [stealCurrency]
 * @property {boolean} [selfDestruct]
 * @property {boolean} [flee]
 * @property {string} [summon] monster defId to add mid-combat (skipped if one is already alive)
 */

/** @typedef {{weight: number, move: Move}[]} RandomMoveBranch */

/**
 * Threaded through applyOneEffect/applyEffects/executeEnemyAction — shape varies by caller
 * (player card play vs enemy move vs consumable), so every field beyond `source` is optional.
 * @typedef {Object} EffectContext
 * @property {'player'|'enemy'} source
 * @property {string} [enemyId] source enemy id, when source==='enemy'
 * @property {?string} [cardTargetId] UI-selected target for player cards needing one
 * @property {boolean} [scalesWithStage] 교활(sly) 자동 발동처럼 단계 개념이 없는 자리는 생략한다(= false).
 * @property {Statuses} [sourceStatuses] source enemy's statuses, when source==='enemy'
 * @property {boolean} [ignoresBlock]
 * @property {string} [itemId] burden-loot card's linked inventory item id
 */

/**
 * @typedef {Object} AiState
 * @property {number} sequenceIndex raw, unbounded — wrapped via modulo at read time (unless `loop:false`)
 * @property {Move} [resolvedMove] cached result of a `{random}` branch — set once, reused at execution
 */

/**
 * @typedef {Object} EnemyState
 * @property {string} id
 * @property {string} defId
 * @property {string} name
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} block
 * @property {Statuses} statuses
 * @property {boolean} isMachine
 * @property {1|2} phase
 * @property {boolean} phaseTransitioned
 * @property {boolean} [doubleActionActive]
 * @property {boolean} [isConstrictSource] 조이기 시전자 표식 — 죽으면 플레이어의 constrict 해제
 * @property {boolean} [fled]
 * @property {AiState} aiState
 * @property {Move} intent
 */

/**
 * @typedef {Object} CombatState
 * @property {'setup'|'player_turn'|'enemy_turn'|'victory'|'defeat'} phase
 * @property {number} turn
 * @property {boolean} overloadActive 과부화 토글의 사본 — 전투 종료 시 playerState로 되돌아간다.
 * @property {PlayerCombatState} player
 * @property {EnemyState[]} enemies
 * @property {Piles} piles
 * @property {RngState} rngState
 */

// ---- monsters ----

/**
 * @typedef {Object} MonsterDef
 * @property {string} id
 * @property {string} name
 * @property {number} hp
 * @property {boolean} isMachine
 * @property {'normal'|'elite'|'boss'|'minion'} tier
 * @property {number} perception §신규 조우 시스템 — 이 몬스터가 속한 위협 마커의 지각 산정에
 *   쓰인다(§computeThreatPerception). tier별 고정값: normal -1 / elite 0 / boss 1 / minion -1 —
 *   minion은 맵 위협 마커에 직접 배정되지 않아 사실상 미사용.
 * @property {(Move|{random: RandomMoveBranch})[]} sequence
 * @property {boolean} [loop] default true; false parks on the final move once reached
 * @property {number} [standingArmor]
 * @property {Statuses} [startingStatuses] e.g. { artifact: 1 } — merged into the enemy's statuses on spawn
 * @property {boolean} [doubleActionIfPlayerHasBurden]
 * @property {number} [phaseTransitionHpFraction] 0-1, of maxHp
 * @property {string} [phaseTransitionInsertStatusCard]
 * @property {number} [phaseTransitionInsertCount]
 * @property {(Move|{random: RandomMoveBranch})[]} [phase2Sequence]
 */

// ---- reward ----

/**
 * @typedef {Object} RewardOption
 * @property {'equipment'|'consumable'|'currency'|'junk'|'ammo'} kind
 * @property {string} [equipmentId]
 * @property {string} [defId] consumable defId
 * @property {number} [value] currency/junk
 * @property {number} [amount] ammo
 */

/**
 * @typedef {Object} RewardSlot
 * @property {string} key
 * @property {'equipment'|'consumable'|'currency'|'junk'} category
 * @property {RewardOption[]} options
 */

/**
 * @typedef {Object} PendingReward
 * @property {RewardSlot[]} slots
 * @property {Object.<string, number>} selections slot key -> chosen option index
 * @property {?string} nodeId
 * @property {'normal'|'elite'|'boss'} tier
 */

// ---- top-level run state ----

/**
 * @typedef {Object} DisengageContext
 * @property {boolean} escapeIntent
 * @property {number} disengageProgress
 */

/**
 * @typedef {Object} CombatContext
 * @property {string} nodeId 이 전투가 벌어지는 시설맵 노드.
 * @property {string} [threatId] 전투를 유발한 위협 그룹 id (§9).
 * @property {number} ammoAtStart
 * @property {number} noiseGauge 전투 소음 게이지(0~9) — 카드를 낼 때마다 즉시 채워지고, 10 도달 시 발생·리셋.
 * @property {0|1|2|3} noiseIntensity 이번 전투에서 마지막으로 발생시킨 소음 강도(1→2→3, 3에서 유지).
 * @property {boolean} roundSettled 지금 라운드의 맵 칸을 이미 청구했는지 — 턴 종료 처리 중에
 *   승리가 확정돼도 종료 처리와 승리 처리가 이중 청구하지 않게 막는다.
 * @property {DisengageContext} disengage
 */

/**
 * 계약 화면에 오른 제안. 계약 정의에 "이 계약을 고르면 지어질 네 구역"(링 순서)이 붙어 있다 —
 * 추첨은 제안이 만들어질 때 돈다(ADR-0089).
 * @typedef {import('../data/contracts.js').ContractDef & {sectorIds: FacilitySectorId[]}} OfferedContract
 */

/**
 * @typedef {Object} GameSnapshot
 * @property {string} currentScreen
 * @property {PlayerState} playerState
 * @property {?FacilityRunState} facilityRunState
 * @property {?CombatState} activeCombatState
 * @property {?CombatContext} combatContext
 * @property {?PendingReward} pendingReward
 * @property {?CombatSummary} combatSummary post-combat durability report, shown once on the
 *   reward screen then cleared by CONFIRM_REWARDS
 * @property {RngState} rngState
 * @property {FacilitySectorId[]|null} [runSectorIds] 이 런의 구역(링 순서, ADR-0081·ADR-0089).
 *   NEW_RUN 시점에는 null이고, ACCEPT_CONTRACT가 수락한 제안에 이미 적혀 있던 목록을 그대로
 *   옮겨 담는다. CONFIRM_LOADOUT이 그대로 generateFacilityGraph에 넘긴다.
 * @property {OfferedContract[]|null} offeredContracts 'contract' 화면에서
 *   고르는 중인 계약. 여덟 구역 전부에서 유형별 한 장씩 뽑으므로 언제나 3장이고, 제안마다
 *   `sectorIds`(그 계약을 고르면 지어질 네 구역, 링 순서)가 함께 적혀 있다.
 *   수락 즉시 activeContract로 옮겨지고 이 필드는 비워진다.
 * @property {{presetId: string, missing: string[]}|undefined} [appliedLoadoutPreset] 마지막으로
 *   적용한 역할군 프리셋과, 창고에 없어 건너뛴 항목의 id. 출격 준비 화면이 「창고에 없음」을
 *   적는 데만 쓰는 표시용 값이다 — 런에 들어가면 아무도 읽지 않는다.
 * @property {(OfferedContract & {status: 'accepted'})|null} activeContract
 *   수락됐지만 아직 confirmLoadout으로 facilityRunState.contract에 옮겨지지 않은 계약. 'contract'/'loadout'
 *   화면 동안만 쓰인다 — confirmLoadout 이후로는 facilityRunState.contract가 유일한 소스다.
 */

/**
 * @typedef {Object} CombatSummary
 * @property {{itemId: string, equipmentId: string, from: number, to: number}[]} durabilityChanges
 * @property {{itemId: string, equipmentId: string}[]} destroyed
 */

export {};
