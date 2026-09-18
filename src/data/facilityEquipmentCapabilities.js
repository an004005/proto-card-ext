// Capability + active field-effect contract per equipped item (docs/map-equipment-capability-mapping.md).
// equipmentId must match src/data/equipment.js / modules.js / implants.js exactly — this is the
// single authority for map Capability values; combat card stats are untouched by this file.

import { CAMERA_SNIPE_TIME, CAMERA_SNIPE_RANGE } from './facilityLayout.js';

/**
 * @typedef {Object} MapEquipmentContract
 * @property {Partial<Record<'perception'|'stealth'|'hacking'|'mobility'|'force'|'deception', number>>} capabilityModifiers
 * @property {null | {
 *   kind: 'temporary_barrier'|'snapshot_scan'|'remote_intrusion'|'camera_snipe',
 *   timeCost: number, cooldown: number, duration: number|null,
 *   range: 1|2, targetKind: 'edge'|'node_contents'|'electronic_device',
 *   deviceKinds?: ('camera'|'accessInterface')[],
 * }} fieldAction 전자 장치를 겨냥하는 행동은 `deviceKinds`로 어떤 장치를 고를 수 있는지 좁힌다 —
 *   비워 두면 전자 장치 전부가 후보다.
 * @property {boolean} [mapInfoEffect] 이 장비의 효과가 맵 정보 자체를 주는가(랜드마크 화살표 등).
 *   Capability 수치로도 fieldAction으로도 표현되지 않지만 경로의 대가를 줄여주는 침투 수단이므로,
 *   역할축 판정(engine/fieldLoot.js axisOfEquipment)이 fieldAction과 같은 자리에서 이 값을 읽는다.
 */

/** @type {Object.<string, MapEquipmentContract>} */
export const MAP_EQUIPMENT_CAPABILITIES = {
  // C4: 무상 보너스 금지 — 칼은 문을 부수는 연장이지 몸을 숨겨주지 않는다.
  katana: { capabilityModifiers: { force: 1 }, fieldAction: null },
  rifle: { capabilityModifiers: {}, fieldAction: null },
  dagger: { capabilityModifiers: {}, fieldAction: null },
  pistol: { capabilityModifiers: {}, fieldAction: null },
  auto_pistol: { capabilityModifiers: {}, fieldAction: null },
  revolver: { capabilityModifiers: {}, fieldAction: null },
  shotgun: { capabilityModifiers: { force: 1, stealth: -1 }, fieldAction: null },
  rocket_launcher: { capabilityModifiers: { force: 1, stealth: -1 }, fieldAction: null },
  // 카메라 저격 — 사거리 안의 카메라를 영구 파괴한다. 통화는 Perception(조준)이고 시간만
  // 받는다. 총성은 쏜 자리에서 나고 파편(강한 흔적)은 카메라 자리에 남는다.
  sniper_rifle: {
    capabilityModifiers: { perception: 1, mobility: -1 },
    fieldAction: {
      kind: 'camera_snipe', timeCost: CAMERA_SNIPE_TIME, cooldown: 20, duration: null,
      range: CAMERA_SNIPE_RANGE, targetKind: 'electronic_device', deviceKinds: ['camera'],
    },
  },
  heavy_top: { capabilityModifiers: { force: 1, stealth: -1 }, fieldAction: null },
  light_top: { capabilityModifiers: { stealth: 1 }, fieldAction: null },
  // C4: 기동만 준다 — 기만까지 얹으면 대가 없이 두 축을 가져가는 지배 선택이 된다.
  tactical_bottom: { capabilityModifiers: { mobility: 1 }, fieldAction: null },
  heavy_bottom: { capabilityModifiers: { force: 1, mobility: -1 }, fieldAction: null },
  module_neural: { capabilityModifiers: {}, fieldAction: null },
  module_body: { capabilityModifiers: { force: 1, mobility: 1, deception: -1 }, fieldAction: null },
  module_forcefield: {
    capabilityModifiers: { hacking: -1 },
    fieldAction: {
      kind: 'temporary_barrier', timeCost: 5, cooldown: 20, duration: 10, range: 1, targetKind: 'edge',
    },
  },
  module_spatial: {
    capabilityModifiers: { perception: 2 },
    fieldAction: {
      kind: 'snapshot_scan', timeCost: 5, cooldown: 20, duration: null, range: 2, targetKind: 'node_contents',
    },
  },
  module_emp: {
    capabilityModifiers: { hacking: 2, deception: 1, perception: -1 },
    fieldAction: {
      kind: 'remote_intrusion', timeCost: 5, cooldown: 20, duration: 10, range: 2, targetKind: 'electronic_device',
    },
  },
  // C4: 가속에는 소리가 따른다 — 기동 +2의 대가로 은신 -1.
  module_sandevistan: { capabilityModifiers: { mobility: 2, stealth: -1 }, fieldAction: null },
  module_mantis_blades: { capabilityModifiers: { force: 2, mobility: 1, stealth: -1 }, fieldAction: null },
  implant1: { capabilityModifiers: {}, fieldAction: null },
  implant2: { capabilityModifiers: { perception: 1 }, fieldAction: null },
  implant3: { capabilityModifiers: {}, fieldAction: null },
  implant4: { capabilityModifiers: { mobility: 1 }, fieldAction: null },
  implant6: { capabilityModifiers: {}, fieldAction: null },
  // ⑦ 지도는 Capability 수치도 현장 행동도 주지 않는다 — 효과가 랜드마크 화살표라 그 두 칸에
  // 담기지 않는다. 그래도 길을 줄여주는 침투 수단이므로 mapInfoEffect로 그 사실을 이 표 안에서
  // 밝힌다. 예외 목록을 fieldLoot.js에 따로 두면 축 분류의 진실이 두 군데가 된다(리뷰 A8).
  implant7: { capabilityModifiers: {}, fieldAction: null, mapInfoEffect: true },
};

export const CAPABILITY_MIN = -2;
export const CAPABILITY_MAX = 4;
