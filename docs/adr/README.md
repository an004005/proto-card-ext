# 맵 재구축 ADR 상태표

이 디렉터리는 결정의 이력을 보존한다. 과거 수치를 기록한 ADR을 삭제하거나 본문을 현재 값으로 다시 쓰지 않는다. 대신 문서 상단의 `status`로 현재 적용 여부를 표시한다.

## 상태 규칙

- `status` 없음: active. 후속 문서와 충돌하지 않는 결정 원칙을 적용한다.
- `status: amended by ...`: 결정의 방향은 유지하지만 표시된 후속 문서가 범위나 수치를 수정했다. 구현에는 후속 문서를 사용한다.
- `status: superseded by ...`: 현재 구현에는 적용하지 않고 결정 이력으로만 남긴다.

현재 구현 계약의 권위는 [구현 명세](../extraction-map-implementation-spec.md)에 있다. 장비·카드 ID별 값은 [장비 매핑](../map-equipment-capability-mapping.md)과 [카드 매핑](../card-map-tag-mapping.md), 용어 의미는 [용어집](../../CONTEXT.md)이 보조한다. active ADR도 이 문서들과 충돌하면 직접 구현 근거로 사용하지 않는다.

## 비활성·수정 ADR

| ADR | 상태 | 현재 참조 |
|---|---|---|
| 0001 숨은 탈출 지점 | superseded | ADR-0025 |
| 0002 재방문과 이동 시간 1 | amended | ADR-0068, 구현 명세 §6.2 |
| 0003 기본 행동 10·매 틱 적 이동 | amended | ADR-0068, 구현 명세 §5, §9 |
| 0005 확률 은신 판정 | superseded | ADR-0063 |
| 0008 기본 비용 10·신속 -1 | amended | ADR-0068, 구현 명세 §6 |
| 0010 다섯 맵 행동 | amended | 구현 명세 §6, §11.2 |
| 0011 위험 정보 행동 | amended | ADR-0040의 결정론적 대가 |
| 0012 장비 스왑 5 | amended | 구현 명세 §6.2의 50 |
| 0013 모든 장비 Capability | amended | ADR-0043의 Capability 없는 장비 허용 |
| 0014 Capability 0~4 | superseded | ADR-0052의 -2~4 |
| 0017 모든 월드 상태 영구 | amended | ADR-0056, 구현 명세 §6.3의 일시 전자 무력화 |
| 0021 증원 20 | amended | 구현 명세 §9.1의 120/60 |
| 0022 Perception 0~4 | amended | ADR-0052의 음수 단계 추가 |
| 0023 Perception 0~4 | amended | ADR-0052의 음수 단계 추가 |
| 0026 탈출 요청 10·대기 30 | superseded/amended | ADR-0054, ADR-0068, 구현 명세 §2 |
| 0027 32노드 | superseded | ADR-0054의 48노드 |
| 0029 장비 스왑 5 | amended | 구현 명세 §6.2의 50 |
| 0032 경로 단절 허용 | amended | ADR-0070의 장비 독립 비상 복구 |
| 0034 순찰 이동 10 | amended | ADR-0068의 100 |
| 0037 카드별 전투 소음 사건 | amended | 구현 명세 §7.1의 라운드 소음 봉투 |
| 0038 일반 소음 지속 10 | amended | ADR-0068, 구현 명세 §7.1의 100 |
| 0039 조용한 해킹 소음 1 | amended | ADR-0056, 구현 명세 §6의 소음 0 |
| 0041 모든 상호작용 공통 접근 모드 | amended | 구현 명세 §6.1의 템플릿별 지원 모드 |
| 0042 모든 장비 Capability | superseded | ADR-0043 |
| 0044 Capability 0~4 clamp | amended | ADR-0052의 -2~4 |
| 0048 일반 이동 10·소음 0 | superseded | ADR-0049 |
| 0049 이동 시간 6~14 | amended | ADR-0068의 60~140 |
| 0050 Mobility·Stealth만 음수 | amended | ADR-0052, ADR-0068 |
| 0051 Capability 0~4 | amended | ADR-0052 |
| 0054 노드 거리·대기 10~30 | amended | ADR-0068, 구현 명세 §2의 가중 시간 거리·100~300 |
| 0055 정찰 10/20/30 | amended | ADR-0068, 구현 명세 §6.2의 80/140/200 |
| 0059 매 틱 위협 한 칸 이동 | amended | ADR-0068, 구현 명세 §5의 `nextMoveAt` |
| 0060 카드별 소음 사건 | amended | 구현 명세 §7.1의 라운드 소음 봉투 |
| 0061 접근 시간 ±10 | amended | ADR-0068, 구현 명세 §6.1의 ±40 |
| 0062 Capability 시간 10~40 | superseded | ADR-0068, 구현 명세 §6 |

새 ADR이 기존 결정을 바꾸면 새 ADR 본문에 대상을 적고, 같은 변경에서 이전 ADR의 `status`와 이 표를 함께 갱신한다.
