# 슬레이 더 스파이어 스타일 프로토타입 (전투 + 맵)

## Context
슬레이 더 스파이어 스타일의 자체 게임 프로토타입을 만들고 싶어함. Slay the Spire 2는 2026년 3월 5일 Early Access로 출시됐지만 콘텐츠와 밸런스가 계속 변경될 수 있으므로, 이 프로토타입은 안정적으로 검증 가능한 **Slay the Spire 1 Ascension 0** 메커니즘을 기준으로 삼음. 전체 게임(상점/휴식/이벤트/메타진행)을 한 번에 만들기엔 범위가 너무 커서, **전투 + 맵 진행**으로 스코프를 좁혔음. 카드/유물 수치는 STS1 기준 데이터를 사용하되, 데이터 파일 하나만 고치면 바로 튜닝되는 구조를 요구함. 빌드 없이 로컬 HTTP 서버로 실행하는 HTML/JS 프로토타입이며, UI는 기능 위주 심플 UI(레이아웃/상호작용은 STS와 유사하게, 비주얼은 도형/색상 위주).

기술 스택은 상태가 복잡해질 걸 감안해 Vanilla 대신 **경량 프레임워크(Preact, CDN)**로 가기로 사용자가 확정함.

## 확정된 스코프
- 포함: 맵 노드 이동(combat/elite/boss), 카드 기반 전투(에너지/핸드/드로우-디스카드-소진 파일), 상태이상(약화/취약/힘/기교/허약), 적 AI 인텐트, 승리/패배, 최소 유물(Burning Blood 정도), 플레이 로그 기반 undo/redo
- 제외: 상점, 휴식, 랜덤 이벤트, 세이브/메타진행, 여러 캐릭터, 카드 업그레이드(+) 전체 시스템(업그레이드 데이터 구조와 `upgradeCard` 효과 인터페이스만 남기고 MVP에서는 Armaments를 제외)

## 기술 스택 / 실행 방식
- 빌드 툴 없음. ES Module의 `file://` CORS 제약을 피하기 위해 프로젝트 루트에서 `python -m http.server 8000` 실행 후 `http://localhost:8000`으로 접속.
- Preact + `@preact/signals` + `htm` 를 esm.sh CDN에서 import (번들러 불필요, JSX 불필요).
- CDN import는 `src/lib.js` 한 곳에서만 하고, 나머지 파일은 전부 `lib.js`에서 재수출된 것만 사용 (버전 변경/장애 시 한 곳만 수정).
- `package.json`에는 `{ "type": "module" }`만 두어 브라우저와 Node 테스트가 같은 `.js` ESM 파일을 사용하도록 함. 의존성 설치나 빌드 스크립트는 필요 없음.

