# CLAUDE.md

Canonical living spec. Every code change updates this file **in the same change**
(§9). A code change with a stale CLAUDE.md is incomplete.

## 1. Project

`lonely-app` — a solo-RPG **play assistant and session logger** built on
**Lonelog**, a plain-text notation for solo RPG session logs (Roberto Bisceglie,
CC BY-SA 4.0). The specs are vendored under `docs/spec/` and are the authoritative
grammar for everything this repo parses, renders, or generates.

| | |
|---|---|
| **Audience** | One solo player — the log's author. No GM, no party, no other seats. |
| **Platforms** | Phone, desktop, browser — one installable PWA |
| **Core job** | Log any solo RPG session in valid Lonelog · derive live campaign state from that log · capture and resolve physical dice rolls |
| **Systems** | **None hardcoded.** Fully usable with no system configured (§1.1) |
| **Backend** | None. Local-only, offline, no account, no server, no sync service |
| **Artifact** | A Lonelog markdown file the user owns and can read without this app |

**Mandatory scope:** log pane with symbol-first composer · State pane derived by
folding the log · persistent state header on every in-play screen · roll entry +
comparator · oracle/table lookup · scene/session lifecycle engine with
confirmation summary and one-step undo · markdown export/import **and** JSON
backup in Settings · add-on surfaces (combat, resources, dungeon, wargaming) ·
spec lint · searchable notation reference, with every automated surface linking
to its reference entry.

**Explicitly out of scope:** dice generation (§1.1), multiplayer, GM tooling,
accounts, servers, per-game rules content, bestiaries, character-creation
wizards.

### 1.1 Product decisions

Recorded from user Q&A. These are settled; do not re-litigate.

| # | Decision | Value |
|---|---|---|
| D1 | Form factor | Local-first installable PWA |
| D2 | Dice input | **Manual only.** The user rolls physical dice; the app captures and compares. **No RNG anywhere in the codebase.** |
| D3 | System support | **System-agnostic by default.** No configuration required to be fully usable. |
| D4 | System packs | Optional accelerators, *learned* from repeated `d:` shapes during play — never authored up front, never a launch blocker |
| D5 | Character sheet | **Derived by folding `[PC:]` tags**, not configured from a schema |
| D6 | Add-on UI | **Surfaces automatically** when an add-on's tags first appear in the log; never a settings toggle |
| D7 | Theme | Light + dark, default follows `prefers-color-scheme`, in-app override |
| D8 | Table device | Phone-first; must work at 360px with zero horizontal overflow |

## 2. Architecture — LOCKED

- **No build step.** Vanilla JS, native ES modules loaded directly by the browser
  (`<script type="module" src="src/main.js">`). Clone-and-run must always work,
  and must still work in five years with no toolchain.
- **Types without a build.** JSDoc annotations checked by `tsc --checkJs
  --noEmit` in `npm test`. The notation engine is where type safety pays; it does
  not justify a compiler in the ship path.
- **Installable PWA:** `manifest.json`, `service-worker.js` (network-first,
  caches app shell + all modules, versioned `CACHE_VERSION`), SVG icon, in-app
  "Update available — reload" toast when the SW detects new code.
- **Storage:** IndexedDB for campaigns/logs/settings; zero configuration, works
  offline from first load. File System Access API where available so a campaign
  binds to a real `.md` file on disk and re-saves in place; download/upload
  fallback elsewhere.
- **No network code at all.** There is no backend, no analytics, no font CDN, no
  telemetry. The service worker is the only network-aware module.
- **No RNG.** `Math.random` and `crypto.getRandomValues` must not appear in
  `src/`. Enforced by a regression check (§9.5). The app is fully deterministic
  and testable from fixtures.
- **Themed UI primitives:** no native `alert/confirm/prompt`. A shared `modal()`
  + `showToast/confirmModal/promptModal`, accessible (focus trap, Escape,
  `aria-modal`, focus restore), sized to the visual viewport (mobile-toolbar
  safe).
