# Handoff: Slay-the-Spire 스타일 게임 UI (맵/전투/보상/게임오버/런완료)

## Overview
`card-ext/PLAN.md`에 정의된 Preact 기반 카드 배틀러 프로토타입의 5개 화면(맵, 전투, 보상, 게임오버, 런완료) 비주얼 목업입니다. Modernist 디자인 시스템(플랫, Archivo 폰트, 레드/화이트, 2px 룰, 도형 기반 아이콘)을 적용했습니다.

## About the Design Files
`Game UI.dc.html`은 **디자인 레퍼런스로 만든 HTML**입니다 — 그대로 복사해 붙일 코드가 아니라, 의도한 레이아웃/스타일/상태 표현을 보여주는 정적 목업입니다. 실제 구현은 PLAN.md에 정의된 `card-ext/src/components/*.js` (Preact + htm) 구조 안에서, 각 컴포넌트가 실제 엔진 signals를 읽어 렌더링하도록 재작성해야 합니다. 이 목업은 하드코딩된 예시 데이터(카드 5장, 적 2마리 등)로 상태를 보여줄 뿐이며 인터랙션(카드 클릭, 드래그 타겟팅 등)은 구현되어 있지 않습니다.

## Fidelity
**High-fidelity (hifi)** — 색상/타이포/간격/보더는 Modernist 토큰 값 그대로이며 최종 스타일로 간주해도 됩니다. 다만 데이터는 전부 더미이며, 애니메이션·실제 인터랙션 로직은 포함되어 있지 않습니다.

## Screens / Views

### 1. Map (`MapScreen.js` + `MapNode.js`)
- 목적: 노드 선택 후 `SELECT_MAP_NODE` dispatch.
- 레이아웃: 상단 헤더(층 표시 + HP/덱/유물 요약) → 스크롤 가능한 SVG 그래프(노드 40×40 사각형 + 연결선) → 하단 범례.
- 그래프 방향: **아래(1층) → 위(보스)**. 각 층은 y좌표 그룹으로 배치, 노드는 x좌표로 분산. `mapNodesRaw` 배열의 좌표를 실제 `mapEngine.generateMap(seed)` 결과 좌표 계산으로 대체해야 함 (현재는 6개 층 하드코딩 예시).
- 노드 색상 규칙 (`nodeStyle()` 참고):
  - 완료(done): `var(--color-neutral-600)` 채움
  - 현재 위치 + 엘리트: `var(--color-accent)` 채움, `var(--color-accent-2-700)` 4px 테두리
  - 이동 가능(available): 배경색, `var(--color-accent)` 3px 테두리
  - 미확인 엘리트: `var(--color-neutral-300)` 채움, `var(--color-accent-2-700)` 3px 테두리
  - 보스: `var(--color-neutral-900)` 채움, `var(--color-accent)` 3px 테두리
  - 미확인 일반: `var(--color-neutral-300)` 채움, `var(--color-divider)` 2px 테두리

### 2. Combat (`CombatScreen.js`, `EnemyRow.js`, `Hand.js`, `Card.js`, `PlayerStatusBar.js`, `PileCounts.js`, `EndTurnButton.js`, `PlayLog.js`, `HistoryControls.js`)
- 레이아웃: 상단 = **캐릭터 영역**(좌: 플레이어 상태 패널, 우: 적 카드들 가로 배치) + 우상단 디버그 플레이로그 패널. 2px `.hr` 구분선. 하단 = **카드 영역**(핸드 카드 가로 배치 + 중앙 정렬 "턴 종료" 버튼).
- 플레이어 패널(180px 폭): 이름, HP 바(14px 높이, 채움 `var(--color-accent-600)`), 방어/힘 등 상태 태그, 에너지 필박스(22×22 사각형, 채워짐=accent/빈칸=divider 테두리), 뽑기/버림/소진 카운트.
- 적 카드(220px 폭): 이름 + 인텐트(공격=위쪽 삼각형+숫자, 방어=아래쪽 삼각형+"방어" 라벨), HP 바, 방어/상태이상 태그.
- 핸드 카드(140px 폭, 최소 190px 높이): 좌상단 코스트 배지(26×26, 타입색 채움), 이름, 타입 태그(공격=accent/스킬=neutral/파워=accent-2), 설명. hover 시 그림자+살짝 위로 이동.
- 플레이로그 패널: `.tag-outline` "DEBUG" 배지 + Undo/Redo 버튼(가능할 때만 활성화) + 최근 entry 목록(모노스페이스, 되돌린 항목은 옅게).

### 3. Reward (`RewardScreen.js`)
- 중앙 정렬. 제목 → `.hr` → 카드 후보 3장(핸드 카드와 동일 스타일이지만 170px 폭, 살짝 큼) → "건너뛰기" 버튼(`.btn-secondary`).

### 4. GameOver (`GameOverScreen.js`)
- 배경 `var(--color-neutral-900)`, 텍스트 `var(--color-bg)`. "RUN OVER" 킥커(accent-400) → "패배" h1(64px) → 통계 3개 → "새 런 시작" `.btn-primary`.

### 5. RunComplete (`RunCompleteScreen.js`)
- 배경 `var(--color-accent)`, 텍스트 `var(--color-bg)`. "SPIRE CLEARED" 킥커 → "런 완료" h1 → 통계 3개 → "새 런 시작" 버튼(bg 반전).

## Interactions & Behavior (구현 필요, 목업엔 없음)
- 맵 노드 클릭 → 이동 가능한 노드만 클릭 가능, 나머지는 비활성.
- 카드 클릭/드래그 → 타겟 필요 카드는 `TargetingOverlay` 노출, 에너지 부족 시 카드 회색 처리.
- "턴 종료" 클릭 → `END_TURN` dispatch, 적 턴 애니메이션.
- Undo/Redo 버튼 → `history.cursor` 기반 활성/비활성, 키보드 단축키 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z.
- 보상 카드 선택/건너뛰기 → `SELECT_REWARD` / `SKIP_REWARD` dispatch 후 맵으로 복귀.

## State Management
PLAN.md의 `state/runState.js` signals(`currentScreen`, `playerState`, `mapState`, `activeCombatState`, `rewardState`, `history`)를 그대로 사용. 이 목업의 더미 배열(`handRaw`, `enemiesRaw`, `mapNodesRaw`, `historyRaw`, `rewardRaw`)은 실제 signals에서 계산되는 값으로 교체.

## Design Tokens
Modernist 디자인 시스템 (`_ds/modernist-8d3fb18a-9e41-4996-8011-480687e15699/styles.css`) 그대로 사용:
- `--color-bg #f3f2f2`, `--color-text #201e1d`, `--color-accent #ec3013`
- neutral/accent/accent-2 100~900 램프
- `--font-heading` / `--font-body`: Archivo (400/600/800)
- `--space-1..8`: 4/8/12/16/24/32px
- `--radius-*`: 0px (라운드 없음)
- `.tag`, `.btn`, `.card`, `.nav`, `.hr` 클래스는 `styles.css` 정의 그대로 재사용

## Assets
아이콘/이미지 없음. 모든 시각 요소는 CSS 도형(사각형, 삼각형 clip 없는 border 삼각형, SVG 라인)으로 구성 — Modernist의 "도형/색상 위주" 방향과 일치.

## Files
- `Game UI.dc.html` — 5개 화면 전체 목업 (탭으로 화면 전환, 상단 nav)
- `styles.css`, `_ds_bundle.js` — Modernist 디자인 시스템 원본
- `PLAN.md` — 이 UI가 구현해야 할 전체 게임 엔진/상태 설계 원본 문서
