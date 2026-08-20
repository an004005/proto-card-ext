# 카드 익스트랙션 맵 V1 구현 명세

> 이 문서는 맵 재구축의 단일 구현 기준 문서다. 용어 의미는 [용어집](../CONTEXT.md), 장비와 카드의 식별자별 값은 [장비 매핑](./map-equipment-capability-mapping.md)과 [카드 매핑](./card-map-tag-mapping.md)이 보조한다. ADR은 결정 이력이며, 충돌할 때는 [ADR 상태표](./adr/README.md)와 이 문서의 현재 계약을 따른다.

### 문서 권위와 리뷰 게이트

문서 간 권위는 `이 구현 명세 > 식별자별 매핑 문서 > CONTEXT.md 용어 정의 > active ADR의 결정 근거` 순서다. 단, 장비·카드의 개별 `id` 값은 해당 매핑 문서가 단일 권위다. 다음 조건을 모두 만족해야 구현 준비 완료로 본다.

1. **일관성** — 같은 상태·수치·식별자가 문서마다 다른 의미를 갖지 않는다.
2. **완결성** — 저장 상태, 명령 입력, 결과, 중단·동시 발생·만료 경계가 정의되어 있다.
3. **결정론** — RNG 소비 시점, 같은 시각의 우선순위, AI 동점 규칙이 재현 가능하다.
4. **추적성** — 데이터 계약은 현재 코드의 파일과 `id`에 연결되고, 대체된 ADR은 상태가 표시된다.
5. **검증 가능성** — 각 MUST 규칙은 자동 테스트 또는 명시된 계측으로 판정할 수 있다.

범위나 밸런스 목표를 바꾸는 수정은 ADR을 추가한다. 구현 세부를 명확히 하거나 모순을 제거하는 수정은 이 명세와 매핑 문서를 직접 고치고 변경 근거를 커밋에 남긴다.

## 1. 목적과 성공 기준

이 문서는 현재의 8층 단방향 분기 맵을 버려진 연구소 기반의 48노드 익스트랙션 맵으로 교체하기 위한 구현 직전 명세다. 전투는 기존 카드 전투를 유지하되, 장비·Capability·카드 소음·월드 상태가 맵 탐사와 같은 런 상태를 공유한다.

### 런 경험 목표

- 실제 플레이 시간: 신규 플레이어도 읽을 수 있는 10분 내외, 숙련자는 7~9분.
- 기준 빌드: 해당 구역에 맞는 장비를 갖추고, 정보·우회·교전 선택의 약 절반을 올바르게 고르며, Overload를 위험 구간 아래로 관리한 플레이어.
- 목표 결과: 위 기준 플레이어가 10,000 seed 시뮬레이션과 최소 200회 플레이테스트에서 80% 내외로 추출한다. 허용 범위는 75~85%다.
- 실패 원인 분포 목표: HP 소진 45%, 추적·증원으로 인한 전투 붕괴 25%, 시간·탈출구 판단 실패 20%, Overload 붕괴 10%.
- 성공은 모든 보상을 획득하는 것이 아니라, 세 탈출구 중 하나에서 추출하는 것이다.

### 시간 단위 주의

게임 시간은 실제 시간과 1:1이 아니다. `시간 포인트`는 위험과 적 이동을 계산하기 위한 시뮬레이션 단위이며, 10포인트마다 상태 틱 하나가 발생한다. 적의 실제 엣지 이동은 상태 틱과 분리된 행동 주기를 사용한다. 4000포인트는 절대 실패선이다. 10분 목표는 플레이어가 내리는 의사결정 수와 UI 전환 시간을 기준으로 검증한다.

V1의 시간축은 일반 이동 60~140포인트, 전투 플레이어 턴 60포인트를 기준으로 둔다. 따라서 성공 런은 18~24회 이동, 5~8회 비전투 행동, 7~10회 전투 턴이라는 약 35~45개의 의미 있는 결정을 목표로 한다. 평균 성공 런의 실제 시간이 8분 미만 또는 12분 초과이면, 출구 시각보다 먼저 행동 비용·전투 턴 비용을 조정한다.

## 2. 확정된 런 구조

### 2.1 연구소 그래프

- 총 48노드, 네 구역 각각 12노드: 입구·관리동, 실험동, 보안·격리동, 동력·정비동.
- 시작 노드는 입구·관리동이다.
- 일반 엣지는 양방향이다. 환풍구·낙하 통로 등 특수 엣지 2~4개는 일방통행일 수 있다.
- 시작점에서 각 탈출구까지 적어도 두 개의 서로 다른 경로가 있어야 한다.
- 막다른 길은 0~2개만 허용한다.
- 각 특수 엣지는 최소 두 Capability 접근법을 가진다. 어느 장비 하나가 진행을 막아서는 안 된다.

### 2.2 탈출구

| 탈출구 | 배치 | 사용 규칙 |
|---|---|---|
| 일반 A | Mobility 0 가중 이동비용 1000~1500, 다른 출구와 다른 구역 | 2500포인트에 비활성화 |
| 일반 B | Mobility 0 가중 이동비용 1800~2200, A/열쇠와 다른 구역 | 3900포인트에 비활성화 |
| 열쇠 | Mobility 0 가중 이동비용 1400~2000, A/B와 다른 구역 | 열쇠 보유 시 즉시 추출, 개별 비활성화 없음 |

- 세 탈출구 위치는 런 시작부터 안개 너머에 표시한다. 적·장치·현장 기회는 정찰 전까지 표시하지 않는다.
- 일반 탈출구는 독립적으로 동시에 개방 요청할 수 있다.
- 일반 탈출구 요청 시간은 50, 요청 뒤의 개방 대기는 유효 Hacking -2~-1/0/1/2/3/4에 따라 300/300/300/250/200/150/100이다.
- 출구가 열리면 100포인트 동안 즉시 추출할 수 있다. 창이 끝나면 닫히며, 해당 출구의 비활성 시각 전이라면 다시 요청할 수 있다.
- 비활성 시각 전에 시작한 개방 대기는 이후에도 계속 진행한다. 단, 시설 붕괴(4000) 후에는 어떤 추출도 처리하지 않는다.
- B가 3900에 비활성화되면 붕괴 유예 100이 시작되고, 4000에 게임 오버다.
- 모든 파밍 기회는 독립적으로 1% 확률로 탈출 열쇠를 준다. 이미 열쇠를 보유하면 추가 열쇠는 일반 고급 보상으로 치환한다.

### 2.3 탈출 시간 경계

- `time === 4000`의 붕괴 판정은 어떤 이동·개방·추출보다 우선한다.
- 4000 미만에서 이동 또는 행동이 끝나는 순간, 현재 노드가 열린 일반 탈출구 또는 열쇠 탈출구면 먼저 추출을 판정한 뒤 같은 시각의 개방 창 만료를 처리한다. 따라서 개방 창 종료와 도착이 같은 시각이면 플레이어에게 유리하게 추출한다.
- 일반 탈출구의 `최종 요청 가능 시각`은 `min(비활성 시각 - 1, 4000 - 요청 시간 - 해당 Hacking 대기 - 1)`로 계산한다. 출구가 열리는 시각은 반드시 4000 미만이어야 한다. HUD와 버튼 미리보기에 이 값을 표시한다.
- 요청 대기는 전역 시간 위에서 진행되므로 플레이어는 출구를 떠나 다른 행동을 할 수 있다. 별도 대기 명령은 제공하지 않는다.

### 2.4 탈출 신호

- 일반 탈출구 요청은 개방 대기부터 개방 창 종료까지 연결된 그래프 전체에 지속되는 `탈출 신호`를 만든다.
- 위협 마커는 활성 탈출 신호 중 실제 최단 경로가 가장 가까운 것을 목표로 한다. 동점은 더 최근 신호를 우선한다.
- 출구에 도착한 마커는 출구가 닫힐 때까지 경계한다. 닫히면 원래 순찰 또는 마지막 조사 목표로 복귀한다.
- 열쇠 탈출구는 신호를 만들지 않는다.

## 3. 런 상태 모델

