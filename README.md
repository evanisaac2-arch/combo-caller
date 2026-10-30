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
- Combos from the built-in starter set or your own saved drill lists (Combo Builder: tap 1–6 or
  type `1-2-3`). Random or in order, or repeat one combo for the whole round.
- Voice picker (installed TTS voices), rate and volume.
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

Updates: the service worker serves the cached copy and refreshes it in the background, so a new
deploy shows up the *second* time you open the app. If you add or rename files, add them to
`ASSETS` in `sw.js` and bump `CACHE`.

## Project layout

```
index.html            UI markup
css/styles.css        dark, mobile-first styles
src/timer.js          timer engine: timeline, timed events, pausable clock (pure)
src/combos.js         combo generator: parsing, names, picker, per-round callout plan (pure)
src/session.js        joins timer + callouts into one event list (pure)
src/storage.js        settings + drills persistence (localStorage, injectable backend)
src/speech.js         TTS (Web Speech API)
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
