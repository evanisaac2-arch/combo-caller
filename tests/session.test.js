import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, currentDrill, resolveCombos, ROUND_SOON_MS } from '../src/session.js';
import { STARTER_COMBOS, PRESET_DRILLS } from '../src/combos.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

test('callouts land only inside rounds, never in get-ready or rest', () => {
  const s = settings({ roundSec: 60, restSec: 30, rounds: 3, getReadySec: 10 });
  const { segments, events } = buildSession(s, resolveCombos(s, []), { rng: () => 0.3 });
  const callouts = events.filter((e) => e.type === 'callout');
  assert.ok(callouts.length > 0);
  for (const c of callouts) {
    const seg = segments.find((x) => c.t >= x.startMs && c.t < x.endMs);
    assert.equal(seg.kind, 'round');
    assert.equal(seg.round, c.round);
  }
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t);
});

test('warning toggle controls the 10-second warning', () => {
  const on = buildSession(settings({ warning: true }), [[1]]);
  const off = buildSession(settings({ warning: false }), [[1]]);
  assert.equal(on.events.filter((e) => e.type === 'warning').length, DEFAULT_SETTINGS.rounds);
  assert.equal(off.events.filter((e) => e.type === 'warning').length, 0);
});

test('round-coming-up cue lands before each round that has a get-ready or rest in front', () => {
  const s = settings({ roundSec: 60, restSec: 30, rounds: 3, getReadySec: 10 });
  const { segments, events } = buildSession(s, [[1]]);
  const cues = events.filter((e) => e.type === 'cue');
  const rounds = segments.filter((x) => x.kind === 'round');
  assert.deepEqual(cues.map((c) => c.round), [1, 2, 3]);
  cues.forEach((c, i) => assert.equal(c.t, rounds[i].startMs - ROUND_SOON_MS));

  const noReady = buildSession(settings({ getReadySec: 0, rounds: 2 }), [[1]]);
  assert.deepEqual(noReady.events.filter((e) => e.type === 'cue').map((c) => c.round), [2]);

  const shortReady = buildSession(settings({ getReadySec: 4, rounds: 1 }), [[1]]);
  assert.equal(shortReady.events.some((e) => e.type === 'cue'), false);
});

test('get-ready counts down once per second, ending a second before round 1', () => {
  const { segments, events } = buildSession(settings({ getReadySec: 3 }), [[1]]);
  const counts = events.filter((e) => e.type === 'count');
  assert.deepEqual(counts.map((c) => [c.t, c.n]), [[0, 3], [1000, 2], [2000, 1]]);
  assert.equal(segments.find((s) => s.kind === 'round').startMs, 3000);
  assert.equal(buildSession(settings({ getReadySec: 0 }), [[1]]).events.some((e) => e.type === 'count'), false);
});

test('no combos means a plain round timer', () => {
  const { events } = buildSession(settings(), []);
  assert.equal(events.some((e) => e.type === 'callout'), false);
  assert.equal(events.at(-1).type, 'done');
});

test('resolveCombos: selected drill, deleted drill, empty drill, no drills at all', () => {
  const drills = [
    { id: 'a', name: 'Jab work', combos: ['1', '1-1', 'oops'] },
    { id: 'b', name: 'Empty', combos: [] },
    { id: 'c', name: 'Hooks', combos: ['3'] },
  ];
  assert.deepEqual(resolveCombos(settings({ source: 'c' }), drills), [[3]]);
  assert.deepEqual(resolveCombos(settings({ source: 'a' }), drills), [[1], [1, 1]]);
  assert.deepEqual(resolveCombos(settings({ source: 'b' }), drills), []);
  // A deleted (unknown) drill falls back to the first drill, matching what the Timer page highlights.
  assert.equal(currentDrill(settings({ source: 'gone' }), drills).id, 'a');
  assert.deepEqual(resolveCombos(settings({ source: 'gone' }), drills), [[1], [1, 1]]);
  assert.equal(currentDrill(settings(), []), null);
  assert.equal(resolveCombos(settings(), []).length, STARTER_COMBOS.length);
});

test('the default source is the Starter set preset', () => {
  const drills = PRESET_DRILLS.map((d) => ({ ...d }));
  assert.equal(currentDrill(settings(), drills).name, 'Starter set');
  assert.equal(resolveCombos(settings(), drills).length, STARTER_COMBOS.length);
});
