import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTE, DAY, parseDuration, retryDelayMs, isDailyLimitMessage, isQuotaError,
  createLimiter, estimateDays, formatWait,
} from '../scripts/ratelimit.mjs';

const headers = (obj) => ({ get: (k) => obj[k] ?? null });

test('parseDuration reads OpenAI-style durations', () => {
  assert.equal(parseDuration('20ms'), 20);
  assert.equal(parseDuration('8.64s'), 8640);
  assert.equal(parseDuration('6m0s'), 360_000);
  assert.equal(parseDuration('1h2m3s'), 3_723_000);
  assert.equal(parseDuration('28m48s.'), 1_728_000);
  for (const bad of [null, '', 'soon', 'm', '5 minutes']) assert.equal(parseDuration(bad), null, String(bad));
});

test('retryDelayMs prefers headers, then the message', () => {
  assert.equal(retryDelayMs(headers({ 'retry-after-ms': '1500' }), 'try again in 9s'), 1500);
  assert.equal(retryDelayMs(headers({ 'retry-after': '7' }), ''), 7000);
  const msg = 'Rate limit reached for gpt-4o-mini-tts on requests per day (RPD): Limit 50, Used 50, Requested 1. Please try again in 28m48s. Visit ...';
  assert.equal(retryDelayMs(headers({}), msg), 1_728_000);
  assert.equal(retryDelayMs(headers({}), 'Rate limit reached'), null);
});

test('daily vs per-minute messages, and out-of-credit errors', () => {
  assert.equal(isDailyLimitMessage('on requests per day (RPD): Limit 50'), true);
  assert.equal(isDailyLimitMessage('on requests per min (RPM): Limit 10'), false);
  assert.equal(isQuotaError({ error: { code: 'insufficient_quota' } }), true);
  assert.equal(isQuotaError({ error: { code: 'rate_limit_exceeded' } }), false);
});

test('limiter spaces requests to fit the per-minute limit', () => {
  let t = 0;
  const lim = createLimiter({ rpm: 10, rpd: 50, now: () => t });
  assert.deepEqual(lim.wait(), { ms: 0, reason: null });
  lim.record();
  const { ms, reason } = lim.wait();
  assert.equal(reason, 'minute');
  assert.equal(ms, 6250); // 60 s / 10 + margin
  // Ten requests at that spacing never put more than 10 inside any 60 s window.
  for (let i = 0; i < 20; i++) {
    t += lim.wait().ms;
    lim.record();
  }
  for (const x of lim.history) assert.ok(lim.history.filter((y) => y >= x && y < x + MINUTE).length <= 10);
});

test('limiter waits for the rolling day once the daily count is used', () => {
  let t = 0;
  const lim = createLimiter({ rpm: 10, rpd: 3, now: () => t });
  for (let i = 0; i < 3; i++) {
    t += lim.wait().ms;
    lim.record();
  }
  const first = lim.history[0];
  const { ms, reason } = lim.wait();
  assert.equal(reason, 'day');
  assert.equal(t + ms, first + DAY);
  t = first + DAY;
  assert.equal(lim.wait().ms, 0);
  assert.equal(lim.usedToday(), 2);
});

test('history loaded from disk counts toward today', () => {
  const t = 10 * DAY;
  const lim = createLimiter({ rpm: 10, rpd: 50, now: () => t, history: [t - DAY - 1, t - 3 * MINUTE, t - 2 * MINUTE] });
  assert.equal(lim.usedToday(), 2); // the day-old one dropped off
});

test('estimates and wait formatting', () => {
  assert.equal(estimateDays(696, 50), 14);
  assert.equal(estimateDays(174, 50), 4);
  assert.equal(estimateDays(40, 50, 20), 2);
  assert.equal(estimateDays(0, 50), 0);
  assert.equal(formatWait(45_000), '1 min');
  assert.equal(formatWait(90 * MINUTE), '1 h 30 min');
  assert.equal(formatWait(5 * 60 * MINUTE), '5 h');
});