### 3.1 저장 가능한 핵심 상태

```ts
type RunState = {
  phase: 'loadout' | 'map' | 'combat' | 'reward' | 'gameOver' | 'extractionComplete';
  time: number;                         // 0..4000 정수
  tickIndex: number;                    // floor(time / 10)
  rngState: SerializableRngState;       // 파밍·열쇠·생성 결과의 단일 난수 권위
  player: {
    position:
      | { kind: 'node'; nodeId: string }
      | { kind: 'edge'; edgeId: string; originNodeId: string; destinationNodeId: string; arrivesAt: number };
    hp: number;
    overload: number;                   // 0..100
    overloadFloor: number;
    overloadGainMultiplier: number;
    extractionKey: boolean;
    loadout: Loadout;                   // 장착 인스턴스 참조만 보관
    inventory: InventoryItemInstance[]; // 탄약도 여기의 item instance가 단일 권위
    capabilities: CapabilityValues;     // -2..4, 장비·임시효과 합산
  };
  observations: Record<string, ObservationState>; // node/threat별 observedAt·해상도
  fieldCooldowns: Record<string, number>;          // equipment instanceId -> readyAt
  pendingAction: PendingAction | null;
  combat: { state: CombatState; context: CombatContext } | null;
  nextFieldSwapAt: number;
  rewardPity: { completed: number; healOffered: boolean; stabilizerOffered: boolean };
  facility: {
    nodes: Record<string, FacilityNodeState>;
    edges: Record<string, FacilityEdgeState>;
    exits: Record<'A' | 'B' | 'key', ExitState>;
    sectorAlerts: Record<SectorId, SectorAlertState>;
    threats: Record<string, ThreatState>;
    noiseEvents: NoiseEvent[];
    falseTargets: FalseTarget[];
    evidence: Evidence[];
    worldFlags: WorldFlag[];
  };
};

type CapabilityValues = {
  perception: number; stealth: number; hacking: number;
  mobility: number; force: number; deception: number;
};

type ThreatState = {
  id: string;
  nodeId: string;
  rosterId: string;                     // 런 생성 시 고정된 2~4개체
  patrolRoute: string[];                // 2~4노드
  patrolIndex: number;
  nextMoveAt: number;                  // 현재 mode의 다음 엣지 이동 시각
  mode: 'patrol' | 'investigate' | 'alert' | 'pursuit' | 'exit_guard' | 'reinforcement_waiting';
  alert: 0 | 1 | 2 | 3;                 // 순찰/조사/경계/추적
  lastKnownPlayerNodeId: string | null;
  pursuitStrength: 0 | 1 | 2 | 3;
  target: ThreatTarget | null;
  investigationMemory: { eventId: string; nodeId: string; expiresAt: number } | null;
};

type PendingAction = {
  id: string;
  kind: 'move' | 'recon' | 'farm' | 'clean' | 'capability' | 'fieldEquipment' | 'swap' | 'exitRequest';
  startedAt: number;
  completesAt: number;
  interruptible: boolean;
  noiseTiming: 'start' | 'complete';
  resultOnComplete: PendingResult;
};

type MovementAction = PendingAction & {
  kind: 'move';
  edgeId: string;
  originNodeId: string;
  destinationNodeId: string;
  departedAt: number;
};

type ThreatTarget =
  | { kind: 'player'; nodeId: string }
  | { kind: 'exitSignal'; exitId: 'A' | 'B'; nodeId: string; createdAt: number }
  | { kind: 'noise'; eventId: string; nodeId: string; score: number; createdAt: number }
  | { kind: 'falseTarget'; eventId: string; nodeId: string; score: number; createdAt: number }
  | { kind: 'patrol'; nodeId: string };

type CombatContext = {
  opening: 'normal' | 'player_ambush' | 'enemy_ambush';
  escapeIntent: boolean;
  disengageProgress: number;
  reinforcementQueue: Array<{ threatId: string; eligibleAt: number; addedCount: number; nextAt: number | null }>;
  roundTimeCommitted: boolean;
};

type ExitState = StandardExitState | KeyExitState;

type KeyExitState = {
  kind: 'key';
  nodeId: string;
};

type StandardExitState = {
  kind: 'standard';
  nodeId: string;
  status: 'closed' | 'requesting' | 'opening' | 'open' | 'disabled';
  disabledAt: number;
  interactionEndsAt: number | null;
  opensAt: number | null;
  openEndsAt: number | null;
  requestId: string | null;
  signalStartedAt: number | null;
};

type SectorAlertState = {
  level: 0 | 1 | 2 | 3;
  resolvedEventIds: string[];           // 같은 소음 사건의 중복 상승 방지
};

type OpportunityState = {
  id: string;
  consumed: boolean;
  keyEligible: boolean;                 // 맵 생성 때 한 번 결정
  reservedReward: SerializableReward | null; // 첫 시도 때 예약, 중단되어도 유지
};

type NoiseEvent = {
  id: string;
  sourceNodeId: string;
  intensity: 1 | 2 | 3;
  createdAt: number;
  expiresAt: number;
};

type FalseTarget = {
  id: string;
  sourceNodeId: string;
  intensity: 1 | 2 | 3;
  createdAt: number;
  expiresAt: number;
};
```

### 3.2 불변 조건

- 시간은 정수이고, 어떤 행동도 비용 0이 될 수 없다.
- 플레이어 위치는 노드 또는 이동 중 엣지 중 정확히 하나다. 엣지 위에서는 노드를 점유하지 않으며 탈출·현장 행동·전투 진입을 판정하지 않는다.
- Capability 유효 범위는 -2~4다. 요구치 비교에는 `max(0, value)`를 쓴다.
- 위협 마커의 전투 로스터와 순찰 경로는 런 생성 뒤 바뀌지 않는다. 목표·위치·경계만 바뀐다.
- 현장 기회·랜드마크는 한 번 소진되면 되돌아오지 않는다.
- 일반 출구의 요청 생명주기는 `closed → requesting → opening → open → closed/disabled`다. `disabledAt`에 진행 중인 생명주기는 끝까지 유지하고, 그 시각에 이미 `closed`이거나 이후 다시 닫히는 출구만 `disabled`가 된다.
- 탈출 완료·사망·4000 붕괴 중 하나가 런을 끝내며, 종료 후 시간 전진은 금지한다.

## 4. 맵 생성 규칙

### 4.1 그래프 생성 순서

1. 네 구역에 12노드씩 생성하고, 각 노드에 테마와 기본 지형을 붙인다.
2. 구역 내부를 연결해 각 노드의 차수 2~4를 목표로 한다.
3. 인접 구역 쌍에 최소 두 개, 전체에 8~12개의 구역 간 연결을 만든다.
4. 시작점·A·B·열쇠 탈출구를 거리/서로 다른 구역 조건으로 배치한다.
5. 시작점에서 각 탈출구까지 두 개 이상의 edge-disjoint 경로를 검증한다. 실패하면 해당 배치를 다시 굴린다.
6. 특수 엣지와 랜드마크, 현장 기회, 위협 마커 순찰 경로를 배치한다.
7. 모든 위협 마커가 적어도 하나의 탈출구와 연결되어 있는지, 모든 노드가 시작점과 연결되는지 검사한다.
8. 플레이어가 경로를 끊을 수 있는 각 조작에 대해, 플레이어 쪽 컴포넌트에 복구·우회·강제 돌파 접근법이 하나 이상 남는지 검사한다. 의도된 단절은 경로 퍼즐이지 장비 미보유로 확정되는 숨은 즉사 상태가 아니다.

생성은 seed마다 최대 64회 후보를 시도한다. 64회 안에 거리·연결 불변 조건을 만족하지 못하면 검증된 48노드 기본 토폴로지에 같은 seed로 콘텐츠만 배치하는 결정론적 fallback을 사용한다. 따라서 모든 seed가 유효한 맵을 반환해야 하며, 10,000 seed에서 측정하는 99.5% 목표는 fallback 없이 무작위 토폴로지 생성에 성공하는 비율이다.

### 4.2 콘텐츠 분포

