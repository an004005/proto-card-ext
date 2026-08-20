# 기존 카드의 맵 태그 매핑

이 표는 `src/data/cards.js`의 V1 카드 정의에 추가할 `mapTags`의 기준값이다. 소음은 카드를 사용할 때 현재 전투 노드에 발생한다. 전투의 플레이어 턴은 60포인트이며, 카드 여러 장을 사용해도 시간은 턴 종료에 한 번만 진행한다.

| defId | 소음 | traits | 이탈 진행도 | 근거 |
|---|---:|---|---:|---|
| katana_slash | 1 | melee | 0 | 일반 근접 공격 |
| katana_parry | 0 | — | 0 | 방어 |
| rifle_aim | 2 | firearm | 0 | 기존 총기 카드 |
| rifle_suppress | 2 | firearm | 0 | 원거리 광역 제압, 폭발 아님 |
| rifle_buttstock | 1 | melee | 0 | 일반 근접 타격 |
| dagger_weak_slash | 0 | melee, assassination | 0 | 저소음 단검 |
| dagger_stab | 0 | melee, assassination | 0 | 저소음 단검 기습; Overload는 기존 +5 유지 |
| pistol_shot | 1 | firearm | 0 | 저위력 총기 |
| reload | 1 | firearm | 0 | 탄창 교체의 근거리 기계음; 라이플·권총이 공유하는 정의 |
| heavy_top_dodge | 0 | — | 0 | 방어 |
| heavy_top_block | 0 | — | 0 | 방어 |
| heavy_top_curse | 0 | — | 0 | 상태 카드 |
| light_top_dodge | 0 | — | 0 | 방어 |
| light_top_deflect | 0 | — | 0 | 방어 |
| tactical_bottom_feint | 0 | deception | 1 | 기만으로 이탈 창구 생성 |
| tactical_bottom_dash | 0 | escape | 1 | 거리 이탈 |
| tactical_bottom_dodge | 0 | — | 0 | 방어 |
| heavy_bottom_support | 0 | — | 0 | 방어 |
| heavy_bottom_shove | 1 | melee, escape | 1 | 밀쳐 이탈 창구 생성 |
| heavy_bottom_curse | 0 | — | 0 | 상태 카드 |
| sticky_curse | 0 | — | 0 | 사용해 소진하는 상태 카드 |
| equipment_damaged_curse | 0 | — | 0 | 사용해 소진하는 상태 카드 |
| module_neural_boost | 0 | electronic | 0 | 조용한 신경 가속 |
| module_body_boost | 0 | — | 0 | 파워 활성화 |
| module_charge_slash | 2 | melee, escape | 1 | 강한 돌진 공격 |
| module_forcefield_defense | 0 | — | 0 | 방어장 |
| module_forcefield_blast | 3 | explosive | 0 | 광역 방출 |
| module_spatial_awareness | 0 | — | 0 | 감지 강화 |
| module_xray_vision | 0 | perception, electronic | 0 | 분석/투시 |
| module_hack | 0 | hack | 1 | 기계 적 교란, 이탈 창구 |
| bare_hands_attack | 1 | melee | 0 | 일반 근접 |
| clumsy_dodge | 0 | — | 0 | 방어 |

`junk_item`, `currency_item`, `equipment_item`, `ammo_item`, `consumable_item`, `infected_curse`, `wound_curse`, `dizziness_curse`, `mucus_curse`, `offering_curse`는 실행 불가이므로 `mapTags` 검증 대상에서 제외한다. 실행 가능한 저주 카드는 위 표처럼 소음 0의 `mapTags`를 명시한다. 실제 사용 가능한 소모품은 카드와 같은 구조를 각 정의에 직접 가진다.

| consumableId | 소음 | traits | 이탈 진행도 |
|---|---:|---|---:|
| `grenade` | 3 | explosive | 0 |
| `flashbang` | 2 | escape | 1 |
| `bandage` | 0 | healing | 0 |
| `stabilizer` | 0 | stabilize | 0 |

```ts
mapTags: {
  noise: 0 | 1 | 2 | 3,
  traits: Array<'explosive' | 'escape' | 'healing' | 'stabilize'>,
  disengageProgress: 0 | 1,
}
```

## 몬스터 행동 소음 매핑

