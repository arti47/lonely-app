# CLAUDE.md

## Project

`lonely-app` — tooling around **Lonelog**, a plain-text notation for solo RPG
session logs (Roberto Bisceglie, CC BY-SA 4.0). The specs are vendored under
`docs/spec/`; they are the authoritative grammar for anything this repo parses,
renders, or generates.

Target: a **local-first PWA** — solo-RPG play assistant and session logger,
system-agnostic, whose on-disk artifact is valid Lonelog markdown. Offline, no
server, no account. Architecture in `docs/design.md`.

Status: design agreed, no application code yet.

## Repo layout

```
docs/spec/lonelog-core.md      Core spec v1.5.0 — the five symbols + optional layers
docs/spec/addon-combat.md      Combat Add-on v1.1.0
docs/spec/addon-dungeon.md     Dungeon Crawling Add-on v1.1.0
docs/spec/addon-resources.md   Resource Tracking Add-on v1.1.0
docs/spec/addon-wargaming.md   Solo Wargaming Add-on v1.0.0
docs/spec-review.md            Known spec defects & inconsistencies (see below)
docs/design.md                 App architecture, system-pack format, build order
```

Planned code layout:

```
packages/lonelog/   pure TS notation engine — lexer, tags, fold, render, lint
packages/systems/   roll comparator + optional saved templates (JSON data)
apps/pwa/           React UI, Dexie/IndexedDB, service worker
```

## System agnosticism

The app must be **fully usable with no system configured**. Lonelog records what
was rolled and what it meant, never how the rules work; the user rolls physical
dice, so there is **no RNG in the codebase**. The PC sheet is derived by folding
`[PC:]` tags, not configured from a schema. System packs are optional
accelerators (saved roll templates, tables, outcome labels) that accrete from
repeated `d:` shapes during play — never a prerequisite, never a launch blocker.

## Core design invariant

**The log is the source of truth.** There is no separate state database.
`CampaignState` (PCs, NPCs, clocks, inventory, rooms, units...) is derived by
folding parsed log entries, with per-scene checkpoints for speed. Editing state
in the UI appends a tag line to the log; it never mutates state directly. Undo is
truncation.

The parser is **tolerant in, canonical out**, and must never lose a byte —
unrecognised lines round-trip verbatim as prose. Correctness bar: every example
in the five vendored specs must round-trip.

## Notation summary (parser contract)

Five core symbols. Add-ons introduce **no** new symbols — only tags, structural
blocks, and line markers.

| Symbol | Meaning |
| :-- | :-- |
| `@ Action` | PC action; `@(Name) Action` attributes to another actor |
| `? Question` | Oracle question |
| `d: roll -> outcome` | Mechanics or oracle dice resolution |
| `-> result` | Any resolution outcome (shorthand when dice detail is omitted) |
| `=> consequence` | Narrative consequence. **Consequences only** — never a dice outcome |

Adjacent line markers: `tbl:` (table lookup), `gen:` (multi-axis generator),
`(note: ...)` (meta), `N (Name): "..."` / `PC: "..."` (dialogue),
`\--- ... ---\` (long in-fiction block).

### Tags

General form: `[Type:Name|field|field|...]`, `|`-separated, whitespace around
separators insignificant. `[#Type:Name]` references a previously-established
element. `+field` / `-field` add/remove; `a -> b` inside a field is a state
transition; `N->M` is a value transition.

| Tag | Source | Notes |
| :-- | :-- | :-- |
| `[PC:Name\|stats]` | core | also holds abstract resources (`Supply d8`, `Supply 4/5`) |
| `[N:Name\|tags]` | core | persistent NPCs |
| `[L:Name\|tags]` | core | locations |
| `[E:Name X/Y]` | core | event/clock — overlaps `[Clock:]`, see spec-review |
| `[Thread:Name\|state]` | core | Open / Closed / Abandoned / custom |
| `[Clock:Name X/Y]` | core | fills up = threat |
| `[Track:Name X/Y]` | core | fills up = progress |
| `[Timer:Name X]` | core | counts down |
| `[F:Name\|stats]` | combat | combatant; `[F:Namex3]` groups identicals |
| `[R:ID\|status\|desc\|exits DIR:ID]` | dungeon | room state |
| `[Inv:Item\|qty\|props]` | resources | concrete items |
| `[Wealth:Cur N]` | resources | `+N` / `-N` / `N->M` deltas |
| `[Unit:Name\|size\|stats\|pos\|status]` | wargaming | `xN`, `Morale N`, `Armor CT#/RT#/...`, `Heat N` |
| `[Force:Name\|cmdr\|strength\|objective]` | wargaming | optional |
| `[Scenario:Name\|objective\|turns\|rules]` | wargaming | opens a `[BATTLE]` |

### Structural blocks

`[BLOCK]` / `[/BLOCK]` digital; `--- BLOCK ---` / `--- END BLOCK ---` analog.
Blocks in use: `COMBAT`, `DUNGEON STATUS`, `RESOURCES`, `BATTLE`, `CAMPAIGN`.

### Line markers

`S#` scene (`S#a` flashback, `S#.#` montage, `T#-S#` parallel thread) ·
`Rd#` combat round (personal scale) · `Tn#` wargame turn (unit scale, optionally
`Tn# Move:` / `Shoot:` / `Combat:` / `Heat:`).

`Rd#` and `Tn#` are deliberately distinct and may both appear in one log.

## Working rules for this repo

- **Extend, don't replace.** Anything that invents a sixth core symbol is a fork,
  not a Lonelog feature. The wargaming add-on's floated `!` symbol is explicitly
  contradicted by the combat add-on — do not implement it.
- Specs in `docs/spec/` are upstream copies. Do not silently "fix" them; record
  defects in `docs/spec-review.md` instead.
- Parsers must tolerate irregular whitespace (`[Inv: Torch|3]` ≡ `[Inv:Torch|3]`)
  and both `x`/`×` multipliers, both `>=`/`≥`.
- Analog and digital forms are equivalent; any renderer should round-trip both.
- Notation in markdown must live in fenced code blocks — `=>` collides with some
  markdown extensions outside them.

## Git

- Develop on `claude/code-review-docs-yg61y7`, merge to `main`, push both.
- Keep this file current when structure or the parser contract changes.
