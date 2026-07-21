# Pit Command

**Live: https://pit-command.vercel.app** — open it on your phone and add it to your home screen.

Race day tire data console for a Limited Late Model crew chief. Asphalt, left turns only.

Installable offline-first PWA. Log cold and hot readings for all four corners, and it
reads the tires back at you: tight/loose balance call, inflation and camber flags,
pressure-gain and leak detection, stagger growth, and a full-day summary with charts.

Everything except Smart Fill works with zero connection — race tracks have dead cell
service, so the whole app shell is precached and all data lives on-device in IndexedDB.

## Install it on your phone

It is a PWA, so there is no app store and no account. Open
**https://pit-command.vercel.app** and add it — after that it launches fullscreen from your home
screen and runs with no signal.

- **iPhone / iPad** — open the link in **Safari** (Chrome on iOS cannot install it), tap **Share**,
  then **Add to Home Screen**.
- **Android** — open the link in Chrome, tap the **⋮** menu, then **Install app** / **Add to Home
  screen**.

Do this before you leave for the track. The first load is what caches the app; after that the
23-file shell is on the device and the only thing that still wants a connection is Smart Fill.

Installing also matters for your data: a home-screen install makes the browser far more likely to
grant `navigator.storage.persist()`, which is what keeps a logged season from being evicted when the
phone runs low on space. The **Backups** panel on the hub tells you which mode you are in.

Sharing it is just sharing the link. Everyone gets their own private log — data lives on each
device, never on a server, and nothing is shared between phones.

## Running it

```bash
npm install
npm run dev            # UI only — /api/parse is not served by vite
npm test               # 86 tests: num(), analyze(), the parse proxy, DOM smoke tests
npm run build          # generates icons, then builds to dist/
npm run preview        # serve the production build
```

`npm run dev` serves `/api/parse` too, via a dev-server plugin that mounts the same
handler Vercel runs — so Smart Fill works locally without a second toolchain. It needs a
key:

```bash
cp .env.example .env.local     # then put your real ANTHROPIC_API_KEY in it
```

The key is re-read per request, so adding it does not require restarting the dev server —
just retry the fill. Without it the app still runs; Smart Fill returns
*"Smart Fill needs an Anthropic API key on the server."* and every other feature is
unaffected. `npx vercel dev` also works if you want the exact Vercel runtime.

## Deploying

Already deployed: **https://pit-command.vercel.app**, from the private repo
`Triseno1397/pit-command`. The repo is connected to Vercel, so **pushing to `main` redeploys the
live site** — there is no manual deploy step.

`vercel.json` pins the build command, output directory, and the `api/parse.js` function limits, so
the only thing that isn't in version control is the secret:

- Vercel → Project → Settings → Environment Variables → `ANTHROPIC_API_KEY` (Production + Preview),
  then redeploy.

The key is read server-side in `api/parse.js` only. It is never bundled into the client, so it is
not exposed by the site being public — but note that anyone who has the link can *use* Smart Fill,
and those calls bill that key. Removing the variable and redeploying is the off switch: Smart Fill
then reports that it needs a key and every other feature is unaffected.

## How it's put together

```
index.html               app shell (safe-area insets, theme color, apple-touch-icon)
src/
  num.js                 fraction parser + formatters — 88.25 | 88 1/4 | 88-1/4 | 1/2
  analyze.js             the analysis engine, ported verbatim from the track-validated build
  state.js               state shape, IndexedDB persistence, v1/v2 migration, normalize()
  render.js              page dispatch + targeted per-session refresh
  smartfill.js           photo/dictation client, image downscale, Web Speech
  exportimport.js        JSON backup round-trip + per-day CSV
  ui/                    hub, day, analysis readout, summary, hand-rolled SVG charts
api/parse.js             Vercel function — Anthropic Messages API, server-held key
scripts/gen-icons.mjs    PNG icon generator (zlib only, no image deps)
test/                    vitest
```

### Notes on a few decisions

**Storage.** `idb-keyval` under the key `lltool:state:v2`, same shape as before, with a
debounced 700 ms autosave. On first load it also migrates a v1 single-event payload or a
leftover localStorage v2 payload, so nothing logged before the rewrite is lost.

**Saving.** There is an explicit **Save** button in the header. It turns chalk-yellow and
pulses the moment there is unsaved work, and reads `Saved · 2m ago` once everything is
down — so at a glance across a hot pit box you know whether it is safe to pocket the
phone. Pressing it writes immediately (no debounce) and lays down a restore point.
Autosave still runs underneath as a safety net; the button is about certainty, not
mechanism.

**Keeping a season.** Three layers, because "refer back to it later" is the whole point:

- *Restore points.* Every explicit Save keeps a dated copy, plus one an hour while you
  work, and one before any restore. The last 12 are kept under **Backups** on the hub.
  Deleting a race day by mistake in the trailer is recoverable — and restoring is not a
  one-way door, because the current state is snapshotted first.