- **Accessibility:** keyboard + screen-reader usable. `aria-live` on roll
  outcomes and state changes, labeled icon-only buttons, `aria-current` nav.
- **Responsive:** phone-first; zero horizontal overflow at 360px on every screen.

## 3. File structure — LOCKED

| File | Purpose |
|---|---|
| `index.html` | App shell: header, bottom nav, screen mount, module entry |
| `styles.css` | Theme (light + dark) + all component styles |
| `manifest.json`, `service-worker.js`, `icon.svg` | PWA |
| `jsconfig.json` | `tsc --checkJs` config for the JSDoc typecheck |
| `tests/` + `package.json` | Dev-only regression harness (`npm test`): `*.test.js` unit tests, `corpus/` spec examples, `smoke.mjs` headless-browser run, `typecheck.mjs`, `extract-corpus.mjs`. The only devDependency is `typescript`, and it is optional. `node_modules` gitignored; not in the SW app shell |
| `docs/spec/*.md` | Vendored Lonelog specs — upstream copies, never edited (§10) |
| `docs/spec-review.md` | Catalogued spec defects; source of the lint rules |
| `docs/design.md` | Rationale and reasoning. Non-canonical — this file wins |
| `README.md` | Setup + licensing note (§10) |
| `CLAUDE.md` | This file — canonical spec |

### 3.1 `src/` module map — LOCKED responsibilities

One module per responsibility; explicit `import`/`export`, nothing through
`window`. Runtime cycles are safe under ESM live bindings.

| Module | Responsibility |
|---|---|
| `core.js` | ✅ Constants, DOM/util helpers. No imports. **No RNG.** |
| `ui.js` | ✅ Themed modals/toasts/confirm/prompt; theme switching |
| `lonelog/lexer.js` | ✅ Line → `Entry{kind, raw, indent, …}`. Kinds: `action question dice resolution consequence tbl gen note dialogue sessionMeta tag marker block prose` |
| `lonelog/tags.js` | ✅ Tag parse/serialise; tolerant of whitespace, `x`/`×`, `>=`/`≥` |
| `lonelog/fold.js` | ✅ `Entry[]` → `CampaignState`, with per-scene checkpoints |
| `lonelog/render.js` | ✅ `Entry[]` → markdown, digital or analog form |
| `lonelog/lint.js` | ✅ Spec-conformance rules (§10, `docs/spec-review.md`) |
| `lonelog/index.js` | ✅ Engine barrel + `parse()` (lex → fold → lint) |
| `compare.js` | Roll comparator over **entered** numbers. No RNG |
| `templates.js` | Learned roll templates + saved tables; pack import/export |
| `store.js` | ✅ IndexedDB persistence, markdown + JSON export/import, File System Access binding |
| `composer.js` | ✅ Symbol-first entry: line kinds, tag builder, autocomplete |
| `logview.js` | ✅ Transcript rendering, editing, truncation-undo |
| `state.js` | State pane: folded PC sheet, NPC/location index, threads, clocks |
| `resolve.js` | Roll entry, oracle lookup, user tables |
| `addons/combat.js` | `[COMBAT]`, `Rd#`, `[F:]` surfaces |
| `addons/resources.js` | `[Inv:]`, `[Wealth:]`, `[RESOURCES]` surfaces |
| `addons/dungeon.js` | `[R:]`, `[DUNGEON STATUS]` surfaces |
| `addons/wargaming.js` | `[Unit:]`, `[Force:]`, `[BATTLE]`, `[CAMPAIGN]`, `Tn#` surfaces |
| `lifecycle.js` | Scene/session/campaign boundary events + undo (§6) |
| `settings.js` | ✅ Preferences, theme, panel visibility, reference links |
| `router.js` | ✅ Bottom-nav routing + conditional tab gating |
| `screens.js` | ◐ Screen renderers. Campaigns, Log and Settings functional; State/Resolve render real folded state, awaiting Phases 3–4 |
| `main.js` | ✅ Entry point / boot |

