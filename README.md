# Combo Caller

A boxing round timer for heavy-bag **technique** work. It calls out punch combos by voice over
whatever music you already have playing (Spotify etc.). It's a phone-first installable PWA with no
backend, no build step and no dependencies.

## Features

- Round timer: round length, rest length, number of rounds, get-ready countdown, 10-second
  warning. Bell for round start/end, double beep for the warning. Start / Pause / Reset.
- Callouts during rounds only, every 2–10 s (default 5 s). Optional **"wait longer after longer
  combos"**: the interval is the time for a 2-punch combo, so a 4-punch combo gets twice as long
  and a single jab half as long (never under 1 s).
- Numbers (`1 2 3`) or names (`jab, cross, lead hook`).
  1 jab · 2 cross · 3 lead hook · 4 rear hook · 5 lead uppercut · 6 rear uppercut.
  Any punch can go to the body: add `b` (`1-3b-2`), called "lead hook body" / "3 body".
  Moves go anywhere in a combo: `SL`/`SR` slip left/right, `RL`/`RR` roll left/right, `PL` pull,
  `PV` pivot (`1-2-SL-2`), always said in words. A recorded voice pack made before a move or
  "body" existed says those combos with the phone voice until its clips are recorded.
- Combos come from saved drill lists, picked with one tap on the Timer page (Combo Builder: tap
  1–6, Body, or a move, or type `1-3b-SL-2`). Random or in order, or repeat one combo for the whole round.
- Four preset drill lists to start with: Starter set, Jab & cross, Hook pairs, Long combos
  (`PRESET_DRILLS` in `src/combos.js`); Long combos uses every punch, body punch and move at least
  once. They're normal saved drills, so you can edit or delete them; a deleted preset doesn't come
  back. Presets added in a later version are given to existing users once; retired presets
  (`RETIRED_PRESETS`) are removed from saved data unless the user edited them. If every drill is deleted, the starter combos are
  used.
- Voice picker (installed English TTS voices only), rate and volume. "Lead" is spoken as
  "leed" so engines don't say the metal.
- Coach personality: Plain (just combos), Encouraging, Stoic or Drill sergeant. A personality
  adds a "round coming up" line 3.5 s before each round, a line with the 10-second warning and
  after the end bell, and sometimes a short technique cue after a combo (only when the gap to
  the next combo is at least 4 s). It also shifts pitch and pace a little. TTS voices can't
  change emotion, so the personality is in the words. Lines live in `src/personalities.js`.
- Recorded voice packs (optional): pre-made AI voice clips for every phrase, so voice, gender
  and coach tone are the same on any phone. See "Voice packs" below. Without packs, or while a
  pack is still loading, the phone's own TTS speaks.

## Voice packs

Chrome on Android can only use the phone's built-in speech engine, so voice choice depends on the
phone. Voice packs avoid that: everything the app ever says is a fixed list of short phrases
(`clipScript()` in `src/personalities.js`: punch numbers and names, "Round N" intros and each
coach's lines), so each phrase is recorded once per voice and per coach as a small mp3.

Packs are made with OpenAI's `gpt-4o-mini-tts`, which takes a tone instruction per coach, so the
drill sergeant actually barks and the stoic coach stays flat. Each pack is 174 clips (about 2,000
characters of text, around 1 MB), so generating all four costs well under $1.

```bash
# PowerShell: set your key for this terminal only, then generate
$env:OPENAI_API_KEY = "sk-..."
npm run voices                      # all packs: male-deep, male, female, female-bright
npm run voices -- --packs female    # just one
```

This writes `voices/<pack>/<coach>/<clip>.mp3` and `voices/index.json`; commit and push them and
the packs appear under Settings → Voice → Recorded. Re-running only makes missing clips (add
`--force` to redo them, e.g. after changing a coach line).

Rate limits: the script stays under your account's limits on its own (defaults 10 requests per
minute and 50 per day; set yours with `--rpm` and `--rpd`). It spaces requests for the minute
limit, remembers the last 24 hours of requests in `voices/.openai-usage.json` (git-ignored), and
when the day's allowance is used it waits until more is allowed. If OpenAI still answers "rate
limited", it waits as long as OpenAI says. Each clip is saved the moment it's done (written under a
temporary name and renamed), so you can close it any time and run it again later.

