# 카드·소모품·몬스터 맵 태그 계약

ID별 실제 값은 `src/data/cards.js`, `src/data/consumables.js`, `src/data/monsters.js`가 원본이며 자동 생성 엑셀의 `카드 일람`과 `몬스터 행동` 시트에 출력된다.

## 카드와 소모품

실행 가능한 카드와 모든 소모품은 다음 구조를 가진다.

```js
mapTags: {
  noise: 0 | 1 | 2 | 3,
  traits: string[],
  disengageProgress: 0 | 1,
}
```

- 소음 0은 무음, 1~3은 각각 맵에서 1~3홉에 전달된다.
- 이탈 진행도는 이탈 의도가 활성화된 전투에서만 누적된다.
- `traits` 중 현재 코드가 실제로 읽는 것은 `'healing'` 하나뿐이다(맵에서의 무료 회복 소모품 판정). `deception`·`hack`·`perception`을 비롯한 나머지 태그는 **현재 소비처가 없다** — 분류용 메타데이터로만 남아 있으며, 어떤 규칙도 이 값을 보지 않는다. 맵의 기만·해킹·정찰 행동은 카드 태그가 아니라 장비 Capability(`facilityEquipmentCapabilities.js`)가 정한다.
- 카드별 소음은 기록하되 맵에는 전투 노드·라운드별 최대 소음 하나만 전달한다.
- 실행 불가 짐 카드·상태이상 카드 정의는 `mapTags`를 생략할 수 있다.

## 몬스터 행동

모든 고정 행동과 무작위 분기의 실제 행동은 `mapNoise: 0 | 1 | 2 | 3`을 직접 정의한다. 이 값은 맵 소음 전용이며 피해 계산의 `attackKind`와 별개다.

## 동기화

- 카드, 소모품, 몬스터 행동을 추가하거나 삭제할 때 태그를 같은 변경에서 정의한다.
- `npm run docs:reference`로 엑셀을 갱신한다.
- `test/mapTagsValidation.test.js`가 누락과 허용 범위를 검증한다.
