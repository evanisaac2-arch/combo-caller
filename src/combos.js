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

// Defensive moves and footwork that can go anywhere in a combo. Written as letters ("1-2-SL-2")
// and kept as lowercase strings in a combo array, next to the punch numbers.
export const MOVE_NAMES = Object.freeze({
  sl: 'slip left',
  sr: 'slip right',
  rl: 'roll left',
  rr: 'roll right',
  pl: 'pull',
  pv: 'pivot',
});

// A punch to the body is the punch number plus "b" ("1-3b-2"), kept as the string "3b".
export const BODY_WORD = 'body';

// A combo step is a punch number, a body punch ("3b") or a move ("sl").
export const isMove = (step) => typeof step === 'string' && step in MOVE_NAMES;
export const isBody = (step) => typeof step === 'string' && /^[1-6]b$/.test(step);
// The punch number of a punch or body punch, or null for a move.
export const punchOf = (step) => (isMove(step) ? null : Number(String(step)[0]));

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
  { id: 'preset-body', name: 'Body work', combos: ['1-2-3b', '3b-3', '1-1b-2', '2-3b-2', '1-6b-3', '1-2-5b-2'] },
  { id: 'preset-defense', name: 'Defense & counter', combos: ['1-2-SL-2', '1-SR-3', '1-2-RR-3-2', '2-3-RL-3', '1-2-PL-2', '1-2-3-PV'] },
  { id: 'preset-uppercuts', name: 'Uppercuts', combos: ['1-6', '5-2', '6-3', '2-5-2', '1-6-3-2', '5-6'] },
  { id: 'preset-long', name: 'Long combos', combos: ['1-2-3-2', '1-2-5-2', '1-6-3-2', '1-1-2-3-2', '2-3-2-3', '1-2-3-4-2'] },
]);

// Let the round-start bell finish before the first callout.
export const FIRST_CALLOUT_DELAY_MS = 1500;
// No new callout this close to the end-of-round bell.
export const END_QUIET_MS = 1500;
// Floor for the scaled gap so a single jab at a short interval still leaves time to throw it.
export const MIN_GAP_MS = 1000;

// Accepts "1-2-3", "1 2 3", "1,2,3" or "123", with a "b" after a punch for the body ("1-3b-2") and
// SL/SR/RL/RR/PL/PV for moves ("1-2-SL-2", "12sl2", any case).
// Returns an array of steps (see isMove/isBody), or null if invalid.
export function parseCombo(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const parts = /[\s,-]/.test(text) ? text.split(/[\s,-]+/).filter(Boolean) : text.match(/s[lr]|r[lr]|p[lv]|\db|./g);
  const steps = parts.map((s) => (/^[1-6]$/.test(s) ? Number(s) : s));
  if (!steps.length || steps.some((s) => typeof s === 'string' && !isMove(s) && !isBody(s))) return null;
  return steps;
}

export function formatCombo(punches) {
  return punches.map((s) => (isMove(s) ? s.toUpperCase() : s)).join('-');
}

const stepName = (s) => (isMove(s) ? MOVE_NAMES[s] : isBody(s) ? `${PUNCH_NAMES[punchOf(s)]} (body)` : PUNCH_NAMES[s]);

export function comboNames(punches) {
  return punches.map(stepName).join(', ');
}

// Text handed to TTS. Numbers are space-separated so engines read "one two three", not "one minus
// two". Moves are said in words in both styles; a body punch adds "body" ("3 body", "leed hook body").
export function comboSpeech(punches, style = 'numbers') {
  return punches.map((s) => {
    if (isMove(s)) return MOVE_NAMES[s];
    const p = punchOf(s);
    const punch = style === 'names' ? SPOKEN_NAMES[p] : String(p);
    return isBody(s) ? `${punch} ${BODY_WORD}` : punch;
  }).join(' ');
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