## 파일 구조
```
card-ext/
  index.html
  package.json               # Node가 engine/test의 .js를 ESM으로 해석하도록 type: module 지정
  src/
    main.js                  # Preact 렌더 부트스트랩, 최상위 화면 라우팅(Map/Combat/Reward/GameOver/RunComplete)
    lib.js                   # esm.sh에서 h, html(htm), signal, computed, effect 재수출 (유일한 CDN 진입점)
    data/
      cards.js                # 카드 정의 (이름/코스트/타입/effects[] — 수치 튜닝 지점)
      enemies.js               # 적 정의 + 인텐트 패턴
      encounters.js            # 노드 종류별 적 조합(단일 적, Louse 페어, 엘리트, 보스)
      relics.js                 # 최소 유물 (Burning Blood)
      statusEffects.js          # weak/vulnerable/strength/dexterity/frail 메타데이터
    engine/                    # 순수 함수, Preact/DOM 의존성 없음 (테스트 가능한 핵심)
      cardEngine.js             # drawCards, shuffleDiscardIntoDraw, playCard
      combatEngine.js           # createCombatState, startPlayerTurn, endPlayerTurn, resolveEnemyTurn, checkWinLoss
      statusEngine.js           # applyStatus, tickStatuses, computeDamage (STS 데미지 공식)
      triggerEngine.js          # powers/temporaryEffects의 트리거 실행. 턴 경계(turnStart/turnEnd)와 반응형(onAttacked/onCardPlayed/onHpThreshold)을 동일 인터페이스로 처리. 플레이어와 적 공용
      enemyAI.js                # chooseNextIntent (가중치 랜덤, 연속 동일패턴 방지 등)
      mapEngine.js               # generateMap(seed), getAvailableNodes, advanceToNode
      rng.js                     # seeded PRNG (재현 가능한 셔플/맵 생성)
      historyEngine.js           # command/log 기록, undo/redo 커서 이동, 분기 폐기
    state/
      dispatch.js               # 유일한 상태 변경 진입점. command 실행 → 새 GameSnapshot → history 기록 → signals 갱신
      runState.js               # 최상위 signals: currentScreen(map|combat|reward|gameOver|runComplete), playerState, mapState, activeCombatState, rewardState, history
      combatStateAdapter.js      # combatEngine 결과 <-> signals 연결
    components/
      App.js, MapScreen.js, MapNode.js, CombatScreen.js, EnemyRow.js,
      IntentIcon.js, Hand.js, Card.js, PlayerStatusBar.js, PileCounts.js,
      EndTurnButton.js, TargetingOverlay.js, RewardScreen.js, GameOverScreen.js,
      RunCompleteScreen.js,
      HistoryControls.js, PlayLog.js
  test/
    combatEngine.test.js        # node:test + node:assert 기반 실제 유닛 테스트 (engine/*는 DOM 의존성 없는 순수 함수라 Node에서 바로 실행 가능)
    cardEngine.test.js          # 드로우/리셔플/파일 이동
    statusEngine.test.js
    triggerEngine.test.js       # 플레이어/적 Power와 temporaryEffects의 발동·해제 순서, 반응형 트리거(Curl Up/Enrage/Split)
    enemyAI.test.js             # 가중치 선택, 연속 동일패턴 방지, 동일 rngState 재현성
    mapEngine.test.js
    historyEngine.test.js
```

**핵심 설계 원칙**: `engine/*`는 순수 상태전이 함수(입력 state → 새 state), DOM/Preact와 완전 분리. `components/*`는 signals만 읽고 `state/*`가 노출하는 액션만 호출. 이 분리 덕분에 전투/맵 규칙을 Node 내장 테스트 러너로 UI 없이 빠르게 검증 가능 (별도 패키지 설치 불필요 — Node 18+의 `node:test`/`node:assert`와 ESM 설정용 최소 `package.json`만 사용. `node --test test/` 한 줄로 전체 스위트 실행).

