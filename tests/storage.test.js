import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, DEFAULT_SETTINGS, STORAGE_KEY } from '../src/storage.js';

const memoryBackend = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

test('empty storage loads defaults', () => {
  const { settings, drills } = createStorage(memoryBackend()).load();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(drills, []);
});

test('save and load round-trip', () => {
  const backend = memoryBackend();
  const store = createStorage(backend);
  const data = {
    settings: { ...DEFAULT_SETTINGS, rounds: 6, style: 'names' },
    drills: [{ id: 'd1', name: 'Hooks', combos: ['1-2-3', '3-2'] }],
  };
  assert.equal(store.save(data), true);
  assert.deepEqual(createStorage(backend).load(), data);
});

test('corrupt JSON and wrong types fall back to defaults', () => {
  const backend = memoryBackend();
  backend.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(createStorage(backend).load().settings, DEFAULT_SETTINGS);

  backend.setItem(STORAGE_KEY, JSON.stringify({
    settings: { rounds: 'lots', rate: 1.5, extra: true },
    drills: [{ id: 'ok', name: 'Fine', combos: ['1'] }, { id: 3, name: 'bad' }, null],
  }));
  const { settings, drills } = createStorage(backend).load();
  assert.equal(settings.rounds, DEFAULT_SETTINGS.rounds);
  assert.equal(settings.rate, 1.5);
  assert.equal('extra' in settings, false);
  assert.deepEqual(drills.map((d) => d.id), ['ok']);
});

test('save reports failure instead of throwing (quota, private mode)', () => {
  const store = createStorage({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.equal(store.save({ settings: DEFAULT_SETTINGS, drills: [] }), false);
});

test('missing localStorage still loads defaults', () => {
  assert.deepEqual(createStorage(undefined).load().settings, DEFAULT_SETTINGS);
});
