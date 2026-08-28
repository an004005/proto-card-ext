// Shared JSDoc typedefs for src/engine + src/data (checkJs, see ../../tsconfig.json). No
// runtime code lives here — import types elsewhere with:
//   /** @typedef {import('./types.js').CombatState} CombatState */

/** @typedef {number} RngState Opaque mulberry32 seed state — always threaded, never re-seeded mid-run. */

// ---- inventory ----

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {'junk'|'currency'|'equipment'|'ammo'|'consumable'} kind
 * @property {number} [value] junk/currency only
 * @property {string} [equipmentId] equipment only
 * @property {number} [durability] equipment only — 0-MAX_DURABILITY, set uniformly on creation
 *   (see equipmentEngine.js). Only meaningful for weapon/top/bottom/module (decays via their
 *   cardList); implants carry the field too for creation-site uniformity but never read/decay it
 *   since they have no cardList (excluded from the durability system).
 * @property {number} [amount] ammo only (1-10 per stack)
 * @property {string} [defId] consumable only — 1 slot = 1 unit, no stacking
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
 * @property {number} overload
 * @property {Loadout} loadout
 * @property {Inventory} inventory 용량 제한 있음 — 런에 들고 나가는 짐, 과적(짐) 규칙 적용 대상
 * @property {Inventory} warehouse 용량 무제한(capacity: Infinity) — 홈베이스 보관함, 과적 규칙 미적용
 */

// ---- facility graph (48-node extraction map, docs/extraction-map-implementation-spec.md §3-4) ----
// These types describe the generated graph shape only (facilityGraph.js). The broader RunState
// from the spec (time, threats' live mode/alert, exits' request lifecycle, etc.) is added in a
// later phase once the time/threat engine lands.

/** @typedef {'entrance'|'labs'|'hangar'|'security'|'power'|'waste'|'comms'|'residential'} FacilitySectorId */

/**
 * @typedef {Object} FacilityNode
 * @property {string} id
 * @property {FacilitySectorId} sectorId
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
 * @property {number} timeCost Mobility 0 기준 base 시간 비용.
 * @property {SpecialEdgeFeature[]} features 빈 배열 = 일반 복도.
 */

/**
 * @typedef {Object} ExitPlacement
 * @property {'A'|'B'|'key'} exitId
 * @property {string} nodeId
 * @property {FacilitySectorId} sectorId
 * @property {number} weightedDistanceFromStart Mobility 0 기준.
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
 * @property {FacilityNode[]} nodes
 * @property {FacilityEdge[]} edges
 * @property {string} startNodeId
 * @property {ExitPlacement[]} exits A/B/key 순서 무관, 3개.
 * @property {SectorLandmark[]} landmarks
 * @property {Opportunity[]} opportunities
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
 * @property {string[]} resolvedEventIds 같은 소음 사건의 중복 상승 방지.
 */

/**
 * @typedef {{kind: 'player', nodeId: string}
 *   | {kind: 'exitSignal', exitId: 'A'|'B', nodeId: string, createdAt: number}
 *   | {kind: 'noise', eventId: string, nodeId: string, score: number, createdAt: number}
 *   | {kind: 'falseTarget', eventId: string, nodeId: string, score: number, createdAt: number}
 *   | {kind: 'patrol', nodeId: string}} ThreatTarget
 */

/**
 * @typedef {Object} ThreatRuntimeState
 * @property {string} id
 * @property {FacilitySectorId} sectorId
 * @property {2|3|4} size
 * @property {string[]} patrolRoute
 * @property {number} patrolIndex
 * @property {string} nodeId 현재 위치.
 * @property {'patrol'|'investigate'|'alert'|'pursuit'|'exit_guard'} mode
 * @property {0|1|2|3} alert
 * @property {number} nextMoveAt
 * @property {string|null} lastKnownPlayerNodeId
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
 * @property {'A'|'B'} exitId
 * @property {string} nodeId
 * @property {'closed'|'requesting'|'opening'|'open'|'disabled'} status
 * @property {number} disabledAt
 * @property {number|null} interactionEndsAt 요청 행동(50) 완료 시각.
 * @property {number|null} opensAt
 * @property {number|null} openEndsAt
 * @property {string|null} requestId
 * @property {number|null} signalStartedAt
 */