| 항목 | 수량 | 제약 |
|---|---:|---|
| 초기 위협 마커 | 12 | 입구 2 / 실험 3 / 보안 4 / 동력 3 |
| 특수 엣지 | 12~16 | 구역마다 3~4 |
| 일방통행 엣지 | 2~4 | 환풍구·낙하 통로 |
| 차단/우회 엣지 | 6~8 | 잠금문·바리케이드·붕괴 통로 |
| 전자 보안 엣지 | 4~6 | 카메라·검문·터렛 연결 |
| 현장 기회 | 노드당 0~2 | 기대값 1.0, 재사용 불가 |
| 구역 랜드마크 | 최소 4 | 구역별 하나 이상 |

일방통행·차단/우회·전자 보안은 서로 배타적인 분류가 아니다. 예를 들어 일방통행 환풍구가 전자 보안도 가질 수 있다. `특수 엣지 12~16`은 고유 edge 수이고, 하위 범주의 합은 중복 때문에 이를 넘을 수 있다.

초기 위협은 시작점 2홉 안에 배치하지 않고, 마커끼리는 최소 2홉을 둔다. 일반 노드에는 최대 두 마커만 합류할 수 있으며 출구 인접 노드는 생성 시 세 마커 이상을 배치하지 않는다. 그룹 크기 2/3/4의 비율은 65/30/5이며, 4개체 그룹은 저체력 미니언을 포함한 조합만 허용한다. 입구·관리동 그룹은 최대 2개체다. 구역별 적 총 HP 예산과 정예 비율은 전투 템플릿 데이터로 고정해 seed마다 상한을 넘지 않게 한다.

보상 선택지는 `rewardPity`를 갱신한다. 완료한 현장 기회가 5개가 될 때까지 치료 또는 안정제가 한 번도 **제공되지 않았다면**, 6번째 완료 기회의 보상 선택지에 각각 치료 소모품과 안정제/안정화 선택지를 강제로 삽입한다. 제공은 자동 획득이 아니며, 플레이어는 위험·인벤토리·시간 때문에 선택하지 않을 수 있다.

전투 예산은 그룹 단위로 다음 상한을 사용한다: 입구 그룹 HP 90 이하, 실험/동력 그룹 HP 120 이하, 보안 그룹 HP 130 이하, 4개체 그룹 HP 80 이하, 런당 정예 그룹 최대 2개. 일반 노드의 런타임 합류 상한은 두 마커이며, 세 번째 도착 예정 마커는 인접 대기 노드를 재탐색해 대기하고 첫 두 마커가 떠난 뒤에만 진입한다.

### 4.3 랜드마크

| 구역 | 랜드마크 | 기본 효과 | 예시 접근 |
|---|---|---|---|
| 입구·관리동 | 보안 기록실 | 해당 구역 및 연결 구역의 적 순찰·탈출 단서 공개, 출입 기록 조작 | Perception / Hacking / Force |
| 실험동 | 격리 표본고 | 희귀 장비·소모품, 실험체 경계 변경 | Stealth / Force / Hacking |
| 보안·격리동 | 중앙 관제실 | 카메라·터렛·통신 상태를 구역 단위로 변경 | Hacking / Deception / Force |
| 동력·정비동 | 주 발전기 | 조명·터렛·환풍구·차단 엣지를 변경 | Force / Hacking / Mobility |

랜드마크는 전투 조건과 경로를 바꾸는 것이 우선이며, 단순 보상 상자는 아니다.

## 5. 시간과 월드 틱

### 5.1 행동 처리

1. 플레이어 명령을 검증하고 RNG가 필요한 결과만 예약한 `PendingAction`을 만든다. 즉시 효과는 명시적으로 `noiseTiming: 'start'`인 사건뿐이다.
2. 다음 10포인트 경계, 행동 완료, 4000 붕괴 중 가장 이른 시각으로 `time`을 전진한다.
3. 10포인트 경계라면 5.2의 월드 틱을 정확히 한 번 실행한다. 행동 완료와 같은 시각이면 5.1.2의 우선순위를 적용한다.
4. 행동이 중단되지 않고 `completesAt`에 도달했을 때만 예약 결과를 적용한다.
5. 노드에 있는 경우 적·증원·탈출 가능 상태를 판정하고 화면 전환을 결정한다.

### 5.1.1 장시간 행동의 완료와 중단

이 절은 5.1의 일반 행동 순서를 구체화하며, 시간이 드는 행동에는 이 절이 우선한다. 해킹·파밍·정찰·정리·현장 장비·스왑은 명령 시 즉시 보상이나 상태 변화를 만들지 않고 `PendingAction`을 만든다. `advanceTime(start, end)`는 10포인트 경계 시각을 하나씩 `tickTime`으로 처리한다. 매 경계 월드 틱 뒤 같은 노드로 적이 도착하면 interruptible 행동은 완료 전에 중단되고, 보상·열쇠 판정·기회 소진·장치 효과는 적용되지 않는다. `completesAt`에 도달한 행동만 `resultOnComplete`를 적용한다.

탈출 요청만 예외다. 신호는 요청 시작 시점에 내며, 요청 행동 완료 뒤 개방 대기를 시작한다. UI는 진행 바, 완료 시각, 중단 시 잃는 시간과 중단 원인을 표시한다.

이동도 `MovementAction`으로 처리한다. 출발 즉시 `player.position.kind`를 `edge`로 바꾸고 원점 점유를 끝내며, `completesAt`에만 목적지 `node` 위치로 확정한다. 원점 적과의 충돌은 출발 전에, 목적지 적과의 충돌은 도착 시에만 판정한다. 이동 중에는 중간 노드 충돌을 만들지 않는다.

중단이 발생한 첫 `tickTime`에서 시간 전진을 멈추고 강제 전투로 전이한다. `completesAt`과 적 도착이 같은 시각이면 완료를 먼저 적용한 뒤 전투를 판정한다. 중단된 탈출 요청은 시작 시 만든 신호와 requestId를 즉시 제거한다.

열쇠 1% 판정은 맵 생성 때 각 현장 기회마다 `rngState`를 한 번 소비해 `keyEligible`로 저장한다. 일반 보상은 해당 기회를 처음 시작할 때 한 번 예약해 기회 상태에 저장하고, 중단되어도 예약을 유지한다. 재시도는 같은 예약 결과를 사용하며 완료할 때만 보상 지급·열쇠 치환·기회 소진을 적용한다. 의도적 중단으로 같은 기회를 다시 굴릴 수 없고 undo/redo도 동일한 결과를 재현한다.

### 5.1.2 같은 시각의 처리 우선순위

같은 시각 `t`에 여러 사건이 있으면 아래 순서를 사용한다. 이 목록은 5.2의 일반 틱 순서보다 우선한다.

1. `t === 4000`이면 즉시 붕괴하고 나머지 사건을 처리하지 않는다.
2. `opensAt === t`인 출구를 연다.
3. `completesAt === t`인 행동 결과를 적용한다. 이동이면 목적지 노드에 도착한다.
4. 도착 노드에서 열쇠 또는 열린 일반 출구 추출을 판정한다.
5. `openEndsAt === t`인 개방 창을 닫고, `disabledAt === t`인 출구의 새 요청을 막는다. 이미 진행 중인 요청·개방 대기는 유지한다.
6. `expiresAt === t`인 소음·가짜 목표·장치 효과를 만료한다.
7. 해당 시각이 10포인트 경계면 위협 목표 선택·이동과 증원을 처리한다.
8. 완료되지 않은 interruptible 행동 위치에 적이 도착하면 중단하고, 노드 충돌과 전투 진입을 판정한다.

따라서 개방 창 종료와 도착이 같은 시각이면 추출하고, 행동 완료와 적 도착이 같으면 결과를 먼저 얻는다. 단 4000 붕괴는 언제나 이 둘보다 우선한다.

### 5.2 월드 틱 순서

