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

## The app does not roll

Dice stay on the table. The app's job is **capture and resolution**, not
generation. There is no RNG anywhere in the codebase, which makes every part of
it deterministic and testable from fixtures alone.

A roll template therefore describes *what to ask for* and *how to judge it*:

```jsonc
{ "id": "action", "label": "Action Roll",
  "inputs": [                              // what the user types after rolling
    { "key": "action", "label": "d6",  "die": 6 },
    { "key": "c1",     "label": "Ch1", "die": 10 },
    { "key": "c2",     "label": "Ch2", "die": 10 }
  ],
  "modifiers": ["{stat}", "{momentum?}"],  // pulled from CampaignState, editable
  "compare": "action + mods vs c1, c2",
  "outcomes": [
    { "when": "beats both", "label": "Strong Hit" },
    { "when": "beats one",  "label": "Weak Hit" },
    { "when": "beats none", "label": "Miss" },
    { "when": "c1 == c2",   "label": "+ Match", "append": true }
  ]}
```

The comparator supports what real systems need: sum vs TN/DC/AC, `≥`/`≤`, paired
challenge dice, count-successes pools, keep-highest/lowest from typed dice, `dF`
ladders, degree bands (crit/strong/weak/miss), and doubles/match detection. It
evaluates entered numbers — it never produces them.

Entry UX is the thing that has to be fast, because it happens dozens of times a
session: a numeric pad sized for a thumb, one field per die, auto-advance on
entry, modifiers pre-filled from the PC's current state and editable inline.
Committing writes the full `d:` line with roll detail, modifiers, comparison and
labelled outcome, so the log stays reproducible by a reader.

Anything the comparator can't express, the user types the `d:` line by hand — the
log accepts it either way, and hand-typed lines fold identically.

Oracles work the same way: the app shows the table and the odds column, the user
rolls and enters the number, the app resolves the lookup and writes the `tbl:` /
`gen:` / `d:` line. Multi-axis generators prompt for one number per axis and emit
the indented multi-line `gen:` block from core §4.3.3.

## Play surface

Three panes, collapsing to tabs on phone:

1. **Log** — the transcript, rendered, editable. Tapping a symbol chip (`@ ? d:
   -> =>`) starts a line of that kind; the composer is symbol-first so notation
   is never typed by hand unless you want to.
2. **State** — live `CampaignState`: PC sheet, NPC/location index, open threads,
   clocks with fill bars, inventory, and whatever add-on blocks are active.
   Editing a value here appends the corresponding tag line to the log rather than
   mutating state directly.
3. **Resolve** — the system pack's roll templates and oracle tables. You roll
   physical dice, enter the numbers, the app compares and labels, then writes the
   `d:` / `tbl:` / `gen:` line. Also holds user-defined tables (core §4.3.1–2),
   including filtered option sets.

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
2. Roll comparator + Generic system pack.
3. PWA shell: campaign list, log pane, composer, IndexedDB, export/import.
4. State pane.
5. Resolve pane: roll entry, oracle lookup, user tables.
6. Add-on UI: combat, then resources, then dungeon, then wargaming.
7. Lint rules surfaced as gentle inline warnings.

## Open questions

- Whether add-ons are opt-in per campaign or auto-surfaced when their tags first
  appear in the log.
- Which systems to ship as packs at launch.
