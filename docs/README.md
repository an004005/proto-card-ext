# 프로젝트 문서

`docs/`에는 현재 구현, 미구현 계획, 미확정 제안, 의사결정 이력을 서로 섞지 않고 보관한다.

## 현재 구현

1. [팀원을 위한 게임 소개](./team-game-guide.md)
2. [게임의 불변 핵심과 가변 요소](./game-core-and-variables.md)
3. [게임 개요](./game-overview.md)
4. [게임 규칙](./game-rules.md)
5. [전투 상세](./combat-reference.md)
6. [맵 구현 명세](./extraction-map-implementation-spec.md)
7. [용어](./terminology.md)
8. [장비 Capability 계약](./map-equipment-capability-mapping.md)
9. [카드·소모품·몬스터 맵 태그 계약](./card-map-tag-mapping.md)
10. [코드 추출 데이터 엑셀](./card-extraction-reference.xlsx)

현재 규칙과 콘텐츠의 최우선 근거는 `src/`와 `test/`다. 엑셀은 `npm run docs:reference`로 코드에서 생성한다.

## 개발용 도구

- 전투 화면의 `DEBUG 즉시 승리`(`DEBUG_WIN_COMBAT`)는 살아 있는 적을 전부 쓰러뜨린 것으로 치고 정상 승리 처리를 그대로 태운다 — 디버그 전용이며 게임 규칙이 아니다.

## 구현 전 정보

- [확정됐지만 미구현](./planned.md)
- [미확정 설계 백로그](./proposals/design-backlog.md)

## 의사결정 이력

- [ADR 상태표](./adr/README.md)

ADR은 결정 당시의 배경을 보존한다. 현재 동작이나 최신 수치는 현재 구현 문서와 코드를 따른다.

## 관리 원칙

- 현재 구현 문서에는 현재 동작만 기록한다.
- 오래된 수치와 설명은 삭제하고 삭선으로 보존하지 않는다.
- 코드 변경과 관련 문서·테스트·자동 생성 엑셀 갱신을 하나의 변경으로 처리한다.