1. 5.1.2의 1~6번 타이머·완료·만료 경계를 처리한다.
2. 각 위협 마커가 목표를 선택한다: 직접 목격/추적 → 활성 탈출 신호 → 가장 크게 들린 소음/가짜 목표 → 순찰. 선택된 구역의 경계도를 해당 마커의 최소 경계 상태에 적용한다.
3. `nextMoveAt <= tickTime`인 위협 마커만 목표를 향해 한 엣지를 이동하고, mode와 구역 경계도에 맞는 다음 이동 시각을 `tickTime`에서 예약한다. 순찰은 100, 조사·경계·탈출 신호 집결은 기본 80, 추적은 60포인트마다 이동한다. 구역 경계도 2/3의 조사·경계 이동은 각각 70/60포인트다.
4. 증원 대기와 플레이어가 점유한 노드의 적을 판정한다. 이동 중인 플레이어와는 충돌하지 않는다.
5. 중단·전투·추출 전이가 없으면 새 맵 스냅샷을 만든다.

행동 시간 30은 상태 갱신 3회를 뜻하지만, 적의 엣지 이동은 각 마커의 `nextMoveAt`에 따라 0~1회 이상 발생할 수 있다. UI는 관측된 마커만 `상태 갱신 3회 · 위협 A 이동 1회`처럼 예측하며, 미관측 위협은 `미확인 위협 반응 가능`으로만 표시한다.

## 6. 행동·Capability·대가

### 6.1 공통 접근 모드

| 모드 | 시간 | 소음 | 추가 결과 |
|---|---:|---:|---|
| 안전 | 기본 +40 | 기본 -1, 최소 0 | 흔적 없음. 단 Force는 강한 흔적을 일반 흔적으로만 낮춤 |
| 신속 | 기본 | 기본 | 기본 결과 |
| 강행 | 기본 -40, 최소 20 | 기본 +1, 최대 3 | 흔적 또는 Overload 추가 |

행동 템플릿은 기본 시간과 기본 소음을 가진다. 지원하지 않는 모드는 숨기며, 실패 확률은 사용하지 않는다.

### 6.2 기본 맵 행동

| 행동 | 기본 시간 | 기본 소음 | 규칙 |
|---|---:|---:|---|
| 일반 이동 | Mobility에 따라 140/120/100/90/80/70/60 | Stealth에 따라 3/2/1/0/0/0/0 | 엣지 규칙과 특수 상태가 추가 적용 |
| 기본 정찰 | 80 | 0 | P 요구 없음, 현재·인접 노드의 위협 있음/없음 확정 |
| 상세 정찰 | 140 | 0 | P1+, 적 규모/구성 등 P 단계 정보 |
| 집중/원거리 분석 | 200 | 0 | P3+ 현재, P4는 2홉 대상 가능 |
| 파밍 | 140 | 1 | 기회 하나 소진, 보상·열쇠 1% 판정 |
| 흔적 정리/은폐 | 100 | 0 | 현재 노드 증거 하나 제거 또는 등급 1 감소 |
| 장비 스왑 | 50 | 0 | 휴대 무기·방어구·모듈만, 임플란트 제외, 100포인트 재스왑 잠금 |
| 일반 탈출구 요청 | 50 | 4 | 접근 모드 없음, 탈출 신호 생성 |
| 비상 경로 복구 | 320 | 3 | 현재 컴포넌트에서 모든 탈출 경로가 끊겼을 때만 표시; Capability 요구 없음, 강한 흔적 생성 |

`대기` 명령은 제공하지 않는다. 무한 대기로 적/출구 상태를 공짜로 조작하는 것을 막는다.

소음 발생 시점은 템플릿 데이터에 명시한다. 이동은 목적지 도착(`complete`), 파밍과 Force는 행동 시작(`start`), Deception의 가짜 출처와 장치·현장 장비 효과는 완료(`complete`)가 기본이다. 소음 0 행동도 값을 명시한다. 시작 소음은 행동이 중단되어도 일반 만료 시각까지 남고, 탈출 신호만 요청 중단 시 requestId와 함께 제거한다.

현장 장비 스왑은 휴대 인벤토리의 무기·방어구·모듈에만 허용하며, 임플란트·전투 중·직접 목격 상태·추적 강도 2 이상에서는 사용할 수 없다. 스왑 뒤 100포인트 동안 재스왑할 수 없다. 이 규칙은 모든 장비를 장애물 직전마다 교체하는 것을 막아 로드아웃 정체성을 보존한다.

### 6.3 Capability 행동표

| Capability | -2/-1 | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|
| Perception | 윤곽만/위험 징후만, 거짓 정보 없음 | 인접 형태·위험 | 적 규모 | 정확한 수·유형 | 경계·다음 이동 | 2홉 약점·기회·탈출 단서 |
| Hacking | 전자 보안 접촉 시 강한 흔적/흔적 | 접근 없음 | 현재 노드 잠금·단말, 80 | 카메라·터렛 일시 무력화, 140 | 인접 원격·통신 유인, 140 | 연쇄 조작·보안망 상태, 200 |
| Force | Force 행동 소음 최소3/+1 및 강한 흔적/흔적 | 접근 없음 | 약한 잠금·잔해, 100 | 바리케이드·발전기, 160 | 차단벽·엣지 개방/봉쇄, 240 | 구조물 붕괴·지름길·영구 차단, 320 |
| Deception | 가짜 목표 지속 -200/-100, 종료 흔적 | 접근 없음 | 인접 가짜 소음1, 80 | 2홉 가짜 흔적·그룹 유인, 140 | 가짜 목표·추적 -1, 140 | 두 그룹 분산 또는 경계를 조사로, 200 |

- Hacking 기본 소음은 0이며 시간과 Overload가 대가다.
- Force 기본 소음은 2와 흔적이다. 대형 구조물/강행은 소음 3이다.
- Deception의 소음·흔적은 플레이어 노드가 아니라 선택한 허위 출처에 남는다.
- Deception 가짜 목표의 기본 지속시간은 D1/2/3/4에서 100/160/220/280포인트다. Deception -1/-2는 접근법을 열지는 못하지만, 스크립트된 단말·소모품·장비가 만드는 가짜 목표의 지속시간을 각각 100/200포인트 줄이고 종료 흔적을 남긴다.

### 6.4 은신과 기습

```text
은신 여유 = 유효 Stealth + 환경/기만 보정 - 적 경계도
```

| 환경/상태 | 보정 |
|---|---:|
| 일반 노드 | 0 |
| 엄폐물·어두운 구역·시야 차단 | +1 |
| 환풍구·완전 은폐 장치·시선 분리 기만 | +2 |
| 순찰/조사/경계/추적 적 경계도 | 0/1/2/3 |

- 여유 2 이상: 플레이어가 `선제 기습`을 선택할 수 있다. 적은 첫 행동을 완전히 잃는다.
- 여유 1: `회피 이동` 또는 은폐 진입이 가능하다.
- 여유 0 이하: 적이 플레이어를 발견한다. 적 선제 또는 강제 전투를 시작한다.
- 구역 경계도 1/2/3은 해당 구역 안 모든 위협 마커의 최소 경계도를 각각 1/2/2로 만든다. 따라서 반복 유인으로 구역 경계도가 오르면 같은 엄폐·Stealth 조합의 은신 여유도 줄어든다.
- UI는 Perception으로 확인한 적에 대해 식의 모든 항과 구역 경계도 보정을 공개한다. 주사위나 숨은 보정은 없다.

## 7. 소음·흔적·추적

### 7.1 소음

| 단계 | 범위 | 카드/행동 예 |
|---|---:|---|
| 0 | 0홉 | 은신·기만·방어·버프, 암살, 조용한 근접 |
| 1 | 1홉 | 일반 근접, 권총, 파밍 |
| 2 | 2홉 | 소총, 중화기, 강제 개방 |
| 3 | 3홉 | 폭발, 광역 파괴, 구조물 붕괴 |
| 4 | 현재 연결 컴포넌트 전체 | 일반 탈출구 개방 요청 신호 |

일반 소음은 100포인트 동안 지속한다. 위협 마커가 이를 조사 목표로 고르면 소음이 만료되어도 `investigationMemory`에 출처를 도착 또는 청취 시점부터 300포인트까지 유지한다. 같은 틱에 여러 소음이 발생하면 위협 마커는 `강도 - 엣지 거리`가 가장 큰 사건을 고른다. 동점은 더 최근 사건이다.

