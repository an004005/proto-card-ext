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

// ---- map ----

/**
 * @typedef {Object} MapNode
 * @property {string} id
 * @property {number} floor
 * @property {'combat'|'elite'|'rest'|'unknown'|'boss'} type
 * @property {?{monsterIds: string[], tier: 'normal'|'elite'|'boss'}} encounter
 */

/**
 * @typedef {Object} MapData
 * @property {MapNode[]} nodes
 * @property {{from: string, to: string}[]} edges
 */

/**
 * @typedef {Object} MapState
 * @property {MapData} mapData
 * @property {?string} currentNodeId
 * @property {string[]} visitedNodeIds
 */

// ---- facility graph (48-node extraction map, docs/extraction-map-implementation-spec.md §3-4) ----
// These types describe the generated graph shape only (facilityGraph.js). The broader RunState
// from the spec (time, threats' live mode/alert, exits' request lifecycle, etc.) is added in a
// later phase once the time/threat engine lands.

/** @typedef {'entrance'|'labs'|'security'|'power'} FacilitySectorId */

/**
 * @typedef {Object} FacilityNode
 * @property {string} id
 * @property {FacilitySectorId} sectorId
 */

/** @typedef {'oneWay'|'blocked'|'electronic'} SpecialEdgeFeature */

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
 * @property {boolean} consumed
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
 * @property {ThreatRoster[]} threats
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
 * @property {'handSize'|'exhaustPileSize'|'discardPileSize'|'strengthStacks'|'playerBlock'|'targetVulnerableStacks'|'targetPoisonStacks'} [scalesBy] damage/block 값에 조건부 고정 보너스를 더함
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
 */

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
 * @typedef {Object} CombatContext
 * @property {'map_node'|'ambush'} kind
 * @property {string} [nodeId]
 * @property {'normal'|'elite'|'boss'} [tier]
 * @property {number} ammoAtStart
 */

/**
 * @typedef {Object} GameSnapshot
 * @property {string} currentScreen
 * @property {PlayerState} playerState
 * @property {?MapState} mapState
 * @property {?CombatState} activeCombatState
 * @property {?CombatContext} combatContext
 * @property {?PendingReward} pendingReward
 * @property {?string} pendingUnknownNodeId
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