## 도메인 모델 (요약)
- **Card**: `{id, name, cost, type: attack|skill|power, target, exhausts, effects:[{kind:"damage"|"damageFromBlock"|"block"|"applyStatus"|"applyPower"|"draw"|"repeat"|"addCard"|"exhaustRandom"|"upgradeCard",...}], description}`. 핸드/덱의 실제 인스턴스는 `{instanceId, defId, upgraded}`로 정의와 분리. MVP에서 사용하지 않는 효과도 확장 인터페이스와 명시적 미지원 오류는 둠.
- **StatusEffects**: `{weak, vulnerable, strength, dexterity, frail}` 맵. 데미지 공식: `finalDamage = floor(floor(base + strength) * (weak?0.75:1) * (vulnerable?1.5:1))`. 블록 공식: `finalBlock = max(0, floor((base + dexterity) * (frail?0.75:1)))`. weak/vulnerable/frail은 보유자 턴 종료 시 감소, strength/dexterity는 영구. 다단 공격은 각 hit마다 strength와 배율 및 내림을 적용.
- **Powers**: `{metallicize, demonForm, ritual, curlUp, enrage, split, ...}` 맵. 각 항목은 필요 시 `{amount, acquiredTurn, consumed}`처럼 발동량·획득 턴·1회성 소진 여부를 보관함. 턴이 지나도 감소하지 않으며 트리거 시점에 효과를 발생시킴. **플레이어와 적이 동일한 구조를 사용** — Cultist의 Ritual(매 턴 힘 증가)은 상태이상이 아니라 적의 Power이며, `triggerEngine`이 양쪽을 같은 코드 경로로 처리함. Ritual은 획득한 첫 턴의 turnEnd에는 발동하지 않고, 첫 공격을 수행한 턴의 turnEnd부터 힘을 부여함.
- **트리거 종류**: 턴 경계 `turnStart`/`turnEnd`와 반응형 `onAttacked`(Louse의 Curl Up — 처음 공격받았을 때 1회만 블록 획득, 이후 `consumed`), `onCardPlayed`(Gremlin Nob의 Enrage — 플레이어가 Skill 카드를 낼 때마다 힘 획득), `onHpThreshold`(Slime Boss의 Split). 반응형 트리거는 해당 이벤트를 발생시킨 효과의 해결이 끝난 직후 실행하며, 트리거가 만든 상태 변화도 같은 history entry에 포함됨.
- **TemporaryEffects**: `{strengthDown, noDraw, ...}` 맵. 해당 턴의 정해진 트리거 시점에 해제 또는 반대 효과를 적용함. Power 및 일반 상태이상과 별도로 관리.
- **Enemy**: `{id, defId, hp, maxHp, block, statuses, powers, intent:{kind, value, hits}, aiState}`. intent kind: attack/defend/buff/debuff/attack_defend(복합).
- **Player**: `{hp, maxHp, block, energy, maxEnergy, statuses, powers, temporaryEffects, relics, deck}`.
- **Map**: `{seed, floors:[[{id,type}]], edges:[{from,to}], currentNodeId, visitedNodeIds}`. node type: combat/elite/boss.
- **RewardState**: `{sourceNodeId, candidates:[defId], selectedDefId:null|string}`. 보상 화면 진입 시 seeded RNG로 후보를 한 번 생성해 저장하며 렌더링 중에는 다시 추첨하지 않음.
- **RNG**: 모든 랜덤 함수는 전역 `Math.random()`을 사용하지 않고 `{value, rngState}` 또는 `{state, rngState}`를 반환. 셔플, 맵 생성, 적 AI, 무작위 카드 효과가 갱신된 `rngState`를 다음 상태전이에 명시적으로 전달함.
- **GameSnapshot**: `{currentScreen, playerState, mapState, activeCombatState, rewardState, rngState}`. 직렬화 가능한 게임 상태만 포함하며 `history`, Preact signals, DOM 객체, 데이터 정의 객체는 제외하고 정의는 ID로 참조.
- **History**: `{baseSnapshot, entries, cursor}`. 각 entry는 `{id, command, summary, before, after}`이며 `before`/`after`는 불변 `GameSnapshot`. `cursor`는 현재 적용된 마지막 entry의 인덱스이고 `-1`은 `baseSnapshot` 상태를 뜻함.

## 플레이 로그 / Undo / Redo
- **성격**: 게임 기능이 아니라 **디버그/밸런싱 도구**이며, 프로토타입 단계에서는 플레이어에게 그대로 노출함(같은 전투를 되돌려 다른 카드 수치를 비교하기 위함). 실제 게임으로 전환할 때 제거 대상이므로, undo/redo에 의존하는 게임 디자인을 만들지 않음. UI에서도 디버그 성격이 드러나게 표시.
- 모든 사용자 액션은 UI에서 상태를 직접 변경하지 않고 `dispatch(command)`를 통과함. command 예: `PLAY_CARD`, `END_TURN`, `SELECT_MAP_NODE`, `SELECT_REWARD`, `SKIP_REWARD`.
- 한 command가 만든 전체 상태전이를 history entry 하나로 기록. `END_TURN`은 남은 핸드 폐기부터 모든 적 행동과 다음 플레이어 턴 시작까지 하나의 원자적 entry이므로 undo 한 번으로 턴 종료 직전으로 복원.
- `PLAY_CARD`는 카드 선택과 대상 확정 후에만 기록. 대상 선택 취소나 에너지 부족처럼 상태가 바뀌지 않은 시도는 로그에 남기지 않음.
- undo는 현재 entry의 `before`, redo는 다음 entry의 `after` 스냅샷을 복원. 복원 대상은 `GameSnapshot`뿐이며 history 자체를 스냅샷에 넣지 않음. RNG 상태도 함께 복원하므로 undo 후 redo했을 때 셔플, 무작위 소진, 적 인텐트와 보상 후보가 완전히 동일해야 함.
- undo 후 새로운 command를 실행하면 cursor 뒤의 redo entries를 삭제하고 새 분기를 기록.
- 최초 런 생성 상태는 history의 base snapshot으로 보관. 저장/메타진행은 제외하므로 새로고침 후 history 복구는 지원하지 않음.
- 전투 승리, 보상 선택, 맵 복귀, 패배 및 보스 승리도 command 결과 스냅샷에 포함하여 화면 경계를 넘어 undo/redo 가능하게 함. 단, `NEW_RUN`은 기존 history를 초기화하므로 이전 런으로 undo할 수 없음.
- `PlayLog`에는 cursor까지 적용된 entry의 `summary`를 표시하고, 되돌린 항목은 별도 스타일로 남김. `HistoryControls`는 가능한 경우에만 Undo/Redo 버튼을 활성화하며 키보드 단축키 `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`를 지원.
- 초기 프로토타입은 구현 단순성과 정확성을 위해 전체 스냅샷을 저장. 상태 크기가 실제 병목으로 확인될 때만 command 재생/checkpoint 방식으로 최적화.

