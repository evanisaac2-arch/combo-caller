// Session builder: joins the timer timeline with planned combo callouts for every round.

import { buildTimeline, buildTimerEvents, sortEvents } from './timer.js';
import { STARTER_COMBOS, createPicker, parseCombo, planRoundCallouts } from './combos.js';

export const WARNING_SEC = 10;
// A "round coming up" cue fires this long before each round, if the get-ready or rest before it
// is long enough to fit it.
export const ROUND_SOON_MS = 3500;

// Combos (as punch arrays) for the selected source. An unknown drill falls back to the starter set;
// a known drill with no valid combos returns [] so the UI can say so.
export function resolveCombos(settings, drills) {
  const drill = settings.source !== 'starter' ? drills.find((d) => d.id === settings.source) : null;
  const list = drill ? drill.combos : STARTER_COMBOS;
  return list.map(parseCombo).filter(Boolean);
}

export function buildSession(settings, combos, { rng = Math.random } = {}) {
  const segments = buildTimeline(settings);
  const events = buildTimerEvents(segments, { warningSec: settings.warning ? WARNING_SEC : 0 });
  segments.forEach((seg, i) => {
    const prev = segments[i - 1];
    if (seg.kind === 'round' && prev && prev.endMs - prev.startMs > ROUND_SOON_MS + 1000) {
      events.push({ t: seg.startMs - ROUND_SOON_MS, type: 'cue', cue: 'roundSoon', round: seg.round });
    }
  });
  if (combos.length) {
    const picker = createPicker(combos, { order: settings.order, rng });
    for (const seg of segments) {
      if (seg.kind !== 'round') continue;
      for (const c of planRoundCallouts(seg.startMs, seg.endMs, picker, settings)) {
        events.push({ t: c.t, type: 'callout', round: seg.round, punches: c.punches });
      }
    }
  }
  return { segments, events: sortEvents(events) };
}