/** @typedef {KeyExitRuntimeState | StandardExitRuntimeState} ExitRuntimeState */

/**
 * @typedef {Object} FacilityRunState
 * @property {FacilityGraph} graph
 * @property {number} time
 * @property {import('./rng.js').RngState} rngState
 * @property {'active'|'collapsed'} phase
 * @property {string|null} playerNodeId
 * @property {string[]} visitedNodeIds 탐사 안개(§10.2)용 — 시작 노드부터 포함.
 * @property {string[]} openedEdgeIds Capability로 연 'blocked'/'electronic' 특수 엣지.
 * @property {number} overload 0..100+ (100 초과는 전투 저주 카드로 처리한다).
 * @property {number} overloadFloor
 * @property {number} overloadGainMultiplier
 * @property {Record<string, {observedAt: number, hasThreat: boolean, exitStatus?: string}>} observations 기본 정찰(§6.2) 및
 *   현재/인접 노드 자동 갱신(§10.2 — gameReducer.js가 매 행동 끝에 기록) 결과. 시야 밖으로 벗어나도
 *   지워지지 않고 "마지막으로 확인한 정보"로 남는다.
 * @property {Record<string, number>} fieldCooldowns instanceId -> readyAt (능동 현장 효과, §11.1).
 * @property {{edgeId: string, expiresAt: number}[]} activeBarriers 역장 강화 임시 장벽 — 적 이동만 막는다(§map-equipment-capability-mapping.md).
 * @property {{cameraId: string, expiresAt: number}[]} hackedCameras
 * @property {string[]} disabledCameraIds Cameras permanently destroyed with Force.
 * @property {string[]} hackedInterfaceIds Access interfaces already taken over by the player.
 * @property {string[]} disabledGeneratorIds
 * @property {{source: 'basic'|'camera', sourceNodeId: string, targetNodeIds: string[], expiresAt: number|null}|null} activeRecon
 * @property {{cameraId: string, nodeId: string, detectedAt: number}|null} lastCameraDetection
 * @property {{kind: 'farm', nodeId: string, opportunityId: string, status: 'completed'|'ambushed', completedAt: number, loot?: {kind: string, equipmentId?: string, defId?: string, value?: number, amount?: number}|null}|null} lastActionResult
 * @property {Record<'A'|'B'|'key', ExitRuntimeState>} exits
 * @property {Record<string, ThreatRuntimeState>} threats
 * @property {NoiseEvent[]} noiseEvents
 * @property {FalseTarget[]} falseTargets
 * @property {Evidence[]} evidence
 * @property {Record<FacilitySectorId, SectorAlertState>} sectorAlerts
 * @property {{threatId: string, nodeId: string}|null} combatTrigger 위협이 playerNodeId에 도착하면 채워진다.
 * @property {boolean} keyDiscovered 열쇠 대상 현장 기회를 파밍해 열쇠 탈출구 위치를 알아냈는지(§5.1.1). 한번 참이 되면 되돌아가지 않는다.
 */

// ---- cards ----