- *Eviction protection.* Browsers evict IndexedDB for "best-effort" origins when the
  device runs low on space. The app calls `navigator.storage.persist()` on launch so the
  log is marked permanent; the Backups panel tells you which mode you are in. Installing
  to the home screen makes the grant much more likely.
- *Export.* JSON backup for full fidelity, per-day CSV, and **Season CSV** — every day ×
  session × reading in one flat table for spreadsheet work.

Two further guards, both tested:

- *Backgrounding inside the debounce window.* Locking the phone or switching apps within
  700 ms of the last edit used to drop that reading. On `visibilitychange`/`pagehide` the
  pending save is flushed: a synchronous localStorage mirror goes down first (guaranteed
  durable even if the OS kills the tab), then the IndexedDB write clears it. Next launch
  picks up the mirror if it survived.
- *An unreadable save.* Rather than starting empty and letting the next autosave overwrite
  it, the raw value is parked under `lltool:state:v2:corrupt` so a season can be recovered
  by hand.

**Rendering.** Field edits do a targeted refresh of just that session's readout and the
overview strip rather than repainting the page. A full re-render tears down the input the
crew is tabbing through and drops focus mid-entry — with gloves on, that loses a reading.
There's a test for it.

**Fonts.** Barlow / Barlow Condensed / JetBrains Mono are self-hosted via `@fontsource`
and precached. Nothing is fetched from a CDN at runtime. A small Vite plugin strips
`@fontsource`'s legacy `.woff` fallbacks — every browser that can run a service worker
supports woff2, and an un-precached fallback would be a doomed network fetch offline.

**Smart Fill model.** `api/parse.js` uses `claude-sonnet-5` with structured outputs
(`output_config.format`), which guarantees schema-valid JSON instead of parsing prose.
The original spec named `claude-sonnet-4-6`; that model doesn't support structured
outputs, so this is the current Sonnet-tier equivalent. It's a single `MODEL` constant
at the top of the file if you want to change it.

**Offline degradation.** Smart Fill buttons disable with a "No signal — manual entry"
note when `navigator.onLine` is false, and re-enable on the `online` event. Everything
else keeps working.

**Dictation.** Tap **Talk it in**, say it however it comes out, tap again — it stops
listening and fills the sheet in one move. Speech recognition is fussy and the first
implementation had three bugs worth naming, since they are easy to reintroduce:

- browsers end a recognition session after a few seconds of silence even with
  `continuous = true`, so the recogniser is now restarted underneath the user while
  their *intent* to dictate is tracked separately;
- a denied microphone surfaced only as an error event that was swallowed, so the button
  sat on "Stop" doing nothing — permission, no-mic, and network failures now each get a
  plain-English message;
- stopping never re-rendered, so the button stuck.

The auto-restart is capped: three instant failures in a row stops it rather than
spinning. Where Web Speech is unavailable the textarea plus the phone keyboard's own
mic button still works, and that path works offline where Web Speech does not.

**Reading messy speech.** The extraction prompt assumes a transcript, not a form: it
ignores crew chatter and filler, accepts any way a corner gets named ("passenger front",
"RF", "right side front"), converts spoken fractions ("eighty eight and a quarter" →
88.25), reads "two ten" as 210 in a temperature context, and takes the *last* value when
a number is corrected mid-sentence. It is told to return null rather than guess. After a
fill, the panel echoes back exactly what landed where — `RF psi 24.5 · size 88.25 · in
210` — so you check it against what you said instead of trusting a count.

**Race Day Details.** Each day carries event, track, date (a real date picker), driver,
car number, class, and day notes. Driver and car show on the hub card and the summary
header, and every field lands in the CSV exports — so a season of logs stays labelled and
searchable rather than becoming a pile of untitled days.

## Acceptance checks

| # | Check | Status |
|---|---|---|
| 1 | `npm run build && npm run preview`; installs to home screen, launches fullscreen | manifest, SW, and icons verified served on the live deploy (all 200); **the install itself needs a real device** |
| 2 | Airplane mode: day + sessions + `88 1/4` fractions → analysis and charts; reload persists | covered by `test/app.test.js` + a 22-entry precached shell |
| 3 | Fronts 20°F hotter than rears → TIGHT with wedge/sway options; post psi < pre psi → red LOST flag | `test/app.test.js`, `test/analyze.test.js` |
| 4 | Smart Fill photo/dictation fills the active tab; "and a quarter" → .25; offline disabled state | request/response contract covered by `test/parse.test.js`, offline state by `test/app.test.js`; `/api/parse` is live and answering; **still needs `ANTHROPIC_API_KEY` set in Vercel to exercise the model call** |
| 5 | Export → wipe → import restores everything | `test/app.test.js` |
| 6 | Lighthouse PWA installability; no console errors | manifest + SW verified, test run is clean of unhandled errors; **run Lighthouse against the deploy** |

The deployment now exists, so what's left is device work: install it on a phone (1), run Lighthouse
against the live URL (6), and set the API key then run one real Smart Fill (4). The model call has
still never been exercised end to end.
