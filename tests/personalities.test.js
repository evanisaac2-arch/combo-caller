import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONALITIES, PUSH_MIN_GAP_MS, personalityLine, calloutLine, voiceTuning } from '../src/personalities.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const KEYS = ['roundSoon', 'lastRoundSoon', 'warning', 'roundEnd', 'done', 'push'];
const always = () => 0; // rng that always passes the chance check and picks the first line

test('the default personality exists and stays quiet', () => {
  assert.ok(PERSONALITIES[DEFAULT_SETTINGS.personality]);
  for (const key of KEYS) assert.equal(personalityLine('plain', key, { round: 1 }), null);
  assert.equal(calloutLine('plain', [1, 2], 'numbers', 10000, always), '1 2');
});

test('every talking personality has a line for every moment', () => {
  for (const [id, p] of Object.entries(PERSONALITIES)) {
    if (id === 'plain') continue;
    for (const key of KEYS) assert.ok(p.lines[key]?.length > 0, `${id}.${key}`);
  }
});

test('round number is filled in', () => {
  const line = personalityLine('stoic', 'roundSoon', { round: 3, rng: always });
  assert.equal(line, 'Round 3.');
  for (const id of Object.keys(PERSONALITIES)) {
    for (const l of PERSONALITIES[id].lines.roundSoon ?? []) assert.ok(l.includes('{n}'), `${id}: ${l}`);
  }
});

test('no personality says "lead" (TTS reads it as the metal)', () => {
  for (const p of Object.values(PERSONALITIES)) {
    for (const list of Object.values(p.lines)) {
      for (const l of list) assert.doesNotMatch(l, /\blead\b/i, l);
    }
  }
});

test('technique cue is added only when there is time and the chance hits', () => {
  assert.equal(calloutLine('sergeant', [1, 2], 'numbers', PUSH_MIN_GAP_MS, always), '1 2. Hands up!');
  assert.equal(calloutLine('sergeant', [1, 2], 'numbers', PUSH_MIN_GAP_MS - 1, always), '1 2');
  assert.equal(calloutLine('sergeant', [1, 2], 'numbers', 10000, () => 0.99), '1 2');
  assert.equal(calloutLine('encouraging', [3], 'names', 10000, always), 'leed hook. Nice!');
});

test('voice tuning: plain is neutral, unknown ids fall back to plain', () => {
  assert.deepEqual(voiceTuning('plain'), { rate: 1, pitch: 1 });
  assert.deepEqual(voiceTuning('nope'), { rate: 1, pitch: 1 });
  assert.ok(voiceTuning('sergeant').rate > 1);
});
