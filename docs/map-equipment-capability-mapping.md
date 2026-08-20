# 장비 Capability 매핑

기존 장비를 연구소 맵의 Capability 및 능동 현장 효과에 연결하는 확정 데이터 계약이다. `equipmentId`는 현재 `src/data/equipment.js`, `modules.js`, `implants.js`의 ID와 정확히 일치해야 한다. 표에 없는 장비는 Capability와 능동 현장 효과가 없으며, 새 ID를 추가할 때는 코드와 이 표를 같은 변경에서 갱신한다.

| equipmentId | 장비 | Capability | 능동 현장 효과 | 능동 효과 계약 |
|---|---|---|---|---|
| `katana` | 카타나 | Force +1, Stealth +1 | 없음 | — |
| `rifle` | 라이플 | 없음 | 없음 | — |
| `dagger` | 단검 | 없음 | 없음 | — |
| `pistol` | 권총 | 없음 | 없음 | — |
| `heavy_top` | 중갑상의 | Force +1, Stealth -1 | 없음 | — |
| `light_top` | 경갑상의 | Stealth +1 | 없음 | — |
| `tactical_bottom` | 전술하의 | Mobility +1, Deception +1 | 없음 | — |
| `heavy_bottom` | 중장하의 | Force +1, Mobility -1 | 없음 | — |
| `module_neural` | 신경 강화 | 없음 | 없음 | — |
| `module_body` | 신체 강화 | Force +1, Mobility +1, Deception -1 | 없음 | — |
| `module_forcefield` | 역장 강화 | Hacking -1 | 임시 장벽: 인접 엣지 하나의 적 이동만 차단, 플레이어는 통과 가능 | 시간 100, Overload +10, 완료부터 cooldown 300; 200 지속, 만료/제거 때 적 재탐색 |
| `module_spatial` | 공간 지각 | Perception +2 | 집중 투시: 현재 노드에서 2홉 이내 적·기회·장치의 완료 시점 스냅샷 공개 | 시간 100, Overload +8, 완료부터 cooldown 300; `observedAt`을 기록하며 실시간 추적 아님 |
| `module_emp` | 전자기 간섭 | Hacking +2, Deception +1, Perception -1 | 원격 침투: 2홉 내 카메라·터렛·통신 장치 하나 조작 | 시간 100, Overload +12, 완료부터 cooldown 300; 장치 비활성 200 또는 지속 200의 통신 가짜 목표 1개 |
| `implant1` | 체력 보강 | 없음 | 없음 | — |
| `implant2` | 위협 감지 | Perception +1 | 없음 | — |
| `implant3` | 수납 확장 | 없음 | 없음 | — |
| `implant4` | 반응 가속 | Mobility +1 | 없음 | — |
| `implant5` | 열 차단 | 없음 | 없음 | — |
| `implant6` | 산개 방출 | 없음 | 없음 | — |

Capability는 장착 정의에서 합산한 뒤 -2~4로 clamp한다. 능동 현장 효과는 장착된 장비 인스턴스의 `instanceId`로 사용하고, `fieldCooldowns[instanceId] = readyAt`을 저장한다. 능동 효과에는 안전·신속·강행 접근 모드를 적용하지 않으며 표의 시간·Overload·지속시간이 최종값이다. 열 차단의 multiplier는 최종 Overload 증가량에 별도로 적용한다.

```ts
type MapEquipmentContract = {
  capabilityModifiers: Partial<Record<
    'perception' | 'stealth' | 'hacking' | 'mobility' | 'force' | 'deception',
    number
  >>;
  fieldAction: null | {
    kind: 'temporary_barrier' | 'snapshot_scan' | 'remote_intrusion';
    timeCost: number;
    overloadGain: number;
    cooldown: number;
    duration: number | null;
    range: 1 | 2;
    targetKind: 'edge' | 'node_contents' | 'electronic_device';
  };
};
```

`없음`은 빈 `capabilityModifiers` 또는 `fieldAction: null`로 직렬화한다. 데이터 로드 시 코드의 모든 장비 ID가 이 계약에 정확히 한 번 존재하는지 검증한다.