`src/lonelog/` imports nothing outside itself — it is the reusable engine and
must stay portable to a future CLI or plugin.

When adding or moving a `src/` file: update the §3 tables **and** the
service-worker app-shell list, then bump `CACHE_VERSION` — same change.

## 4. Notation contract

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

### 4.1 Tags

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

### 4.2 Structural blocks & line markers

`[BLOCK]` / `[/BLOCK]` digital; `--- BLOCK ---` / `--- END BLOCK ---` analog.
Blocks: `COMBAT`, `DUNGEON STATUS`, `RESOURCES`, `BATTLE`, `CAMPAIGN`.

`S#` scene (`S#a` flashback, `S#.#` montage, `T#-S#` parallel thread) ·
`Rd#` combat round (personal scale) · `Tn#` wargame turn (unit scale, optionally
`Tn# Move:` / `Shoot:` / `Combat:` / `Heat:`). `Rd#` and `Tn#` are deliberately
distinct and may both appear in one log.

## 5. Core invariants — LOCKED

1. **The log is the source of truth.** There is no separate state database.
   `CampaignState` is derived by folding parsed entries, with per-scene
   checkpoints. Editing state in the UI **appends a tag line to the log**; it
   never mutates state directly. Undo is truncation. Importing a hand-written log
   uses the same code path as live play.
2. **Never lose a byte.** Unrecognised lines round-trip verbatim as `prose`.
   Parsing is lossless; the user's log is theirs.
3. **Tolerant in, canonical out.** Accept the irregularity found in the specs'
   own examples (`[Inv: Torch | 3]`, `Arrowx12`, `Arrow × 12`, `5≥4`, `5>=4`);
   emit one canonical form; lint flags violations without refusing to parse.
4. **No RNG.** The user rolls. The app compares. (§2)
5. **No configuration gates usage.** The app is fully usable with nothing set up.
   Every "system" feature is learned or optional (D3, D4).
6. **Extend, don't replace.** Anything inventing a sixth core symbol is a fork,
   not a Lonelog feature. The wargaming add-on's floated `!` symbol is explicitly
   contradicted by the combat add-on — do not implement it.
7. **Every rendered value is traceable.** Each `CampaignState` value carries the
   line index that last set it, and is clickable back to that line.

## 6. Data model

IndexedDB. Every schema addition ships a normalization path back-filling defaults
on old records (never crash on old data), documented here in the same change.

```
campaigns/{id}
  meta:     { title, ruleset?, genre?, player?, tone?, createdAt, updatedAt,
              fileHandle? }                       // §5.1 core campaign header
  log:      string[]                              // THE artifact — raw lines, ordered
  bindings: { path?, handle?, lastSavedHash? }    // File System Access binding
  view:     { hiddenPanels[], theme?, composerMode }   // UI state ONLY — never
                                                       // affects fold output (D6)
  checkpoints/{sceneIndex}: { lineIndex, state }  // fold memoisation, derivable,
                                                  // safe to discard and rebuild
templates/{id}: { label, inputs[], modifiers[], compare, outcomes[], packId?, seenCount }
tables/{id}:    { name, die?, entries[] | options[] }   // core §4.3.1–2
settings:       { theme, referenceLinks, lintLevel }
```

`log` is the only authoritative field. `checkpoints` are a cache. `view` is
presentation. Anything in `CampaignState` not reconstructible from `log` is a bug.

## 7. Settings & toggle pattern — LOCKED

Optional surfaces follow one pattern: a flag in `settings.js`
(`Settings.<flag>() → !!get("<flag>")`), a toggle row in Settings with a one-line
description, every related UI checks the flag before rendering, and gated nav
tabs are hidden by the router when off. Explicit user choice beats inferred
defaults (store `true`/`false` distinctly from unset).

