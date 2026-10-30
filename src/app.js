// App wiring: connects the timer engine, combo callouts, speech, sounds, wake lock and storage to
// the UI. Everything platform-specific lives in its own module so a native wrapper can swap it.

import { TimerEngine } from './timer.js';
import { buildSession, currentDrill, resolveCombos, WARNING_SEC } from './session.js';
import { PUNCH_NAMES, parseCombo, formatCombo, comboNames, comboSpeech, calloutGapMs } from './combos.js';
import { PERSONALITIES, personalityLine, calloutLine, voiceTuning } from './personalities.js';
import { createStorage } from './storage.js';
import { createSpeech } from './speech.js';
import { createBeeper } from './audio.js';
import { createWakeLock } from './wakelock.js';

// Events this late (phone asleep, tab throttled) are skipped rather than replayed in a burst.
const STALE_EVENT_MS = 1500;
const TICK_MS = 100;
// The end-of-round line waits for the bell to finish.
const AFTER_BELL_MS = 1200;

const $ = (id) => document.getElementById(id);
const storage = createStorage();
const data = storage.load();
const speech = createSpeech();
const beeper = createBeeper();
const wakeLock = createWakeLock({ onChange: onWakeLockChange });

let engine = null;
let ticker = null;
let lineTimer = null;
let builder = [];
let editing = blankDrill();
let dirty = false;

function save() {
  storage.save(data);
}

function blankDrill() {
  return { id: null, name: '', combos: [] };
}

function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ---------- banner ----------

const banners = new Map();

function setBanner(key, message) {
  if (message) banners.set(key, message);
  else banners.delete(key);
  const el = $('banner');
  el.replaceChildren(...[...banners.values()].map((m) => Object.assign(document.createElement('p'), { textContent: m })));
  el.hidden = banners.size === 0;
}

function onWakeLockChange(state, err) {
  const messages = {
    unsupported:
      "Screen wake lock isn't available here (it needs Chrome over HTTPS). Keep the screen on yourself: if the phone locks, callouts stop.",
    error: `Couldn't keep the screen on${err?.message ? ` (${err.message})` : ''}. Keep it on yourself: if the phone locks, callouts stop.`,
    released: 'The screen wake lock was dropped (battery saver?). Keep the screen on yourself.',
  };
  setBanner('wakelock', messages[state] ?? null);
}

// ---------- session ----------

const isActive = () => engine && (engine.state === 'running' || engine.state === 'paused');

function startPause() {
  if (engine?.state === 'running') {
    engine.pause();
    speech.cancel();
    stopTicker();
    render();
    return;
  }
  if (!isActive()) {
    const combos = resolveCombos(data.settings, data.drills);
    if (!combos.length) {
      setBanner('combos', 'The selected drill has no combos. Add some on the Combos tab, or pick another drill.');
      return;
    }
    setBanner('combos', null);
    const { segments, events } = buildSession(data.settings, combos);
    engine = new TimerEngine({ segments, events, onEvent: handleEvent });
  }
  beeper.unlock();
  wakeLock.acquire();
  engine.start();
  startTicker();
  render();
}

function reset() {
  engine = null;
  stopTicker();
  clearTimeout(lineTimer);
  speech.cancel();
  wakeLock.release();
  showCombo(null);
  render();
}