## 전투 엔진 (STS 규칙 그대로)
1. 전투 시작: 덱 셔플→드로우파일, 에너지=3/3, 블록=0, 적 첫 인텐트 롤.
2. 플레이어 턴 시작: 블록 리셋→turnStart Power 발동→에너지 회복→5장 드로우(드로우파일 부족시 디스카드 리셔플). 기본 턴 시작 드로우 전에 이전 턴의 `noDraw`가 남아 있는 상태는 허용하지 않음.
3. 카드 플레이: 에너지 검증→차감→effects[] 순서대로 적용→디스카드/소진 이동. `noDraw`가 활성화된 동안 후속 `draw` 효과는 실행하지 않음. 매 플레이 후 즉시 승패 체크(적이 턴 중간에 죽으면 바로 승리).
4. 플레이어 턴 종료: turnEnd Power 발동→즉시 승패 체크→남은 핸드 전부 디스카드→`noDraw` 제거 및 strengthDown 같은 temporaryEffects의 반대 효과 적용→플레이어의 weak/vulnerable/frail 감소→적 턴으로 전환. Battle Trance는 카드를 뽑은 직후 현재 턴에 `noDraw`를 부여하며 다음 턴의 기본 드로우에는 영향을 주지 않음.
5. 적 턴: 화면 배열 순서대로 살아 있는 적만 처리. 각 적은 블록 리셋→turnStart Power 발동→인텐트 실행→즉시 승패 체크→turnEnd Power 발동(예: Cultist의 Ritual로 힘 증가)→해당 적의 weak/vulnerable/frail 감소→살아 있으면 다음 인텐트 롤. Power별 획득 턴 규칙을 적용하여 Ritual은 부여된 첫 턴에는 발동하지 않음. 플레이어가 사망하면 이후 적 행동을 중단.
6. 블록은 데미지를 1:1로 흡수하고 초과분은 소멸 (관통 없음).
7. 죽은 적은 배열에서 즉시 삭제하지 않고 `hp <= 0`으로 유지해 대상 인덱스를 안정적으로 보존하며, 타겟팅과 AI에서 제외. 모든 적 사망 시 즉시 승리하며 이후 효과와 행동은 실행하지 않음. **플레이어와 마지막 적이 동시에 사망할 수 있는 효과(반사 피해, 자해 피해 등)는 스코프에서 배제**하여 이 판정 자체가 발생하지 않게 함. 그런 효과를 추가할 때 원작 동작을 확인하고 규칙을 정함.
8. Attack/Skill 카드는 해결 후 `exhausts`에 따라 discardPile 또는 exhaustPile로 이동. Power 카드는 해결 후 별도 powers 영역에 누적되고 어떤 카드 파일에도 들어가지 않음.
9. **적 스폰(Slime Boss의 Split)**: 전투 중 적 배열 **끝에 추가**하여 기존 인덱스를 변경하지 않음. 분열 시 원본은 사망 처리(`hp <= 0`)하고 분열체 2기를 추가한 뒤, 각 분열체의 첫 인텐트를 **배열 추가 순서대로** 롤하여 RNG 소비 순서를 결정적으로 고정(undo/redo 재현성 유지). 분열은 `split` Power의 `onHpThreshold` 트리거로 1회만 발동(`consumed`). 스폰이 끝난 뒤 승패 체크(분열 직후에는 살아 있는 적이 있으므로 승리로 판정되지 않아야 함).

