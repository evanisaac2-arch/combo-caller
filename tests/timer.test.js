import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, buildTimerEvents, TimerEngine } from '../src/timer.js';

const fakeClock = () => {
  let now = 0;
  return { now: () => now, advance: (ms) => { now += ms; } };
};

const engineFor = (config, warningSec = 10) => {
  const clock = fakeClock();
  const fired = [];
  const segments = buildTimeline(config);
  const engine = new TimerEngine({
    segments,
    events: buildTimerEvents(segments, { warningSec }),
    onEvent: (ev, info) => fired.push({ ...ev, ...info }),
    now: clock.now,
  });
  return { engine, clock, fired };
};

test('timeline: get-ready, rounds, rests between rounds only', () => {
  const segs = buildTimeline({ roundSec: 180, restSec: 60, rounds: 3, getReadySec: 10 });
  assert.deepEqual(segs.map((s) => s.kind), ['getready', 'round', 'rest', 'round', 'rest', 'round']);
  assert.equal(segs.at(-1).endMs, (10 + 3 * 180 + 2 * 60) * 1000);
  assert.deepEqual(segs.filter((s) => s.kind === 'round').map((s) => s.round), [1, 2, 3]);
});

test('timeline: no get-ready when 0, single round has no rest', () => {
  const segs = buildTimeline({ roundSec: 60, restSec: 30, rounds: 1, getReadySec: 0 });
  assert.deepEqual(segs, [{ kind: 'round', round: 1, startMs: 0, endMs: 60000 }]);
});

test('events: warning 10s before each round end, round-end, done last', () => {
  const segs = buildTimeline({ roundSec: 60, restSec: 30, rounds: 2, getReadySec: 5 });
  const evs = buildTimerEvents(segs, { warningSec: 10 });
  const warnings = evs.filter((e) => e.type === 'warning').map((e) => e.t);
  assert.deepEqual(warnings, [55000, 145000]);
  assert.deepEqual(evs.filter((e) => e.type === 'round-end').map((e) => e.t), [65000, 155000]);
  assert.deepEqual(evs.at(-1), { t: 155000, type: 'done' });
});

test('events: no warning when disabled or round is not longer than the warning', () => {
  const segs = buildTimeline({ roundSec: 10, restSec: 10, rounds: 1 });
  assert.equal(buildTimerEvents(segs, { warningSec: 10 }).some((e) => e.type === 'warning'), false);
  const long = buildTimeline({ roundSec: 60, restSec: 10, rounds: 1 });
  assert.equal(buildTimerEvents(long, { warningSec: 0 }).some((e) => e.type === 'warning'), false);
});

test('engine: start fires the opening phase immediately', () => {
  const { engine, fired } = engineFor({ roundSec: 60, restSec: 30, rounds: 2, getReadySec: 10 });
  engine.start();
  assert.equal(engine.state, 'running');
  assert.deepEqual(fired.map((e) => [e.type, e.kind]), [['phase', 'getready']]);
});

test('engine: events fire in order as time passes, then done', () => {
  const { engine, clock, fired } = engineFor({ roundSec: 60, restSec: 30, rounds: 2, getReadySec: 10 });
  engine.start();
  for (let i = 0; i < 2000; i++) { clock.advance(100); engine.update(); }
  assert.deepEqual(fired.map((e) => e.kind ? `${e.type}:${e.kind}` : e.type), [
    'phase:getready', 'phase:round', 'warning', 'round-end', 'phase:rest',
    'phase:round', 'warning', 'round-end', 'done',
  ]);
  assert.equal(engine.state, 'done');
  assert.ok(fired.every((e) => e.lateMs < 100));
});

test('engine: pause freezes time, resume continues from the same point', () => {
  const { engine, clock } = engineFor({ roundSec: 60, restSec: 30, rounds: 1, getReadySec: 0 });
  engine.start();
  clock.advance(5000); engine.update();
  engine.pause();
  clock.advance(60000); engine.update();
  assert.equal(engine.elapsedMs, 5000);
  assert.equal(engine.state, 'paused');
  engine.start();
  clock.advance(1000); engine.update();
  assert.equal(engine.elapsedMs, 6000);
  assert.equal(engine.status().remainingMs, 54000);
});

test('engine: a long gap (phone asleep) fires missed events once with lateMs', () => {
  const { engine, clock, fired } = engineFor({ roundSec: 60, restSec: 30, rounds: 2, getReadySec: 0 });
  engine.start();
  clock.advance(70000); engine.update();
  const warning = fired.find((e) => e.type === 'warning');
  assert.equal(warning.lateMs, 20000);
  assert.equal(fired.filter((e) => e.type === 'round-end').length, 1);
  assert.equal(engine.status().segment.kind, 'rest');
});

test('engine: reset returns to idle and replays from the start', () => {
  const { engine, clock, fired } = engineFor({ roundSec: 60, restSec: 30, rounds: 1, getReadySec: 0 });
  engine.start();
  clock.advance(30000); engine.update();
  engine.reset();
  assert.equal(engine.state, 'idle');
  assert.equal(engine.elapsedMs, 0);
  fired.length = 0;
  engine.start();
  assert.deepEqual(fired.map((e) => e.type), ['phase']);
});

test('engine: status reports the current segment and seconds left', () => {
  const { engine, clock } = engineFor({ roundSec: 60, restSec: 30, rounds: 2, getReadySec: 10 });
  engine.start();
  clock.advance(12500); engine.update();
  const st = engine.status();
  assert.equal(st.segment.kind, 'round');
  assert.equal(st.segment.round, 1);
  assert.equal(st.remainingMs, 57500);
  assert.equal(engine.totalRounds, 2);
});