function startTicker() {
  if (!ticker) ticker = setInterval(tick, TICK_MS);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function tick() {
  engine?.update();
  if (engine?.state !== 'running') stopTicker();
  renderTimer();
}

function handleEvent(ev, { lateMs }) {
  const fresh = lateMs <= STALE_EVENT_MS;
  const personality = data.settings.personality;
  switch (ev.type) {
    case 'phase':
      if (ev.kind === 'round') {
        if (fresh) beeper.bell();
      } else {
        showCombo(null);
      }
      break;
    case 'cue':
      if (fresh) {
        const last = ev.round === engine.totalRounds && engine.totalRounds > 1;
        say(personalityLine(personality, last ? 'lastRoundSoon' : 'roundSoon', { round: ev.round }));
      }
      break;
    case 'round-end':
      speech.cancel();
      showCombo(null);
      if (fresh) {
        beeper.bell();
        const key = ev.round === engine.totalRounds ? 'done' : 'roundEnd';
        sayAfterBell(personalityLine(personality, key));
      }
      break;
    case 'warning':
      if (fresh) {
        beeper.warning();
        say(personalityLine(personality, 'warning'));
      }
      break;
    case 'callout':
      if (fresh) {
        showCombo(ev.punches);
        const gapMs = calloutGapMs(ev.punches, data.settings);
        say(calloutLine(personality, ev.punches, data.settings.style, gapMs));
      }
      break;
    case 'done':
      wakeLock.release();
      render();
      break;
  }
}

function say(text) {
  if (text) speech.speak(text, voiceOptions());
}

function sayAfterBell(text) {
  clearTimeout(lineTimer);
  if (text) lineTimer = setTimeout(() => engine && say(text), AFTER_BELL_MS);
}

// The rate slider scales the personality's own pace.
function voiceOptions() {
  const { voiceURI, rate, volume, personality } = data.settings;
  const tuning = voiceTuning(personality);
  return { voiceURI, rate: rate * tuning.rate, pitch: tuning.pitch, volume };
}

function showCombo(punches) {
  $('combo-numbers').textContent = punches ? formatCombo(punches) : ' ';
  $('combo-names').textContent = punches ? comboNames(punches) : ' ';
}

// ---------- timer view ----------

const drillNow = () => currentDrill(data.settings, data.drills);

function sourceSummary() {
  const s = data.settings;
  return [
    drillNow()?.name ?? 'Starter combos',
    s.order === 'inorder' ? 'in order' : 'random',
    s.repeatOne ? 'one combo per round' : null,
    `every ${s.intervalSec}s${s.scaleByLength ? '+' : ''}`,
    s.style,
    s.personality !== 'plain' ? PERSONALITIES[s.personality]?.label.toLowerCase() : null,
  ].filter(Boolean).join(' · ');
}

function renderTimer() {
  const s = data.settings;
  let phase = 'Ready';
  let clock = mmss(s.roundSec);
  let kind = 'idle';
  let label = 'Start';
  let warn = false;

  if (engine && engine.state !== 'idle') {
    const st = engine.status();
    if (st.state === 'done') {
      phase = 'Done';
      clock = '0:00';
      kind = 'done';
      label = 'Start again';
    } else if (st.segment) {
      const seg = st.segment;
      kind = seg.kind;
      if (seg.kind === 'getready') phase = 'Get ready';
      else if (seg.kind === 'rest') phase = `Rest · round ${seg.round + 1} next`;
      else phase = `Round ${seg.round} of ${engine.totalRounds}`;
      clock = mmss(Math.ceil(st.remainingMs / 1000));
      warn = seg.kind === 'round' && s.warning && st.remainingMs <= WARNING_SEC * 1000;
      if (st.state === 'paused') {
        phase += ' · paused';
        label = 'Resume';
      } else {
        label = 'Pause';
      }
    }
  }

  document.body.dataset.phase = kind;
  $('phase').textContent = phase;
  $('clock').textContent = clock;
  $('clock').classList.toggle('warn', warn);
  $('btn-start').textContent = label;
  $('round-info').textContent = `${s.rounds} × ${mmss(s.roundSec)} rounds · ${mmss(s.restSec)} rest`;
  $('source-info').textContent = sourceSummary();
}

// Drill buttons on the Timer page: one tap picks what the next session calls out.
function renderChips() {
  const current = drillNow()?.id;
  $('drill-chips').replaceChildren(...data.drills.map(({ id, name }) => {
    const btn = document.createElement('button');
    btn.className = 'btn chip';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(id === current));
    btn.dataset.source = id;
    btn.textContent = name;
    return btn;
  }));
}

function bindChips() {
  $('drill-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-source]');
    if (!btn || isActive()) return;
    data.settings.source = btn.dataset.source;
    save();
    render();
  });
}

// ---------- settings view ----------

// Each fills the settings row marked data-stepper="<key>".
const STEPPERS = [
  { key: 'roundSec', label: 'Round length', step: 30, min: 30, max: 900, format: mmss },
  { key: 'restSec', label: 'Rest', step: 15, min: 15, max: 300, format: mmss },
  { key: 'rounds', label: 'Rounds', step: 1, min: 1, max: 30, format: String },
  { key: 'getReadySec', label: 'Get ready', step: 5, min: 0, max: 60, format: (v) => (v ? `${v}s` : 'Off') },
  { key: 'intervalSec', label: 'Callout every', step: 1, min: 2, max: 10, format: (v) => `${v}s` },
];

const TOGGLES = { 'set-warning': 'warning', 'set-scale': 'scaleByLength', 'set-repeat': 'repeatOne' };

function buildSteppers() {
  for (const cfg of STEPPERS) {
    const row = document.querySelector(`[data-stepper="${cfg.key}"]`);
    row.innerHTML = `
      <span class="row-label"></span>
      <span class="stepper">
        <button class="step minus" data-dir="-1">−</button>
        <output class="stepper-value"></output>
        <button class="step plus" data-dir="1">+</button>
      </span>`;
    row.querySelector('.row-label').textContent = cfg.label;
    row.querySelector('.minus').setAttribute('aria-label', `Decrease ${cfg.label}`);
    row.querySelector('.plus').setAttribute('aria-label', `Increase ${cfg.label}`);
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      data.settings[cfg.key] = clamp(data.settings[cfg.key] + cfg.step * Number(btn.dataset.dir), cfg.min, cfg.max);
      save();
      render();
    });
    cfg.output = row.querySelector('output');
  }
}

