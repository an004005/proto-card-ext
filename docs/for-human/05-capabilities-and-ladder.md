# 05. Capability와 층계

## 이 시스템이 하는 일

장착한 장비가 여섯 개의 Capability 값을 만들고, 그 값이 시설에서 문제를 푸는 방식을 정한다. 요구치는 넘거나 못 넘거나가 아니라 **층계**다 — 모자란 채로도 들어갈 수 있고, 대신 모자란 만큼 그 Capability의 통화로 대가를 치른다. 대가를 전부 시간으로 받지 않는 것이 이 시스템의 핵심이다.

## 규칙과 수치

### 여섯 Capability

| 한글 | 코드 키 | 맡는 것 | 층계 통화 |
|---|---|---|---|
| 지각 | `perception` | 정보의 깊이, 흔적 정리, 카메라 저격 | (시간만) |
| 은신 | `stealth` | 조우 판정, 이동 흔적, 카메라 발각 | 흔적 · 경계도 |
| 해킹 | `hacking` | 전자 자물쇠, 카메라, 출구 개방 대기, 통제실 | 경계도 |
| 기동 | `mobility` | 이동 시간, 고지대, 이탈 | HP |
| 파괴 | `force` | 물리 자물쇠, 파괴, 전원 차단 | 소음 · 내구도 |
| 기만 | `deception` | 조우 속이기, 가짜 소음, 가짜 목표 송출 | 효과 지속 |

- 장착 장비의 보정을 전부 더한 뒤 `CAPABILITY_MIN` = −2 ~ `CAPABILITY_MAX` = 4로 자른다(`computeCapabilities`).
- 임플란트도 Capability를 준다(슬롯에 든 것만).
- 런 중에 Capability를 바꾸는 유일한 방법은 **장비 교체**(건당 3칸)다.

### 장비별 Capability 보정 (`MAP_EQUIPMENT_CAPABILITIES`)

보정이 없는 장비도 빈 계약으로 등재되어 있다 — 예외 목록을 따로 두면 축 분류의 진실이 두 군데가 되기 때문이다.

| 장비 | 보정 | 현장 행동 |
|---|---|---|
| 카타나 | Force +1 | — |
| 자동 소총 · 단검 · 권총 · 자동권총 · 리볼버 | 없음 | — |
| 샷건 | Force +1 / Stealth −1 | — |
| 로켓런처 | Force +1 / Stealth −1 | — |
| 저격총 | Perception +1 / Mobility −1 | 카메라 저격 |
| 중갑상의 | Force +1 / Stealth −1 | — |
| 경갑상의 | Stealth +1 | — |
| 전술하의 | Mobility +1 | — |
| 중장하의 | Force +1 / Mobility −1 | — |
| 신경 강화 | 없음 | — |
| 신체 강화 | Force +1 / Mobility +1 / Deception −1 | — |
| 역장 강화 | Hacking −1 | 임시 장벽 |
| 공간 지각 | Perception +2 | 집중 투시 |
| 전자기 간섭 | Hacking +2 / Deception +1 / Perception −1 | 원격 침투 |
| 산데비스탄 | Mobility +2 / Stealth −1 | — |
| 맨티스 블레이드 | Force +2 / Mobility +1 / Stealth −1 | — |
| ① 체력 보강 | 없음 | — |
| ② 위협 감지 | Perception +1 | — |
| ③ 수납 확장 | 없음 | — |
| ④ 반응 가속 | Mobility +1 | — |
| ⑥ 산개 방출 | 없음 | — |
| ⑦ 지도 | 없음 (`mapInfoEffect: true`) | 랜드마크 화살표 |

**무상 보너스 금지**가 이 표의 규칙이다. 한 축을 올리는 장비는 다른 축을 내리거나, 애초에 한 축만 올린다. 두 축을 공짜로 얹으면 그 장비가 선택이 아니라 정답이 된다.

기본 창고 장비로 짠 대표 로드아웃(카타나·단검·경갑상의·전술하의·신경 강화·신체 강화 + 임플란트 ①③⑥)의 실효값은 **Perception 0 · Stealth 1 · Hacking 0 · Mobility 2 · Force 2 · Deception −1**이다.

### 층계 다섯 단계 (`capabilityStep`)

요구치 R, 원시 실효 수치 A. `gap = A − R`.

| 조건 | 단계 | 코드 키 | 시간 가감 |
|---|---|---|---|
| A ≥ R+1 | 여유 | `surplus` | −1칸 |
| A = R | 표준 | `standard` | 0 |
| A = R−1 | 무리 | `strained` | +2칸 |
| A = R−2 | 위태 | `severe` | +4칸 |
| A ≤ R−3 | 불가 | `impossible` | 시도 불가 |

