import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONALITIES, PUSH_MIN_GAP_MS, MAX_ROUNDS,
  roundCue, momentPhrase, calloutPhrase, gapBetweenMs, clipScript, voiceTuning,
} from '../src/personalities.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const always = () => 0; // rng that always passes the chance check and picks the first line
const MOMENTS = ['warning', 'roundEnd', 'done'];

test('the default personality exists and stays quiet', () => {
  assert.ok(PERSONALITIES[DEFAULT_SETTINGS.personality]);
  assert.equal(roundCue('plain', 1), null);
  for (const key of MOMENTS) assert.equal(momentPhrase('plain', key), null);
  assert.deepEqual(calloutPhrase('plain', [1, 2], 'numbers', 10000, always), { text: '1 2', keys: ['num-1', 'num-2'] });
});

test('every talking personality has something for every moment', () => {
  for (const [id, p] of Object.entries(PERSONALITIES)) {
    if (id === 'plain') continue;
    assert.ok(p.roundIntro?.includes('{n}'), id);
    for (const key of [...MOMENTS, 'lastRoundSoon', 'push']) assert.ok(p.lines[key]?.length > 0, `${id}.${key}`);
    assert.ok(p.instructions, id);
  }
});

test('round cue: intro with the round number, plus an optional line; last round has its own', () => {
  assert.deepEqual(roundCue('encouraging', 3, { rng: always }), {
    text: "Round 3 coming up. You've got this.",
    keys: ['round-3', 'roundSoon-0'],
  });
  assert.deepEqual(roundCue('stoic', 2, { rng: always }), { text: 'Round 2.', keys: ['round-2'] });
  assert.deepEqual(roundCue('sergeant', 4, { isLast: true, rng: always }).keys, ['lastRoundSoon-0']);
});

test('callout: names joined with commas, technique cue only with time and luck', () => {
  assert.deepEqual(calloutPhrase('sergeant', [1, 2], 'numbers', PUSH_MIN_GAP_MS, always), {
    text: '1 2. Hands up!', keys: ['num-1', 'num-2', 'push-0'],
  });
  assert.equal(calloutPhrase('sergeant', [1, 2], 'numbers', PUSH_MIN_GAP_MS - 1, always).text, '1 2');
  assert.equal(calloutPhrase('sergeant', [1, 2], 'numbers', 10000, () => 0.99).text, '1 2');
  assert.deepEqual(calloutPhrase('stoic', [1, 3], 'names', 1000, always), {
    text: 'jab, leed hook', keys: ['name-1', 'name-3'],
  });
});

test('clip gaps: short between punches, longer around lines', () => {
  assert.equal(gapBetweenMs('name-1', 'name-2'), 60);
  assert.equal(gapBetweenMs('num-1', 'push-0'), 250);
  assert.equal(gapBetweenMs('round-2', 'roundSoon-1'), 250);
});

test('clip script covers every key a phrase can use, with unique keys', () => {
  for (const id of Object.keys(PERSONALITIES)) {
    const script = clipScript(id);
    const keys = new Set(script.map((c) => c.key));
    assert.equal(keys.size, script.length, `${id}: duplicate keys`);
    const used = [
      ...calloutPhrase(id, [1, 2, 3, 4, 5, 6], 'numbers', 10000, always).keys,
      ...calloutPhrase(id, [1, 2, 3, 4, 5, 6], 'names', 10000, always).keys,
      ...(roundCue(id, MAX_ROUNDS, { rng: always })?.keys ?? []),
      ...(roundCue(id, 1, { isLast: true, rng: always })?.keys ?? []),
      ...MOMENTS.flatMap((m) => momentPhrase(id, m, always)?.keys ?? []),
    ];
    for (const k of used) assert.ok(keys.has(k), `${id}: missing clip ${k}`);
    // Each line of every list is in the script, not just the first.
    for (const [key, list] of Object.entries(PERSONALITIES[id].lines)) {
      list.forEach((_, i) => assert.ok(keys.has(`${key}-${i}`), `${id}: ${key}-${i}`));
    }
  }
});

test('no clip text says "lead" (TTS reads it as the metal)', () => {
  for (const id of Object.keys(PERSONALITIES)) {
    for (const c of clipScript(id)) assert.doesNotMatch(c.text, /\blead\b/i, `${id}: ${c.text}`);
  }
});

test('voice tuning: plain is neutral, unknown ids fall back to plain', () => {
  assert.deepEqual(voiceTuning('plain'), { rate: 1, pitch: 1 });
  assert.deepEqual(voiceTuning('nope'), { rate: 1, pitch: 1 });
  assert.ok(voiceTuning('sergeant').rate > 1);
});