function bindSettings() {
  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).addEventListener('change', (e) => {
      data.settings[key] = e.target.checked;
      save();
      render();
    });
  }
  for (const name of ['style', 'order']) {
    for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
      radio.addEventListener('change', () => {
        data.settings[name] = radio.value;
        save();
        render();
      });
    }
  }
  $('set-personality').addEventListener('change', (e) => {
    data.settings.personality = e.target.value;
    save();
    render();
  });
  $('set-voice').addEventListener('change', (e) => {
    data.settings.voiceURI = e.target.value;
    save();
  });
  for (const key of ['rate', 'volume']) {
    $(`set-${key}`).addEventListener('input', (e) => {
      data.settings[key] = Number(e.target.value);
      save();
      renderSettings();
    });
  }
  $('btn-test-voice').addEventListener('click', () => {
    const intro = personalityLine(data.settings.personality, 'roundSoon', { round: 1 });
    say([intro, comboSpeech([1, 2, 3], data.settings.style)].filter(Boolean).join(' '));
  });
}

function buildPersonalities() {
  $('set-personality').replaceChildren(...Object.entries(PERSONALITIES).map(([id, p]) => new Option(p.label, id)));
}

function renderSettings() {
  const s = data.settings;
  for (const cfg of STEPPERS) cfg.output.textContent = cfg.format(s[cfg.key]);
  for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = s[key];
  for (const name of ['style', 'order']) {
    for (const radio of document.querySelectorAll(`input[name="${name}"]`)) radio.checked = radio.value === s[name];
  }
  const personality = PERSONALITIES[s.personality] ? s.personality : 'plain';
  $('set-personality').value = personality;
  $('coach-blurb').textContent = PERSONALITIES[personality].blurb;
  $('set-rate').value = s.rate;
  $('set-volume').value = s.volume;
  $('out-rate').textContent = `${s.rate.toFixed(1)}×`;
  $('out-volume').textContent = `${Math.round(s.volume * 100)}%`;
  $('settings-note').hidden = !isActive();
}

const isEnglish = (voice) => /^en([-_]|$)/i.test(voice.lang);

// "Microsoft David - English (United States)" → "David"; Android's "English United States" stays.
const voiceLabel = (voice) => voice.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s+-\s+English.*$/, '');

function renderVoices() {
  const sel = $('set-voice');
  const all = speech.voices();
  const voices = all.filter(isEnglish).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  sel.replaceChildren(new Option('Phone default', ''), ...voices.map((v) => new Option(voiceLabel(v), v.voiceURI)));
  // Drop a saved voice that's no longer offered (e.g. a non-English one picked earlier).
  if (all.length && data.settings.voiceURI && !voices.some((v) => v.voiceURI === data.settings.voiceURI)) {
    data.settings.voiceURI = '';
    save();
  }
  sel.value = data.settings.voiceURI;
  sel.disabled = !speech.supported;
}

// ---------- combos view ----------

function comboRow(text, onRemove) {
  const li = document.createElement('li');
  const punches = parseCombo(text);
  li.innerHTML = '<span class="c-num"></span><span class="c-names"></span>';
  li.querySelector('.c-num').textContent = text;
  li.querySelector('.c-names').textContent = punches ? comboNames(punches) : '';
  if (onRemove) {
    const btn = document.createElement('button');
    btn.className = 'btn remove';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', `Remove ${text}`);
    btn.addEventListener('click', onRemove);
    li.append(btn);
  }
  return li;
}

function setComboMsg(text, isError = false) {
  const el = $('combo-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function buildKeypad() {
  const pad = $('keypad');
  for (const [num, name] of Object.entries(PUNCH_NAMES)) {
    const btn = document.createElement('button');
    btn.className = 'btn key';
    btn.dataset.punch = num;
    btn.innerHTML = `<span class="key-num">${num}</span><span class="key-name">${name}</span>`;
    pad.append(btn);
  }
  pad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-punch]');
    if (!btn) return;
    builder.push(Number(btn.dataset.punch));
    renderBuilder();
  });
}

function addCombo(punches) {
  editing.combos.push(formatCombo(punches));
  dirty = true;
  setComboMsg(`Added ${formatCombo(punches)}.`);
  renderCombos();
}

function confirmDiscard() {
  return !dirty || confirm('Discard unsaved changes to this drill?');
}