상수는 `CAPABILITY_STEP_TIME_DELTA`, 하한은 `CAPABILITY_MIN_TIME` = 1칸. 최하 단계 간격은 `CAPABILITY_STEP_MIN_GAP` = −2.

판정은 **원시 수치(−2~4)** 로 한다. `effectiveForRequirement`의 `max(0, ...)` 하한을 쓰면 요구치 2 이하인 행동에서 불가 구간이 아예 사라지기 때문이다. 예외는 고지대 통과 하나로, 지형 판정이라 0 하한을 적용한 값으로 층계를 가른다(요구치가 3이라 불가 구간은 그대로 남는다).

### 단계별 대가표 (Capability마다 자기 통화만)

| Capability | 통화 | 여유 | 표준 | 무리 | 위태 |
|---|---|---|---|---|---|
| Perception | (없음) | 시간 −1 | — | 시간 +2 | 시간 +4 |
| Hacking | 경계도 (`CAPABILITY_STEP_RAISES_ALERT`) | 시간 −1 | — | 시간 +2 | 시간 +4 · **그 구역 경계 압력 +4** |
| Force | 소음 (`CAPABILITY_STEP_NOISE_DELTA`) / 내구도 (`CAPABILITY_STEP_DURABILITY_LOSS`) | 시간 −1 · 소음 −1 | — | 시간 +2 · 소음 +1 | 시간 +4 · 소음 +2 · 장착 장비 내구도 −1 |
| Stealth | 흔적 (`CAPABILITY_STEP_LEAVES_STRONG_TRACE`) + 경계도 | 시간 −1 | — | 시간 +2 · 그 자리에 **강한 흔적** | 시간 +4 · 강한 흔적 + 그 구역 경계 압력 +4 |
| Mobility | HP (`CAPABILITY_STEP_HP_COST`) | 시간 −1 | — | 시간 +2 · **HP −3** | 시간 +4 · **HP −8** |
| Deception | 효과 지속 | 시간 −1 · 지속 표 | — | 시간 +2 · 지속 표 | 시간 +4 · 지속 표 |

- 소음은 0~3으로 잘린다.
- 위태 단계로 그 자리에서 들키는 것의 경계 압력은 `ALERT_PRESSURE.botchedAction` = 4다.
- HP와 내구도는 시설 상태 바깥이라 행동 시점에 청구서로 쌓였다가 커맨드 래퍼에서 정산된다. 내구도는 장착한 무기부터 깎는다.
- 층계 대가로 HP가 0이 되면 런이 끝난다. 내구도가 0이 된 장비는 슬롯에서 빠지되 파손 상태로 인벤토리에 남는다.

### 지속이 통화인 행동 — 가짜 목표 송출

배율이 아니라 단계별 **고정표**를 읽는다(`FALSE_BROADCAST_DURATION_BY_STEP`).

| 단계 | 여유 | 표준 | 무리 | 위태 |
|---|---|---|---|---|
| 지속(칸) | 19 | 15 | 8 | 4 |

장비가 가진 고정 지속(임시 장벽 10칸 등)에는 이 보정을 적용하지 않는다.

### 비용 계산 순서 (`resolveCapabilityCost`)

`자격 확인 → 기본 비용 → 층계 시간 가감 → (지원 행동에만) 접근 모드 가감 → 최소 1칸`

중간에 클램프를 끼우지 않는다 — 그러면 강행(−2)과 무리(+2)가 서로 상쇄되지 못해 같은 조합이 경로에 따라 다른 값이 된다.

**전용 시간 규칙**을 가진 행동은 층계 시간 가감을 중복으로 받지 않는다(`dedicatedTimeRule`): 이동, 고지대 통과(Mobility 칸 가감), 흔적 정리(Perception 전용표). 그 행동들에서 층계는 불가 판정과 비시간 통화만 맡는다.

### 층계가 걸리는 행동 전부