## 맵 엔진
- `generateMap(seed)`: 고정 층수(예: 8층), 층별 2~4노드, 가중치 랜덤 타입(콤뱃 다수, 3층부터 엘리트), 보스층은 단일 노드. 다음 층 연결 시 고아 노드 없도록 보정.
- 런 중 지속 상태(`runState.playerState`: hp, deck)는 맵 전체에서 유지, `activeCombatState`는 전투마다 새로 생성/폐기. 승리 시 최종 HP를 runState로 반영(블록은 리셋), Burning Blood 발동. 패배 시 GameOverScreen.
- 일반/엘리트 전투 승리 시 3장의 카드 후보 중 1장을 선택하거나 건너뛰는 최소 보상 화면을 제공. 후보는 seeded RNG로 생성하며 상점·화폐 시스템은 구현하지 않음. 보스 승리 시 즉시 런 승리.

## 초기 데이터 세트 (1차 MVP 8장, 확장 후 17장 + 7종 적)
- 초기 덱: Strike 5장, Defend 4장, Bash 1장. 카드 인스턴스마다 고유 `instanceId`를 부여.
- 1차 MVP 카드 풀: Strike, Defend, Bash, Twin Strike, Iron Wave, Cleave, Thunderclap, Shrug It Off. 기본 피해/블록/드로우/단일·다단·광역/상태이상을 먼저 검증.
- 2차 확장 카드 풀: Body Slam, Clothesline, True Grit, Flex, Battle Trance, Inflame, Demon Form, Metallicize, Anger. 동적 피해, 무작위 소진, 일시 효과, Power 트리거, 카드 복제까지 effect/trigger 모델을 확장한 뒤 추가. 카드 업그레이드 시스템이 제외되므로 Armaments는 MVP에서 제외.
- 적 정의: Cultist(Ritual — turnEnd 트리거), Jaw Worm(가중치 랜덤+연속방지 AI), Louse(Curl Up — onAttacked 트리거, 다중 적 처리), Gremlin Nob(엘리트, Enrage — onCardPlayed 트리거), Slime Boss(보스, Split — onHpThreshold 트리거), Acid Slime M / Spike Slime M(Slime Boss 분열체, 인카운터에 직접 배치되지 않고 스폰으로만 등장).
- 인카운터 정의: 일반 노드는 Cultist/Jaw Worm 단독 또는 Louse 페어, 엘리트 노드는 Gremlin Nob, 보스 노드는 Slime Boss. 적 개체 데이터와 조합 데이터를 분리함.
- 유물: Burning Blood(전투 승리시 HP 6 회복)만 최소 구현.