위협 마커의 현재 연결 컴포넌트에서 경로가 없는 목표는 후보에서 제외한다. 기존 목표가 엣지 봉쇄로 끊기면 즉시 재탐색하고, 들을 수 있는 사건이 없으면 현재 컴포넌트 안의 가장 가까운 순찰 경로 노드로 복귀한다. 순찰 경로 전체가 끊겼으면 현재 노드에서 대기하며 매 상태 틱 재탐색한다.

전투 소음은 카드별 기록을 남기되 AI에는 **전투 노드·전투 라운드당 하나의 소음 봉투**만 전달한다. 그 봉투의 강도는 해당 라운드 카드/적 행동의 최대 소음이며, 이 봉투만 조사 완료 시 구역 경계도를 올릴 수 있다.

### 7.2 흔적

| 등급 | 생성 예 | 적이 발견했을 때 |
|---|---|---|
| 흔적 1 | 신속 파밍, 강행 해킹, Stealth -1~2 이동 | 해당 그룹을 조사 상태로, 마지막 확인 위치 갱신 |
| 강한 흔적 2 | Force, Stealth -2 이동, Hacking -2 | 해당 그룹을 경계 상태로, 추적 강도 1 부여 |

- 흔적은 해당 노드에 남아 적이 방문할 때만 영향을 준다.
- 일반 이동 흔적은 목적지 노드에 남긴다. Stealth -2는 강한 흔적, -1~2는 흔적 1, 3 이상은 흔적 없음이다. Stealth 4는 추적 중에도 같은 감면을 유지한다.
- 흔적 정리/은폐는 100시간, 소음0으로 한 등급을 낮추거나 제거한다.
- `현장 정리`는 적 시체, 파괴 장치, 강행 침입 흔적에도 적용한다.

### 7.3 추적

- 추적은 마지막 확인 위치와 강도 1~3을 가진다. 적은 플레이어의 실시간 위치를 모른다.
- 강도 1: 마지막 위치까지 이동 후 조사. 강도 2: 그 뒤 인접 노드까지 조사. 강도 3: 다음 두 틱 동안 마지막 이동 방향을 추론해 추적.
- Stealth 4는 추적 중에도 이동 소음·흔적 감면을 유지한다.
- Deception 3은 추적 강도 -1, Hacking은 감시를 끄고, Mobility는 지름길로 선행하며, Force는 엣지 봉쇄로 경로를 바꾼다.

### 7.4 구역 경계도

| 경계도 | 최소 적 경계 | 조사·경계 이동 주기 | 효과 |
|---|---|---:|---|
| 0 | 순찰(0) | 80 | 기본 상태 |
| 1 | 조사(1) | 80 | 은신 여유가 사실상 1 낮아짐 |
| 2 | 경계(2) | 70 | 은신 여유 감소, 조사·증원 반응 빨라짐 |
| 3 | 경계(2) | 60 | 새 소음·가짜 목표에 빠르게 집결 |

- 위협 마커가 소음 또는 가짜 목표 출처에 도착해 플레이어를 찾지 못하면, 그 사건은 `resolvedEventIds`로 표시되고 **출처 노드가 속한 구역**의 경계도를 1 올린다. 하나의 사건을 여러 적이 조사하거나 같은 틱에 도착해도 한 번만 상승한다.
- 경계도는 자연 감소하지 않는다. 흔적 정리는 이후의 추가 상승을 막을 뿐, 이미 올라간 경계도를 내리지 않는다.
- 중앙 관제실 또는 보안 단말의 `보안 로그 삭제`는 시간 140, 소음 0, Overload +6으로 현재 구역 경계도를 1 낮춘다. 구역당 런에서 두 번까지만 가능하다.
- 탈출 신호는 별도 시스템 사건이므로 구역 경계도를 올리지 않는다.

## 8. Overload

### 8.1 수치와 구간

| 구간 | 상태 | UI/규칙 |
|---|---|---|
| 0~24 | 노멀 | 기본 카드 수치 |
| 25~49 | 가열 | 전투 카드의 단계 보정 1, UI 황색 |
| 50~74 | 고열 | 전투 카드의 단계 보정 2, UI 주황색 |
| 75~99 | 임계 | 전투 카드의 단계 보정 3, UI 적색·비필수 능동 효과 확인 |
| 100 이상 | 멜트다운 | 즉시 런 패배. HP와 무관하게 과부하로 시스템 붕괴 |

Overload는 0~100 정수이며 자연 회복하지 않는다. 장착 임플란트가 만드는 Overload 바닥 아래로는 줄지 않는다. 무한 대기 악용을 막기 위해 시간을 보내 회복하는 방법은 없다.

열 차단 임플란트의 `overloadGainMultiplier`는 카드·해킹·강행·장비 액티브를 포함한 모든 양의 Overload 증가에 적용한 뒤 `Math.round`한다. Overload 바닥값과 음의 감소량에는 적용하지 않는다.

### 8.2 증가량과 회복

| 원인 | Overload |
|---|---:|
| Hacking 1/2/3/4 신속 접근 | +3 / +6 / +9 / +12 |
| Hacking 안전 접근 | 위 값 -3, 최소 +0 |
| Hacking 강행 접근 | 위 값 +6 |
| 공간 지각 모듈 집중 투시 | +8 |
| 전자기 간섭 모듈 원격 침투 | +12 |
| 역장 임시 장벽 | +10 |
| 강행 접근의 Overload 대가 | +6 |
| 안정제/냉각 소모품 | -20 |
| 구역 랜드마크의 안정화 선택 | -25, 런당 1회 |

- Overload 100 이상이 되는 행동은 확인 단계에서 `멜트다운: 런 패배`를 명시한다.
- 플레이어는 행동 미리보기에서 증가 후 단계와 멜트다운 여부를 본다.
- 기준 빌드는 보통 15~20에서 시작해 peak 60~75로 탈출하며, 90 이상은 마지막 탈출 수단으로만 쓴다.
- 초반 6개 현장 기회 안에는 안정제 또는 랜드마크 안정화 선택을 적어도 한 번 보장한다.

## 9. 카드 전투 연동

### 9.1 카드 태그

각 카드 정의에 아래 필드를 추가한다.

```ts
type MapTrait =
  | 'assassination' | 'melee' | 'firearm' | 'explosive'
  | 'hack' | 'deception' | 'escape' | 'perception' | 'electronic'
  | 'healing' | 'stabilize';

type MapTags = {
  noise: 0 | 1 | 2 | 3;
  traits: MapTrait[];
  disengageProgress: 0 | 1;
};
```

기존 카드별 초기값은 [카드 맵 태그 매핑](./card-map-tag-mapping.md)을 따른다.

- 전투에서 실행 가능한 모든 카드와 소모품 정의는 `mapTags`를 명시한다. 기본값으로 누락을 숨기지 않으며 데이터 검증에서 실패시킨다.
- 플레이어·적 카드 모두 카드별 소음 기록을 남기고, 라운드 종료에 최대 강도의 전투 소음 봉투 하나를 해당 노드에 만든다.
- 플레이어 턴 하나는 기본 60포인트다. 턴 종료마다 그 60포인트에 포함된 상태 틱·위협 이동·증원을 즉시 처리하고, UI는 다음 플레이어 턴 전에 갱신된 증원 ETA를 보여 준다.
- 증원 대기 그룹은 전투 시작 또는 도착 후 120포인트에 첫 1개체가 합류하고, 이후 60포인트마다 1개체씩 최대 2개체가 합류한다.
- 기습 전투는 적 첫 행동 스턴 1턴으로 시작한다.

### 9.1.1 전투 라운드 마감

플레이어 한 턴의 기본 시간은 60포인트다. 카드가 마지막 적을 처치하거나 중간 턴 이탈·패배가 발생해도, 전투 종료를 확정하기 전에 현재 라운드 소음 봉투를 내고 60포인트를 정확히 한 번 진행한다. `roundTimeCommitted`가 이를 중복 처리하지 못하게 한다.

