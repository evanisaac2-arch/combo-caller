// Storage: settings and saved drill lists in localStorage. The backend is injectable so a native
// wrapper (e.g. Capacitor Preferences behind a sync cache) or a test fake can replace it.

import { PRESET_DRILLS } from './combos.js';

export const STORAGE_KEY = 'combo-caller:v1';
export const STARTER_DRILL_ID = 'preset-starter';

export const DEFAULT_SETTINGS = Object.freeze({
  roundSec: 180,
  restSec: 60,
  rounds: 3,
  getReadySec: 10,
  warning: true,
  intervalSec: 5,
  scaleByLength: false,
  style: 'numbers', // numbers | names
  source: 'preset-starter', // a drill id
  order: 'random', // random | inorder
  repeatOne: false,
  voiceURI: '',
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
      const drills = isObject(data) && Array.isArray(data.drills) ? data.drills.filter(isDrill) : [];
      seedPresets(drills, seededIds(data));
      return { settings, drills };
    },

    save({ settings, drills }) {
      try {
        const seededPresets = PRESET_DRILLS.map((p) => p.id);
        backend.setItem(STORAGE_KEY, JSON.stringify({ settings, drills, seededPresets }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
