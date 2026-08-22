// 시설맵 Capability(6종) 표시용 공용 라벨/설명 — 순수 집계 로직(capabilityEngine.js)과 분리해
// 두어, 맵 화면 밖(창고/인벤토리)에서도 맵 코드를 끌어오지 않고 같은 문구를 쓸 수 있게 한다.
import { MAP_EQUIPMENT_CAPABILITIES } from './facilityEquipmentCapabilities.js';

export const CAPABILITY_ORDER = ['perception', 'stealth', 'hacking', 'mobility', 'force', 'deception'];
export const CAPABILITY_LABELS = { perception: 'Perception', stealth: 'Stealth', hacking: 'Hacking', mobility: 'Mobility', force: 'Force', deception: 'Deception' };
export const CAPABILITY_SHORT = { perception: 'P', stealth: 'S', hacking: 'H', mobility: 'M', force: 'F', deception: 'D' };
export const CAPABILITY_ROLE = {
  perception: '주변 정보 파악(정찰 해상도).',
  stealth: '은신/소음 억제.',
  hacking: '전자 장치·탈출구 제어.',
  mobility: '이동·회피.',
  force: '물리적 장애물 돌파.',
  deception: '기만·위장.',
};

/** 이 장비를 장착하면 적용되는 시설맵 Capability 보정치를 문장으로 — 보정치가 없으면 null. */
export function describeCapabilityModifiers(equipmentId) {
  const contract = equipmentId ? MAP_EQUIPMENT_CAPABILITIES[equipmentId] : null;
  if (!contract) return null;
  const parts = CAPABILITY_ORDER
    .filter((key) => contract.capabilityModifiers[key])
    .map((key) => `${CAPABILITY_LABELS[key]} ${contract.capabilityModifiers[key] > 0 ? '+' : ''}${contract.capabilityModifiers[key]}`);
  if (parts.length === 0) return null;
  return `시설맵 Capability: ${parts.join(', ')}`;
}
