import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, resolveCombos, ROUND_SOON_MS } from '../src/session.js';
import { STARTER_COMBOS } from '../src/combos.js';
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

test('no combos means a plain round timer', () => {
  const { events } = buildSession(settings(), []);
  assert.equal(events.some((e) => e.type === 'callout'), false);
  assert.equal(events.at(-1).type, 'done');
});

test('resolveCombos: starter set, a saved drill, unknown drill, empty drill', () => {
  const drills = [
    { id: 'a', name: 'Jab work', combos: ['1', '1-1', 'oops'] },
    { id: 'b', name: 'Empty', combos: [] },
  ];
  assert.equal(resolveCombos(settings({ source: 'starter' }), drills).length, STARTER_COMBOS.length);
  assert.deepEqual(resolveCombos(settings({ source: 'a' }), drills), [[1], [1, 1]]);
  assert.equal(resolveCombos(settings({ source: 'gone' }), drills).length, STARTER_COMBOS.length);
  assert.deepEqual(resolveCombos(settings({ source: 'b' }), drills), []);
});
