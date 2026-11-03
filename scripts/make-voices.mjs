// Builds recorded voice packs: one short mp3 per phrase in clipScript(), for every coach
// personality, in each voice below. Output goes to voices/<pack>/<personality>/<key>.mp3 plus
// voices/index.json, which the app reads. Needs ffmpeg on PATH.
//
//   OpenAI (the real packs):  set OPENAI_API_KEY, then  node scripts/make-voices.mjs
//   (or npm run voices, where PowerShell allows npm's launcher script)
//   Options:  --packs male,female   only these packs, in this order
//             --rpm 10 --rpd 50     your account's request limits (default 10/min, 50/day)
//             --force               regenerate clips that already exist
//             --no-batch            one request per clip instead of batches
//             --provider sapi       Windows built-in voices, for testing the pipeline offline
//                                   (writes test-* packs; don't publish those)
//
// Batching: each request reads a group of lines with long pauses between them, and the recording
// is cut at those pauses into one clip per line, so a pack takes about 16 requests instead of
// 174. A batch is only cut when the pauses clearly mark the expected number of lines; otherwise
// it's re-requested as two halves, down to one line per request, so a bad split never becomes a
// mislabeled clip.
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
import { PERSONALITIES, clipScript, clipFiles } from '../src/personalities.js';
import {
  createLimiter, retryDelayMs, isDailyLimitMessage, isQuotaError, estimateDays, formatWait, MINUTE,
} from './ratelimit.mjs';
import { parseSilences, lineRanges, plausibleSplit, chunk } from './split.mjs';

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fileURLToPath(new URL('..', import.meta.url));
const voicesDir = join(root, 'voices');
// Timestamps of requests sent in the last day, so the daily count survives a restart.
const usageFile = join(voicesDir, '.openai-usage.json');
// Batch recordings that wouldn't split, kept for diagnosis (git-ignored).
const debugDir = join(voicesDir, '.debug');

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
// Lines per request, by kind of clip. Longer lines get smaller batches, so a batch that won't
// split cleanly costs less to redo.
const BATCH_SIZE = { punch: 12, round: 15, line: 8 };
// Punch words come out spoken slowly and deliberately, one at a time. Speeding them up (pitch
// kept) gives combos a coach's real cadence.
const PUNCH_TEMPO = 1.5;

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const provider = option('provider') ?? 'openai';
const onlyPacks = option('packs')?.split(',');
const force = args.includes('--force');
const batching = !args.includes('--no-batch');
const rpm = Number(option('rpm') ?? 10);
const rpd = Number(option('rpd') ?? 50);

const exists = (path) => access(path).then(() => true, () => false);
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Text actually sent for a clip: single digits as words so every engine says them the same way,
// and "lead" spelled properly (the phone TTS gets "leed", but voice services stretch that vowel
// out; instructionsFor tells them how to say "lead" instead).
const INPUT_OVERRIDES = { 'name-3': 'lead hook', 'name-5': 'lead uppercut' };

function inputFor(clip) {
  const n = clip.key.match(/^num-(\d)$/)?.[1];
  return n ? NUMBER_WORDS[n] : INPUT_OVERRIDES[clip.key] ?? clip.text;
}

// Newest file name for a clip (a re-recorded clip gets a new one, see CLIP_REVISIONS).
const clipPath = (id, personalityId, key) => join(voicesDir, id, personalityId, `${clipFiles(key)[0]}.mp3`);

const kindOf = (clip) => (/^(num|name|move|mod)-/.test(clip.key) ? 'punch' : clip.key.startsWith('round-') ? 'round' : 'line');

function instructionsFor(personalityId, clip, batchSize = 1) {
  let text = PERSONALITIES[personalityId].instructions;
  if (kindOf(clip) === 'punch') {
    text += batchSize > 1
      ? ' Each line is a single punch or move callout: say it quickly and crisply.'
      : ' This is a single punch or move callout: say it quickly and crisply, nothing else.';
    text += ' "Lead" means the front hand: say it like "leader" (rhymes with "need"), short and clipped, never drawn out.';
  }
  if (batchSize > 1) {
    text += ' You are reading a list of separate lines that will be cut into individual audio clips.'
      + ' Read each line exactly as written, as its own complete utterance in the same tone, then stay'
      + ' completely silent for two full seconds before the next line. Never add, skip or number lines.';
  }
  return text;
}

// One line per paragraph, each ending in punctuation so it's read as a finished sentence.
const batchInput = (jobs) => jobs.map((j) => (/[.!?]$/.test(j.input) ? j.input : `${j.input}.`)).join('\n\n');