| 행동 | Capability | 요구치 | 기본 칸 | 기본 소음 |
|---|---|---|---|---|
| 고지대 통과 | Mobility | 3 | 이동 규칙 | 0 |
| 조우 속이기 | Deception | 2 | 0 | 0 |
| 특수 엣지 개방 | Force 또는 Hacking | 엣지가 정함(기본 1) | 5 / 4 | 2 / 0 |
| 접속 인터페이스 해킹 | Hacking | 1 | 5 | 0 |
| 카메라 해킹 | Hacking | 1 | 5 | 0 |
| 카메라 파괴 | Force | 1 | 5 | 2 |
| 카메라 저격 | Perception | 2 | 4 | 2 |
| 발전기 해킹 무력화 | Hacking | 1 | 5 | 0 |
| 발전기 파괴 | Force | 1 | 5 | 2 |
| 통제실 장악 | Hacking | 1 | 8 | 0 |
| 물건 확보(회수 계약) | Stealth 또는 Mobility | 1 | 6 | 0 |
| 폭약 설치 | Force | 1 | 9 | 0 |
| 데이터 확보 | Hacking | 1 | 6 | 0 |
| 데이터 송출 | Hacking | 1 | 5 | 0 |
| 흔적 정리 | Perception | 1 | 4~8(전용표) | 0 |
| 전원 차단 | Force | 1 | 6 | 3 |
| 가짜 목표 송출 | Deception | 1 | 7 | 0 |
| 가짜 소음 | Deception | 1 | 3 | 0 |

요구치가 대부분 1이므로, **아무것도 장착하지 않은 기본 로드아웃(전 Capability 0)은 특수 엣지의 97%를 "무리" 단계로 열 수 있다.** 잠기는 것은 Capability 하한(−2)에 있는 빌드뿐이다.

### 이분 게이트는 남아 있지 않다

예전에 요구치 미달을 잠김으로 처리하던 고지대(Mobility 3), 조우 속이기(Deception 2), 가짜 소음(Deception 1)이 전부 층계로 들어왔다. 다음 표들은 게이트가 아니라 **정보의 깊이·사거리·대기 시간만 조절**하므로 그대로 둔다: `CAMERA_HACK_RANGE_BY_HACKING`, `EXIT_OPEN_WAIT_BY_HACKING`, `PERCEPTION_INFO_TABLE`, `MOBILITY_MOVE_TIME_DELTA`, `INTERFACE_CAMERA_REVEAL_HOPS_BY_HACKING`, `FAKE_NOISE_RANGE_BY_DECEPTION`. 카메라 발각선(Stealth 3)도 행동이 아니라 수동 감지 판정이라 층계 밖이다.

### 고지대 통과 (`HIGH_GROUND_MOBILITY_REQUIREMENT` = 3)

| 실효 Mobility | 단계 | 대가 |
|---|---|---|
| 4+ | 여유 | 없음 |
| 3 | 표준 | 없음 |
| 2 | 무리 | HP −3 |
| 1 | 위태 | HP −8 |
| 0 이하 | 불가 | 넘지 못한다 |

이동 시간은 평소의 Mobility 칸 가감 그대로이고 층계 시간 가감을 얹지 않는다. 지도 툴팁이 `고지대 — Mobility 3 기준, 현재 부족분 N: HP −X`로 미리 적는다.

### 조우 속이기 (`ENCOUNTER_DECEIVE_REQUIREMENT` = 2)

0칸짜리 행동이라 시간으로 대가를 받을 수 없어, **판정 자체**에 대가를 붙인다(`ENCOUNTER_DECEIVE_STEP_PENALTY`).

| 실효 Deception | 단계 | 성공 기준 | 추가 대가 |
|---|---|---|---|
| 3+ | 여유 | Deception ≥ 위협의 경계 | 없음 |
| 2 | 표준 | Deception ≥ 위협의 경계 | 없음 |
| 1 | 무리 | Deception ≥ 위협의 경계 **+ 1** | 없음 |
| 0 | 위태 | Deception ≥ 위협의 경계 **+ 1** | 성공·실패와 무관하게 **그 위협의 경계 +1** |
| −1 이하 | 불가 | — | 시도 불가 |

실패하면 조우가 **열세로 내려간다.** 위협당 한 번뿐이며, 추적을 끊는 것이 아니라 추적 목표를 인접한 다른 노드로 옮긴다.

### 가짜 소음 사거리 (`FAKE_NOISE_RANGE_BY_DECEPTION`)

| 실효 Deception | −2 | −1 | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|
| 홉 범위 | (불가) | 1 | 1 | 1 | 2 | 3 | 3 |

`FAKE_NOISE_STRONG_DECEPTION` = 3 이상이면 심는 소음이 강도 `FAKE_NOISE_STRONG_INTENSITY` = 2, 그 미만은 `FAKE_NOISE_INTENSITY` = 1이다. 요구치(1)에 못 미쳐도 심을 수는 있고, 부족분은 층계가 시간으로 받으며 사거리는 최소 1홉으로 주저앉는다. 경계도는 건드리지 않는다.