**Add-on panels are the exception and are not toggles** (D6): they surface from
log content, are sticky per campaign once seen, and may be *hidden* — hiding is
`view` state and must never mutate or drop log content.

## 8. Roadmap

Build strictly in order. Per-feature spec format is mandatory for every item:
**Contract** (the spec rule + citation) · **Target** (file · module · function) ·
**Behavior/UI** · **Schema** (field · type · default · location, §6 updated) ·
**Acceptance** (how to confirm in a browser).

- [x] **Phase 0 — Foundations.** Scaffold §3 files; PWA shell + SW +
      `CACHE_VERSION`; theme (light/dark/system); `ui.js` primitives; IndexedDB
      store; router + empty screens; `npm test` harness booting headless with
      zero console errors; no-RNG check; 360px overflow check.
- [x] **Phase 1 — Notation engine.** `src/lonelog/*`: lexer, tags, fold, render.
      Ledger T1–T27. **Correctness bar: every example in all five vendored specs
      round-trips byte-identically.** Engine is complete before any UI consumes
      it. *Done: 377/377 spec snippets round-trip; 69 unit tests and 20 browser
      checks green.*
- [x] **Phase 2 — Log pane.** Symbol-first composer (tap `@ ? d: -> =>`, tag
      builder, autocomplete from folded state); transcript rendering + editing;
      truncation-undo; scene/session markers; markdown export/import **and** JSON
      backup in Settings; file binding where supported.
      *Done: composer emits all eight line kinds plus scene, session, block and
      tag builders; rows are clickable for edit and truncate-from-here.*
- [x] **🏁 Milestone — First Session Logged.** Start a campaign → log a real solo
      session end-to-end → export valid Lonelog markdown → reimport it and get an
      identical fold. Verified at a real play session. **No system configuration
      of any kind is required to reach this milestone.**
      *Met: `tests/milestone.test.js` composes a full session through the
      composer's own helpers, exports, reimports and asserts an identical fold;
      the browser run does the same through the UI.*
- [ ] **Phase 3 — State pane.** Folded PC sheet from `[PC:]` tags (D5); NPC and
      location index; threads; clocks/tracks/timers with fill meters; persistent
      state header on every in-play screen; every value traceable to its line
      (§5.7); editing appends a tag line (§5.1).
- [ ] **Phase 4 — Resolve pane.** Free-form roll entry; comparator (§3.1 module)
      covering sum vs TN/DC/AC, `≥`/`≤`, paired challenge dice, count-successes
      pools, keep-high/low, `dF` ladders, degree bands, match detection; generic
      yes/no oracle with odds column; user tables incl. inline definitions and
      filtered option sets; emits full `d:` / `tbl:` / `gen:` lines. Ledger
      T3–T8, T17.
- [ ] **Phase 5 — Add-on surfaces.** Auto-surfacing per D6, in order: combat
      (T28–T34), resources (T40–T47), dungeon (T35–T39), wargaming (T48–T57).
- [ ] **Phase 6 — Lifecycle engine.** Explicit End Scene / End Session controls
      firing the whole boundary bundle (scene checkpoint, session header, state
      snapshot blocks — `[RESOURCES]`, `[DUNGEON STATUS]`, `[CAMPAIGN]` — where
      those add-ons are live), with confirmation summary and one-step undo.
- [ ] **Phase 7 — Learned templates.** Detect repeated `d:` shapes; offer to save
      as a quick roll; template editor; group into a named pack; pack
      export/import as a file (D4).
- [ ] **Phase 8 — Lint & reference.** `lint.js` rules from `docs/spec-review.md`
      surfaced as gentle inline warnings, never blocking; searchable notation
      reference; every automated surface links to its reference entry.
- [ ] **Hardening (always).** Regression harness green; accessibility pass; full
      spec-conformance audit (§11) with every finding closed.

