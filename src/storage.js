// Storage: settings and saved drill lists in localStorage. The backend is injectable so a native
// wrapper (e.g. Capacitor Preferences behind a sync cache) or a test fake can replace it.

import { PRESET_DRILLS } from './combos.js';

export const STORAGE_KEY = 'combo-caller:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  roundSec: 180,
  restSec: 60,
  rounds: 3,
  getReadySec: 10,
  warning: true,
  intervalSec: 5,
  scaleByLength: false,
  style: 'numbers', // numbers | names
  source: 'starter', // 'starter' or a drill id
  order: 'random', // random | inorder
  repeatOne: false,
  voiceURI: '',
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
      const drills = isObject(data) && Array.isArray(data.drills) ? data.drills.filter(isDrill) : [];
      // Presets are added once (also for data saved before presets existed); after the first save
      // the flag is set, so a preset the user deletes stays deleted.
      if (!(isObject(data) && data.presetsSeeded)) {
        for (const preset of PRESET_DRILLS) {
          if (!drills.some((d) => d.id === preset.id)) drills.push(structuredClone(preset));
        }
      }
      return { settings, drills };
    },

    save({ settings, drills }) {
      try {
        backend.setItem(STORAGE_KEY, JSON.stringify({ settings, drills, presetsSeeded: true }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
