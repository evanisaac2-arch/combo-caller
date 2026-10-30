// Builds recorded voice packs: one short mp3 per phrase in clipScript(), for every coach
// personality, in each voice below. Output goes to voices/<pack>/<personality>/<key>.mp3 plus
// voices/index.json, which the app reads. Needs ffmpeg on PATH.
//
//   OpenAI (the real packs):  set OPENAI_API_KEY, then  npm run voices
//   Options:  --packs male,female   only these packs, in this order
//             --rpm 10 --rpd 50     your account's request limits (default 10/min, 50/day)
//             --force               regenerate clips that already exist
//             --provider sapi       Windows built-in voices, for testing the pipeline offline
//                                   (writes test-* packs; don't publish those)
//
// It stays under both limits on its own: requests are spaced for the per-minute limit, and when
// the day's requests are used up it waits until more are allowed. Every finished clip is saved
// immediately, so it's safe to close the window and run it again later; it skips what's done.

import { mkdir, writeFile, readFile, access, rename, rm, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONALITIES, clipScript } from '../src/personalities.js';
import {
  createLimiter, retryDelayMs, isDailyLimitMessage, isQuotaError, estimateDays, formatWait, MINUTE,
} from './ratelimit.mjs';

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fileURLToPath(new URL('..', import.meta.url));
const voicesDir = join(root, 'voices');
// Timestamps of requests sent in the last day, so the daily count survives a restart.
const usageFile = join(voicesDir, '.openai-usage.json');

const PACKS = [
  { id: 'male-deep', label: 'Male, deep', openai: 'onyx', sapi: 'Microsoft David Desktop' },
  { id: 'male', label: 'Male', openai: 'ash', sapi: 'Microsoft David Desktop' },
  { id: 'female', label: 'Female', openai: 'coral', sapi: 'Microsoft Zira Desktop' },
  { id: 'female-bright', label: 'Female, bright', openai: 'nova', sapi: 'Microsoft Zira Desktop' },
];

const NUMBER_WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
const OPENAI_MODEL = 'gpt-4o-mini-tts';
const OPENAI_URL = `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/audio/speech`;
const MAX_ATTEMPTS = 6; // per clip, for errors other than rate limits

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const provider = option('provider') ?? 'openai';
const onlyPacks = option('packs')?.split(',');
const force = args.includes('--force');
const rpm = Number(option('rpm') ?? 10);
const rpd = Number(option('rpd') ?? 50);

const exists = (path) => access(path).then(() => true, () => false);
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Text actually sent for a clip: single digits as words so every engine says them the same way.
function inputFor(clip) {
  const n = clip.key.match(/^num-(\d)$/)?.[1];
  return n ? NUMBER_WORDS[n] : clip.text;
}

function instructionsFor(personalityId, clip) {
  const base = PERSONALITIES[personalityId].instructions;
  const isPunch = /^(num|name)-/.test(clip.key);
  return isPunch ? `${base} This is a single punch callout: say it quickly and crisply, nothing else.` : base;
}

// ---------- OpenAI with rate limits ----------

async function loadUsage() {
  const data = await readFile(usageFile, 'utf8').then(JSON.parse, () => ({}));
  return Array.isArray(data.history) ? data.history.filter(Number.isFinite).sort((a, b) => a - b) : [];
}

const saveUsage = (history) => writeFile(usageFile, JSON.stringify({ history }));