### 8.1 Spec Conformance Ledger — mandatory

**How to continue (for any AI resuming this project):** work top to bottom within
the current phase. For each item, read the cited spec section in `docs/spec/`,
implement parse + fold + render, add its spec examples to the round-trip corpus,
**tick the box in the same change**, and append a §12 changelog row. An unticked
box means the construct is not implemented — **never build UI against an unticked
construct.** Where a construct is defective upstream, implement the tolerant
reading and add a lint rule; do not edit the vendored spec (§10).

**Core** (`docs/spec/lonelog-core.md`)

- [x] T1 Five core symbols `@ ? d: -> =>` (§3.1–3.3)
- [x] T2 `@(Name)` actor attribution (§3.1.1)
- [ ] T3 Comparison shorthand `≥ ≤ >= <= vs S F` (§3.2.1) — round-trips, but is
      not interpreted; needs the Phase 4 comparator
- [x] T4 `tbl:` simple lookup (§4.3)
- [ ] T5 `tbl:` inline table definition, named + die + entries (§4.3.1) — the
      indented entry block is not yet parsed into a table (Phase 4)
- [ ] T6 `tbl:` filtered option sets `[A, B, C]` (§4.3.2) — Phase 4
- [x] T7 `gen:` single-line compound (§4.3)
- [ ] T8 `gen:` multi-line axis blocks (§4.3.3) — the per-axis lines are not yet
      grouped under their generator (Phase 4)
- [x] T9 `[N:]` NPCs (§4.1.1)
- [x] T10 `[L:]` locations (§4.1.2)
- [x] T11 `[E:]` events/clocks (§4.1.3)
- [x] T12 `[Thread:]` + states (§4.1.4)
- [x] T13 `[PC:]` + stat updates (§4.1.5)
- [x] T14 `[#Type:Name]` reference tags (§4.1.6)
- [x] T15 Tag categories `trait:a,b` (§4.1.7)
- [x] T16 Multi-line tag form (§4.1.8)
- [x] T17 Roll context `d: ... [tags] ...` (§4.1.9)
- [x] T18 `+field` / `-field` deltas and `a -> b` transitions (§4.1.1)
- [x] T19 `[Clock:]` `[Track:]` `[Timer:]` (§4.2)
- [x] T20 Dialogue lines `N (Name):` / `PC:` (§4.4)
- [x] T21 `\--- ... ---\` narrative blocks (§4.4)
- [x] T22 `(note: ...)` meta notes (§4.5)
- [x] T23 Scene markers `S#`, `S#a`, `S#.#`, `T#-S#` (§5.3)
- [x] T24 Campaign header — YAML front matter + analog block (§5.1)
- [x] T25 Session header — digital + analog (§5.2)
- [x] T26 Indentation insignificance (§2.3)
- [x] T27 Digital ↔ analog equivalence round-trip (§2.4)

**Combat** (`docs/spec/addon-combat.md`)

- [x] T28 `[COMBAT]`/`[/COMBAT]`, analog form, scene-header form (§1)
- [x] T29 `Rd#` round markers (§2)
- [x] T30 `[F:]` combatant tag (§3.1)
- [x] T31 `[F:Namex#]` groups + splitting (§3.2)
- [x] T32 Position bands + `[Far->Close]` movement (§3.3)
- [x] T33 `Rd# Roster:` lines (§5.2)
- [x] T34 `(Init: ...)` initiative note (Quick Ref)

**Dungeon** (`docs/spec/addon-dungeon.md`)

- [x] T35 `[R:ID|status|desc]` room tag (§1)
- [x] T36 `exits DIR:ID`, directional shortcuts, `(secret)` (§2)
- [x] T37 `[R:ID|+status]` inline status add (§1.2)
- [x] T38 `[DUNGEON STATUS]` block + analog (§3)
- [x] T39 Room tag in scene header (§4.1)

