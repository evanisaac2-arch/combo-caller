// Coach personalities: what the coach says besides the combos, and how it sounds. Everything the
// coach can say is a fixed set of phrases, so it can be pre-recorded as a voice pack (see
// clipScript) and fall back to the phone's TTS when no pack is loaded. Cues are about technique,
// not effort, since the app is for technique work. Pure logic, no DOM.

import { SPOKEN_NAMES } from './combos.js';

// Only add a technique cue after a combo when the gap to the next one leaves time to say it.
export const PUSH_MIN_GAP_MS = 4000;
export const MAX_ROUNDS = 30;
const DEFAULT_PUSH_CHANCE = 0.25;

// roundIntro is said 3.5 s before each round ("Round {n} coming up."), optionally followed by a
// roundSoon line; lastRoundSoon replaces both before the final round.
// instructions tell a voice service how to deliver this personality's clips.
export const PERSONALITIES = Object.freeze({
  plain: {
    label: 'Plain',
    blurb: 'Just the combos',
    rate: 1,
    pitch: 1,
    instructions: 'A clear, neutral boxing coach calling punches. Crisp, short, even tone.',
    roundIntro: null,
    lines: {},
  },
  encouraging: {
    label: 'Encouraging',
    blurb: 'Warm coach',
    rate: 1,
    pitch: 1.1,
    instructions: 'A warm, upbeat, encouraging boxing coach. Friendly, positive and energetic, smiling while talking.',
    roundIntro: 'Round {n} coming up.',
    lines: {
      roundSoon: ["You've got this.", 'Nice and relaxed.', 'Have fun with it.'],
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
    instructions: 'A calm, stoic old boxing trainer. Low, steady, unhurried voice with very little emotion.',
    roundIntro: 'Round {n}.',
    lines: {
      roundSoon: [],
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
    instructions: 'A loud, intense military drill sergeant barking orders. Short, forceful, commanding, almost shouting.',
    roundIntro: 'Round {n}!',
    lines: {
      roundSoon: ['Hands up!', 'No sloppy punches!'],
      lastRoundSoon: ['Last round! Leave nothing in there!'],
      warning: ['Ten seconds! Do not drop those hands!', 'Ten seconds! Clean punches!'],
      roundEnd: ['Time! Shake it out!', 'Time! Reset!'],
      done: ['Done! Good work, recruit!'],
      push: ['Hands up!', 'Snap it back!', 'Chin down!', 'Turn that hip!', 'Again!', 'Sharper!'],
    },
  },
});

const personality = (id) => PERSONALITIES[id] ?? PERSONALITIES.plain;
const pickIndex = (list, rng) => Math.floor(rng() * list.length);

// A phrase is what gets said at one moment: text for the phone's TTS, and the clip keys a voice
// pack plays in order. Combo parts get a short gap between them, lines a longer one.
const joinerBefore = (prev, p) => {
  if (p.combo && prev.combo) return p.joiner;
  return /[.!?]$/.test(prev.text) ? ' ' : '. ';
};

const phrase = (parts) => (parts.length ? {
  text: parts.reduce((acc, p, i) => (i === 0 ? p.text : `${acc}${joinerBefore(parts[i - 1], p)}${p.text}`), ''),
  keys: parts.map((p) => p.key),
} : null);

const line = (id, key, rng) => {
  const list = personality(id).lines[key];
  if (!list?.length) return null;
  const i = pickIndex(list, rng);
  return { key: `${key}-${i}`, text: list[i] };
};

// Punches run together with no commas: a comma makes TTS pause after every punch, which sounds
// nothing like a coach calling a combo.
const punchPart = (p, style) => (style === 'names'
  ? { key: `name-${p}`, text: SPOKEN_NAMES[p], combo: true, joiner: ' ' }
  : { key: `num-${p}`, text: String(p), combo: true, joiner: ' ' });

// "Round 3 coming up. You've got this." (or the last-round line), or null for Plain.
export function roundCue(id, round, { isLast = false, rng = Math.random } = {}) {
  const p = personality(id);
  if (!p.roundIntro) return null;
  if (isLast) {
    const last = line(id, 'lastRoundSoon', rng);
    if (last) return phrase([last]);
  }
  const intro = { key: `round-${round}`, text: p.roundIntro.replace('{n}', String(round)) };
  return phrase([intro, line(id, 'roundSoon', rng)].filter(Boolean));
}

// A line for warning, roundEnd or done, or null when this personality stays quiet.
export function momentPhrase(id, key, rng = Math.random) {
  const l = line(id, key, rng);
  return l ? phrase([l]) : null;
}

// The combo callout, sometimes followed by a short technique cue.
export function calloutPhrase(id, punches, style, gapMs, rng = Math.random) {
  const parts = punches.map((p) => punchPart(p, style));
  const p = personality(id);
  if (p.lines.push?.length && gapMs >= PUSH_MIN_GAP_MS && rng() < (p.pushChance ?? DEFAULT_PUSH_CHANCE)) {
    parts.push(line(id, 'push', rng));
  }
  return phrase(parts);
}

// Pause between two clips of a phrase: none between punches (each clip already keeps a few ms of
// silence at its edges), longer before a line.
export function gapBetweenMs(key, nextKey) {
  const combo = (k) => k.startsWith('num-') || k.startsWith('name-');
  return combo(key) && combo(nextKey) ? 0 : 250;
}

// Clips re-recorded after a first version shipped. A new revision gets a new file name, so the
// generator sees it as missing and makes it, while the app keeps playing the previous file until
// the new one exists. r2: "lead" punches were recorded as "leed", which came out drawn-out.
export const CLIP_REVISIONS = Object.freeze({ 'name-3': 2, 'name-5': 2 });

// File names (without .mp3) to try for a clip, newest first.
export function clipFiles(key) {
  const rev = CLIP_REVISIONS[key] ?? 1;
  const files = [];
  for (let r = rev; r >= 1; r--) files.push(r === 1 ? key : `${key}.r${r}`);
  return files;
}

// Every clip a voice pack needs for one personality: [{ key, text }].
export function clipScript(id) {
  const p = personality(id);
  const clips = [];
  for (const n of Object.keys(SPOKEN_NAMES)) {
    clips.push({ key: `num-${n}`, text: n }, { key: `name-${n}`, text: SPOKEN_NAMES[n] });
  }
  if (p.roundIntro) {
    for (let r = 1; r <= MAX_ROUNDS; r++) clips.push({ key: `round-${r}`, text: p.roundIntro.replace('{n}', String(r)) });
  }
  for (const [key, list] of Object.entries(p.lines)) {
    list.forEach((text, i) => clips.push({ key: `${key}-${i}`, text }));
  }
  return clips;
}

export function voiceTuning(id) {
  const p = personality(id);
  return { rate: p.rate, pitch: p.pitch };
}
