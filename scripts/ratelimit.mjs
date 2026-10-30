// Rate limiting for the voice-pack generator: spaces requests to stay under a per-minute limit,
// keeps a rolling 24-hour count for the daily limit, and works out how long to wait after a 429.
// Pure helpers with an injectable clock so they can be tested.

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

// "6m0s", "1h2m3.5s", "8.64s", "20ms" -> milliseconds, or null if it isn't a duration.
export function parseDuration(text) {
  if (!text) return null;
  const s = String(text).trim().replace(/\.$/, '');
  const msOnly = s.match(/^([\d.]+)ms$/);
  if (msOnly) return Math.ceil(Number(msOnly[1]));
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const seconds = (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
  return Math.ceil(seconds * 1000);
}

// How long a 429 response says to wait: retry-after-ms / retry-after headers, else the
// "Please try again in 6m0s" text OpenAI puts in the error message. null if neither says.
export function retryDelayMs(headers, message) {
  const header = (name) => headers?.get?.(name) ?? null;
  const ms = Number(header('retry-after-ms'));
  if (ms > 0) return ms;
  const seconds = Number(header('retry-after'));
  if (seconds > 0) return seconds * 1000;
  return parseDuration(String(message ?? '').match(/try again in ([\d.hms]+)/i)?.[1]);
}

export const isDailyLimitMessage = (message) => /per day|\bRPD\b/i.test(String(message ?? ''));

// Out of credit, as opposed to a rate limit: waiting won't help.
export const isQuotaError = (body) => body?.error?.code === 'insufficient_quota' || body?.error?.type === 'insufficient_quota';

// history: timestamps of requests already sent (oldest first), e.g. loaded from disk so the daily
// count survives closing the script.
export function createLimiter({ rpm, rpd, history = [], now = Date.now }) {
  // Even spacing keeps bursts from tripping the per-minute limit; the margin absorbs clock jitter.
  const gap = Math.ceil(MINUTE / rpm) + 250;
  const prune = () => {
    const t = now();
    const keep = history.filter((x) => t - x < DAY);
    history.splice(0, history.length, ...keep);
    return t;
  };
  return {
    history,

    // Milliseconds until the next request may be sent (0 = now), and which limit is the reason.
    wait() {
      const t = prune();
      let ms = 0;
      let reason = null;
      const last = history[history.length - 1];
      if (last !== undefined && last + gap - t > ms) {
        ms = last + gap - t;
        reason = 'minute';
      }
      if (history.length >= rpd) {
        // The window frees up when the oldest of the last rpd requests is a day old.
        const free = history[history.length - rpd] + DAY - t;
        if (free > ms) {
          ms = free;
          reason = 'day';
        }
      }
      return { ms: Math.max(0, ms), reason };
    },

    record() {
      history.push(now());
    },

    usedToday() {
      prune();
      return history.length;
    },
  };
}

// Days needed for `count` more requests when `usedToday` of today's allowance is already gone.
export function estimateDays(count, rpd, usedToday = 0) {
  if (count <= 0) return 0;
  const today = Math.max(0, rpd - usedToday);
  if (count <= today) return 1;
  return 1 + Math.ceil((count - today) / rpd);
}

export function formatWait(ms) {
  const minutes = Math.ceil(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
