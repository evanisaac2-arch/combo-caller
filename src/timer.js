// Timer engine: builds the get-ready/round/rest timeline and fires timed events against a pausable
// clock. Time comes from an injectable now() so tests can drive it and so a throttled tab catches up
// on wall-clock time instead of drifting.

export function buildTimeline({ roundSec, restSec, rounds, getReadySec = 0 }) {
  const segments = [];
  let t = 0;
  const push = (kind, round, sec) => {
    segments.push({ kind, round, startMs: t, endMs: t + sec * 1000 });
    t += sec * 1000;
  };
  if (getReadySec > 0) push('getready', 0, getReadySec);
  for (let r = 1; r <= rounds; r++) {
    push('round', r, roundSec);
    if (r < rounds && restSec > 0) push('rest', r, restSec);
  }
  return segments;
}

// Events: 'phase' at each segment start, 'warning' warningSec before each round ends,
// 'round-end' at each round end, and 'done' at the very end.
export function buildTimerEvents(segments, { warningSec = 0 } = {}) {
  const events = [];
  for (const seg of segments) {
    events.push({ t: seg.startMs, type: 'phase', kind: seg.kind, round: seg.round });
    if (seg.kind !== 'round') continue;
    const warnMs = warningSec * 1000;
    if (warnMs > 0 && warnMs < seg.endMs - seg.startMs) {
      events.push({ t: seg.endMs - warnMs, type: 'warning', round: seg.round });
    }
    events.push({ t: seg.endMs, type: 'round-end', round: seg.round });
  }
  events.push({ t: totalMs(segments), type: 'done' });
  return events;
}

export function totalMs(segments) {
  return segments.length ? segments[segments.length - 1].endMs : 0;
}

// Stable sort: events at the same time keep their insertion order (round-end before the next phase).
export function sortEvents(events) {
  return [...events].sort((a, b) => a.t - b.t);
}

export class TimerEngine {
  constructor({ segments, events, onEvent = () => {}, now = () => performance.now() }) {
    this.segments = segments;
    this.events = sortEvents(events);
    this.totalMs = totalMs(segments);
    this.totalRounds = segments.filter((s) => s.kind === 'round').length;
    this.onEvent = onEvent;
    this.now = now;
    this.reset();
  }

  reset() {
    this.state = 'idle'; // idle | running | paused | done
    this.elapsedMs = 0;
    this.nextIndex = 0;
    this.lastNow = 0;
  }

  // Starts from idle or resumes from paused.
  start() {
    if (this.state === 'running' || this.state === 'done') return;
    this.lastNow = this.now();
    this.state = 'running';
    this.update();
  }

  pause() {
    if (this.state !== 'running') return;
    this.update();
    if (this.state === 'running') this.state = 'paused';
  }

  // Advances the clock and fires every event now due. onEvent gets { lateMs } so callers can
  // skip sounds for events that were missed while the phone was asleep.
  update() {
    if (this.state !== 'running') return;
    const now = this.now();
    this.elapsedMs = Math.min(this.totalMs, this.elapsedMs + (now - this.lastNow));
    this.lastNow = now;
    while (this.nextIndex < this.events.length && this.events[this.nextIndex].t <= this.elapsedMs) {
      const ev = this.events[this.nextIndex++];
      this.onEvent(ev, { lateMs: this.elapsedMs - ev.t });
    }
    if (this.elapsedMs >= this.totalMs) this.state = 'done';
  }

  status() {
    const segment = this.segments.find((s) => this.elapsedMs >= s.startMs && this.elapsedMs < s.endMs) ?? null;
    return {
      state: this.state,
      elapsedMs: this.elapsedMs,
      segment,
      remainingMs: segment ? segment.endMs - this.elapsedMs : 0,
    };
  }
}
