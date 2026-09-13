import { html } from '../lib.js';
import { WEAPON_DEFINITIONS, ARMOR_TOP_DEFINITIONS, ARMOR_BOTTOM_DEFINITIONS } from '../data/equipment.js';
import { MODULE_DEFINITIONS } from '../data/modules.js';
import { IMPLANT_DEFINITIONS } from '../data/implants.js';
import { CONSUMABLE_DEFINITIONS } from '../data/consumables.js';
import { describeItem, describeImplantCost } from '../data/itemDisplay.js';
import { describeCapabilityModifiers } from '../data/capabilityDisplay.js';
import { EquipmentTooltipContent } from './EquipmentTooltipContent.js';

const EQUIPMENT_DEFS = { ...WEAPON_DEFINITIONS, ...ARMOR_TOP_DEFINITIONS, ...ARMOR_BOTTOM_DEFINITIONS, ...MODULE_DEFINITIONS, ...IMPLANT_DEFINITIONS };

/** 인벤토리/창고 아이템 카드의 툴팁 콘텐츠 — "각 장비의 설명"이 그대로 보이도록 장비는
 * EquipmentTooltipContent(카드 목록), 그 외는 짧은 설명 텍스트를 보여준다. */
export function ItemTooltipContent({ item }) {
  const info = describeItem(item);
  if (item.kind === 'equipment') {
    const def = EQUIPMENT_DEFS[item.equipmentId];
    const durabilityLine = item.durability !== undefined ? html`<div style=${{ fontSize: '10px', opacity: 0.7, marginTop: '4px' }}>${info.sub}</div>` : null;
    const capLine = describeCapabilityModifiers(item.equipmentId);
    const capNote = capLine ? html`<div style=${{ fontSize: '10px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-neutral-700)', opacity: 0.9 }}>${capLine}</div>` : null;
    const costLine = describeImplantCost(item.equipmentId);
    const costNote = costLine ? html`<div style=${{ fontSize: '10px', marginTop: '6px', color: 'var(--color-negative, #dc2626)', fontWeight: 700 }}>${costLine}</div>` : null;
    if (def?.cardList) return html`<div><${EquipmentTooltipContent} name=${def.name} cardList=${def.cardList} />${durabilityLine}${costNote}${capNote}</div>`;
    return html`<div style=${{ width: '220px' }}><div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>${info.name}</div><div style=${{ fontSize: '11px', opacity: 0.85 }}>${def?.description || '패시브 장비 — 장착 시 효과 적용'}</div>${durabilityLine}${costNote}${capNote}</div>`;
  }
  if (item.kind === 'consumable') {
    const def = CONSUMABLE_DEFINITIONS[item.defId];
    return html`<div style=${{ width: '220px' }}><div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>${info.name}</div><div style=${{ fontSize: '11px', opacity: 0.85 }}>${def?.description}</div></div>`;
  }
  const genericText = {
    junk: '판매 전용 잡동사니. 과적(짐) 상태일 때만 카드로 내서 영구 소멸시킬 수 있다.',
    currency: '고가치 환금템. 잡템과 동일한 과적 규칙을 따른다.',
    ammo: '원거리 카드의 탄약 코스트에 소모된다. 과적 시 짐 카드로 전환.',
  }[item.kind];
  return html`<div style=${{ width: '220px' }}><div style=${{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>${info.name}</div><div style=${{ fontSize: '11px', opacity: 0.85 }}>${info.sub}${genericText ? ` — ${genericText}` : ''}</div></div>`;
}
