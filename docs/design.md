# lonely-app — architecture

Goal: a solo-RPG play assistant and session logger, system-agnostic, whose
on-disk artifact is valid Lonelog markdown.

Form factor: **local-first PWA**. Installable on phone and desktop, fully
offline, no server, no account.

## Principle: the log is the source of truth

The app never keeps a separate database of "current campaign state" alongside the
log. State is **derived by folding the log**, line by line:

```
lines[] --parse--> Entry[] --fold--> CampaignState
```

`CampaignState` = PCs, NPCs, locations, threads, clocks/tracks/timers, inventory,
wealth, rooms, units, open blocks. Every value in it carries the line index that
last set it, so any number on screen is clickable back to the moment it changed.

Why this way:
- It is the spec's own stated principle ("record changes at the point of
  fiction... don't maintain a separate inventory spreadsheet you update
  silently").
- No drift between the log you export and the state the app shows.
- Undo is truncation. Editing history is a re-fold.
- Import of a hand-written log is the same code path as live play.

Cost: folding is O(log length) on every change. Mitigated by memoising the fold
per scene boundary — a session of a few thousand lines re-folds in single-digit
milliseconds, and only the tail after the last checkpoint is recomputed on
append.

## Modules

```
packages/lonelog/     pure TS, zero UI deps — the whole notation
  lexer.ts            line -> {kind, raw, indent}  kind: action|question|dice|
                      resolution|consequence|tbl|gen|note|dialogue|tag|marker|prose
  tags.ts             tag parse/serialise, tolerant of whitespace, x/×, >=/≥
  fold.ts             Entry[] -> CampaignState, with per-scene checkpoints
  render.ts           Entry[] -> markdown, digital or analog form
  lint.ts             spec-violation rules (see docs/spec-review.md)
packages/systems/     system packs (data, not code) + loader/validator
apps/pwa/             React UI, IndexedDB persistence, service worker
```

`packages/lonelog` is the asset worth getting right. It is testable headlessly,
usable by a future CLI or Obsidian plugin, and publishable on its own.

### Parser posture: tolerant in, canonical out

Real logs look like the spec's own examples — irregular. The lexer accepts
`[Inv: Torch | 3]`, `[Inv:Torch|3]`, `Arrowx12`, `Arrow × 12`, `5≥4`, `5>=4`.
The renderer emits one canonical form. A `strict` lint pass flags the
inconsistencies catalogued in `docs/spec-review.md` without refusing to parse.

Unrecognised lines are preserved verbatim as `prose` and round-trip untouched.
The parser must never lose a byte of the user's log.

## System packs

"Any solo game" means the system is **data**, not a code branch. A pack is JSON:

```jsonc
{
  "id": "ironsworn",
  "name": "Ironsworn",
  "addons": ["resources"],              // which Lonelog add-ons to surface
  "pc": { "fields": [                   // drives the character panel + [PC:] tag
    { "key": "Health", "type": "track", "max": 5 },
    { "key": "Supply", "type": "track", "max": 5 },
    { "key": "Momentum", "type": "number", "min": -6, "max": 10 }
  ]},
  "rolls": [                            // named roll templates -> d: lines
    { "id": "action", "label": "Action Roll",
      "dice": "d6 + {stat} vs d10, d10",
      "outcomes": [
        { "when": "both", "label": "Strong Hit" },
        { "when": "one",  "label": "Weak Hit" },
        { "when": "none", "label": "Miss" }
      ]}
  ],
  "oracles": [                          // -> ? / d: / tbl: lines
    { "id": "yesno", "kind": "yesno", "odds": ["Almost Certain","Likely","50/50","Unlikely","Small Chance"] },
    { "id": "action", "kind": "table", "die": "d100", "entries": ["Scheme","Clash","Weaken", "..."] }
  ]
}
```

Ship packs for Ironsworn, Mythic GME, PbtA, FitD, OSR/d20, and a **Generic**
pack that is nothing but a dice expression box and a yes/no oracle. Users clone
and edit packs in-app; a pack is exportable as a file, so a homebrew system is
shareable.

Dice expressions get a small evaluator: `NdM`, `+`/`-`, `kh`/`kl`, `dF`,
`vs TN`, `vs AC`, exploding, and paired-challenge-die comparison. Anything the
evaluator can't express, the user types the `d:` line by hand — the log accepts
it either way.

## Play surface

Three panes, collapsing to tabs on phone:

1. **Log** — the transcript, rendered, editable. Tapping a symbol chip (`@ ? d:
   -> =>`) starts a line of that kind; the composer is symbol-first so notation
   is never typed by hand unless you want to.
2. **State** — live `CampaignState`: PC sheet, NPC/location index, open threads,
   clocks with fill bars, inventory, and whatever add-on blocks are active.
   Editing a value here appends the corresponding tag line to the log rather than
   mutating state directly.
3. **Tools** — the system pack's rolls and oracles, plus user tables. Every roll
   emits its `d:` / `tbl:` / `gen:` line with full detail, so the log stays
   reproducible.

Add-on UI is conditional on the pack's `addons` list — a Mythic investigation
never shows a battle tracker.

## Storage & sync

IndexedDB (Dexie) holds campaigns, sessions, packs, and user tables. Export
writes a Lonelog markdown file per campaign — YAML front matter, `##` sessions,
`###` scenes, notation in fenced code blocks per core §2.1. Import parses one
back. File System Access API where available, so a campaign can be bound to a
real `.md` file on disk and re-saved in place; download/upload fallback
elsewhere.

No server. If sync is ever wanted, it is a file in the user's own cloud folder,
not a backend.

## Stack

Vite · React · TypeScript · Dexie · Vitest · `vite-plugin-pwa`. No UI framework
beyond CSS modules — the surface is dense and custom; a component library would
be fought more than used.

## Build order

1. `packages/lonelog` — lexer, tags, fold, render, round-trip tests against every
   example in the five vendored specs. This is the correctness bar: **the spec's
   own examples must round-trip**.
2. Generic system pack + dice evaluator.
3. PWA shell: campaign list, log pane, composer, IndexedDB, export/import.
4. State pane.
5. Tools pane, oracles, user tables.
6. Add-on UI: combat, then resources, then dungeon, then wargaming.
7. Lint rules surfaced as gentle inline warnings.

## Open questions

- Whether the app rolls dice or records physical rolls (drives how central the
  Tools pane is).
- Whether add-ons are opt-in per campaign or auto-surfaced when their tags first
  appear in the log.
