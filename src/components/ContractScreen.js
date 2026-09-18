import { html } from '../lib.js';
import { dispatch } from '../state/dispatch.js';
import { snapshotSignal } from '../state/runState.js';
import { SECTOR_NAMES, LANDMARKS_BY_SECTOR, RUN_COLLAPSE_TIME, RUN_SECTOR_COUNT } from '../data/facilityLayout.js';

const TYPE_LABEL = { retrieval: '회수', destroy: '파괴', intel: '정보' };
const TYPE_COMPLETION = {
  retrieval: '완료: 목표부에서 물건을 확보한 뒤 그걸 들고 탈출해야 한다',
  destroy: '완료: 목표부를 파괴하는 즉시 완료된다',
  intel: '완료: 목표부에서 데이터를 딴 뒤 이웃 구역 랜드마크에서 송출해야 한다',
};

// 구역 추첨은 제안 시점에 이미 돌았다(ADR-0089) — 그래서 계약을 고르는 일은 곧 이번 판의
// 시설을 고르는 일이고, 그 사실이 수락 **전에** 보여야 한다. 링 순서 그대로 네 이름을 잇고
// 마지막에 첫 구역을 괄호로 한 번 더 적어, 좌우 이웃이 어디인지(그리고 맞은편 하나는 이웃이
// 아니라는 것이) 줄 모양에서 바로 읽히게 한다.
function SectorRingLine({ sectorIds, objectiveSectorId }) {
  if (!sectorIds || sectorIds.length === 0) return null;
  // 링 정반대(가장 깊은 자리)는 언제나 중간 인덱스다 — 동력·정비동이 뽑혔으면 그것이, 아니면
  // 계약 목표 구역이 이 자리를 차지한다(selectRunSectorIds).
  const deepestIndex = Math.floor(RUN_SECTOR_COUNT / 2);
  return html`
    <div style=${{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style=${{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em' }}>이번 시설</span>
      <div style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px', fontSize: '11px' }}>
        ${sectorIds.map((sectorId, index) => {
          const isObjective = sectorId === objectiveSectorId;
          const tags = [];
          if (index === 0) tags.push('시작');
          if (isObjective) tags.push('목표');
          if (index === deepestIndex) tags.push('가장 깊음');
          return html`
            <span key=${sectorId} style=${{ display: 'inline-flex', alignItems: 'baseline', gap: '3px' }}>
              ${index > 0 ? html`<span style=${{ opacity: 0.45 }}>–</span>` : null}
              <span style=${{ fontWeight: isObjective ? 800 : 600, color: isObjective ? 'var(--color-accent-700)' : undefined }}>
                ${SECTOR_NAMES[sectorId]}
              </span>
              ${tags.length ? html`<span style=${{ fontSize: '10px', opacity: 0.75 }}>(${tags.join('·')})</span>` : null}
            </span>
          `;
        })}
        <span style=${{ opacity: 0.45 }}>– (${SECTOR_NAMES[sectorIds[0]]})</span>
      </div>
      <span style=${{ fontSize: '10px', opacity: 0.7 }}>줄에서 좌우로 맞닿은 구역이 이웃이고 맞은편 하나는 이웃이 아닙니다. 수락하면 이 네 구역으로 시설이 만들어집니다</span>
    </div>
  `;
}

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
        ${/* 계약 화면에서 미리 알아야 할 시간은 둘뿐이다 — 시설이 언제 무너지는가, 그리고
            목표를 집는 순간 무엇이 달라지는가. 봉쇄는 출구를 앞당겨 닫지 않는다(ADR-0083). */ null}
        <span style=${{ opacity: 0.7 }}>확보 즉시 봉쇄 — 위협 가속·증원 단축. 출구 폐쇄 시각은 그대로</span>
        <span style=${{ opacity: 0.7 }}>시설 붕괴 ${RUN_COLLAPSE_TIME}칸</span>
      </div>
      <${SectorRingLine} sectorIds=${contract.sectorIds} objectiveSectorId=${contract.sectorId} />
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
