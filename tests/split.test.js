import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSilences, lineRanges, plausibleSplit, chunk } from '../scripts/split.mjs';

const ffmpegLog = `
[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 0.3 | silence_duration: 0.3
[silencedetect @ 0x1] silence_start: 0.7
[silencedetect @ 0x1] silence_end: 2.7 | silence_duration: 2
[silencedetect @ 0x1] silence_start: 3.1
[silencedetect @ 0x1] silence_end: 3.45 | silence_duration: 0.35
[silencedetect @ 0x1] silence_start: 3.75
[silencedetect @ 0x1] silence_end: 5.75 | silence_duration: 2
[silencedetect @ 0x1] silence_start: 6.15
`;
const total = 6.65;

test('parseSilences reads start/end pairs and an open trailing silence', () => {
  assert.deepEqual(parseSilences(ffmpegLog, total), [
    { start: 0, end: 0.3 }, { start: 0.7, end: 2.7 }, { start: 3.1, end: 3.45 },
    { start: 3.75, end: 5.75 }, { start: 6.15, end: total },
  ]);
});

test('three lines: the two long pauses are the breaks, the short one stays inside line 2', () => {
  const ranges = lineRanges(parseSilences(ffmpegLog, total), total, 3);
  assert.equal(ranges.length, 3);
  const r = ranges.map(({ from, to }) => [Math.round(from * 100) / 100, Math.round(to * 100) / 100]);
  assert.deepEqual(r, [[0.25, 0.75], [2.65, 3.8], [5.7, 6.2]]);
});

test('refuses when the breaks are not clearly longer than pauses inside lines', () => {
  const s = [{ start: 0.5, end: 1.3 }, { start: 1.8, end: 2.4 }, { start: 3, end: 3.9 }];
  // Two lines wanted: longest pause 0.9 s vs 0.8 s left over: too close to call.
  assert.equal(lineRanges(s, 4.5, 2), null);
});

test('refuses with too few pauses, too-short breaks, or an empty line', () => {
  const s = [{ start: 0.5, end: 2.5 }];
  assert.equal(lineRanges(s, 3, 3), null); // needs 2 breaks, has 1
  assert.equal(lineRanges([{ start: 0.5, end: 0.8 }], 1.5, 2), null); // 0.3 s isn't a break
  assert.equal(lineRanges([{ start: 0.05, end: 2 }, { start: 2.05, end: 4 }], 4.5, 2), null); // line 1 is 0.03 s
});

test('a single line is everything between the leading and trailing silence', () => {
  const ranges = lineRanges([{ start: 0, end: 0.2 }, { start: 0.9, end: 1.2 }], 1.2, 1);
  assert.deepEqual(ranges.map(({ from, to }) => [Math.round(from * 100) / 100, Math.round(to * 100) / 100]), [[0.15, 0.95]]);
});

test('plausibleSplit: lengths that fit the words pass', () => {
  const texts = ['Jab.', 'Cross.', 'Lead hook.', 'Rear uppercut.'];
  const ranges = [[0, 0.5], [1, 1.6], [2, 2.9], [3.5, 4.8]].map(([from, to]) => ({ from, to }));
  assert.equal(plausibleSplit(ranges, texts), true);
});

test('plausibleSplit: a merged pair or a line cut in half fails', () => {
  const texts = ['Jab.', 'Cross.', 'Lead hook.', 'Rear uppercut.'];
  // "Cross" and "Lead hook" ran together, so "Lead hook" got the start of "Rear uppercut"
  // and "Rear uppercut" got only its tail.
  const merged = [[0, 0.5], [1, 2.9], [3.5, 4.1], [4.3, 4.8]].map(([from, to]) => ({ from, to }));
  assert.equal(plausibleSplit(merged, texts), false);
  assert.equal(plausibleSplit([{ from: 0, to: 3 }], ['Jab.']), false); // 1 s per letter
  assert.equal(plausibleSplit(null, texts), false);
  assert.equal(plausibleSplit([{ from: 0, to: 1 }], texts), false); // wrong count
});

test('chunk', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});