**Resources** (`docs/spec/addon-resources.md`)

- [x] T40 `[Inv:Item|qty|props]` (§1)
- [x] T41 `[Inv:]` deltas `+N` `-N` `N->M` `depleted` (§1.2)
- [x] T42 Property transitions, `+prop` / `-prop` (§1.3)
- [x] T43 Grouped/bulk `x`/`×` multipliers, slot inventories (§1.5)
- [x] T44 Usage dice in `[PC:]`, step-down chain `d12→…→depleted` (§2.1)
- [x] T45 Supply tracks + qualitative levels (§2.2–2.3)
- [x] T46 `[Wealth:]` totals and deltas (§3.1)
- [x] T47 `[RESOURCES]` block + analog (§5)

**Wargaming** (`docs/spec/addon-wargaming.md`)

- [x] T48 `[Unit:Name|size|stats|pos|status]` (§2)
- [x] T49 Unit status vocabulary (§2)
- [x] T50 Abstract size `full`/`half`/`depleted` (§2)
- [x] T51 Formation labels (§2)
- [x] T52 `[Force:]` (§2)
- [x] T53 `[Scenario:]` incl. multi-line form (§3)
- [x] T54 `[BATTLE]` block + analog (§1)
- [x] T55 `Tn#` markers + phase suffixes (§1)
- [x] T56 Location armor `CT#/RT#/…`, `Heat N` + thresholds (§5)
- [x] T57 `[CAMPAIGN]` block + analog (§4)

**Lint** (`docs/spec-review.md`)

- [x] T58 Rules for all 10 catalogued defects, each linking to its review entry

## 9. Process rules — LOCKED

1. **Living spec.** This file is canonical. Every code change updates it in the
   same change — features, data model, file tables, roadmap checkboxes, ledger
   ticks, changelog.
2. **Single source of truth.** Notation semantics come from `docs/spec/`. Never
   hardcode a notation rule in a UI module — it belongs in `src/lonelog/`.
3. **Changelog table.** Every change appends a dated §12 row: what, why, root
   cause for fixes, verification performed, cache version.
4. **Verify in a real browser.** Every phase/feature is verified headless
   (Playwright) before being marked complete: flow works end-to-end with **zero
   console errors**. "Syntax is valid" is not verification.
5. **Committed regression harness.** `npm test` asserts at minimum: boot/wiring
   smoke on every tab with zero JS errors; **round-trip of every example in all
   five vendored specs**; fold determinism (same log → same state, and
   fold-from-checkpoint ≡ fold-from-zero); losslessness (unknown lines survive
   byte-identically); **no RNG in `src/`**; comparator invariants; `tsc --checkJs`
   clean; zero horizontal overflow at 360/390px on every screen; a11y basics; and
   every closed audit finding. Every bug fix adds a check that would catch its
   return.
6. **Cache discipline.** Any shipped-file change bumps `CACHE_VERSION`.
7. **Root-cause fixes.** Debug to the actual cause before editing; record cause +
   fix in the changelog. No symptom-patching.
8. **Scope guard.** Lonelog core + the four vendored add-ons only. No per-game
   rules content. Any convenience the specs don't define is labeled a house aid
   in the UI.
9. **Module discipline.** Respect §3.1 responsibilities; import/export
   explicitly; `src/lonelog/` stays dependency-free.

## 10. Content, spec fidelity & license

- Specs in `docs/spec/` are **upstream copies. Do not edit them** — not even to
  fix the defects catalogued in `docs/spec-review.md`. Implement the tolerant
  reading, add a lint rule, record the defect.
- Lonelog is CC BY-SA 4.0 (Roberto Bisceglie). Attribution ships in the app's
  About screen and the README. Adaptations of the *spec* would be ShareAlike;
  this app is a tool that reads and writes the notation, and the user's session
  logs are their own work under no such obligation — state this in the README.