function announceWait(ms, reason) {
  if (reason === 'day') {
    const until = new Date(Date.now() + ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    console.log(`\n[${clock()}] Daily limit reached (${rpd} per day). Waiting until about ${until} (${formatWait(ms)}).`);
    console.log('  Finished clips are saved. You can leave this open, or close it and run "npm run voices" again later.');
  } else if (ms > MINUTE) {
    console.log(`\n[${clock()}] Rate limited. Waiting ${formatWait(ms)}, then continuing.`);
  }
}

async function openaiClip(limiter, text, voice, instructions) {
  for (let attempt = 1; ; attempt++) {
    const { ms, reason } = limiter.wait();
    if (ms > 0) {
      announceWait(ms, reason);
      await sleep(ms);
    }
    let res;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_MODEL, voice, input: text, instructions, response_format: 'mp3' }),
      });
    } catch (err) {
      // Network hiccup (Wi-Fi drop, laptop woke up): back off and try again.
      if (attempt >= MAX_ATTEMPTS) throw new Error(`Network error: ${err.message}`);
      await sleep(Math.min(5 * MINUTE, 2000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      limiter.record();
      await saveUsage(limiter.history);
      return Buffer.from(await res.arrayBuffer());
    }

    const raw = await res.text();
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON
    }
    const message = body?.error?.message ?? raw;

    if (res.status === 429 && isQuotaError(body)) {
      throw new Error('OpenAI says the account is out of credit (insufficient_quota). Add credit under Settings → Billing, then run this again.');
    }
    if (res.status === 429) {
      // Rate limited after all (e.g. requests made elsewhere today): wait as long as OpenAI says.
      // These don't use up an attempt, since waiting is the fix.
      const daily = isDailyLimitMessage(message);
      const ms = retryDelayMs(res.headers, message) ?? (daily ? 60 * MINUTE : MINUTE);
      announceWait(ms + 1000, daily ? 'day' : 'minute');
      await sleep(ms + 1000);
      attempt--;
      continue;
    }
    if (res.status === 401) throw new Error('OpenAI rejected the API key (401). Check it and enter it again.');
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      limiter.record(); // it may still count toward the limits
      await saveUsage(limiter.history);
      await sleep(Math.min(5 * MINUTE, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${message.slice(0, 300)}`);
  }
}

// ---------- Windows SAPI (test packs) ----------

// One PowerShell run per pack+personality renders all its clips to WAV files.
async function sapiClips(jobs, voice, rate, workDir) {
  const listFile = join(workDir, `sapi-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(listFile, JSON.stringify(jobs.map((j) => ({ text: j.input, out: j.raw }))));
  const script = `
    Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice('${voice}')
    $s.Rate = ${rate}
    foreach ($j in (Get-Content -Raw '${listFile}' | ConvertFrom-Json)) {
      $s.SetOutputToWaveFile($j.out); $s.Speak($j.text)
    }
    $s.Dispose()`;
  await run('powershell.exe', ['-NoProfile', '-Command', script], { maxBuffer: 1 << 24 });
}

// ---------- shared ----------

// Trim leading/trailing silence, mono, small mp3. Written to a temp name and renamed, so a clip
// interrupted halfway is never mistaken for a finished one.
async function finish(raw, out) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  const part = out.replace(/\.mp3$/, '.part.mp3');
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', raw,
    '-af', `${trim},areverse,${trim},areverse`,
    '-ac', '1', '-ar', '24000', '-b:a', '48k', part,
  ]);
  await rename(part, out);
}

const packId = (pack) => (provider === 'sapi' ? `test-${pack.id}` : pack.id);

// Clips still to make for a pack: [{ personalityId, clip, out }].
async function missingClips(pack) {
  const jobs = [];
  for (const personalityId of Object.keys(PERSONALITIES)) {
    for (const clip of clipScript(personalityId)) {
      const out = join(voicesDir, packId(pack), personalityId, `${clip.key}.mp3`);
      if (force || !await exists(out)) jobs.push({ personalityId, clip, out, input: inputFor(clip) });
    }
  }
  return jobs;
}

// A pack is listed only when every clip for every personality exists.
async function complete(id) {
  for (const personalityId of Object.keys(PERSONALITIES)) {
    for (const clip of clipScript(personalityId)) {
      if (!await exists(join(voicesDir, id, personalityId, `${clip.key}.mp3`))) return false;
    }
  }
  return true;
}