// Saves the drill being edited. Returns false (with a message) if it can't be saved yet.
function saveDrill() {
  editing.name = $('drill-name').value.trim();
  if (!editing.name) {
    setComboMsg('Give the drill a name first.', true);
    return false;
  }
  if (!editing.combos.length) {
    setComboMsg('Add at least one combo first.', true);
    return false;
  }
  if (!editing.id) {
    editing.id = `d${Date.now().toString(36)}`;
    data.drills.push(structuredClone(editing));
  } else {
    data.drills = data.drills.map((d) => (d.id === editing.id ? structuredClone(editing) : d));
  }
  dirty = false;
  save();
  return true;
}

function bindCombos() {
  $('kp-back').addEventListener('click', () => {
    builder.pop();
    renderBuilder();
  });
  $('kp-add').addEventListener('click', () => {
    if (!builder.length) {
      setComboMsg('Tap some punches first.', true);
      return;
    }
    addCombo(builder);
    builder = [];
    renderBuilder();
  });
  const addTyped = () => {
    const input = $('combo-text');
    const punches = parseCombo(input.value);
    if (!punches) {
      setComboMsg('Use punch numbers 1–6, like 1-2-3.', true);
      return;
    }
    addCombo(punches);
    input.value = '';
  };
  $('combo-text-add').addEventListener('click', addTyped);
  $('combo-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTyped();
  });
  $('drill-name').addEventListener('input', (e) => {
    editing.name = e.target.value;
    dirty = true;
  });
  $('drill-select').addEventListener('change', (e) => {
    if (!confirmDiscard()) {
      e.target.value = editing.id ?? '';
      return;
    }
    const drill = data.drills.find((d) => d.id === e.target.value);
    editing = drill ? structuredClone(drill) : blankDrill();
    dirty = false;
    setComboMsg('');
    renderCombos();
  });
  $('drill-save').addEventListener('click', () => {
    if (saveDrill()) {
      setComboMsg(`Saved “${editing.name}”.`);
      render();
    }
  });
  $('drill-use').addEventListener('click', () => {
    if (!saveDrill()) return;
    data.settings.source = editing.id;
    save();
    setComboMsg(`Callouts will use “${editing.name}”.`);
    render();
  });
  $('drill-delete').addEventListener('click', () => {
    if (!editing.id) {
      if (!confirmDiscard()) return;
    } else {
      if (!confirm(`Delete “${editing.name}”?`)) return;
      // If it was the selected drill, the first remaining drill takes over (see currentDrill).
      data.drills = data.drills.filter((d) => d.id !== editing.id);
      save();
    }
    editing = blankDrill();
    dirty = false;
    setComboMsg('');
    render();
  });
}

function renderBuilder() {
  const el = $('builder-display');
  el.textContent = builder.length ? formatCombo(builder) : 'Tap punches below';
  el.classList.toggle('empty', !builder.length);
}

function renderCombos() {
  const sel = $('drill-select');
  sel.replaceChildren(new Option('+ New drill', ''), ...data.drills.map((d) => new Option(d.name, d.id)));
  sel.value = editing.id ?? '';
  const nameInput = $('drill-name');
  if (document.activeElement !== nameInput) nameInput.value = editing.name;
  const list = $('drill-combos');
  if (!editing.combos.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No combos yet.';
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...editing.combos.map((c, i) => comboRow(c, () => {
      editing.combos.splice(i, 1);
      dirty = true;
      renderCombos();
    })));
  }
  $('drill-delete').textContent = editing.id ? 'Delete drill' : 'Clear';
  renderBuilder();
}

// ---------- tabs & init ----------

function showTab(name) {
  for (const view of document.querySelectorAll('.view')) view.hidden = view.dataset.view !== name;
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  window.scrollTo(0, 0);
}

function render() {
  renderTimer();
  renderChips();
  renderSettings();
  renderCombos();
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
$('btn-start').addEventListener('click', startPause);
$('btn-reset').addEventListener('click', reset);

buildSteppers();
buildKeypad();
buildPersonalities();
bindChips();
bindSettings();
bindCombos();
speech.onVoicesChanged(renderVoices);
renderVoices();
if (!wakeLock.supported) onWakeLockChange('unsupported');
if (!speech.supported) setBanner('speech', 'This browser has no text-to-speech, so combos will only show on screen.');
render();

// A new service worker takes over once an update has downloaded. Reload to run the new version,
// but never mid-session; then it waits until the session is reset or finished.
let updateReady = false;

function reloadIfUpdateReady() {
  if (updateReady && !isActive()) location.reload();
}

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing old to replace
    updateReady = true;
    reloadIfUpdateReady();
  });
  $('btn-reset').addEventListener('click', reloadIfUpdateReady);
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
