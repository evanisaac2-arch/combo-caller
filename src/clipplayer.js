// Clip player: plays pre-recorded voice-pack clips back to back through Web Audio. Like the bell,
// it uses no <audio> element and suspends its audio context between phrases, so it doesn't hold
// on to the phone's audio output while music plays. Clips live at
// voices/<pack>/<personality>/<key>.mp3 and are decoded into memory ahead of time.

import { gapBetweenMs, clipFiles } from './personalities.js';

export function createClipPlayer({
  AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetchClip = (url) => fetch(url),
} = {}) {
  let ctx = null;
  let suspendTimer = null;
  let sources = [];
  const buffers = new Map(); // "<pack>/<personality>/<key>" -> AudioBuffer

  const id = (pack, personality, key) => `${pack}/${personality}/${key}`;

  function ensure() {
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    clearTimeout(suspendTimer);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function suspendAfter(ms) {
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => ctx?.suspend().catch(() => {}), ms);
  }

  return {
    supported: Boolean(AudioCtx),

    // Fetches and decodes any of these clips not already in memory, trying a re-recorded clip's
    // newest file first and its older one if that's not there yet. Missing clips are skipped;
    // has() then reports false and the caller falls back to TTS.
    async load(pack, personality, keys) {
      if (!AudioCtx) return;
      if (!ctx) ctx = new AudioCtx(); // decoding works on a suspended context, no tap needed
      await Promise.all(keys.map(async (key) => {
        const k = id(pack, personality, key);
        if (buffers.has(k)) return;
        for (const file of clipFiles(key)) {
          try {
            const res = await fetchClip(`voices/${pack}/${personality}/${file}.mp3`);
            if (!res.ok) continue;
            buffers.set(k, await ctx.decodeAudioData(await res.arrayBuffer()));
            return;
          } catch {
            // offline and not cached, or a bad file: try the next one
          }
        }
      }));
    },

    has(pack, personality, keys) {
      return keys.every((key) => buffers.has(id(pack, personality, key)));
    },

    // Plays the clips in order, replacing anything still playing. Always at natural speed: Web
    // Audio can only speed a clip up by raising its pitch, and the clips already have a coach's
    // cadence built in.
    play(pack, personality, keys, { volume = 1 } = {}) {
      this.stop();
      const c = ensure();
      if (!c) return;
      const gain = c.createGain();
      gain.gain.value = volume;
      gain.connect(c.destination);
      let t = c.currentTime + 0.03;
      keys.forEach((key, i) => {
        const buffer = buffers.get(id(pack, personality, key));
        if (!buffer) return;
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(gain);
        src.start(t);
        sources.push(src);
        t += buffer.duration;
        if (i < keys.length - 1) t += gapBetweenMs(key, keys[i + 1]) / 1000;
      });
      suspendAfter((t - c.currentTime) * 1000 + 600);
    },

    stop() {
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          // already finished
        }
      }
      sources = [];
    },
  };
}