## 빌드 순서 (마일스톤, 각 단계 독립적으로 브라우저에서 검증 가능)
1. 스켈레톤 렌더 — `<h1>` 하나만 Preact/htm/esm.sh 파이프라인으로 렌더 (가장 리스크 큰 통합 지점을 최우선 검증)
2. 정적 전투 화면 — 하드코딩된 핸드 5장 + 적 1마리 + 고정 에너지/파일 카운트 표시 (레이아웃만)
3. 엔진 단독 검증 — `combatEngine`/`cardEngine`/`statusEngine` 작성 후 `node --test`로 데미지/드로우 로직 유닛 테스트 작성·통과 확인 (UI 없이)
4. 엔진↔화면 연결 (플레이어 턴만) — 카드 클릭시 실제 에너지 차감/데미지/파일 이동, 에너지 부족시 회색처리
5. 플레이 로그 기반 상태전이 — 모든 액션을 `dispatch(command)`로 통일하고 카드 플레이 undo/redo, redo 분기 폐기, RNG 스냅샷 복원을 엔진 테스트로 검증
6. 턴 종료→적 턴 — 블록 리셋, 적 인텐트 실행, 새 인텐트 롤, 드로우/에너지 리필까지 풀 사이클. 전체 적 턴을 단일 history entry로 기록
7. 상태이상/Power — Vulnerable/Weak 적용 후 데미지 배율, Dexterity/Frail 적용 후 블록 수치, Power와 temporaryEffects의 턴 시작/종료 순서 확인. Battle Trance의 현재 턴 추가 드로우 차단·턴 종료 해제와 Ritual의 획득 턴 미발동/이후 적 turnEnd 발동을 검증하고 플레이어/적 Power가 동일 경로로 처리되는지 확인
8. 승리/패배 — 턴 중간 즉시 승리 전환, 플레이어 사망시 패배 전환, 화면 경계를 넘는 undo/redo 확인
9. 다중 적 전투 — 타겟팅 UI, AoE 카드, 일부만 죽었을 때 전투 계속
10. 적 AI 패턴 + 반응형 트리거 — Jaw Worm 가중치+연속방지, Cultist 1턴차 전용 패턴, undo/redo 후 동일 인텐트 확인. Louse의 Curl Up(최초 피격 1회만), Gremlin Nob의 Enrage(Skill 카드에만 반응) 검증
10-1. 적 스폰 — Slime Boss가 HP 50% 이하에서 1회만 분열, 분열체가 배열 끝에 추가되고 기존 타겟 인덱스가 유지되는지, 분열 직후 승리 판정이 나지 않는지, undo→redo 시 분열체 인텐트가 동일한지 확인
11. 맵 화면 정적 렌더 — 노드/엣지 그래프, 시드 바꿔가며 고아노드 없는지 확인
12. 맵 상호작용+전투 연결 — 노드 클릭→전투 시작→승리시 최소 카드 보상(선택/건너뛰기)→맵 복귀(HP/유물 반영)→보스까지 풀 런 플레이. 각 화면 전환의 undo/redo 확인
13. 데이터 세트 확장 — trigger/effect 테스트를 먼저 추가한 뒤 2차 카드와 나머지 적 채우기. `cards.js` 숫자 하나를 바꿔 재로드만으로 반영되는지 확인 (데이터/엔진 분리 검증)
14. (선택) 폴리싱 — 타겟팅 오버레이, 데미지 텍스트 애니메이션 등

## 검증 방법
- **엔진 레이어**: Node 18+에서 `node --test test/`로 `cardEngine`/`combatEngine`/`statusEngine`/`triggerEngine`/`enemyAI`/`mapEngine`/`historyEngine`에 대한 실제 ESM 유닛 테스트 실행 (`package.json`의 `type: module` 사용, npm install 불필요). 데미지·블록 공식, 상태이상/Power/temporaryEffects 트리거 순서, 드로우 리셔플, RNG 재현성, 다중 적 행동 중단, 적 스폰 시 인덱스/RNG 순서, 승패 판정 등 수치와 순서가 정확해야 하는 부분은 전부 여기서 검증.
- **History 검증**: 카드 플레이와 턴 종료의 undo→원본 상태 완전 일치, redo→결과 상태 완전 일치, RNG 포함 deep equality, undo 후 새 행동 시 redo 제거, 전투↔보상↔맵 및 GameOver/RunComplete 화면 경계 복원을 테스트. 스냅샷에 history/signals/DOM이 포함되지 않는지와 `cursor=-1` 경계도 검사.
- **UI 레이어**: 자동화 테스트 프레임워크는 두지 않음(빌드 없음 제약). 각 마일스톤마다 브라우저에서 수동 클릭 검증 + `window.__combatState`로 상태 직접 노출해서 devtools에서 수치 검산.
- **UI 실행**: `python -m http.server 8000` 후 `http://localhost:8000` 접속. `index.html`을 파일로 직접 여는 방식은 지원하지 않음.
- 최종적으로 맵 시작→카드 보상→보스 처치까지 풀 런 1회 수동 플레이

## 참고
- Slay the Spire 2는 Early Access 중이라 데이터와 밸런스가 변경될 수 있으므로, 이 플랜은 **Slay the Spire 1, Ascension 0의 현재 비업그레이드 카드와 기본 적 패턴**을 안정적인 기준으로 삼음. 적 HP처럼 범위가 있는 값도 seeded RNG로 결정하며, 각 데이터 정의에 검산 출처/메모를 남김. 배포 전에는 원작 카드명·문구·아트 등 지식재산 사용 범위를 별도로 검토함.
- 나중에 다른 기준 데이터를 적용할 때는 `data/cards.js`, `data/enemies.js`를 우선 교체하되, 새로운 effect/intent 종류가 생기면 엔진 확장이 필요할 수 있음. 데이터 교체만으로 항상 충분하다고 가정하지 않음.
