// Builds recorded voice packs: one short mp3 per phrase in clipScript(), for every coach
// personality, in each voice below. Output goes to voices/<pack>/<personality>/<key>.mp3 plus
// voices/index.json, which the app reads. Needs ffmpeg on PATH.
//
//   OpenAI (the real packs):  set OPENAI_API_KEY, then  npm run voices
//   Options:  --packs male,female   only these packs
//             --force               regenerate clips that already exist
//             --provider sapi       Windows built-in voices, for testing the pipeline offline
//                                   (writes test-* packs; don't publish those)

import { mkdir, writeFile, readFile, access, rm, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONALITIES, clipScript } from '../src/personalities.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const voicesDir = join(root, 'voices');

const PACKS = [
  { id: 'male-deep', label: 'Male, deep', openai: 'onyx', sapi: 'Microsoft David Desktop' },
  { id: 'male', label: 'Male', openai: 'ash', sapi: 'Microsoft David Desktop' },
  { id: 'female', label: 'Female', openai: 'coral', sapi: 'Microsoft Zira Desktop' },
  { id: 'female-bright', label: 'Female, bright', openai: 'nova', sapi: 'Microsoft Zira Desktop' },
];

const NUMBER_WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
const OPENAI_MODEL = 'gpt-4o-mini-tts';
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const provider = option('provider') ?? 'openai';
const onlyPacks = option('packs')?.split(',');
const force = flag('force');

const exists = (path) => access(path).then(() => true, () => false);

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

async function openaiClip(text, voice, instructions) {
  const key = process.env.OPENAI_API_KEY;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, voice, input: text, instructions, response_format: 'mp3' }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

// Windows SAPI: one PowerShell run per pack+personality renders all its clips to WAV files.
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

// Trim leading/trailing silence, mono, small mp3.
async function finish(raw, out) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', raw,
    '-af', `${trim},areverse,${trim},areverse`,
    '-ac', '1', '-ar', '24000', '-b:a', '48k', out,
  ]);
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function buildPack(pack, workDir) {
  const id = provider === 'sapi' ? `test-${pack.id}` : pack.id;
  let made = 0;
  for (const personalityId of Object.keys(PERSONALITIES)) {
    const dir = join(voicesDir, id, personalityId);
    await mkdir(dir, { recursive: true });
    const jobs = [];
    for (const clip of clipScript(personalityId)) {
      const out = join(dir, `${clip.key}.mp3`);
      if (!force && await exists(out)) continue;
      jobs.push({ clip, out, input: inputFor(clip), raw: join(workDir, `${id}-${personalityId}-${clip.key}.${provider === 'sapi' ? 'wav' : 'mp3'}`) });
    }
    if (!jobs.length) continue;
    if (provider === 'sapi') {
      const rate = Math.round((PERSONALITIES[personalityId].rate - 1) * 10);
      await sapiClips(jobs, pack.sapi, rate, workDir);
    }
    await pool(jobs, CONCURRENCY, async (job) => {
      if (provider === 'openai') {
        await writeFile(job.raw, await openaiClip(job.input, pack.openai, instructionsFor(personalityId, job.clip)));
      }
      await finish(job.raw, job.out);
      made++;
      process.stdout.write(`\r${id}: ${made} clips made`);
    });
  }
  process.stdout.write(made ? '\n' : `${id}: up to date\n`);
  return { id, label: provider === 'sapi' ? `Test: ${pack.label}` : pack.label };
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

async function main() {
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Set OPENAI_API_KEY first (or use --provider sapi to test with Windows voices).');
    process.exit(1);
  }
  if (!['openai', 'sapi'].includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  const packs = PACKS.filter((p) => !onlyPacks || onlyPacks.includes(p.id));
  const workDir = await mkdtemp(join(tmpdir(), 'combo-voices-'));
  try {
    const built = [];
    for (const pack of packs) built.push(await buildPack(pack, workDir));

    // Merge into the existing index, keeping packs this run didn't touch.
    const indexFile = join(voicesDir, 'index.json');
    const index = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({ packs: [] }));
    const byId = new Map(index.packs.map((p) => [p.id, p]));
    for (const p of built) byId.set(p.id, p);
    const listed = [];
    for (const p of byId.values()) if (await complete(p.id)) listed.push(p);
    await writeFile(indexFile, `${JSON.stringify({ packs: listed }, null, 2)}\n`);
    console.log(`voices/index.json lists: ${listed.map((p) => p.id).join(', ') || 'nothing'}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
