# Lonely

A local-first solo RPG **play assistant and session logger**, built on Lonelog
notation. Works with any solo system, needs no setup, and keeps everything on
your device.

- **No account, no server, no sync service.** Nothing leaves your device.
- **No dice rolling.** You roll physical dice; the app captures the numbers and
  labels the outcome. There is no RNG in the codebase.
- **No system configuration.** Your character sheet is derived from the `[PC:]`
  tags you write. Add-on panels appear when their tags first appear in your log.
- **The log is the artifact.** What you export is plain Lonelog markdown you can
  read, diff and keep without this app.

## Run it

No build step. Clone and serve the directory:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works. Opening `index.html` over `file://` works too, minus
the service worker. To install as an app, open it in a browser and choose
"Install" / "Add to Home Screen".

## Develop

```sh
npm test          # unit tests + typecheck + headless browser smoke test
npm run test:unit # unit tests only (no browser needed)
npm run corpus    # re-harvest spec examples into tests/corpus/
```

`npm test` runs with **no installed dependencies** — the browser smoke test
drives Chromium over the DevTools Protocol using Node's built-in WebSocket, and
the typecheck skips itself if TypeScript is absent. `npm install` adds
TypeScript so the JSDoc types are actually checked.

The suite asserts, among other things, that **every example in all five vendored
Lonelog specs round-trips byte-identically**, and that folding a log is
deterministic and equal to folding from any scene checkpoint.

## Layout

```
src/lonelog/    the notation engine — lexer, tags, fold, render, lint
src/            app shell, screens, storage, UI primitives
docs/spec/      vendored Lonelog specs (upstream copies, never edited)
docs/           spec review, design rationale
tests/          unit tests, spec corpus, browser smoke test
CLAUDE.md       the canonical project spec — read this first
```

`src/lonelog/` imports nothing outside itself, so it is reusable as-is by a CLI
or an editor plugin.

## Publish it on GitHub Pages

The app is plain static files with no build step, so Pages needs no workflow:

1. **Settings → Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main`, folder `/ (root)` → **Save**

It will be served at `https://<user>.github.io/lonely-app/`. Every asset
reference is relative and a test enforces that, so the project subpath works.
`.nojekyll` stops Jekyll from touching the files.

Everything still runs locally — Pages just gives you a URL to install the PWA
from on a phone.

## Status

Phases 0–5 are complete, and the 58-item spec-conformance ledger is fully
implemented. You can log a session end to end, watch state fold out of it,
resolve rolls, oracles and tables, and get combat, resource, dungeon and
wargaming panels that appear on their own when your log starts using them.
Scene and session boundaries fire as one bundle — closing open blocks and
snapshotting whichever add-ons are in play — with a summary first and one-step
undo after. Roll the same shape a few times and the app offers to save it as a
one-tap quick roll, which you can export as a pack — so a "system" accretes from
play rather than being configured first. A searchable Notation tab explains every
construct, and any line that breaks a spec rule is flagged with an explanation —
never blocked. Remaining: the hardening pass (accessibility, full spec-conformance
audit). See `CLAUDE.md` §8.

## Licensing

Lonelog is © Roberto Bisceglie, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The specs under
`docs/spec/` are unmodified upstream copies redistributed under that licence.

This application is a tool that reads and writes the notation. **Your session
logs are your own work** and are not subject to the spec's licence — publish them
however you like.

The app ships no rules content from any game publisher.