`src/data/monsters.js`의 모든 move는 아래 `monsterId + moveId` 조합으로 `mapNoise`를 가진다. 피해가 없는 강화·저주·소환은 0, 물리 타격과 낮은 투사체는 1, 저격·에너지 방출·강한 포효는 2다. 현재 로스터에는 소음 3에 해당하는 폭발 행동이 없다.

| monsterId | moveId별 mapNoise |
|---|---|
| `nibbit` | `headbutt:1`, `slice:1`, `hiss:0` |
| `shrinker_beetle` | `weaken:0`, `bite:1`, `stomp:1` |
| `inklet` | `jab:1`, `snipe:2`, `whirl:1` |
| `vine_shambler` | `push:1`, `wrap:1`, `bite:1` |
| `mawler` | `rip:1`, `rampage:1`, `roar:0`, `rip2:1` |
| `fogmog` | `spore_summon:0`, `slap:1`, `headbutt2:1` |
| `snapping_jaxfruit` | `energy_orb:2` |
| `slithering_strangler` | `constrict_grip:1`, `coil:1`, `bite2:1` |
| `cubex_construct` | `charge:0`, `burst1:2`, `burst2:2`, `release:2` |
| `flyconid` | `wither_spore:1`, `slap3:1`, `vulnerable_spore:1` |
| `fuzzy_wurm_crawler` | `acid:1`, `drain:0`, `acid2:1` |
| `leaf_slime_m` | `goo:0`, `thorn:1` |
| `twig_slime_m` | `goo2:0`, `pounce:1`, `goo3:0` |
| `bygone_effigy` | `sleep:0`, `awaken:0`, `slash:1`, `sleep2:0`, `slash2:1` |
| `byrdonis` | `strike:1`, `peck:1` |
| `phrog_parasite` | `infect:0`, `smash3:1` |
| `ceremonial_beast` | `stomp_charge:1`, `dig:1`, `dig2:1`, `stun_self:0`, `roar2:2`, `stomp2:1`, `crush:1` |
| `kin_follower` | `quickstrike:1`, `boomerang:1`, `power_dance:0` |
| `kin_priest` | `frailty_orb:2`, `weakness_orb:2`, `soul_beam:2`, `dark_ritual:0` |
| `vantom` | `ink_throw:1`, `ink_spear:1`, `dismember:1`, `prepare:0` |
| `sawtooth_eye` | `dizzy_spores:1` |

## 구현 규칙

```ts
mapTags: {
  noise: 0 | 1 | 2 | 3,
  traits: Array<'assassination' | 'melee' | 'firearm' | 'explosive' | 'hack' | 'deception' | 'escape' | 'perception' | 'electronic' | 'healing' | 'stabilize'>,
  disengageProgress: 0 | 1,
}
```

- `src/data/cards.js`의 실행 가능한 카드 ID와 위 표는 양방향으로 일치해야 한다. 카드 추가·삭제 시 이 표와 데이터 검증을 같은 변경에서 갱신한다.
- 표의 traits `—`는 빈 배열 `[]`로 직렬화한다.
- Overload는 `mapTags`가 아니라 기존 카드의 `overloadGain`이 단일 권위다.
- `disengageProgress`는 `BEGIN_DISENGAGE` 뒤 `escapeIntent`가 켜진 전투에서만 누적한다. 이탈 완료·intent 해제·전투 종료 후 0으로 초기화한다.
- 소모품 사용도 카드와 같은 전투 라운드 소음 봉투·이탈 intent 규칙을 거치며, reducer는 효과 적용·아이템 소진·맵 태그 처리를 하나의 원자적 전이로 수행한다.
- `assassination`은 맵에서 기습을 열지 않는다. 기습은 은신 여유가 결정하고, 이 태그는 기습 전투에서 조용한 처치 선택을 강화하는 콘텐츠 훅이다.
- 적 행동도 같은 소음 기준을 사용한다. 몬스터 move에는 `mapNoise: 0 | 1 | 2 | 3`을 직접 명시하며 미지정 기본값은 두지 않는다. 이 필드는 맵 소음 전용이며, 피해 보정에 쓰는 기존 `attackKind: 'melee' | 'ranged' | null`을 대체하거나 재사용하지 않는다.
- 카드별 소음은 기록용이며, AI와 구역 경계도에는 전투 노드·라운드당 최대 소음 하나만 전달한다.