// Requests needed for these clips, assuming every batch splits cleanly.
function requestsFor(jobs) {
  if (!batching) return jobs.length;
  let n = 0;
  for (const personalityId of Object.keys(PERSONALITIES)) {
    for (const kind of Object.keys(BATCH_SIZE)) {
      const count = jobs.filter((j) => j.personalityId === personalityId && kindOf(j.clip) === kind).length;
      n += Math.ceil(count / BATCH_SIZE[kind]);
    }
  }
  return n;
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
    console.log('  Finished clips are saved. You can leave this open, or close it and run "node scripts/make-voices.mjs" again later.');
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

// Trim leading/trailing silence, mono, small mp3; optionally only the { from, to } part of the
// recording, and sped up by `tempo` (pitch kept). Written to a temp name and renamed, so a clip
// interrupted halfway is never mistaken for a finished one.
async function finish(raw, out, range = null, tempo = 1) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  const speed = tempo !== 1 ? `,atempo=${tempo}` : '';
  const part = out.replace(/\.mp3$/, '.part.mp3');
  // The cut goes before -i so ffmpeg only reads that slice and the filters see all of it; as
  // output options, -to can end the output before the reversed trim is done and clip the line.
  const cut = range ? ['-ss', range.from.toFixed(3), '-to', range.to.toFixed(3)] : [];
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', ...cut, '-i', raw,
    '-af', `${trim},areverse,${trim},areverse${speed}`,
    '-ac', '1', '-ar', '24000', '-b:a', '48k', part,
  ]);
  await rename(part, out);
}

const tempoFor = (clip) => (kindOf(clip) === 'punch' ? PUNCH_TEMPO : 1);

// Finishes one clip and, for a re-recorded clip, removes the older version it replaces.
async function finishClip(raw, job, range) {
  await finish(raw, job.out, range, tempoFor(job.clip));
  const dir = join(job.out, '..');
  for (const older of clipFiles(job.clip.key).slice(1)) await rm(join(dir, `${older}.mp3`), { force: true });
}

// Silence levels to try, strict to loose. Real voices leave breaths and room tone between lines,
// so a strict level can miss the breaks; a loose one can find breaks inside words. Whichever
// level first gives a split whose pieces also fit their words wins.
const SILENCE_DB = [-45, -40, -35, -30];
const BREAK_RULES = { minBreak: 0.35, ratio: 1.25 };

// Where each line sits in a batch recording: { ranges, attempts }. ranges is null if no level
// gives a split that passes both checks; attempts says what each level found (for debugging).
async function findLines(raw, texts) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]);
  const total = Number(stdout.trim());
  const attempts = [];
  for (const db of SILENCE_DB) {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', raw, '-af', `silencedetect=noise=${db}dB:d=0.15`, '-f', 'null', '-'], { maxBuffer: 1 << 24 });
    const silences = parseSilences(stderr, total);
    const ranges = lineRanges(silences, total, texts.length, BREAK_RULES);
    const ok = plausibleSplit(ranges, texts);
    attempts.push({ db, silences: silences.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]), split: Boolean(ranges), plausible: ok });
    if (ok) return { ranges, attempts, total };
  }
  return { ranges: null, attempts, total };
}

// Keeps a batch that wouldn't split, with what was tried, so the cause can be looked at.
async function saveFailedBatch(raw, name, texts, found) {
  await mkdir(debugDir, { recursive: true });
  await writeFile(join(debugDir, `${name}.mp3`), await readFile(raw));
  await writeFile(join(debugDir, `${name}.json`), `${JSON.stringify({ texts, total: found.total, attempts: found.attempts }, null, 1)}\n`);
}

// Makes these clips (same personality and kind) with as few requests as possible: the whole group
// in one request, cut at the pauses; if that doesn't split cleanly, each half on its own.
async function makeBatch(limiter, pack, personalityId, jobs, workDir, onClip, stats) {
  const first = jobs[0];
  const raw = join(workDir, `${packId(pack)}-${personalityId}-${first.clip.key}-x${jobs.length}.mp3`);
  const input = jobs.length === 1 ? first.input : batchInput(jobs);
  await writeFile(raw, await openaiClip(limiter, input, pack.openai, instructionsFor(personalityId, first.clip, jobs.length)));
  stats.requests++;
  if (jobs.length === 1) {
    await finishClip(raw, first, null);
    onClip();
    return;
  }
  const texts = jobs.map((j) => j.input);
  const found = await findLines(raw, texts);
  const { ranges } = found;
  if (!ranges) {
    stats.resplits++;
    await saveFailedBatch(raw, `${packId(pack)}-${personalityId}-${first.clip.key}-x${jobs.length}`, texts, found);
    const mid = Math.ceil(jobs.length / 2);
    await makeBatch(limiter, pack, personalityId, jobs.slice(0, mid), workDir, onClip, stats);
    await makeBatch(limiter, pack, personalityId, jobs.slice(mid), workDir, onClip, stats);
    return;
  }
  for (let i = 0; i < jobs.length; i++) {
    await finishClip(raw, jobs[i], ranges[i]);
    onClip();
  }
}

const packId = (pack) => (provider === 'sapi' ? `test-${pack.id}` : pack.id);

