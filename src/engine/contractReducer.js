// 계약 선택/수락 커맨드(§3단계, D3). 로드아웃 화면 진입 전 'contract' 화면에서만 산다 —
// 수락 이후의 진행 상태는 confirmLoadout이 facilityRunState.contract로 옮기고 나면
// runEngine.js의 완료 액션들(facilityReducer.js 경유)이 다룬다.
import { pick } from './rng.js';
import { CONTRACT_DEFS } from '../data/contracts.js';
import { addItem, createItem } from './inventoryEngine.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * 유형별로 하나씩, 정확히 3개를 뽑는다. 순수 함수 — rngState를 명시적으로 스레딩한다.
 * @param {import('./rng.js').RngState} rngState
 * @returns {{contracts: import('../data/contracts.js').ContractDef[], rngState: import('./rng.js').RngState}}
 */
export function offerContracts(rngState) {
  let state = rngState;
  const contracts = [];
  for (const type of /** @type {const} */ (['retrieval', 'destroy', 'intel'])) {
    const pool = CONTRACT_DEFS.filter((c) => c.type === type);
    const { value, state: next } = pick(state, pool);
    state = next;
    contracts.push(value);
  }
  return { contracts, rngState: state };
}

/**
 * 결과 화면(ExtractionCompleteScreen/GameOverScreen)이 계약 완료/미완수를 표시하기 위한 요약.
 * 저장하지 않는다 — computeInventoryScore와 같은 위상의 화면 표시 전용 값이다.
 * @param {import('./types.js').FacilityRunState | null | undefined} facilityRunState
 * @returns {{contract: import('./types.js').ContractRuntimeState, completed: boolean, scoreDelta: number} | null}
 */
export function computeContractOutcome(facilityRunState) {
  const contract = facilityRunState?.contract;
  if (!contract) return null;
  const completed = contract.status === 'completed';
  const scoreDelta = completed ? (contract.completionRewardValue || 0) : -contract.penaltyValue;
  return { contract, completed, scoreDelta };
}

/**
 * 계약 3장 중 하나를 수락한다 — 선불(재화)을 즉시 지급하고 로드아웃 화면으로 넘어간다. 사전
 * 정보(목표부 위치 공개)는 여기서가 아니라 confirmLoadout이 createRunState를 부를 때
 * revealLandmarkSectorIds로 처리한다(그 시점에야 graph가 생겨 랜드마크 노드를 알 수 있다).
 * @param {GameSnapshot} snapshot
 * @param {string} contractId
 * @returns {GameSnapshot}
 */
export function acceptContractCommand(snapshot, contractId) {
  if (snapshot.currentScreen !== 'contract') return snapshot;
  const contract = (snapshot.offeredContracts || []).find((c) => c.id === contractId);
  if (!contract) return snapshot;
  const inventory = addItem(snapshot.playerState.inventory, createItem('currency', { value: contract.prepaymentCurrency }));
  return {
    ...snapshot,
    playerState: { ...snapshot.playerState, inventory },
    activeContract: { ...contract, status: 'accepted' },
    offeredContracts: null,
    currentScreen: 'loadout',
  };
}