### 가짜 목표 송출의 사거리

대상은 인접 구역이지만 `FALSE_BROADCAST_ANY_SECTOR_DECEPTION` = **Deception 3 이상**이면 시설 어느 구역으로나 던질 수 있다.

### 예고 문장

- 층계나 접근 보정이 걸린 행동은 툴팁에 `문 해킹 3칸 = 기본 4 − 능력 1`처럼 분해를 낸다(`describeForecast`).
- 하한에 잘렸으면 그 행동의 실제 하한을 적는다(이동은 2칸, 나머지는 1칸).
- 층계 뱃지는 단계 이름과 그 단계가 바꾼 대가를 낸다. 소음은 **총량**으로 적고, 층계가 그 값을 바꿨을 때만 `소음 2(기본 3 − 여유 1)`처럼 괄호를 덧붙인다. 부호가 붙는 것은 증분인 시간뿐이다.
- 불가 단계는 한 문장으로만 말한다: `Hacking 3이 표준, 1 이상이면 대가를 치르고 시도 가능(현재 0)`.

## 기획 의도

- **Capability 범위가 −2~4인 이유**(ADR-0052): 처음에는 0~4였지만, 음수 구간이 있어야 "이 장비는 그 축을 깎는다"는 대가가 실제로 판정에 들어간다. 하한 −2가 곧 "불가"가 실제로 발생하는 유일한 자리다.
- **층계로 바꾼 이유**(D8 / ADR-0075): Capability 게이트가 이분법이면 장비 선택이 "요구치를 넘겼나"라는 체크박스가 된다. 층계로 바꾸면 모자란 채로도 들어갈 수 있고, 대신 **무엇을 치를지**가 선택지가 된다.
- **통화를 나눈 이유**(ADR-0073): 대가를 전부 시간으로 받으면 시간이 다시 단일 통화가 되어 층계가 의미를 잃는다. 시간 가감만 공통이고 나머지는 Capability마다 다르다.
- **Hacking의 통화가 경계도인 이유**(ADR-0080): 원래는 과부화였는데, 과부화는 플레이어가 그 자리에서 다룰 수 있는 것이 아니라 런 시작 시점에 이미 정해져 있었다 — 해킹 빌드는 "치를 것인가"를 고르는 대신 게이지가 차오르는 것을 지켜보기만 했다. 경계도는 실제로 수습할 수 있는 자원이다.
- **Capability는 로드아웃으로만 바뀐다**(ADR-0029). 런 중 레벨업이 없으므로 빌드는 출격 전에 정해지고, 중반의 선택은 "그 수치로 무엇을 할까"가 된다. 상황 보정(ADR-0079)이 들어온 것은 이 고정성을 상쇄하기 위해서다 — [06](./06-threats-alert-and-recovery.md) 참고.
- **상위 티어는 아직 없다**(ADR-0056·0057·0058): 현재 구현은 각 Capability의 tier 1만 모델링한다. Hacking 2~4의 원격 연쇄 조작, Force 2~4의 구조물 파괴, Deception 2~4의 그룹 분산은 [12](./12-open-questions.md)에 있다.
- **조우 속이기와 가짜 소음이 층계로 들어온 이유**: 그 둘이 마지막 남은 이분 게이트였다. 0칸 행동은 시간으로 대가를 받을 수 없으므로 판정 난이도를, 사거리형 행동은 사거리를 대가로 삼았다.

## 관련 코드

- `src/data/facilityEquipmentCapabilities.js` — 장비별 Capability 계약(유일한 원본)
- `src/data/facilityLayout.js` — `CAPABILITY_STEP_*`, `HIGH_GROUND_MOBILITY_REQUIREMENT`, `ENCOUNTER_DECEIVE_*`, `FAKE_NOISE_*`, `FALSE_BROADCAST_*`
- `src/engine/capabilityEngine.js` — `computeCapabilities`, `effectiveForRequirement`, `listFieldActiveEquipment`
- `src/engine/capabilityCosts.js` — `capabilityStep`, `resolveCapabilityCost`, `CAPABILITY_CURRENCIES`
- `src/engine/actionCosts.js` — `ACTION_SPECS`, `forecastAction`, `describeForecast`
- `src/components/ladderDisplay.js`, `capabilityDisplay.js`
- `docs/adr/0052`, `0056`, `0057`, `0058`, `0073`, `0075`, `0080`
