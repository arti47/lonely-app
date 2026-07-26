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
packages/systems/     roll comparator + optional saved templates/packs (data)
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

## System-agnostic by default

The app requires **no system configuration to be fully usable**. You can open it,
start a campaign, and log any game without telling it what you're playing.

This falls out of two facts. Lonelog is already system-agnostic — it records
*what you rolled and what it meant*, never *how the rules work*. And since you
roll physical dice, the app has no need to know a system's dice mechanics in
order to produce them. What's left for a "system" to do is only labelling and
convenience.

So the whole thing works from the notation alone:

| Concern | How it works with no system defined |
| :-- | :-- |
| Rolls | Type the roll as you'd write it: `Stealth d6=5 vs TN 4`, pick or type the outcome. The lexer parses it; the fold stores it. |
| Character sheet | **Derived from your `[PC:]` tags.** Write `HP 12/15` once and the State pane grows an HP meter. No schema to configure. |
| Clocks, tracks, timers, threads | Core notation. Already system-independent. |
| Inventory, wealth, rooms, units | Add-on notation. Already system-independent. |
| Oracles | A generic yes/no with an odds column, plus any table you define inline per core §4.3.1–2. |

The character sheet being *folded rather than configured* is the important one:
it is the same invariant as the rest of the app, applied to the one place most
tools would have put a settings screen. Your sheet is whatever your log says it
is.

### Packs are optional accelerators, learned not configured

A system pack is then a pure convenience layer — saved roll templates, saved
tables, outcome-band labels — and it is **never required**.

Better, it doesn't need authoring up front. The app watches the `d:` lines you
type, and once it has seen the same shape a few times it offers to save it:

> You've entered `Stealth d6=N vs TN 4` three times. Save as a quick roll?

Accepting captures the shape, its modifiers, and its outcome labels as a template
you can tap next time. A pack accretes from actual play instead of being
configured before it. Templates are editable, groupable into a named pack, and
exportable as a file — so a homebrew system becomes shareable as a by-product of
having played it.

Pre-made packs for common systems can ship later as seed data. They are a
convenience on a convenience, not a prerequisite, and nothing blocks on them.

**The trade-off, stated plainly:** with no pack, the app can't auto-label outcome
bands — it has no way to know that 7–9 means Weak Hit. You pick or type the
outcome, exactly as you would writing the log by hand. The moment that annoys
you, save the template from a roll you already made and it stops.

## The app does not roll

Dice stay on the table. The app's job is **capture and resolution**, not
generation. There is no RNG anywhere in the codebase, which makes every part of
it deterministic and testable from fixtures alone.

A saved roll template — when you choose to make one — therefore describes *what
to ask for* and *how to judge it*:

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
2. PWA shell: campaign list, log pane, symbol-first composer, IndexedDB,
   markdown export/import. **Usable for real play at this point**, with no
   system configuration of any kind.
3. State pane, with the PC sheet derived from `[PC:]` tags.
4. Free-form roll entry + generic yes/no oracle + user-defined tables.
5. Roll comparator and saved templates, offered from repeated `d:` shapes.
6. Add-on UI: combat, then resources, then dungeon, then wargaming.
7. Lint rules surfaced as gentle inline warnings.
8. Optional: seed packs for common systems.

Nothing before step 6 requires knowing which game is being played.

## Open questions

- Whether add-ons are opt-in per campaign or auto-surfaced when their tags first
  appear in the log.
