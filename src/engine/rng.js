// Seeded PRNG (mulberry32). Every function is pure: (state, ...) => { value, state }.
// Never call Math.random() from engine code — all randomness must thread rngState explicitly
// so combat/map generation is reproducible and undo/redo can restore identical outcomes.

/** @typedef {import('./types.js').RngState} RngState */

/**
 * @param {number} seed
 * @returns {RngState}
 */
export function createRngState(seed) {
  return seed >>> 0;
}

/**
 * @param {RngState} state
 * @returns {{value: number, state: RngState}} value in [0, 1)
 */
export function nextFloat(state) {
  const t = (state + 0x6d2b79f5) >>> 0;
  let z = t;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  const value = ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

/**
 * @param {RngState} state
 * @param {number} maxExclusive
 * @returns {{value: number, state: RngState}} integer in [0, maxExclusive)
 */
export function nextInt(state, maxExclusive) {
  const { value, state: nextState } = nextFloat(state);
  return { value: Math.floor(value * maxExclusive), state: nextState };
}

/**
 * @template T
 * @param {RngState} state
 * @param {T[]} array
 * @returns {{value: T, state: RngState}}
 */
export function pick(state, array) {
  const { value: index, state: nextState } = nextInt(state, array.length);
  return { value: array[index], state: nextState };
}

/**
 * @template T
 * @param {RngState} state
 * @param {T[]} array
 * @returns {{value: T[], state: RngState}} a fresh shuffled copy (input untouched)
 */
export function shuffle(state, array) {
  const result = array.slice();
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const { value: j, state: nextState } = nextInt(s, i + 1);
    s = nextState;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { value: result, state: s };
}

/**
 * @template T
 * @param {RngState} state
 * @param {{value: T, weight: number}[]} items
 * @returns {{value: T, state: RngState}}
 */
export function weightedPick(state, items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const { value: roll, state: nextState } = nextFloat(state);
  let threshold = roll * totalWeight;
  for (const item of items) {
    threshold -= item.weight;
    if (threshold <= 0) return { value: item.value, state: nextState };
  }
  return { value: items[items.length - 1].value, state: nextState };
}
