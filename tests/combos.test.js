import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STARTER_COMBOS, PRESET_DRILLS, FIRST_CALLOUT_DELAY_MS, END_QUIET_MS,
  parseCombo, formatCombo, comboNames, comboSpeech, createPicker, calloutGapMs, planRoundCallouts,
} from '../src/combos.js';

// Deterministic rng: returns the given values in turn.
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('parseCombo accepts dashes, spaces, commas and bare digits', () => {
  assert.deepEqual(parseCombo('1-2-3'), [1, 2, 3]);
  assert.deepEqual(parseCombo(' 1 2  3 '), [1, 2, 3]);
  assert.deepEqual(parseCombo('1,2,3'), [1, 2, 3]);
  assert.deepEqual(parseCombo('123'), [1, 2, 3]);
  assert.deepEqual(parseCombo('6'), [6]);
});

test('parseCombo rejects anything outside punches 1-6', () => {
  for (const bad of ['', '   ', '7', '1-7', '0', '1-x', '12-3', 'jab', null, undefined]) {
    assert.equal(parseCombo(bad), null, String(bad));
  }
});

test('formatting for display and speech', () => {
  assert.equal(formatCombo([1, 2, 3]), '1-2-3');
  assert.equal(comboNames([1, 2, 3, 4, 5, 6]), 'jab, cross, lead hook, rear hook, lead uppercut, rear uppercut');
  assert.equal(comboSpeech([1, 2, 3], 'numbers'), '1 2 3');
  assert.equal(comboSpeech([1, 2, 3], 'names'), 'jab, cross, lead hook');
});

test('starter set parses and only uses punches 1-4', () => {
  for (const c of STARTER_COMBOS) {
    const p = parseCombo(c);
    assert.ok(p, c);
    assert.ok(p.every((n) => n >= 1 && n <= 4), c);
  }
});

test('preset drills: unique ids and every combo parses', () => {
  assert.equal(new Set(PRESET_DRILLS.map((d) => d.id)).size, PRESET_DRILLS.length);
  for (const drill of PRESET_DRILLS) {
    assert.ok(drill.combos.length > 0, drill.name);
    for (const c of drill.combos) assert.ok(parseCombo(c), `${drill.name}: ${c}`);
  }
});

test('picker in order cycles through the list', () => {
  const picker = createPicker([[1], [1, 2], [2, 3]], { order: 'inorder' });
  const out = Array.from({ length: 5 }, () => formatCombo(picker.next()));
  assert.deepEqual(out, ['1', '1-2', '2-3', '1', '1-2']);
});

test('picker random never repeats the same combo twice in a row', () => {
  const picker = createPicker([[1], [2], [3]], { order: 'random', rng: seq(0, 0, 0.5, 0.5) });
  const out = Array.from({ length: 4 }, () => formatCombo(picker.next()));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i], out[i - 1]);
});

test('picker with one combo always returns it; empty list throws', () => {
  const picker = createPicker([[1, 2]], { rng: seq(0.9) });
  assert.deepEqual(picker.next(), [1, 2]);
  assert.deepEqual(picker.next(), [1, 2]);
  assert.throws(() => createPicker([]));
});

test('callout gap: fixed interval, or scaled with a 2-punch combo as the baseline', () => {
  assert.equal(calloutGapMs([1, 2, 3, 2], { intervalSec: 5 }), 5000);
  assert.equal(calloutGapMs([1, 2], { intervalSec: 5, scaleByLength: true }), 5000);
  assert.equal(calloutGapMs([1, 2, 3, 2], { intervalSec: 5, scaleByLength: true }), 10000);
  assert.equal(calloutGapMs([1], { intervalSec: 5, scaleByLength: true }), 2500);
  assert.equal(calloutGapMs([1], { intervalSec: 2, scaleByLength: true }), 1000);
});

test('round plan: first callout after the bell, fixed spacing, quiet before the end', () => {
  const picker = createPicker([[1, 2]], {});
  const plan = planRoundCallouts(10000, 70000, picker, { intervalSec: 5 });
  assert.equal(plan[0].t, 10000 + FIRST_CALLOUT_DELAY_MS);
  for (let i = 1; i < plan.length; i++) assert.equal(plan[i].t - plan[i - 1].t, 5000);
  assert.ok(plan.at(-1).t < 70000 - END_QUIET_MS);
  assert.ok(plan.at(-1).t + 5000 >= 70000 - END_QUIET_MS);
  assert.equal(plan.length, 12);
});

test('round plan: scaled waits follow each combo length', () => {
  const picker = createPicker([[1], [1, 2, 3, 2]], { order: 'inorder' });
  const plan = planRoundCallouts(0, 30000, picker, { intervalSec: 4, scaleByLength: true });
  const gaps = plan.slice(1).map((c, i) => c.t - plan[i].t);
  assert.deepEqual(gaps.slice(0, 3), [2000, 8000, 2000]);
});

test('round plan: repeat one combo for the whole round', () => {
  const picker = createPicker([[1], [2, 3], [3, 2]], { order: 'inorder' });
  const r1 = planRoundCallouts(0, 60000, picker, { intervalSec: 5, repeatOne: true });
  const r2 = planRoundCallouts(60000, 120000, picker, { intervalSec: 5, repeatOne: true });
  assert.ok(r1.every((c) => formatCombo(c.punches) === '1'));
  assert.ok(r2.every((c) => formatCombo(c.punches) === '2-3'));
});
