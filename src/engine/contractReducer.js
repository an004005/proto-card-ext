// 계약 선택/수락 커맨드(§3단계, D3). 계약 제안은 그 계약을 골랐을 때 지어질 네 구역까지 함께
// 들고 있다(ADR-0089) — 구역 추첨이 제안 시점에 돌기 때문이다. 로드아웃 화면 진입 전 'contract' 화면에서만 산다 —
// 수락 이후의 진행 상태는 confirmLoadout이 facilityRunState.contract로 옮기고 나면
// runEngine.js의 완료 액션들(facilityReducer.js 경유)이 다룬다.
import { pick } from './rng.js';
import { selectRunSectorIds } from './facilityGraph.js';
import { CONTRACT_DEFS } from '../data/contracts.js';
import { addItem, createItem } from './inventoryEngine.js';

/** @typedef {import('./types.js').GameSnapshot} GameSnapshot */

/**
 * 유형별로 하나씩, 여덟 구역 **전부**의 계약에서 뽑는다 — 언제나 3장이다(ADR-0083). 그리고
 * 제안마다 그 계약을 수락했을 때 지어질 네 구역을 **여기서 미리 뽑아 둔다**(ADR-0089) — 계약을
 * 고르는 일은 곧 이번 판의 시설을 고르는 일인데, 추첨이 수락 뒤에 돌던 동안에는 그 사실이
 * 수락하고 나서야 보였다. 세 제안은 같은 런 RNG를 순서대로 진행시켜 굴리므로 시드가 같으면
 * 제안도 구역도 같다. 수락(acceptContractCommand)은 여기 적힌 목록을 그대로 쓴다 — 다시 굴리지
 * 않는다.
 * 순수 함수 — rngState를 명시적으로 스레딩한다.
 * @param {import('./rng.js').RngState} rngState
 * @returns {{contracts: import('./types.js').OfferedContract[], rngState: import('./rng.js').RngState}}
 */
export function offerContracts(rngState) {
  let state = rngState;
  /** @type {import('./types.js').OfferedContract[]} */
  const contracts = [];
  for (const type of /** @type {const} */ (['retrieval', 'destroy', 'intel'])) {
    const pool = CONTRACT_DEFS.filter((c) => c.type === type);
    if (pool.length === 0) continue;
    const { value, state: next } = pick(state, pool);
    state = next;
    const drawn = selectRunSectorIds(state, value.sectorId);
    state = drawn.rngState;
    contracts.push({ ...value, sectorIds: drawn.sectorIds });
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
 * 계약 3장 중 하나를 수락한다 — 선불(재화)을 즉시 지급하고 로드아웃 화면으로 넘어간다.
 *
 * **구역 추첨은 여기서 돌지 않는다**(ADR-0089). 제안이 만들어질 때 이미 굴려 둔 `sectorIds`를
 * 그대로 옮겨 담을 뿐이다 — 계약 화면이 보여준 네 구역과 실제로 지어지는 시설이 같아야 하기
 * 때문이다. CONFIRM_LOADOUT이 그 목록 그대로 generateFacilityGraph에 넘긴다.
 *
 * 사전 정보(목표부 위치 공개)는 여기서가 아니라 confirmLoadout이 createRunState를 부를 때
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
    runSectorIds: contract.sectorIds,
    currentScreen: 'loadout',
  };
}
