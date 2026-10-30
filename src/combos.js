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

export const STARTER_COMBOS = Object.freeze([
  '1', '1-1', '1-2', '1-1-2', '1-2-3', '2-3', '1-2-3-2', '3-2', '1-3', '2-3-2',
]);

// Drill lists every user starts with. They're ordinary saved drills, so they can be edited or deleted.
export const PRESET_DRILLS = Object.freeze([
  { id: 'preset-jab-cross', name: 'Jab & cross', combos: ['1', '1-1', '1-2', '1-1-2', '2-1-2', '1-2-1-2'] },
  { id: 'preset-lead-hook', name: 'Lead hook', combos: ['1-3', '1-2-3', '3-2', '1-1-3', '2-3-2', '1-2-3-2'] },
  { id: 'preset-rear-hook', name: 'Rear hook', combos: ['1-4', '3-4', '1-3-4', '1-2-3-4', '5-4'] },
  { id: 'preset-uppercuts', name: 'Uppercuts', combos: ['1-6', '5-2', '6-3', '2-5-2', '1-6-3-2', '5-6'] },
  { id: 'preset-long', name: 'Long combos', combos: ['1-2-3-2', '1-2-5-2', '1-6-3-2', '1-1-2-3-2', '2-3-2-3', '1-2-3-4-2'] },
]);

// Let the round-start bell finish before the first callout.
export const FIRST_CALLOUT_DELAY_MS = 1500;
// No new callout this close to the end-of-round bell.
export const END_QUIET_MS = 1500;
// Floor for the scaled gap so a single jab at a short interval still leaves time to throw it.
export const MIN_GAP_MS = 1000;

// Accepts "1-2-3", "1 2 3", "1,2,3" or "123". Returns an array of punch numbers, or null if invalid.
export function parseCombo(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;
  const parts = /[\s,-]/.test(text) ? text.split(/[\s,-]+/).filter(Boolean) : text.split('');
  const punches = parts.map(Number);
  if (!punches.length || punches.some((p) => !Number.isInteger(p) || !(p in PUNCH_NAMES))) return null;
  return punches;
}

export function formatCombo(punches) {
  return punches.join('-');
}

export function comboNames(punches) {
  return punches.map((p) => PUNCH_NAMES[p]).join(', ');
}

// Text handed to TTS. Numbers are space-separated so engines read "one two three", not "one minus two".
export function comboSpeech(punches, style = 'numbers') {
  return style === 'names' ? comboNames(punches) : punches.join(' ');
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
      if (combos.length > 1 && k === last) k = (k + 1) % combos.length;
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