정상 `END_TURN`은 플레이어 카드 → 기존 적 행동 → 최대 소음 봉투 생성 → 60포인트/월드 틱 → 증원 등록 → 다음 플레이어 턴 순서다. 마지막 적 처치·성공 이탈처럼 플레이어 행동 중 전투 종료가 확정되면 기존 적 행동을 건너뛰되 소음 봉투와 60포인트는 처리한 뒤 맵/보상으로 전이한다. 적 행동으로 플레이어가 패배하면 그 적 행동까지 포함한 봉투와 60포인트를 처리한 뒤 최종 실패 원인을 판정한다. 이번 라운드에 등록된 증원은 즉시 공격하지 않고 다음 적 행동부터 참가한다.

### 9.2 전투 이탈

- 기본 이탈 진행도 요구치는 2다.
- 스턴, 섬광, Hacking, Deception, Mobility 카드가 진행도를 제공한다.
- 진행도가 충족되면 인접 엣지 하나를 선택해 이탈한다. 적은 마지막 확인 위치를 이탈 전 노드로 두고 추적 강도 1~3을 받는다.
- 이탈은 전투 그룹을 초기화하거나 삭제하지 않는다.

이탈 진행도는 `BEGIN_DISENGAGE`로 `escapeIntent`를 켠 전투에서만 누적한다. 기본 요구치는 2이며, `escape`·`deception`·`hack` 태그, Mobility 보정, 스턴·섬광이 진행도를 제공한다. 충족 뒤 `DISENGAGE_COMBAT`으로 인접 엣지를 선택한다. intent 해제·전투 종료·성공 이탈 뒤 진행도는 0으로 초기화한다.

이탈 진행도의 단일 권위는 `CombatContext.disengageProgress`다. 카드·소모품은 `mapTags.disengageProgress`의 명시값만 한 번 더하며 trait·스턴 효과에서 자동으로 중복 계산하지 않는다. Mobility 2 이상은 `BEGIN_DISENGAGE` 시 1회 +1, 그 외 Mobility는 +0이다. `CANCEL_DISENGAGE`는 intent와 진행도를 즉시 0으로 만든다.

## 10. UI/UX 명세

### 10.1 맵 HUD

상단 고정 바는 다음 순서로 표시한다.

```text
[HP] [Ammo] [Overload: 53 고열]   [시간 1,240 / 4,000]
[현재 구역 경계: 2 경계 · 보안 로그 삭제 가능]
[A 비활성 1,260] [B 비활성 2,660] [붕괴 --]
[열쇠 탈출구: 미보유] [A: 요청 중 15] [B: 닫힘]
```

- 임계 Overload와 300포인트 이내의 탈출구 비활성/붕괴는 색만으로 전달하지 않고 아이콘·텍스트·카운트다운을 함께 쓴다.
- 시간은 행동 뒤 증가값뿐 아니라 다음 월드 틱까지 남은 포인트를 툴팁으로 보여 준다.

### 10.2 노드와 엣지 표현

- 현재 노드와 인접 노드는 선명하게, 방문 노드는 마지막 관측 정보로 흐리게, 미방문 중간 노드는 숨긴다.
- 세 탈출구는 안개 너머에도 전용 아이콘과 상태(A/B/열쇠, 닫힘/요청/열림/비활성)를 표시한다.
- 위협 마커는 Perception 정보 수준에 맞춰 `위험 징후` → `소수/다수` → `구성` → `경계·다음 이동`으로 해상도를 높인다.
- 구역 이름 옆에는 경계도 0~3을 아이콘·텍스트로 표시한다. 소음/기만 행동 미리보기는 `출처 도착 후 플레이어 미발견 시 실험동 경계 1 → 2`처럼 누적 결과를 보여 준다.
- 엣지를 선택하면 기본 이동 시간, 이동 소음, 잠금/위험, 가능한 접근법을 미리 보여 준다. 위협 이동 예측은 관측된 마커에만 제공하고, 나머지는 집계 경고로 표시한다.
- 소음 범위는 행동 미리보기 시 해당 노드에서 1/2/3홉 반투명 링으로 표시한다. 가짜 소음은 점선 링과 `기만` 레이블을 사용한다.

### 10.3 행동 패널

현재 노드 패널은 다음 순서다.

1. `이동` — 인접 엣지와 이동 미리보기.
2. `정찰` — 기본/상세/집중/원거리, 잠긴 행동은 필요 Perception과 해제 경로 표시.
3. `현장 기회` — 남은 횟수, 보상 범주, 안전/신속/강행 비교.
4. `환경 조작` — Hacking/Force/Deception/랜드마크/장치.
5. `정리/은폐`, `장비 스왑`, `탈출구 요청`.
6. `현장 장비` — 사용 가능/쿨다운/대상/사거리/완료 시각을 표시.

모든 실행 버튼에는 한 줄의 결과 미리보기를 반드시 붙인다.

```text
Hacking 2 카메라 해킹
시간 +140 · 상태 갱신 14회 · 관측 위협 A 이동 1회 · 소음 0 · Overload +6 → 63(고열)
효과: 동쪽 카메라 200포인트 비활성
```

48노드 화면은 seed 기반의 안정적인 구역 배치, 확대/축소·패닝, 현재 위치 재중앙, 화면 밖 탈출구 방향 표시, 넓은 엣지 선택 영역을 제공한다. 긴 행동의 10~32개 틱은 개별 애니메이션하지 않고 이동·도착·중단 같은 주요 사건만 압축 로그로 보여 준다.

### 10.4 은신·전투 진입 UX

- 적이 있는 노드 또는 엣지를 선택하면 이동 버튼 대신 `우회`, `선제 기습`, `정면 진입`을 보여 준다.
- 우회/기습 버튼은 `은신 여유 = 1 + 1 - 1 = 1`을 항목별로 표시한다.
- 성공/실패 대신 결과를 사전에 명시한다: `우회 가능`, `기습 가능`, `발각됨`.
- 전투 진입 화면은 기습 스턴, 현재 노드 소음, 대기 증원 ETA, 추적 위험을 한 번에 보여 준다.

### 10.5 접근성·오류 방지

- 취소 불가능하거나 큰 월드 상태를 바꾸는 행동(Force 4, 탈출 요청, Overload 90 이상 능동 효과)만 확인 다이얼로그를 사용한다.
- 일반 이동·정찰·파밍에는 확인 다이얼로그를 쓰지 않는다.
- 정보가 오래된 경우 `마지막 관측: 300포인트 전`을 표시한다.
- 숨은 확률을 사용하지 않으며, 열쇠 드롭 1%만 사전에 확률로 표시한다.

## 11. 구현 설계

### 11.1 기존 코드 교체 범위

| 현재 파일 | 변경 |
|---|---|
| `src/data/mapLayout.js` | 8층 노드 가중치 대신 구역·그래프·엣지·랜드마크·위협 템플릿 데이터로 교체 |
| `src/engine/mapEngine.js` | 단방향 floor 그래프 API를 48노드 무방향 시설 그래프, 가시성, 거리, 시간 틱 엔진으로 교체 |
| `src/engine/gameReducer.js` | 맵 명령, 시간 전진, 현장 행동, 출구, 위협 이동, 전투 진입/이탈 전이를 추가. 맵 화면의 기존 창고 접근은 제거하고 모든 현장 교체를 `SWAP_FIELD_EQUIPMENT`로 통합 |
| `src/data/equipment.js`, `modules.js`, `implants.js` | 확정된 Capability 수정자와 능동 현장 효과를 선언 |
| `src/data/cards.js`, `consumables.js` | 모든 실행 가능한 정의에 `mapTags`를 선언 |
| `src/data/monsters.js` | 모든 몬스터 move에 0~3 정수의 맵 소음용 `mapNoise`를 선언. 전투 피해 분류인 기존 `attackKind`와 분리 |
| `src/data/mapBaselines.js` | 12개 밸런스 baseline의 전체 장비 슬롯·소모품·기대 Capability를 고정 |
| `src/engine/combatEngine.js`, `gameReducer.js` | 카드/소모품 소음, 이탈 진행도, Overload, 라운드 마감을 반영 |
| `src/components/MapScreen.js` | 탐사 안개, 엣지, HUD, 행동 패널, 미리보기 기반 UI로 재구성 |

