// Storage: settings and saved drill lists in localStorage. The backend is injectable so a native
// wrapper (e.g. Capacitor Preferences behind a sync cache) or a test fake can replace it.

import { PRESET_DRILLS } from './combos.js';

export const STORAGE_KEY = 'combo-caller:v1';
export const STARTER_DRILL_ID = 'preset-starter';
// Bumped when defaults change in a way saved settings should pick up once (see upgrade()).
export const SETTINGS_VERSION = 2;
export const MAX_GET_READY_SEC = 10;

export const DEFAULT_SETTINGS = Object.freeze({
  roundSec: 180,
  restSec: 60,
  rounds: 3,
  getReadySec: 3,
  warning: true,
  intervalSec: 5,
  scaleByLength: false,
  style: 'names', // names | numbers
  source: 'preset-starter', // a drill id
  order: 'random', // random | inorder
  repeatOne: false,
  voiceURI: '',
  voicePack: '', // a recorded voice pack id from voices/index.json; '' uses the phone's TTS
  personality: 'plain', // a key of PERSONALITIES
  rate: 1,
  volume: 1,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const isDrill = (d) =>
  isObject(d) &&
  typeof d.id === 'string' &&
  typeof d.name === 'string' &&
  Array.isArray(d.combos) &&
  d.combos.every((c) => typeof c === 'string');

// Presets this user has already been given. Older saves only had a presetsSeeded flag, which
// meant the original five.
const LEGACY_PRESET_IDS = ['preset-jab-cross', 'preset-lead-hook', 'preset-rear-hook', 'preset-uppercuts', 'preset-long'];

function seededIds(data) {
  if (!isObject(data)) return new Set();
  if (Array.isArray(data.seededPresets)) return new Set(data.seededPresets);
  return new Set(data.presetsSeeded ? LEGACY_PRESET_IDS : []);
}

// Each preset is added once, so one the user deletes stays deleted. A preset added in a later
// version goes in its preset-list position, ahead of the presets that follow it.
function seedPresets(drills, seeded) {
  PRESET_DRILLS.forEach((preset, i) => {
    if (seeded.has(preset.id) || drills.some((d) => d.id === preset.id)) return;
    const laterIds = PRESET_DRILLS.slice(i + 1).map((p) => p.id);
    const at = drills.findIndex((d) => laterIds.includes(d.id));
    drills.splice(at === -1 ? drills.length : at, 0, structuredClone(preset));
  });
}

// Presets whose contents changed after they shipped: a saved copy still exactly as it was first
// given is brought up to date; one the user has edited is left alone.
const PRESET_REVISIONS = { 'preset-jab-rear-hook': { name: 'Jab & rear hook', combos: ['1-4'] } };

function revisePresets(drills) {
  for (const drill of drills) {
    const old = PRESET_REVISIONS[drill.id];
    const preset = PRESET_DRILLS.find((p) => p.id === drill.id);
    if (!old || !preset || drill.name !== old.name || drill.combos.join() !== old.combos.join()) continue;
    drill.name = preset.name;
    drill.combos = [...preset.combos];
  }
}

// One-time changes for settings saved by an older version. Version 2: get-ready went from a
// 10 s default (0–60 s) to 3 s (0–10 s), and punch names became the default call-out style.
function upgrade(settings, version) {
  if (version < 2) {
    if (settings.getReadySec === 10) settings.getReadySec = DEFAULT_SETTINGS.getReadySec;
    if (settings.style === 'numbers') settings.style = 'names';
  }
  settings.getReadySec = Math.min(settings.getReadySec, MAX_GET_READY_SEC);
}

export function createStorage(backend = globalThis.localStorage) {
  return {
    load() {
      let data = {};
      try {
        const raw = backend?.getItem(STORAGE_KEY);
        if (raw) data = JSON.parse(raw);
      } catch {
        data = {};
      }
      const stored = isObject(data) && isObject(data.settings) ? data.settings : {};
      const settings = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) settings[key] = stored[key];
      }
      // The starter set used to be a built-in source rather than a drill.
      if (settings.source === 'starter') settings.source = STARTER_DRILL_ID;
      if (isObject(data) && isObject(data.settings)) {
        upgrade(settings, Number.isInteger(data.settingsVersion) ? data.settingsVersion : 1);
      }
      const drills = isObject(data) && Array.isArray(data.drills) ? data.drills.filter(isDrill) : [];
      revisePresets(drills);
      seedPresets(drills, seededIds(data));
      return { settings, drills };
    },

    save({ settings, drills }) {
      try {
        const seededPresets = PRESET_DRILLS.map((p) => p.id);
        backend.setItem(STORAGE_KEY, JSON.stringify({ settings, drills, seededPresets, settingsVersion: SETTINGS_VERSION }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
