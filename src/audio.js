// Audio: short synthesized bell and warning sounds through Web Audio. There's no music and no
// <audio> element, and the context is suspended between sounds so it doesn't keep hold of the
// phone's audio output while your music plays.

const BELL_HZ = 700;
// Rough partials of a struck bell (multiples of the fundamental).
const BELL_PARTIALS = [
  [1, 0.3, 1.1],
  [2.76, 0.12, 0.6],
  [5.4, 0.05, 0.3],
];

export function createBeeper(AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext) {
  let ctx = null;
  let suspendTimer = null;

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

  function tone(c, freq, start, dur, peak, type = 'sine') {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  return {
    // Call from a tap (the Start button): mobile browsers only allow audio after a user gesture.
    unlock() {
      const c = ensure();
      if (!c) return;
      tone(c, 440, c.currentTime, 0.02, 0.0002);
      suspendAfter(500);
    },

    // Boxing-style triple ding, for round start and round end.
    bell() {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + 0.03;
      for (let i = 0; i < 3; i++) {
        const s = t0 + i * 0.35;
        for (const [mult, peak, dur] of BELL_PARTIALS) tone(c, BELL_HZ * mult, s, dur, peak);
      }
      suspendAfter(2500);
    },

    // Two short beeps, 10 seconds before the round ends.
    warning() {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + 0.03;
      tone(c, 1000, t0, 0.12, 0.25, 'square');
      tone(c, 1000, t0 + 0.22, 0.12, 0.25, 'square');
      suspendAfter(1000);
    },
  };
}
