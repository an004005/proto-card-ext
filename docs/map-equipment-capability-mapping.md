# 장비 Capability 계약

장비별 실제 값은 `src/data/facilityEquipmentCapabilities.js`가 유일한 원본이며 자동 생성 엑셀의 `무기`, `방어구`, `모듈`, `임플란트` 시트에 함께 출력된다.

## Capability

`perception`, `stealth`, `hacking`, `mobility`, `force`, `deception` 여섯 값을 장착 장비에서 합산하고 각각 -2~4로 제한한다. 값이 없는 장비도 빈 계약을 명시해 모든 장비 ID가 정확히 한 번 대응되도록 한다.

## 능동 현장 효과

| 종류 | 제공 장비 | 대상 | 현재 규칙 |
|---|---|---|---|
| `temporary_barrier` | 역장 강화 | 인접 엣지 | 시간 5칸, 과부화 10, 지속 10칸, 재사용 15칸 |
| `snapshot_scan` | 공간 지각 | 2홉 노드 정보 | 시간 5칸, 과부화 8, 재사용 15칸 |
| `remote_intrusion` | 전자기 간섭 | 2홉 전자 장치 | 시간 5칸, 과부화 12, 지속 10칸, 재사용 15칸 |

능동 효과는 장비 정의 ID가 아니라 장착 인스턴스 ID별로 재사용 대기시간을 저장한다. 일반 안전·신속·강행 접근 보정은 능동 현장 효과에 적용하지 않는다. 장비가 가진 고정 지속은 Capability 층계의 지속 고정표를 타지 않고 위 칸 수 그대로다.

## 동기화

- 장비를 추가하거나 삭제할 때 장비 정의와 Capability 계약을 같은 변경에서 수정한다.
- `npm run docs:reference`를 실행해 엑셀을 갱신한다.
- `test/capabilityEngine.test.js`와 관련 장비 테스트를 실행한다.
