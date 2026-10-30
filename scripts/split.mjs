// Splitting a batch recording (several lines read with long pauses between them) into one clip per
// line. Pure helpers: ffmpeg's silencedetect output goes in, the time range of each line comes out,
// or null when the pauses don't clearly mark the expected number of lines.

// Silences from ffmpeg `silencedetect` stderr: [{ start, end }] in seconds. A silence still open
// at the end of the file ends at `total`.
export function parseSilences(stderr, total) {
  const silences = [];
  let start = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== null) {
      silences.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) silences.push({ start, end: total });
  return silences;
}

// Time range of each of `n` lines: [{ from, to }], padded a little so the trim step has room.
// The n-1 longest pauses inside the recording are taken as the breaks between lines; that's only
// trusted when every break is at least minBreak long and clearly longer (ratio) than any pause
// left inside a line, and every line has at least minVoiced seconds of sound.
export function lineRanges(silences, total, n, { minBreak = 0.6, ratio = 1.4, minVoiced = 0.15, pad = 0.05 } = {}) {
  if (n < 1 || !(total > 0)) return null;
  const edge = 0.02;
  const leading = silences.find((s) => s.start <= edge);
  const trailing = silences.find((s) => s.end >= total - edge && s !== leading);
  const inner = silences.filter((s) => s !== leading && s !== trailing);
  if (inner.length < n - 1) return null;

  const len = (s) => s.end - s.start;
  const byLength = [...inner].sort((a, b) => len(b) - len(a));
  const breaks = byLength.slice(0, n - 1).sort((a, b) => a.start - b.start);
  const others = byLength.slice(n - 1);
  if (breaks.length) {
    const shortestBreak = Math.min(...breaks.map(len));
    if (shortestBreak < minBreak) return null;
    if (others.length && shortestBreak < ratio * Math.max(...others.map(len))) return null;
  }

  const voiceStart = leading ? leading.end : 0;
  const voiceEnd = trailing ? trailing.start : total;
  const ranges = [];
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? voiceStart : breaks[i - 1].end;
    const to = i === n - 1 ? voiceEnd : breaks[i].start;
    if (to - from < minVoiced) return null;
    ranges.push({ from: Math.max(0, from - pad), to: Math.min(total, to + pad) });
  }
  return ranges;
}

// A second, independent check that a split is right: each piece's length has to fit its words.
// Seconds per letter must be in a sane range for speech, and every line has to be spoken at a
// similar pace to the rest of its batch. A merged pair of lines or a line cut in half shows up
// as one piece far too long or too short for its text.
const letters = (text) => Math.max(1, String(text).replace(/[^a-z0-9]/gi, '').length);

export function plausibleSplit(ranges, texts, { minPerLetter = 0.025, maxPerLetter = 0.3, spread = [0.45, 2.2] } = {}) {
  if (!ranges || ranges.length !== texts.length) return false;
  const pace = ranges.map((r, i) => (r.to - r.from) / letters(texts[i]));
  if (pace.some((p) => p < minPerLetter || p > maxPerLetter)) return false;
  if (pace.length < 3) return true;
  const sorted = [...pace].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return pace.every((p) => p / median >= spread[0] && p / median <= spread[1]);
}

// Splits a list into chunks of at most `size`.
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
