// Coach personalities: what the coach says besides the combos, and how it sounds. TTS voices can't
// change emotion, so tone comes from the words plus small pitch/rate shifts. Cues are about
// technique, not effort, since the app is for technique work. Pure logic, no DOM.

import { comboSpeech } from './combos.js';

// Only add a technique cue after a combo when the gap to the next one leaves time to say it.
export const PUSH_MIN_GAP_MS = 4000;
const DEFAULT_PUSH_CHANCE = 0.25;

export const PERSONALITIES = Object.freeze({
  plain: {
    label: 'Plain',
    blurb: 'Just the combos',
    rate: 1,
    pitch: 1,
    lines: {},
  },
  encouraging: {
    label: 'Encouraging',
    blurb: 'Warm coach',
    rate: 1,
    pitch: 1.1,
    lines: {
      roundSoon: ["Round {n} coming up. You've got this.", 'Round {n}. Nice and relaxed.', 'Here comes round {n}. Have fun with it.'],
      lastRoundSoon: ['Last round coming up. Make it your best one.'],
      warning: ['Ten seconds, finish strong!', "Ten seconds, you're doing great!"],
      roundEnd: ['Time. Great round, breathe.', 'Time. Beautiful work.'],
      done: ['All done. Great session!', "That's the workout. Proud of that work."],
      push: ['Nice!', 'Good, hands up.', 'Beautiful.', 'Good snap.', "That's it, stay relaxed."],
    },
  },
  stoic: {
    label: 'Stoic',
    blurb: 'Calm, few words',
    rate: 0.95,
    pitch: 0.9,
    pushChance: 0.1,
    lines: {
      roundSoon: ['Round {n}.'],
      lastRoundSoon: ['Final round.'],
      warning: ['Ten seconds.'],
      roundEnd: ['Time.'],
      done: ['Done.'],
      push: ['Breathe.', 'Chin down.', 'Hands home.'],
    },
  },
  sergeant: {
    label: 'Drill sergeant',
    blurb: 'Loud, relentless',
    rate: 1.15,
    pitch: 0.85,
    pushChance: 0.35,
    lines: {
      roundSoon: ['Round {n}! Hands up!', 'Round {n}! No sloppy punches!'],
      lastRoundSoon: ['Last round! Leave nothing in there!'],
      warning: ['Ten seconds! Do not drop those hands!', 'Ten seconds! Clean punches!'],
      roundEnd: ['Time! Shake it out!', 'Time! Reset!'],
      done: ['Done! Good work, recruit!'],
      push: ['Hands up!', 'Snap it back!', 'Chin down!', 'Turn that hip!', 'Again!', 'Sharper!'],
    },
  },
});

export function pickLine(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

// A spoken line for a moment in the session (roundSoon, lastRoundSoon, warning, roundEnd, done),
// or null when this personality stays quiet.
export function personalityLine(id, key, { round = 0, rng = Math.random } = {}) {
  const list = PERSONALITIES[id]?.lines[key];
  if (!list?.length) return null;
  return pickLine(list, rng).replace('{n}', String(round));
}

// The combo callout, sometimes followed by a short technique cue.
export function calloutLine(id, punches, style, gapMs, rng = Math.random) {
  const text = comboSpeech(punches, style);
  const p = PERSONALITIES[id];
  if (!p?.lines.push?.length || gapMs < PUSH_MIN_GAP_MS) return text;
  if (rng() >= (p.pushChance ?? DEFAULT_PUSH_CHANCE)) return text;
  return `${text}. ${pickLine(p.lines.push, rng)}`;
}

export function voiceTuning(id) {
  const p = PERSONALITIES[id] ?? PERSONALITIES.plain;
  return { rate: p.rate, pitch: p.pitch };
}