// Clips still to make for a pack: [{ personalityId, clip, out }].
async function missingClips(pack) {
  const jobs = [];
  for (const personalityId of Object.keys(PERSONALITIES)) {
    for (const clip of clipScript(personalityId)) {
      const out = clipPath(packId(pack), personalityId, clip.key);
      if (force || !await exists(out)) jobs.push({ personalityId, clip, out, input: inputFor(clip) });
    }
  }
  return jobs;
}

// The personalities of a pack that have every clip, so the app can use a voice before all four
// coaches are recorded.
async function completePersonalities(id) {
  const done = [];
  for (const personalityId of Object.keys(PERSONALITIES)) {
    let all = true;
    for (const clip of clipScript(personalityId)) {
      if (!await exists(clipPath(id, personalityId, clip.key))) {
        all = false;
        break;
      }
    }
    if (all) done.push(personalityId);
  }
  return done;
}

// Rewrites voices/index.json with every pack that has at least one complete coach, and which
// coaches those are (keeping packs this run didn't touch).
async function updateIndex(labels) {
  const indexFile = join(voicesDir, 'index.json');
  const index = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({ packs: [] }));
  const byId = new Map(index.packs.map((p) => [p.id, p]));
  for (const [id, label] of labels) byId.set(id, { id, label });
  const listed = [];
  for (const p of byId.values()) {
    const personalities = await completePersonalities(p.id);
    if (personalities.length) listed.push({ id: p.id, label: p.label, personalities });
  }
  await writeFile(indexFile, `${JSON.stringify({ packs: listed }, null, 2)}\n`);
  return listed;
}

const describe = (listed) => listed.map((p) => (p.personalities.length === Object.keys(PERSONALITIES).length
  ? p.id : `${p.id} (${p.personalities.join(', ')})`)).join('; ');

// onCoachDone runs after each personality's clips are made, so voices/index.json lists a coach
// as soon as it's ready.
async function buildPack(pack, jobs, workDir, limiter, stats, onCoachDone = async () => {}) {
  const id = packId(pack);
  const total = jobs.length;
  let made = 0;
  const progress = () => process.stdout.write(`\r${id}: ${made}/${total} clips made`);
  const onClip = () => {
    made++;
    progress();
  };
  progress();
  for (const personalityId of Object.keys(PERSONALITIES)) {
    const group = jobs.filter((j) => j.personalityId === personalityId);
    if (!group.length) continue;
    await mkdir(join(voicesDir, id, personalityId), { recursive: true });
    if (provider === 'sapi') {
      for (const job of group) job.raw = join(workDir, `${id}-${personalityId}-${job.clip.key}.wav`);
      await sapiClips(group, pack.sapi, Math.round((PERSONALITIES[personalityId].rate - 1) * 10), workDir);
      for (const job of group) {
        await finishClip(job.raw, job, null);
        onClip();
      }
      await onCoachDone();
      continue;
    }
    for (const kind of Object.keys(BATCH_SIZE)) {
      const ofKind = group.filter((j) => kindOf(j.clip) === kind);
      for (const batch of chunk(ofKind, batching ? BATCH_SIZE[kind] : 1)) {
        await makeBatch(limiter, pack, personalityId, batch, workDir, onClip, stats);
      }
    }
    await onCoachDone();
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
    const requests = plan.reduce((n, p) => n + requestsFor(p.jobs), 0);
    const days = estimateDays(requests, rpd, limiter.usedToday());
    console.log(`${remaining} clips to make across ${plan.filter((p) => p.jobs.length).length} pack(s), in about ${requests} requests${batching ? ' (batched)' : ''}.`);
    if (remaining) {
      console.log(`Limits: ${rpm} per minute, ${rpd} per day (${limiter.usedToday()} used in the last 24 h).`);
      console.log(`That's about ${days} day${days === 1 ? '' : 's'}, a bit more if some batches have to be redone.`);
      console.log('Packs become usable one at a time as each finishes.\n');
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), 'combo-voices-'));
  const labels = new Map(packs.map((p) => [packId(p), provider === 'sapi' ? `Test: ${p.label}` : p.label]));
  const stats = { requests: 0, resplits: 0 };
  try {
    for (const { pack, jobs } of plan) {
      if (!jobs.length) {
        console.log(`${packId(pack)}: already complete`);
        continue;
      }
      await buildPack(pack, jobs, workDir, limiter, stats, () => updateIndex(labels));
      const listed = await updateIndex(labels);
      console.log(`[${clock()}] ${packId(pack)} done. Ready to publish: ${describe(listed)}`);
    }
    const listed = await updateIndex(labels);
    if (provider === 'openai') {
      console.log(`${stats.requests} requests made; ${stats.resplits} batch${stats.resplits === 1 ? '' : 'es'} had to be split up and redone.`);
    }
    console.log(`voices/index.json lists: ${describe(listed) || 'nothing'}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  console.error('Finished clips are kept. Fix the problem above, then run "node scripts/make-voices.mjs" again to continue.');
  process.exit(1);
});
