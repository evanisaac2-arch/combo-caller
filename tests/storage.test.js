import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, DEFAULT_SETTINGS, STORAGE_KEY } from '../src/storage.js';
import { PRESET_DRILLS } from '../src/combos.js';

const presetIds = PRESET_DRILLS.map((d) => d.id);

const memoryBackend = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

test('empty storage loads defaults and the preset drills', () => {
  const { settings, drills } = createStorage(memoryBackend()).load();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(drills, PRESET_DRILLS);
});

test('a deleted preset stays deleted after saving', () => {
  const backend = memoryBackend();
  const store = createStorage(backend);
  const data = store.load();
  data.drills = data.drills.filter((d) => d.id !== presetIds[0]);
  store.save(data);
  assert.deepEqual(createStorage(backend).load().drills.map((d) => d.id), presetIds.slice(1));
});

test('presets are added to data saved before presets existed, keeping user drills', () => {
  const backend = memoryBackend();
  backend.setItem(STORAGE_KEY, JSON.stringify({
    settings: DEFAULT_SETTINGS,
    drills: [{ id: 'mine', name: 'Mine', combos: ['1-2'] }],
  }));
  assert.deepEqual(createStorage(backend).load().drills.map((d) => d.id), ['mine', ...presetIds]);
});

test('upgrade from the five-preset version: Starter set is added first, old source migrated', () => {
  const backend = memoryBackend();
  const five = PRESET_DRILLS.filter((d) => d.id !== 'preset-starter');
  backend.setItem(STORAGE_KEY, JSON.stringify({
    settings: { ...DEFAULT_SETTINGS, source: 'starter' },
    drills: [...five.slice(1), { id: 'mine', name: 'Mine', combos: ['1-2'] }], // user deleted one preset
    presetsSeeded: true,
  }));
  const { settings, drills } = createStorage(backend).load();
  assert.equal(settings.source, 'preset-starter');
  assert.deepEqual(drills.map((d) => d.id), ['preset-starter', ...five.slice(1).map((d) => d.id), 'mine']);
});

test('a deleted Starter set stays deleted', () => {
  const backend = memoryBackend();
  const store = createStorage(backend);
  const data = store.load();
  data.drills = data.drills.filter((d) => d.id !== 'preset-starter');
  store.save(data);
  assert.equal(createStorage(backend).load().drills.some((d) => d.id === 'preset-starter'), false);
});

test('loading presets does not let edits leak into the shared preset list', () => {
  const { drills } = createStorage(memoryBackend()).load();
  drills[0].combos.push('6-6');
  assert.equal(PRESET_DRILLS[0].combos.includes('6-6'), false);
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
  assert.deepEqual(drills.map((d) => d.id), ['ok', ...presetIds]);
});

test('save reports failure instead of throwing (quota, private mode)', () => {
  const store = createStorage({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.equal(store.save({ settings: DEFAULT_SETTINGS, drills: [] }), false);
});

test('missing localStorage still loads defaults', () => {
  assert.deepEqual(createStorage(undefined).load().settings, DEFAULT_SETTINGS);
});