Batching keeps the request count low: each request reads a group of lines (12 punch callouts, 15
round intros or 8 coach lines) with two-second pauses, and the recording is cut at those pauses.
A batch is only cut when two independent checks agree: the pauses clearly mark the right number of
lines (each break at least 0.35 s and clearly longer than any pause inside a line), and every
piece's length fits its words (a sane seconds-per-letter, and a pace similar to the rest of the
batch). Real voices breathe between lines, so silence is looked for at several levels (-45 to
-30 dB) and the first level that passes both checks wins. Otherwise the batch is re-requested as
two halves, down to one line per request, so a bad split never becomes a mislabeled clip. Batches
that wouldn't split are kept in `voices/.debug/` (git-ignored) with what each level found. That's about 15
requests per pack, 60 for all four: roughly a day and a bit at 50 per day. `--no-batch` goes back
to one request per clip. Packs are listed in the app as each one finishes. `--provider sapi` builds `test-*` packs
with Windows' built-in voices to test the pipeline without a key; those are git-ignored.

The clips are AI-generated voices, not recordings of real people. Clip speed follows the Speed
slider within 0.8–1.25×, since speeding up a recording also raises its pitch.
- Screen Wake Lock during a session, with a warning banner if it isn't available.
- Settings and drills saved in `localStorage`. Works offline once loaded.

## Run locally

Needs Node 22+ (only for the dev server, tests and icon script; the app itself is static files).

```bash
npm start          # serves http://localhost:8080
npm test           # unit tests (node:test, no installs)
```

Any static server works too, e.g. `python -m http.server 8080`. Open the URL over `http://localhost`;
browsers treat localhost as secure, so the service worker and wake lock work there.

To try it on your phone before deploying, plug it in over USB, open `chrome://inspect` on the
desktop and add port forwarding for `8080 → localhost:8080`, then open `http://localhost:8080`
on the phone. (A plain LAN address like `http://192.168.x.x:8080` is **not** secure, so wake lock
and install won't work there.)

## Deploy (GitHub Pages)

HTTPS is required for wake lock and "Add to Home screen". There's no build step, so the repo root
is the site:

1. Create a GitHub repo and push this folder to it (`main` branch).
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**, branch
   `main`, folder `/ (root)`.
3. After a minute it's live at `https://<user>.github.io/<repo>/`. Open it in Chrome on Android
   → ⋮ menu → **Add to Home screen** / **Install app**.

All paths are relative, so it works from a sub-path. Netlify, Cloudflare Pages or any static host
works the same way (publish directory = repo root).

Updates: **bump `CACHE` in `sw.js` on every deploy** (and add any new files to `ASSETS`). The
changed `sw.js` makes the browser install the new version in the background; once it's ready
the app reloads itself into it, unless a session is running, in which case it waits until you
press Reset. Without the bump, changes still arrive (the cache refreshes in the background) but
only show up on the following launch.

## Project layout

```
index.html            UI markup
css/styles.css        dark, mobile-first styles
src/timer.js          timer engine: timeline, timed events, pausable clock (pure)
src/combos.js         combo generator: parsing, names, picker, per-round callout plan (pure)
src/session.js        joins timer + callouts + coach cues into one event list (pure)
src/personalities.js  coach lines, pitch and pace per personality (pure)
src/storage.js        settings + drills persistence (localStorage, injectable backend)
src/speech.js         TTS (Web Speech API)
src/clipplayer.js     voice-pack clip playback (Web Audio)
voices/               generated voice packs (scripts/make-voices.mjs)
src/audio.js          bell / warning sounds (Web Audio)
src/wakelock.js       Screen Wake Lock
src/app.js            UI wiring
sw.js                 offline service worker
manifest.webmanifest  PWA manifest
scripts/              dev server, icon generator
tests/                unit tests for timer, combos, session, storage
```

The pure modules have no DOM access and are fully unit-tested. Platform pieces (`speech`,
`audio`, `wakelock`, `storage`) each sit behind a small interface so a native wrapper such as
Capacitor can swap them, e.g. native TTS for `speech.js` or Preferences for `storage.js`,
without touching the timer or combo logic.

## Known limits

- **The screen must stay on.** A web page can't run reliably with the phone locked; Chrome
  freezes it. The app holds a wake lock during a session. If the phone locks anyway, the clock
  keeps real time, but callouts and bells that came due while it was locked are skipped, not
  replayed. Callouts with the screen locked need the native (Capacitor) version.
- **Voice quality depends on the phone's installed TTS voices.** Google's voices are usually
  best; you can install more in Android Settings → Text-to-speech.
- **Music ducking vs. pausing depends on the phone.** The app never plays music or holds audio
  focus on purpose (sounds are short Web Audio tones and the audio context is suspended between
  them), but some Android builds pause other apps' music while Chrome speaks instead of ducking
  it. Try it with Spotify playing before a real workout.
- The first sound needs a tap: mobile browsers block audio until you press Start.
- iOS Safari isn't a target; it may work but isn't tested.
