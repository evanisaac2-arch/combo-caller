// Combo generator: punch numbering, parsing, callout text, and per-round callout plans.
// Pure logic, no DOM, so it runs in Node tests and in any wrapper.

export const PUNCH_NAMES = Object.freeze({
  1: 'jab',
  2: 'cross',
  3: 'lead hook',
  4: 'rear hook',
  5: 'lead uppercut',
  6: 'rear uppercut',
});

// What TTS is given for each punch. "lead" is spelled "leed" so engines don't say the metal.
export const SPOKEN_NAMES = Object.freeze({
  ...PUNCH_NAMES,
  3: 'leed hook',
  5: 'leed uppercut',
});

// Defensive moves that can go anywhere in a combo. Written as letters ("1-2-SL-2") and kept as
// lowercase strings in a combo array, next to the punch numbers.
export const MOVE_NAMES = Object.freeze({
  sl: 'slip left',
  sr: 'slip right',
});

// Everything a combo can contain: punches 1–6 and the moves.
export const STEP_NAMES = Object.freeze({ ...PUNCH_NAMES, ...MOVE_NAMES });
const SPOKEN_STEPS = Object.freeze({ ...SPOKEN_NAMES, ...MOVE_NAMES });

export const isMove = (step) => typeof step === 'string';

export const STARTER_COMBOS = Object.freeze([
  '1', '1-1', '1-2', '1-1-2', '1-2-3', '2-3', '1-2-3-2', '3-2', '1-3', '2-3-2',
]);

// Drill lists every user starts with. They're ordinary saved drills, so they can be edited or deleted.
// STARTER_COMBOS doubles as the fallback when no drills exist at all.
export const PRESET_DRILLS = Object.freeze([
  { id: 'preset-starter', name: 'Starter set', combos: [...STARTER_COMBOS] },
  { id: 'preset-jab-cross', name: 'Jab & cross', combos: ['1', '1-1', '1-2', '1-1-2', '2-1-2', '1-2-1-2'] },
  { id: 'preset-lead-hook', name: 'Lead hook', combos: ['1-3', '1-2-3', '3-2', '1-1-3', '2-3-2', '1-2-3-2'] },
  { id: 'preset-rear-hook', name: 'Rear hook', combos: ['1-4', '3-4', '1-3-4', '1-2-3-4', '5-4'] },
  { id: 'preset-jab-rear-hook', name: 'Hook pairs', combos: ['1-4', '2-3'] },
  { id: 'preset-uppercuts', name: 'Uppercuts', combos: ['1-6', '5-2', '6-3', '2-5-2', '1-6-3-2', '5-6'] },
  { id: 'preset-long', name: 'Long combos', combos: ['1-2-3-2', '1-2-5-2', '1-6-3-2', '1-1-2-3-2', '2-3-2-3', '1-2-3-4-2'] },
]);

// Let the round-start bell finish before the first callout.
export const FIRST_CALLOUT_DELAY_MS = 1500;
// No new callout this close to the end-of-round bell.
export const END_QUIET_MS = 1500;
// Floor for the scaled gap so a single jab at a short interval still leaves time to throw it.
export const MIN_GAP_MS = 1000;

// Accepts "1-2-3", "1 2 3", "1,2,3" or "123", with SL/SR for slips ("1-2-SL-2", "12sl2", any case).
// Returns an array of punch numbers and move strings, or null if invalid.
export function parseCombo(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const parts = /[\s,-]/.test(text) ? text.split(/[\s,-]+/).filter(Boolean) : text.match(/s[lr]|./g);
  const steps = parts.map((s) => (s in MOVE_NAMES ? s : Number(s)));
  if (!steps.length || steps.some((s) => !isMove(s) && !(Number.isInteger(s) && s in PUNCH_NAMES))) return null;
  return steps;
}

export function formatCombo(punches) {
  return punches.map((s) => (isMove(s) ? s.toUpperCase() : s)).join('-');
}

export function comboNames(punches) {
  return punches.map((s) => STEP_NAMES[s]).join(', ');
}

// Text handed to TTS. Numbers are space-separated so engines read "one two three", not "one minus
// two". Slips are said in words in both styles.
export function comboSpeech(punches, style = 'numbers') {
  return punches.map((s) => (style === 'names' || isMove(s) ? SPOKEN_STEPS[s] : s)).join(' ');
}

// combos: array of punch arrays. order: 'random' | 'inorder'.
export function createPicker(combos, { order = 'random', rng = Math.random } = {}) {
  if (!combos.length) throw new Error('No combos to pick from');
  let index = -1;
  let last = -1;
  return {
    next() {
      if (order === 'inorder') {
        index = (index + 1) % combos.length;
        return combos[index];
      }
      let k = Math.floor(rng() * combos.length);
      // With only two combos, skipping repeats would just alternate them, so repeats are allowed.
      if (combos.length > 2 && k === last) k = (k + 1) % combos.length;
      last = k;
      return combos[k];
    },
  };
}

// Time from one callout to the next. With scaleByLength the interval is treated as the time for a
// 2-punch combo, so a 4-punch combo gets twice as long and a single punch half as long.
export function calloutGapMs(punches, { intervalSec, scaleByLength = false }) {
  const base = intervalSec * 1000;
  if (!scaleByLength) return base;
  return Math.max(MIN_GAP_MS, Math.round((base * punches.length) / 2));
}

// Callouts for one round between startMs and endMs: [{ t, punches }].
export function planRoundCallouts(startMs, endMs, picker, { intervalSec, scaleByLength = false, repeatOne = false }) {
  const plan = [];
  const fixed = repeatOne ? picker.next() : null;
  let t = startMs + FIRST_CALLOUT_DELAY_MS;
  while (t < endMs - END_QUIET_MS) {
    const punches = fixed ?? picker.next();
    plan.push({ t, punches });
    t += calloutGapMs(punches, { intervalSec, scaleByLength });
  }
  return plan;
}