### 11.2 권장 명령

```ts
MOVE_EDGE { edgeId, mode? }
RECON { tier: 'basic' | 'detailed' | 'focused' | 'remote', targetNodeId? }
USE_OPPORTUNITY { nodeId, opportunityId, approachId, mode }
MANIPULATE_EDGE { edgeId, approachId, mode }
CLEAN_EVIDENCE { nodeId, evidenceId }
REQUEST_EXTRACTION { exitId: 'A' | 'B' }
SWAP_FIELD_EQUIPMENT { slotType, equipmentId }
USE_FIELD_EQUIPMENT { itemInstanceId, targetId }
PLAY_CARD { instanceId }
END_TURN
BEGIN_DISENGAGE
CANCEL_DISENGAGE
DISENGAGE_COMBAT { edgeId }
```

`USE_FIELD_EQUIPMENT`는 `fieldCooldowns[itemInstanceId]`의 `readyAt`을 확인하고, 장비 정의의 대상·사거리·대상 수·지속시간·Overload·행동 시간을 PendingAction으로 만든다. 쿨다운은 행동 완료 시점부터 시작한다. 모든 명령은 순수 reducer 입력으로 처리한다. 열쇠 여부는 생성 시 기회에 고정하고, 일반 파밍 보상은 첫 시도 때 `rngState`를 소비해 해당 기회에 예약한다. undo/redo와 중단 후 재시도가 같은 결과를 재현해야 한다.

### 11.3 테스트 인수 기준

1. 동일 seed는 그래프, 위협 로스터, 기회, 열쇠 드롭을 동일하게 생성한다.
2. 48노드, 구역별 12노드, 위협 2/3/4/3, 특수 엣지 12~16을 항상 만족한다.
3. 모든 탈출구가 서로 다른 구역이며 Mobility 0 실제 가중 이동비용이 각 범위 안에서 `A < 열쇠 < B`를 만족하고, 각 탈출구까지 두 edge-disjoint 경로가 있다. 모든 seed가 유효한 맵을 반환하며 10,000 seed 중 fallback 미사용 비율은 99.5% 이상이다.
4. 행동 시간 30은 정확히 세 번의 상태 틱을 만들고, 위협의 엣지 이동은 `nextMoveAt`에 의해서만 발생한다.
5. 소음 0~3은 각각 0~3홉만 영향을 주고 100포인트 뒤 만료된다. 탈출 신호는 출구와 현재 연결된 컴포넌트 전체를 대상으로 하며 경로 단절 너머에는 전달되지 않는다.
6. 일반 탈출구 A/B의 요청·열림·100포인트 재차단·2500/3900 비활성·4000 붕괴 전이가 정확하다. 4000 붕괴는 같은 시각의 추출보다 우선한다.
7. Hacking 수치에 따른 개방 대기 300/250/200/150/100이 정확하다.
8. 은신 여유 2/1/0 경계에서 기습/우회/발각이 결정론적으로 전이한다.
9. Overload 100은 HP와 무관한 즉시 패배이며, 장착 임플란트 바닥 아래로는 감소하지 않는다.
10. 카드 소음과 전투 턴 60포인트가 턴마다 맵 위협 이동과 증원 ETA에 반영된다.
11. 모든 특수 엣지와 랜드마크는 두 개 이상 접근법을 제공한다.
12. 같은 소음·가짜 목표 사건은 여러 위협 마커가 조사해도 구역 경계도를 한 번만 올리며, 다른 사건을 반복 조사하면 0~3까지 누적된다.
13. 구역 경계도 1/2/3이 은신 최소 경계도와 조사 이동 주기 80/70/60에 정확히 반영되고, 보안 로그 삭제만 1단계를 낮춘다.
14. PendingAction은 완료 전에 적이 도착하면 중단되고 보상·기회·장치 효과를 적용하지 않는다. 시간 틱은 각 경계 시각으로 처리한다.
15. 미관측 위협은 행동 미리보기에서 위치·경로를 누설하지 않으며, 전투 라운드 소음은 하나의 봉투로 합산된다.
16. 장비 쿨다운 직렬화, 임플란트 현장 스왑 거부, 이탈 intent, 같은 시각의 출구 만료/도착과 붕괴 경계를 테스트한다.
17. 이동의 출발/도착 충돌, 행동 중단·동시 완료 우선순위, 전투 중간 종료의 소음/60포인트 마감, 그룹별 증원 큐를 테스트한다.
18. 현재 `CARD_DEFINITIONS`와 `CONSUMABLE_DEFINITIONS`의 실행 가능한 모든 ID가 매핑 문서와 정확히 일치하고 `mapTags`를 가진다. 새 정의가 매핑 없이 추가되면 데이터 검증이 실패한다.
19. 몬스터의 모든 move는 카드 매핑 문서와 일치하는 `mapNoise: 0 | 1 | 2 | 3`을 명시한다. 미지정 기본값은 없으며, 피해 보정에 쓰는 기존 `attackKind`에는 이 소음 분류를 넣지 않는다.
20. 경로 단절 뒤 위협은 도달 불가능한 목표를 버리고 현재 컴포넌트에서 재탐색한다. 플레이어가 만들 수 있는 모든 단절 상태에는 현재 컴포넌트 안에서 실행 가능한 복구·우회·돌파 선택지가 남고, 어떤 Capability도 없으면 320/소음 3/강한 흔적의 비상 복구를 사용할 수 있다.

## 12. 밸런스 검증 계획

### 12.1 계측 이벤트

각 런 종료 시 아래를 저장한다.

```text
seed, result, extractionType, time, realSeconds, playerHp,
peakOverload, finalOverload, fightsEntered, fightsAvoided,
ambushes, disengages, evidenceCreated/cleaned,
exitRequestsA/B, keyDrops, routeLength, wrongChoiceMarkers,
baselineId, failureCause, decisionRiskScores
```

`wrongChoiceMarkers`는 콘텐츠가 지정한 8개 중요 결정의 후보별 위험 점수로 판정한다. 매 런 4개는 최저 위험 해법, 나머지 4개는 차선 해법을 기준 정책이 고른다. 명백한 자살 선택은 표본에서 제외한다. 이 계약으로 봇과 사람이 같은 “절반의 올바른 선택” 기준을 사용한다.

`DecisionOption`은 `{ decisionId, riskScore: 0..100, reasonCodes }`를 가진다. 같은 결정을 후보별 위험 점수 오름차순으로 정렬하며 최저위험은 0~33, 차선은 34~66, 고위험은 67~100이다. `failureCause`는 `meltdown > collapse > hp > reinforcement > pursuit > time > other` 우선순위의 단일 enum으로 기록해 원인이 겹치지 않게 한다.

### 12.2 80% 목표 검증 프로토콜

1. 적절한 장비 조합을 여섯 Capability 축별로 최소 2개씩 준비한다.
2. 10,000개 seed에 대해 기준 정책 봇을 실행해 성공률 78~82%를 먼저 확인한다. 기준 정책은 런마다 8개의 중요 결정을 표시하고, 4개는 최저위험 해법·4개는 차선 해법을 선택한다.
3. 내부 플레이테스터가 같은 기준으로 최소 200런을 수행한다. 100런은 80% 성공률의 신뢰구간이 너무 넓어 최종 확인 표본으로 쓰지 않는다.
4. 성공률 75~85%, 중앙 실제 시간 8~12분, 중앙 peak Overload 60~75, 중앙 전투 진입 2~4회를 합격선으로 한다.
5. 성공률이 75% 미만이면 사망 원인 비율을 먼저 확인한다. HP 실패가 크면 적 그룹/증원, 시간 실패가 크면 행동 시간/출구 시각, Overload 실패가 크면 회복 기회/증가량을 하나씩 조정한다.
6. 성공률이 85% 초과면 보상량을 낮추기보다 소음 조사·증원 또는 경계 적 밀도를 먼저 올린다.