- No game-system rules content from any publisher. The app ships zero per-game
  data (D3).

## 11. Spec-conformance audit — before "done"

- **Round-trip corpus:** every example in all five specs, byte-identical out.
- **Fold behavior — audit hardest here.** Sequencing and state transitions are
  where defects will live: `+`/`-` delta application order, `a -> b` transitions,
  reference tags inheriting prior state, block open/close nesting, scene
  checkpoint equivalence, `Rd#` vs `Tn#` scope, usage-die step-down chains, group
  tag splitting, status accumulation (`cleared, looted`).
- **Analog ↔ digital equivalence** in both directions for every block type.
- Document findings as a numbered work-list (**Rule / Target / Fix / Why**),
  close each with a regression check, and record what was **verified clean** so
  future audits don't re-litigate it.

## 12. Changelog

| Date | Change | Verification | Cache |
|---|---|---|---|
| 2026-07-26 | Vendored five Lonelog specs; catalogued 10 spec defects | Read-through of all five specs | — |
| 2026-07-26 | Design settled: local-first PWA, log-as-source-of-truth, no RNG, system-agnostic, add-ons self-surfacing | Design review with user (D1–D8) | — |
| 2026-07-26 | Instantiated canonical spec: architecture LOCKED to no-build ES modules, file/module tables, data model, 9-phase roadmap, 58-item conformance ledger, process rules | Template §5–§12 adapted; no code yet | — |
| 2026-07-26 | **Phase 1 — notation engine.** `src/lonelog/{lexer,tags,fold,render,lint,index}.js`. Losslessness is achieved by replaying `raw`+`eol`, which makes canonicalisation an explicit opt-in transform rather than a side effect of reading a log. Ledger T1–T2, T4, T7, T9–T58 ticked; T3/T5/T6/T8 deferred to Phase 4 with reasons recorded inline | 377/377 spec snippets round-trip byte-identically; 69 unit tests green; fold deterministic and checkpoint-equivalent across the whole corpus | `lonely-v1` |
| 2026-07-26 | **Phase 0 — foundations.** PWA shell, service worker, light/dark theme, IndexedDB store, hash router, accessible modal/toast primitives, markdown + JSON export/import, campaign CRUD | 20 headless-browser checks green: boots, all five screens render, zero console errors, zero horizontal overflow at 360/390px | `lonely-v1` |
| 2026-07-26 | **Phase 2 — log pane, and the First Session Logged milestone.** `composer.js` (symbol bar, tag builder with autocomplete from folded state, scene/session/block inserters), `logview.js` (per-entry rows, tag highlighting, inline lint flags, edit, truncate-from-here), file binding via the File System Access API with download fallback. Undo is truncation throughout, with one-step restore of a truncated tail | 85 unit tests; 27 browser checks — composing through the real UI appends and persists, undo pops and persists, export→reimport folds identically | `lonely-v2` |
| 2026-07-26 | Added a `sessionMeta` line kind for `*Date: … \| Duration: …*` under a session heading (core §5.2.1), which had been falling through to prose. Found by the milestone test asserting the composer cannot emit an unrecognised line. Fold attaches the pairs to the session they sit under | Regression tests both ways: metadata parses, ordinary italic prose still lexes as prose | `lonely-v2` |
| 2026-07-26 | Fixed four parser defects found during the ledger pass: `exits DIR:ID` took its key as `exits S`; space-separated stat keys (`Armor CT30/RT25`) lost their key; `[Inv:Torch\|4]` quantity and `[Inv:Torch-1]` delta landed on different slots; a block opened in a scene header (`S9 *Ambush* [COMBAT]`, combat §1.1) never opened. Root cause in each: a parse rule written for one spec's shape that another spec's shape also matched | Regression test added per fix; full suite green | `lonely-v1` |

## Git

- Develop on `claude/code-review-docs-yg61y7`, merge to `main`, push both.
