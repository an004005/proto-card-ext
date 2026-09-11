import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { SECTOR_NAMES, LANDMARKS_BY_SECTOR } from '../data/facilityLayout.js';

const TYPE_LABEL = { retrieval: '회수', destroy: '파괴', intel: '정보' };
const TYPE_COMPLETION = {
  retrieval: '완료: 목표부에서 물건을 확보한 뒤 그걸 들고 탈출해야 한다',
  destroy: '완료: 목표부를 파괴하는 즉시 완료된다',
  intel: '완료: 목표부에서 데이터를 딴 뒤 아무 랜드마크에서나 송출해야 한다',
};

function ContractCard({ contract }) {
  const landmark = LANDMARKS_BY_SECTOR[contract.sectorId];
  return html`
    <div style=${{
      border: '2px solid var(--color-divider)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column',
      gap: 'var(--space-2)', background: 'var(--color-surface)', width: '260px',
    }}>
      <span style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>
        ${TYPE_LABEL[contract.type]} 계약
      </span>
      <h3 style=${{ margin: 0 }}>${contract.name}</h3>
      <div style=${{ fontSize: '12px', opacity: 0.8 }}>${SECTOR_NAMES[contract.sectorId]} · ${landmark.name}</div>
      <p style=${{ fontSize: '12px', margin: 0 }}>${contract.flavor}</p>
      <div style=${{ fontSize: '11px', borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span>선불: 재화 ${contract.prepaymentCurrency}cr + 목표부 위치 사전 공개</span>
        ${contract.type === 'retrieval'
          ? html`<span>회수품: ${contract.goodsSlots}칸 · 칸당 ${contract.goodsValuePerSlot}cr</span>`
          : html`<span>완료 보상: +${contract.completionRewardValue}cr</span>`}
        <span>위약(미완수 시): -${contract.penaltyValue}cr</span>
        <span style=${{ opacity: 0.7 }}>${TYPE_COMPLETION[contract.type]}</span>
      </div>
      <button
        class="btn btn-primary"
        style=${{ marginTop: 'var(--space-2)' }}
        onClick=${() => dispatch({ type: 'ACCEPT_CONTRACT', contractId: contract.id })}
      >이 계약 수락</button>
    </div>
  `;
}

// 창고 진입 전 계약 선택(D3) — 유형별로 하나씩 3장이 제안되고, 하나를 고르면 즉시 선불이
// 지급되고 로드아웃(창고) 화면으로 넘어간다. 완료하지 못한 채 탈출해도 생존은 그대로 성공
// 처리되지만(불변 핵심 6번), 위약을 치른다 — 그 대가는 결과 화면에서 회수 점수로 표시된다.
export function ContractScreen() {
  const offered = snapshotSignal.value.offeredContracts || [];
  return html`
    <div style=${{ padding: 'var(--space-6) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style=${{ borderBottom: '2px solid var(--color-divider)', paddingBottom: 'var(--space-3)' }}>
        <h2 style=${{ margin: 0 }}>계약 — 출격 전 브리핑</h2>
        <span style=${{ fontSize: '11px', opacity: 0.7 }}>셋 중 하나를 수락한다. 완수하지 못한 채 탈출해도 생존은 그대로 성공이지만, 위약을 치른다.</span>
      </div>
      <div style=${{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        ${offered.map((contract) => html`<${ContractCard} key=${contract.id} contract=${contract} />`)}
      </div>
    </div>
  `;
}