기준 시뮬레이션은 여섯 축마다 두 개, 총 12개의 고정 baseline을 동일 비중으로 돌린다. 괄호의 두 항목은 한 로드아웃에 동시에 넣는다는 뜻이 아니라 각각 별도 baseline의 핵심 장비다: Perception(공간 지각 모듈 / 위협 감지 임플란트), Stealth(경갑 상의 / 카타나), Hacking(전자기 간섭 모듈 / 역장 강화 모듈의 음수 대조군), Mobility(전술 하의 / 반응 가속 임플란트), Force(중갑 상의 / 신체 강화 모듈), Deception(전술 하의 / 전자기 간섭 모듈).

baseline 데이터는 `baselineId`, 모든 장비 슬롯의 정확한 equipment ID, 시작 소모품, 출격 시 Capability 합계, Overload floor, gain multiplier를 고정한다. 같은 핵심 장비를 쓰는 다른 축 baseline도 별도 `baselineId`와 보완 장비 조합을 가져야 한다. 시뮬레이터가 임의로 빈 슬롯을 채우거나 seed마다 로드아웃을 바꾸면 안 된다.

12개 `baselineId`는 `perception_spatial`, `perception_threat`, `stealth_light`, `stealth_katana`, `hacking_emp`, `hacking_forcefield`, `mobility_tactical`, `mobility_reaction`, `force_heavy_top`, `force_body`, `deception_tactical`, `deception_emp`로 고정한다. `src/data/mapBaselines.js`의 각 레코드는 모든 슬롯을 채운 뒤 계산한 Capability와 Overload 값도 스냅샷으로 저장하고, 장비 엔진 재계산값과 일치하지 않으면 테스트를 실패시킨다.

아래 배열 순서는 장착 순서이며 `—`는 빈 슬롯이다. 모든 baseline의 시작 소모품은 `[bandage, stabilizer, flashbang]`, Overload gain multiplier는 1이다. Capability 표기는 `P/S/H/M/F/D` 순서다.

| baselineId | weapons | top | bottom | modules | implants | P/S/H/M/F/D | floor |
|---|---|---|---|---|---|---|---:|
| `perception_spatial` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_spatial, module_neural]` | `[implant1, implant3]` | `2/2/0/1/1/1` | 15 |
| `perception_threat` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_spatial, module_neural]` | `[implant2]` | `3/2/0/1/1/1` | 20 |
| `stealth_light` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_body, module_neural]` | `[implant1, implant3]` | `0/2/0/2/2/0` | 15 |
| `stealth_katana` | `[katana, katana]` | `light_top` | `heavy_bottom` | `[module_neural, module_neural]` | `[implant1, implant3]` | `0/3/0/-1/3/0` | 15 |
| `hacking_emp` | `[katana, rifle]` | `light_top` | `heavy_bottom` | `[module_emp, module_neural]` | `[implant1, implant3]` | `-1/2/2/-1/2/1` | 15 |
| `hacking_forcefield` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_forcefield, module_neural]` | `[implant1, implant3]` | `0/2/-1/1/1/1` | 15 |
| `mobility_tactical` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_neural, module_neural]` | `[implant1, implant4]` | `0/2/0/2/1/1` | 30 |
| `mobility_reaction` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_body, module_neural]` | `[implant4]` | `0/2/0/3/2/0` | 20 |
| `force_heavy_top` | `[katana, katana]` | `heavy_top` | `tactical_bottom` | `[module_body, module_neural]` | `[implant1, implant3]` | `0/1/0/2/4/0` | 15 |
| `force_body` | `[katana, rifle]` | `light_top` | `heavy_bottom` | `[module_body, module_neural]` | `[implant1, implant3]` | `0/2/0/0/3/-1` | 15 |
| `deception_tactical` | `[katana, rifle]` | `light_top` | `tactical_bottom` | `[module_emp, module_emp]` | `[implant1, implant3]` | `-2/2/4/1/1/3` | 15 |
| `deception_emp` | `[katana, rifle]` | `light_top` | `heavy_bottom` | `[module_emp, module_emp]` | `[implant1, implant3]` | `-2/2/4/-1/2/2` | 15 |

같은 equipment ID가 배열에 반복되면 서로 다른 장비 인스턴스를 뜻한다. `hacking_forcefield`는 Hacking -1의 대가와 장벽 능동 효과를 검증하는 의도적 음수 대조군이므로 “유효 Capability 2 이상 두 개” 기준의 예외다. 나머지 baseline은 장비 판타지와 함께 적어도 하나의 보조 축을 제공한다.

### 12.3 초기 밸런스 가정

- 기준 런: 이동 18~24회, 현장 행동 5~8회, 전투 2~3회(총 7~10턴), 탈출 요청 1회.
- 기준 플레이어는 모든 현장 기회를 먹지 않는다. 보상보다 탈출 경로·정보·Overload 여유를 우선한다.
- 올바른 장비는 적어도 두 개의 유효 Capability 2 이상과 한 개의 고유 능동 효과 또는 전투 특화 장비를 뜻한다.
- 절반의 올바른 선택은 고위험 행동 중 50%에서 더 나은 접근법을 고른다는 뜻이며, 매 선택 정답을 맞히는 플레이가 아니다.

### 12.4 초기 성공 확률 예산

V1은 플레이어의 단일 판정 실패가 런 전체를 끝내지 않도록, 탈출 수단과 회복 수단을 중첩한다. 아래는 적절한 장비·절반의 올바른 선택을 한 기준 플레이어의 설계상 결과 분포다. 이는 구현 후 최소 200런 검증에서 비교할 목표 분포다.

| 결과 | 목표 비율 | 전형적 원인/경로 |
|---|---:|---|
| A 일반 탈출 | 41% | 1900~2200포인트에 A를 요청하고 기만·은신으로 개방 창 도달 |
| B 일반 탈출 | 36% | A를 포기하거나 닫힌 뒤 장기 경로와 관제/발전기 조작으로 B 도달 |
| 열쇠 탈출 | 3% | 3~5회 파밍 중 열쇠 확보 후 신호 없이 우회 |
| 실패 | 20% | HP 9%, 증원/추적 5%, 시간 판단 4%, Overload 2% |

이 분포의 추출 성공률은 80%다. 열쇠 탈출은 런을 보장하지 않는 보너스이며, A/B가 항상 주요 성공 경로여야 한다.

### 12.5 시간·Overload 예산

| 항목 | 기준 플레이어 목표 | 실패 위험선 |
|---|---:|---:|
| A 추출 시점 | 1900~2200 | 2500 이후 A 신규 요청 불가 |
| B 추출 시점 | 3300~3550 | 3900 이후 B 신규 요청 불가 |
| 평균 전투 시간 | 180~300/전투 | 420 이상이면 증원 위험 급증 |
| 현장 행동 합계 | 500~800 | 1000 이상이면 보상 탐욕 경고 |
| peak Overload | 55~80 | 90 이상은 마지막 수단, 100은 멜트다운 즉시 패배 |
| 파밍 횟수 | 3~5 | 전체 현장 행동 5~8회 안에서만 선택 |

행동 미리보기는 위 위험선을 직접 보여 준다. 예를 들어 A 비활성 전 300포인트 이하에서 140포인트 현장 행동을 고르면 `A 요청 가능 시간 1회 남음`을 표시한다.

## 13. 구현 순서

1. 데이터 모델·48노드 생성·거리 검증·seed 테스트.
2. 시간 엔진·위협 AI·소음/흔적/추적·탈출 상태 기계.
3. 맵 화면·탐사 안개·HUD·행동 미리보기.
4. Capability 현장 행동·특수 엣지·랜드마크·Overload.
5. 카드 소음·전투 시간·기습·이탈·증원 연결.
6. 장비 Capability 매핑과 능동 효과.
7. 계측·최소 200런 밸런스 패스·실제 플레이 시간 조정.

이 순서는 맵의 결정론적 상태 기계와 UI 미리보기를 먼저 검증하고, 이후 카드·장비 콘텐츠를 안전하게 연결하게 한다.