// Rewrites voices/index.json with every complete pack (keeping ones this run didn't touch).
async function updateIndex(labels) {
  const indexFile = join(voicesDir, 'index.json');
  const index = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({ packs: [] }));
  const byId = new Map(index.packs.map((p) => [p.id, p]));
  for (const [id, label] of labels) byId.set(id, { id, label });
  const listed = [];
  for (const p of byId.values()) if (await complete(p.id)) listed.push(p);
  await writeFile(indexFile, `${JSON.stringify({ packs: listed }, null, 2)}\n`);
  return listed;
}

async function buildPack(pack, jobs, workDir, limiter) {
  const id = packId(pack);
  const total = jobs.length;
  let made = 0;
  const progress = () => process.stdout.write(`\r${id}: ${made}/${total} clips made`);
  progress();
  for (const personalityId of Object.keys(PERSONALITIES)) {
    const group = jobs.filter((j) => j.personalityId === personalityId);
    if (!group.length) continue;
    await mkdir(join(voicesDir, id, personalityId), { recursive: true });
    for (const job of group) job.raw = join(workDir, `${id}-${personalityId}-${job.clip.key}.${provider === 'sapi' ? 'wav' : 'mp3'}`);
    if (provider === 'sapi') {
      await sapiClips(group, pack.sapi, Math.round((PERSONALITIES[personalityId].rate - 1) * 10), workDir);
    }
    for (const job of group) {
      if (provider === 'openai') {
        await writeFile(job.raw, await openaiClip(limiter, job.input, pack.openai, instructionsFor(personalityId, job.clip)));
      }
      await finish(job.raw, job.out);
      made++;
      progress();
    }
  }
  process.stdout.write('\n');
}

async function main() {
  if (!['openai', 'sapi'].includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Set OPENAI_API_KEY first (or use --provider sapi to test with Windows voices).');
    process.exit(1);
  }
  if (!(rpm > 0 && rpd > 0)) throw new Error('--rpm and --rpd must be positive numbers');
  await mkdir(voicesDir, { recursive: true });

  const packs = onlyPacks ? onlyPacks.map((id) => {
    const p = PACKS.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown pack "${id}". Packs: ${PACKS.map((x) => x.id).join(', ')}`);
    return p;
  }) : PACKS;
  const plan = [];
  for (const pack of packs) plan.push({ pack, jobs: await missingClips(pack) });
  const remaining = plan.reduce((n, p) => n + p.jobs.length, 0);
  const limiter = createLimiter({ rpm, rpd, history: provider === 'openai' ? await loadUsage() : [] });

  if (provider === 'openai') {
    const days = estimateDays(remaining, rpd, limiter.usedToday());
    console.log(`${remaining} clips to make across ${plan.filter((p) => p.jobs.length).length} pack(s).`);
    if (remaining) {
      console.log(`Limits: ${rpm} per minute, ${rpd} per day (${limiter.usedToday()} used in the last 24 h).`);
      const batchMin = Math.ceil(Math.min(remaining, rpd) / rpm);
      console.log(`That's about ${days} day${days === 1 ? '' : 's'}; each day's batch takes roughly ${batchMin} minute${batchMin === 1 ? '' : 's'}.`);
      console.log('Packs become usable one at a time as each finishes.\n');
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), 'combo-voices-'));
  const labels = new Map(packs.map((p) => [packId(p), provider === 'sapi' ? `Test: ${p.label}` : p.label]));
  try {
    for (const { pack, jobs } of plan) {
      if (!jobs.length) {
        console.log(`${packId(pack)}: already complete`);
        continue;
      }
      await buildPack(pack, jobs, workDir, limiter);
      const listed = await updateIndex(labels);
      console.log(`[${clock()}] ${packId(pack)} done. Ready to publish: ${listed.map((p) => p.id).join(', ')}`);
    }
    const listed = await updateIndex(labels);
    console.log(`voices/index.json lists: ${listed.map((p) => p.id).join(', ') || 'nothing'}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  console.error('Finished clips are kept. Fix the problem above, then run "npm run voices" again to continue.');
  process.exit(1);
});