/**
 * @typedef {Object} CardEffect
 * @property {string} kind 'damage'|'block'|'applyStatus'|'applyStun'|'draw'|'discardRandomFromHand'|'activatePower'|'grantNextRangedBonus'|'removeInventoryItem'|'reload'
 * @property {number} [value]
 * @property {string} [status]
 * @property {number} [amount]
 * @property {string} [target] 'self'|'player'|'enemy'|'machine_enemy'|'all_enemies'
 * @property {'melee'|'ranged'} [attackKind]
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
 * @property {'attack'|'skill'|'power'|'curse'|'status'} type 'status' = 과적(짐) 카드 전용(§6), 몬스터 저주(curse)와 구분
 * @property {?('melee'|'ranged')} attackKind
 * @property {number} [cost] absent when `stageTable` is used instead
 * @property {number} [ammoCost]
 * @property {number} [requiresLoadedAtMost] Only playable while the current magazine has this many rounds or fewer.
 * @property {boolean} exhausts
 * @property {boolean} scalesWithStage
 * @property {number} overloadGain
 * @property {CardEffect[]} [effects]
 * @property {CardStageRow[]} [stageTable]
 * @property {'variable'|'fixed'} [powerKind]
 * @property {boolean} [unplayable]
 * @property {string} [requiresWeapon]
 * @property {number} [damagePerTurnHeld] 감염류 저주: 턴 종료 시 손패에 있으면 장당 이만큼 피해
 * @property {boolean} [volatile] 어지러움류 저주: 턴 종료 시 손패에 있으면 소진(버림 더미 대신)
 * @property {boolean} [retain] 보존(사일런트): 턴 종료 시 버려지지 않고 손패에 유지됨
 * @property {boolean} [innate] 선천성: 전투 시작 시 뽑기 더미 맨 앞에 배치되어 첫 턴에 반드시 잡힘
 * @property {boolean} [sly] 교활(사일런트): 턴 종료 전에 손패에서 버려지면(플레이된 것이 아니라) 무료로 자동 발동 후 버림 더미로 이동
 * @property {string} description
 * @property {MapTags} [mapTags] 맵 소음/이탈 태그 (구현 명세 §9.1, docs/card-map-tag-mapping.md). 실행 불가 카드(잡템/저주 등) 제외, 실행 가능한 카드는 전부 명시 — 데이터 검증 테스트가 강제한다.
 */

/**
 * @typedef {Object} MapTags 구현 명세 §9.1.
 * @property {0|1|2|3} noise
 * @property {MapTrait[]} traits
 * @property {0|1} disengageProgress
 */

/** @typedef {'assassination'|'melee'|'firearm'|'explosive'|'hack'|'deception'|'escape'|'perception'|'electronic'|'healing'|'stabilize'} MapTrait */

/**
 * @typedef {Object} CardInstance
 * @property {string} instanceId
 * @property {string} defId
 * @property {string} [itemId] 잡템/환금템/장비/탄약 저주 카드만 — 연결된 인벤토리 아이템 id
 * @property {string} [equipmentInstanceId] 장비(무기/상의/하의/모듈) cardList에서 온 카드만 — 그
 *   카드를 낸 장비 인스턴스(Item.id). 필러/과적/장비손상 저주 카드는 없음.
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
 * @property {string} [insertCurse]
 * @property {number} [insertCurseCount] default 1
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
 * @property {string} [cardTargetId] UI-selected target for player cards needing one
 * @property {boolean} scalesWithStage
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
 * @property {number} overload
 * @property {number} overloadFloor
 * @property {number} overloadGainMultiplier
 * @property {number} overloadCurseCount 과부화 100 초과분으로 이번 전투에 삽입된 저주 카드 수(§과부화 3단계 개편).
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
 * @property {(Move|{random: RandomMoveBranch})[]} sequence
 * @property {boolean} [loop] default true; false parks on the final move once reached
 * @property {number} [standingArmor]
 * @property {Statuses} [startingStatuses] e.g. { artifact: 1 } — merged into the enemy's statuses on spawn
 * @property {boolean} [doubleActionIfPlayerHasBurden]
 * @property {number} [phaseTransitionHpFraction] 0-1, of maxHp
 * @property {string} [phaseTransitionInsertCurse]
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
 * @typedef {Object} ReinforcementQueueEntry
 * @property {string} threatId
 * @property {number} eligibleAt
 * @property {number} addedCount
 * @property {number|null} nextAt
 */

/**
 * @typedef {Object} CombatContext
 * @property {string} nodeId 이 전투가 벌어지는 시설맵 노드.
 * @property {string} [threatId] 전투를 유발한 위협 그룹 id (§9).
 * @property {number} ammoAtStart
 * @property {number[]} roundNoiseValues 이번 라운드에 사용된 카드/적 행동 소음값 — END_TURN마다 소진.
 * @property {ReinforcementQueueEntry[]} reinforcementQueue
 * @property {DisengageContext} disengage
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
 */

/**
 * @typedef {Object} CombatSummary
 * @property {{itemId: string, equipmentId: string, from: number, to: number}[]} durabilityChanges
 * @property {{itemId: string, equipmentId: string}[]} destroyed
 */

export {};
