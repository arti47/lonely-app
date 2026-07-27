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
| D9 | Composer | **Stays symbol-first** (§1). Symbols carry a visible word; a four-symbol beginner set (`@ ? d: =>`) expands to all eight on demand |
| D10 | Navigation | Four tabs — **Campaigns · Play · Sheet · Help**. Rolling is a drawer on Play, not a tab. Settings lives under Campaigns |
| D11 | First run | Four layers, all shipping: guide-first landing · in-context checklist on Play · openable sample campaign · self-explaining empty states |
| D12 | Play furniture | Pinned: a one-line status strip (expands to the full chip set) and the composer. Scene/session controls live in the strip |

## 2. Architecture — LOCKED

- **No build step.** Vanilla JS, native ES modules loaded directly by the browser
  (`<script type="module" src="src/main.js">`). Clone-and-run must always work,
  and must still work in five years with no toolchain.
- **Types without a build.** JSDoc annotations checked by `tsc --checkJs
  --noEmit` in `npm test`. The notation engine is where type safety pays; it does
  not justify a compiler in the ship path.
- **Installable PWA:** `manifest.json`, `service-worker.js` (network-first,
  caches app shell + all modules, versioned `CACHE_VERSION`), SVG icon. A new
  worker **waits**; the page offers it as a toast button and applies it only
  when the user taps (`update.js`). An update must never reload a session
  out from under the person writing in it.
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
| `docs/audit.md` | §11 conformance audit: findings, fixes, verified-clean list |
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
| `lonelog/lexer.js` | ✅ Line → `Entry{kind, raw, indent, …}`. Kinds: `action question dice resolution consequence tbl gen tableEntry genAxis note dialogue sessionMeta tag marker block prose` |
| `lonelog/tags.js` | ✅ Tag parse/serialise; tolerant of whitespace, `x`/`×`, `>=`/`≥` |
| `lonelog/fold.js` | ✅ `Entry[]` → `CampaignState`, with per-scene checkpoints; inline tables and generators |
| `lonelog/render.js` | ✅ `Entry[]` → markdown, digital or analog form |
| `lonelog/lint.js` | ✅ Spec-conformance rules (§10, `docs/spec-review.md`) |
| `lonelog/index.js` | ✅ Engine barrel + `parse()` (lex → fold → lint) |
| `compare.js` | ✅ Roll comparator over **entered** numbers, oracle ladder, table lookup. No RNG |
| `templates.js` | ✅ Learned roll templates; pack import/export |
| `store.js` | ✅ IndexedDB persistence, markdown + JSON export/import, File System Access binding |
| `composer.js` | ✅ Symbol-first entry: line kinds, tag builder (one row per field), autocomplete |
| `logview.js` | ✅ Transcript rendering, editing, truncation-undo |
| `state.js` | ✅ State pane: folded PC sheet, NPC/location index, threads, clocks; persistent state header; shared tag-line builders reused by the add-on surfaces |
| `addons/index.js` | ✅ Add-on barrel; `surfaced(state)` decides which panels appear |
| `resolve.js` | ✅ Roll entry, oracle lookup, user tables |
| `addons/combat.js` | ✅ `[COMBAT]`, `Rd#`, `[F:]` surfaces |
| `addons/resources.js` | ✅ `[Inv:]`, `[Wealth:]`, `[RESOURCES]` surfaces |
| `addons/dungeon.js` | ✅ `[R:]`, `[DUNGEON STATUS]` surfaces |
| `addons/wargaming.js` | ✅ `[Unit:]`, `[Force:]`, `[BATTLE]`, `[CAMPAIGN]`, `Tn#` surfaces |
| `lifecycle.js` | ✅ Scene/session boundary bundles + one-step undo |
| `update.js` | ✅ Service-worker update detection; the update prompt and its button |
| `settings.js` | ✅ Preferences, theme, lint level, reference links |
| `reference.js` | ✅ Searchable notation reference; entry per construct, cited to the spec; plain-English tag-type names for choosers |
| `guide.js` | ✅ Step-by-step new-user guide; shares the Help tab with the reference |
| `onboarding.js` | ✅ Getting-started checklist, sample campaign, first-launch landing (§8.2 F7–F9) |
| `router.js` | ✅ Bottom-nav routing; tab gating and the remembered campaign (D10) |
| `screens.js` | ✅ Screen renderers for all six routes (four of them tabs, D10) |
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
  view:     { hiddenPanels[], theme?, composerMode,     // UI state ONLY — never
              checklist }                              // affects fold output (D6)
                                                       // checklist: 'auto'|'hidden'
  checkpoints/{sceneIndex}: { lineIndex, state }  // fold memoisation, derivable,
                                                  // safe to discard and rebuild
templates/{id}: { id, shape, label, mode, inputs[], modifiers[], target?,
                  targetLabel?, compare, packId?, seenCount }
                                                  // learned from repeated `d:`
                                                  // shapes; tables live in the log
tables/{id}:    { name, die?, entries[] | options[] }   // core §4.3.1–2
settings:       { theme, referenceLinks, lintLevel, notationView, lastCampaign,
                  seenGuide }
                                                  // lastCampaign: which campaign
                                                  // the gated tabs point at (D10)
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
- [x] **Phase 3 — State pane.** Folded PC sheet from `[PC:]` tags (D5); NPC and
      location index; threads; clocks/tracks/timers with fill meters; persistent
      state header on every in-play screen; every value traceable to its line
      (§5.7); editing appends a tag line (§5.1).
      *Done: steppers emit `[PC:Alex|HP-2]`, `[Clock:Name 4/6]`, `[Timer:Name 2]`,
      `[N:X|+flag]` / `[N:X|-flag]` and `[Thread:X|Open -> Closed]`; every value
      links back to the line that set it.*
- [x] **Phase 4 — Resolve pane.** Free-form roll entry; comparator (§3.1 module)
      covering sum vs TN/DC/AC, `≥`/`≤`, paired challenge dice, count-successes
      pools, keep-high/low, `dF` ladders, degree bands, match detection; generic
      yes/no oracle with odds column; user tables incl. inline definitions and
      filtered option sets; emits full `d:` / `tbl:` / `gen:` lines. Ledger
      T3–T8, T17.
      *Done: six comparison modes, all evaluating numbers the player entered —
      there is still no RNG anywhere in `src/`. Tables defined in the log are
      usable from the pane, keeping the log self-contained.*
- [x] **Phase 5 — Add-on surfaces.** Auto-surfacing per D6, in order: combat
      (T28–T34), resources (T40–T47), dungeon (T35–T39), wargaming (T48–T57).
      *Done: panels appear from log content alone and are sticky once seen;
      hiding one is `view` state and never touches the log. Every control
      appends a tag line asserted to fold back into the intended state.*
- [x] **Phase 6 — Lifecycle engine.** Explicit End Scene / End Session controls
      firing the whole boundary bundle (scene checkpoint, session header, state
      snapshot blocks — `[RESOURCES]`, `[DUNGEON STATUS]`, `[CAMPAIGN]` — where
      those add-ons are live), with confirmation summary and one-step undo.
      *Done: a bundle is a list of lines, so undo is truncation of exactly its
      length. Confirmation appears when a bundle does more than drop a marker.*
- [x] **Phase 7 — Learned templates.** Detect repeated `d:` shapes; offer to save
      as a quick roll; template editor; group into a named pack; pack
      export/import as a file (D4).
      *Done: a shape abstracts the rolled numbers and keeps the roll, so a
      repeat is offered — never saved silently — and a pack falls out of play.*
- [x] **Phase 8 — Lint & reference.** `lint.js` rules from `docs/spec-review.md`
      surfaced as gentle inline warnings, never blocking; searchable notation
      reference; every automated surface links to its reference entry.
      *Done: 30 paraphrased entries, each cited and each example asserted to lex.
      A flagged line explains itself and links out; lint level is a setting and
      never blocks writing.*
- [x] **Hardening (always).** Regression harness green; accessibility pass; full
      spec-conformance audit (§11) with every finding closed.
      *Done: 6 findings, all fixed and closed by regression checks; the
      verified-clean list is recorded in `docs/audit.md`.*
- [x] **Phase 9 — Onboarding & flow.** The notation is complete and the app is
      correct; what is missing is a legible path through it. Four tabs, symbols
      that say what they mean, a safe default on every destructive menu, and a
      first run that teaches itself. Full spec in §8.2, built in three slices.
      - [x] Slice 1 — nav, composer labels, safe row default, empty states (F1–F4)
      - [x] Slice 2 — status strip, roll drawer (F5–F6)
      - [x] Slice 3 — checklist, sample campaign, guide-first landing (F7–F9)

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
- [x] T3 Comparison shorthand `≥ ≤ >= <= vs S F` (§3.2.1)
- [x] T4 `tbl:` simple lookup (§4.3)
- [x] T5 `tbl:` inline table definition, named + die + entries (§4.3.1)
- [x] T6 `tbl:` filtered option sets `[A, B, C]` (§4.3.2)
- [x] T7 `gen:` single-line compound (§4.3)
- [x] T8 `gen:` multi-line axis blocks (§4.3.3)
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

### 8.2 Phase 9 — Onboarding & flow

Nine features, each in the §8 mandatory format. Nothing here changes the
notation, the fold, or what lands in the log — this phase is entirely about the
path a person takes through the app. D9–D12 settle the open questions; do not
re-litigate them.

**F1 · Four-tab navigation** *(slice 1)*
- **Contract:** D10; §7 "gated nav tabs are hidden by the router when off" —
  which `setNavVisible` was written for and no caller ever used.
- **Target:** `index.html` nav · `src/router.js` · `render`, `markNav`,
  `rememberCampaign`, `currentCampaign` · `src/main.js` boot.
- **Behavior/UI:** tabs are Campaigns · Play · Sheet · Help. Play and Sheet are
  hidden until a campaign is open, and stay visible once one has been, so
  stepping back to the list does not strand you. Routes with no tab of their own
  mark their parent: `resolve` → Play, `settings` → Campaigns, keeping exactly
  one `aria-current` on every route.
- **Schema:** `settings.lastCampaign` · `string|null` · default `null` · §6.
  Cleared when that campaign is deleted.
- **Acceptance:** with no campaign the nav shows two tabs; after opening one it
  shows four; `#/resolve/<id>` marks Play current; deleting the open campaign
  drops back to two.

**F2 · Symbols that say what they mean** *(slice 1)*
- **Contract:** D9. §1 keeps the composer symbol-first, so the symbol stays the
  control — it just stops being the only thing on the button.
- **Target:** `src/composer.js` · `SYMBOLS`, `mountComposer`,
  `usesAdvancedSymbols` · `styles.css` `.sym`.
- **Behavior/UI:** each button shows its glyph over one word — `@ Did`,
  `? Asked`, `d: Rolled`, `=> So`. Those four show by default; `⋯ More` reveals
  `-> Result`, `tbl: Table`, `gen: Generate`, `( ) Note`. A log that already uses
  an advanced kind opens expanded, because the user has plainly met them.
- **Schema:** none. Disclosure is view state held in the module for the life of
  the page — not a preference, so §7 does not apply.
- **Acceptance:** four buttons on a fresh campaign, eight after `⋯ More`; a log
  containing a `tbl:` line starts with eight; every button still emits the line
  its own lexer round-trips (existing test).

**F3 · No destructive default** *(slice 1)*
- **Contract:** §2 themed primitives; a menu opened to *read* a line must not
  offer deletion as its highlighted action.
- **Target:** `src/logview.js` · `openRowMenu`.
- **Behavior/UI:** the row menu's primary action is Close, which is where focus
  lands. Truncation is last, quiet, plainly worded — "Delete from here…" — and
  keeps its confirmation.
- **Schema:** none.
- **Acceptance:** opening a row and pressing Enter changes nothing; the
  confirmation still appears before any truncation.

**F4 · Empty states that name the next action** *(slice 1)*
- **Contract:** §1 "no configuration gates usage" is only true if the first
  screen says what to do.
- **Target:** `src/screens.js` · `logScreen`, `campaignsScreen` ·
  `src/logview.js` · `renderLog` · `src/state.js` · `renderState`.
- **Behavior/UI:** every empty state names one concrete next action and the
  control that performs it. Campaigns grows a Settings entry, since Settings no
  longer has a tab.
- **Schema:** none.
- **Acceptance:** each empty screen names a control that exists on it.

**F5 · One-line status strip** *(slice 2)* — D12.
- **Target:** `src/state.js` · `renderStateHeader` (compact + expanded forms).
- **Behavior/UI:** one tappable line — `Session 2 · S5 · HP 8 · Suspicion 3/6` —
  expanding to today's full chip set. Scene and Session controls move into it,
  which is what makes the lifecycle visible instead of buried in a tools row.
- **Schema:** none — expansion is view state.
- **Acceptance:** the strip is one line high at 360px and every value still
  traces to the line that set it (§5.7).

**F6 · Roll drawer on Play** *(slice 2)* — D10.
- **Target:** `src/screens.js` · `logScreen` · `src/resolve.js` ·
  `renderResolve` (unchanged, hosted in a drawer).
- **Behavior/UI:** a 🎲 Roll control on Play opens the existing Resolve pane as a
  sheet over the log; committing a roll closes it and the new line is already
  there. `#/resolve/<id>` stays a real route for the guide's deep links.
- **Schema:** none.
- **Acceptance:** rolling never leaves the Play screen; the drawer traps focus
  and restores it (§2).

**F7 · Getting-started checklist** *(slice 3)* — D11.
- **Target:** new `src/onboarding.js` (§3.1 table + SW app shell + cache bump).
- **Behavior/UI:** a dismissible checklist above the composer — start a session ·
  write a line · name someone · roll — each item ticking itself off by reading
  the folded state, the whole thing gone once complete or dismissed.
- **Schema:** `campaigns/{id}.view.checklist` · `'auto'|'hidden'` · default
  `'auto'` · §6. A complete list stops showing on its own, so no third value is
  needed. View state: it must never affect a fold (D6).
- **Acceptance:** items tick from log content alone; dismissing survives a
  reload and leaves the log byte-identical.

**F8 · Openable sample campaign** *(slice 3)* — D11.
- **Target:** `src/onboarding.js` · `SAMPLE_LOG`, `createSample`.
- **Behavior/UI:** "Look at an example" on the empty Campaigns screen creates a
  real, deletable campaign whose short log already surfaces a sheet, a clock and
  a combat panel — the fastest way to see D6 auto-surfacing. System-agnostic and
  free of any publisher's content (§9.8, D3).
- **Schema:** none beyond a normal campaign record.
- **Acceptance:** the sample folds without lint errors, surfaces at least two
  add-on panels, and deletes like any other campaign.

**F9 · Guide-first landing** *(slice 3)* — D11.
- **Target:** `src/main.js` boot · `src/guide.js`.
- **Behavior/UI:** a first-ever launch opens Help with a "Start my first
  campaign" action at the top, instead of an empty list. Once any campaign has
  existed, boot returns to Campaigns.
- **Schema:** `settings.seenGuide` · `boolean` · default `false` · §6.
- **Acceptance:** first launch lands on Help; second launch does not.

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
10. **Single branch.** All work lands on `main` (see Git, below). No feature
    branches, no branch left behind.

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
  future audits don't re-litigate it. **First pass complete — `docs/audit.md`.**

## 12. Changelog

| Date | Change | Verification | Cache |
|---|---|---|---|
| 2026-07-26 | The tag builder had one Fields box and asked the writer to type `|` between fields — the separator is the notation's business, not theirs, and on a phone that pipe is two keyboard layers down. Fields are now one row each, with **+ Add field**, a `×` per row, and a live preview of the tag being built. Field text autocompletes from the vocabulary the campaign already uses: stat keys and flags already folded onto that type of element | 248 unit tests (empty rows dropped, suggestions drawn from the fold); browser check builds `[N:Jonah\|wounded\|HP 8]` through the rows, drops a row without disturbing the others, and asserts no input ever contains a `\|` | `lonely-v17` |
| 2026-07-26 | **Click-to-update.** A deploy used to reach an open page only by luck: the worker called `skipWaiting()` on install, so it seized control mid-session and the page could only say "reload to finish" — a message with nothing to press. The worker now waits; `update.js` notices it, offers *A new version is ready* with an **Update** button, and applies it by posting `SKIP_WAITING`, reloading on `controllerchange`. A long-running PWA re-checks every 30 minutes and whenever it becomes visible, since an installed app may never navigate again and nothing else would ask. `showToast` gained an optional action button (and a dismiss), Settings gained *Check for updates* | Browser check drives the whole flow: the smoke server publishes a byte-different worker — what a push to GitHub looks like — then asserts the button appears, that the session is *not* reloaded while it waits, and that tapping it applies the worker and reloads | `lonely-v16` |
| 2026-07-26 | The tag chooser listed bare notation codes — `PC N L E Thread Clock Track Timer F R Inv Wealth Unit Force Scenario` — which is a quiz, not a menu. Types now read as words and group by where they come from: *NPC (N)* under Core, *Combatant (F)* under Combat. `TAG_TYPES` lives beside the reference entries so a type's name, its group and its explanation stay together; the option value is still the notation, so nothing downstream changed | 246 unit tests, including that the chooser offers exactly the types the engine parses and cites an entry that exists; browser check that the words appear, the groups appear, and picking one still writes `[N:Jonah]` | `lonely-v15` |
| 2026-07-26 | **Phase 9 slices 2–3 — the flow.** The state header is a one-line strip that expands to the full chip set, and Scene/Session moved into it, which is what makes the session lifecycle visible and gets the composer's tools back to one row. Rolling is a drawer over the log — the shared `modal()` presenting as a sheet, so there is one focus trap, not two — and committing a roll closes it with the line already in the log. New `onboarding.js`: a getting-started checklist that ticks itself off by reading the fold and hides as `view` state, a sample campaign whose short log already surfaces a sheet, a clock and two add-on panels, and the rule that a first-ever launch opens the guide rather than an empty list | 243 unit tests (13 new, covering every checklist tick, the sample's round-trip, lint-cleanliness, surfaced panels and system-agnosticism, and the landing rule); 113 browser checks including the strip collapsing and expanding, the drawer opening over Play and closing on commit, the checklist ticking and hiding without touching the log, and the example opening with its panels | `lonely-v14` |
| 2026-07-26 | Fixed: the composer was `position: sticky`, which pins to the viewport rather than to the log column — so once the column became fixed-height it pulled the composer up out of flow and painted it over the checklist's last row. The column now sizes the log area to absorb the slack and the composer is static. Root cause: sticky was solving a problem the fixed-height column had already solved, and the two disagreed about where the bottom was. Also: only the log may shrink, or a flex child quietly clips itself; and a tall dialog focused its action button by scrolling past its own contents, so the drawer opened at the bottom | Browser checks: the composer's bottom edge clears the nav, the drawer shows its roll panel on open, 360/390px overflow clean | `lonely-v14` |
| 2026-07-26 | **Phase 9 slice 1 — the way in.** Nav is four tabs (Campaigns · Play · Sheet · Help); Play and Sheet are gated on a campaign existing, which is what `setNavVisible` was written for and no caller had ever used, and the routes without a tab light the tab that owns them. Composer symbols now carry a word — `@ Did`, `? Asked`, `d: Rolled`, `=> So` — with the other four behind `⋯ More`, because the meanings had been living in `title` attributes that a phone never shows. The row menu's primary action is Close: you open it to read a line far more often than to delete the rest of your log | 230 unit tests; 96 browser checks including the gated tabs before and after a campaign exists, Play carrying the campaign back across a detour, the beginner set expanding and collapsing, and the row menu focusing a safe action | `lonely-v13` |
| 2026-07-26 | Fixed: the composer is `position: sticky; bottom: 0`, but sticky anchors to the viewport, which the body's bottom padding does not move — so the tool row sat *underneath* the fixed nav. Latent since Phase 2 and only visible once the row wrapped to two lines, which adding the Roll button did. The bar also squeezed its labels to `Rol…` when expanded; it now holds a legible width and scrolls | Browser check: the composer's bottom edge is at or above the nav's top edge; 360/390px overflow checks still clean | `lonely-v13` |
| 2026-07-26 | Fixed: `npm test` had been reporting a pass with the typecheck skipped, because `tsc` is optional and absent on a fresh clone. Installing it surfaced four real JSDoc errors in the composer's `ctx` type from the slice above. The skip is by design (§2 clone-and-run) but it means the typecheck only runs where someone has installed it | `npm run typecheck` clean with `typescript` installed | `lonely-v13` |
| 2026-07-26 | Vendored five Lonelog specs; catalogued 10 spec defects | Read-through of all five specs | — |
| 2026-07-26 | Design settled: local-first PWA, log-as-source-of-truth, no RNG, system-agnostic, add-ons self-surfacing | Design review with user (D1–D8) | — |
| 2026-07-26 | Instantiated canonical spec: architecture LOCKED to no-build ES modules, file/module tables, data model, 9-phase roadmap, 58-item conformance ledger, process rules | Template §5–§12 adapted; no code yet | — |
| 2026-07-26 | **Phase 1 — notation engine.** `src/lonelog/{lexer,tags,fold,render,lint,index}.js`. Losslessness is achieved by replaying `raw`+`eol`, which makes canonicalisation an explicit opt-in transform rather than a side effect of reading a log. Ledger T1–T2, T4, T7, T9–T58 ticked; T3/T5/T6/T8 deferred to Phase 4 with reasons recorded inline | 377/377 spec snippets round-trip byte-identically; 69 unit tests green; fold deterministic and checkpoint-equivalent across the whole corpus | `lonely-v1` |
| 2026-07-26 | **Phase 0 — foundations.** PWA shell, service worker, light/dark theme, IndexedDB store, hash router, accessible modal/toast primitives, markdown + JSON export/import, campaign CRUD | 20 headless-browser checks green: boots, all five screens render, zero console errors, zero horizontal overflow at 360/390px | `lonely-v1` |
| 2026-07-26 | **Phase 2 — log pane, and the First Session Logged milestone.** `composer.js` (symbol bar, tag builder with autocomplete from folded state, scene/session/block inserters), `logview.js` (per-entry rows, tag highlighting, inline lint flags, edit, truncate-from-here), file binding via the File System Access API with download fallback. Undo is truncation throughout, with one-step restore of a truncated tail | 85 unit tests; 27 browser checks — composing through the real UI appends and persists, undo pops and persists, export→reimport folds identically | `lonely-v2` |
| 2026-07-26 | Added a `sessionMeta` line kind for `*Date: … \| Duration: …*` under a session heading (core §5.2.1), which had been falling through to prose. Found by the milestone test asserting the composer cannot emit an unrecognised line. Fold attaches the pairs to the session they sit under | Regression tests both ways: metadata parses, ordinary italic prose still lexes as prose | `lonely-v2` |
| 2026-07-26 | **Phase 3 — state pane.** `state.js`: character sheet folded from `[PC:]` tags (D5), clock/track fill meters, countdown timers, thread states, NPC/location index, and the persistent state header now shared by Log, State and Resolve. Every value links back to the line that set it (§5.7). Editing appends a tag line and never mutates state (§5.1). Thread state changes emit the transition form `[Thread:X\|Open -> Closed]` rather than a restatement, because flags accumulate — restating `Closed` would leave `Open` set too | 98 unit tests, each edit asserted by folding the emitted line back; 36 browser checks including stepping a clock from the State pane and tracing a value into the log | `lonely-v3` |
| 2026-07-26 | **Phase 4 — resolve pane.** `compare.js` (six comparison shapes: target incl. roll-under, success pools, paired challenge dice, keep high/low, `dF` ladders, degree bands; match detection; a generic d100 oracle ladder labelled a house aid; table lookup) and `resolve.js` (roll entry, oracle, tables). Every number is entered by the player — `src/` still contains no RNG, enforced by test. Engine gained inline table definitions, filtered option sets and multi-line generator axes, so a table defined in a log is immediately usable and the log stays self-contained. **Ledger complete: 58/58** | 129 unit tests; 46 browser checks including entering a roll, an oracle answer and a table lookup through the real UI | `lonely-v4` |
| 2026-07-26 | Fixed: an omitted numeric field parsed as `0`, so a roll with no target compared against 0 and always succeeded. Root cause: `Number('')` is `0`, and the guard only rejected `NaN`. Empty now reads as "not given" | Regression test per mode; `MODES` all evaluate safely on empty input | `lonely-v4` |
| 2026-07-26 | Fixed: every log row printed the entry kind as a gutter glyph *and* the raw line, so `@ Start running` rendered as `@ @ Start running`. Root cause: the gutter was designed before the rows showed raw text, and the symbol is already the first thing on the line. The gutter now carries the line number instead — which the State pane was already citing with nothing in the log to match it against | Browser check: an action row contains exactly one `@`, and its gutter is a line number | `lonely-v12` |
| 2026-07-26 | Added a 13-step new-user guide sharing the Notation tab with the reference, switched by a remembered toggle — the Guide teaches the app in order, the Reference answers a question out of order. Steps deep-link to the screen they describe rather than acting for the user; a guide that quietly creates a campaign teaches nothing and leaves data behind. Steps needing a campaign say so when there is none | 227 unit tests, including that every guide example lexes as notation, every cited reference entry exists, every route is real, and the guide claims nothing the app does not do; 97 browser checks | `lonely-v11` |
| 2026-07-26 | Notation reference is now an accordion: entries collapse to title + syntax and open on tap, with Expand/Collapse all. Built on native `<details>`/`<summary>` so keyboard and screen-reader behaviour is the platform's, not ours. A search opens its matches, since a narrowed list is an answer rather than a list to browse | 4 browser checks: collapsed by default, one opens alone, expand/collapse all, search results open | `lonely-v10` |
| 2026-07-26 | Fixed A5/A6: the router fell back to Campaigns for any unregistered route, so a browser running a cached build from before the Notation tab existed rendered Campaigns under it — two tabs, identical content, no error. An unknown route now names itself and offers a reload; the app warns when a service worker takes control after load; and the worker no longer caches itself, so a bad version cannot pin itself. Log/State/Resolve with no campaign open also rendered no `h1`, which the first accessibility sweep missed by only visiting them with a campaign | Browser checks now click the tabs rather than setting the hash, assert each reaches its own screen, and sweep every screen with and without a campaign | `lonely-v9` |
| 2026-07-26 | **Hardening — §11 conformance audit and accessibility pass.** Four findings, all fixed with regression checks (`docs/audit.md`). A1: a trailing number was read as a value for every type, so `[F:Pirate 1]` and `[F:Pirate 2]` folded into one element holding both combatants' flags — silent identity loss. A2: `[R:1\|cleared, looted]` became a single untestable flag, hiding state the log recorded. A3: `[F:Skeleton 2->1]` set a value while the count stayed stale, giving one group two contradictory sizes. A4: Resolve's numeric fields had labels with no `for`, so screen readers announced them unnamed. Root cause of A1–A3 in each case: a parse rule generalised past the type it was written for | 220 unit tests; 82 browser checks, now including an accessibility sweep of all six screens (accessible names, one h1, one `aria-current`, landmarks, modal focus trap and restore) | `lonely-v8` |
| 2026-07-26 | Fixed: mixing `??` and `\|\|` without parentheses is a parse error, not a lint nit — it stopped the whole app booting. Caught by the browser run, which is why "syntax is valid" is not verification (§9.4) | Boot check with zero console errors | `lonely-v8` |
| 2026-07-26 | **Phase 8 — lint surfacing and the notation reference.** `reference.js`: 30 entries covering the five symbols, tags, blocks, markers and all four add-ons, each paraphrased and cited, reachable from a searchable Notation tab. Every automated surface links to its entry — composer symbols, add-on panel headings, and each lint finding. Lint level is a Settings choice (`warn` / `all` / `off`) and is advisory throughout: a violation is flagged on its line, explained on tap, and still written | 206 unit tests, including that every reference example lexes as the construct it documents and that no summary reproduces eight consecutive words of spec prose (§10, §12); 79 browser checks | `lonely-v8` |
| 2026-07-26 | **Phase 7 — learned roll templates.** `templates.js`: a shape abstracts the numbers that change roll to roll (`=5` → `=#`) and keeps the ones that describe the roll, so a different target is correctly a different shape. After three occurrences the Resolve pane *offers* to save — nothing is stored without being asked (D4). Applying a template presets label, target and dice count but never the dice themselves (D2). Packs export and import as a file, validated with readable errors | 195 unit tests; 69 browser checks including a shape being learned from a real log, the suggestion withdrawn once saved, and the preset leaving the dice empty | `lonely-v7` |
| 2026-07-26 | **Phase 6 — lifecycle engine.** `lifecycle.js`: End Scene closes explicitly opened blocks then opens the next scene (a scene-header block is left to the marker that closes it, combat §1.1); End Session closes every open block innermost-first and snapshots each surfaced add-on. Combat gets no snapshot because its spec defines none, and an add-on holding nothing writes no empty block. A bundle is a plain list of lines, so one-step undo is truncation of exactly its length | 176 unit tests, including that truncating a bundle restores the byte-identical prior fold; 63 browser checks covering the confirmation summary, the bundle landing, one-step undo and restore | `lonely-v6` |
| 2026-07-26 | Fixed: undo popped a single line, so a three-line session header or any multi-line insert needed three presses and left the log half-edited in between. Undo now takes back the whole of the last commit, with a separate Restore for putting it back | Browser check: an eight-line bundle undoes in one press and restores in one | `lonely-v6` |
| 2026-07-26 | **Phase 5 — add-on surfaces.** `addons/{combat,resources,dungeon,wargaming}.js`, surfacing purely from folded log content (D6) and sticky once seen; hiding a panel is `view` state and never edits the log. Combat: rounds, rosters, damage against whatever stat the system uses, range transitions, group splitting. Resources: quantity steps, usage-die step-down chain, wealth deltas, `[RESOURCES]` snapshot. Dungeon: room status accumulation, exits, `[DUNGEON STATUS]` snapshot. Wargaming: casualties, status transitions, heat with advisory thresholds, location armor, `[BATTLE]`/`[CAMPAIGN]` snapshots. The tag-line builders live once in `state.js` and are reused by all four (§9.2) | 162 unit tests, every control asserted by folding its emitted line back; 55 browser checks including all four panels surfacing, a combat control appending, `Tn#` advancing independently of `Rd#`, a balanced snapshot block, and hiding leaving the log byte-identical | `lonely-v5` |
| 2026-07-26 | Consolidated to a single branch: all work now commits directly to `main`. The old feature branch held no unmerged commits | `git log main..<branch>` empty before removal; local branch deleted | — |
| 2026-07-26 | Repo prepared for GitHub Pages: `.nojekyll`, and a test asserting every asset reference is relative so the app works from a project subpath | `npm test` | `lonely-v4` |
| 2026-07-26 | Router now carries an optional line index (`#/log/<id>/<line>`) so a folded value can open the exact line that set it | Browser check: clicking a stat focuses its row in the log | `lonely-v3` |
| 2026-07-26 | Fixed four parser defects found during the ledger pass: `exits DIR:ID` took its key as `exits S`; space-separated stat keys (`Armor CT30/RT25`) lost their key; `[Inv:Torch\|4]` quantity and `[Inv:Torch-1]` delta landed on different slots; a block opened in a scene header (`S9 *Ambush* [COMBAT]`, combat §1.1) never opened. Root cause in each: a parse rule written for one spec's shape that another spec's shape also matched | Regression test added per fix; full suite green | `lonely-v1` |

## Git — LOCKED

- **One branch: `main`.** Commit directly to it and push. Do not open feature
  branches, and do not leave a second branch behind after a piece of work.
- **This outranks a session-assigned branch.** Some tooling hands an agent a
  working branch (`claude/…`). Use it if you must, but merge it to `main` and
  push `main` before the work is done — everything lands on `main`, always.
- Every change updates this file in the same commit (§9.1) and lands with the
  suite green (§9.4–9.5).
- Two stale refs on the remote — `claude/code-review-docs-yg61y7` and
  `claude/code-study-ydoia7` — are fully merged into `main` and carry no
  unmerged commits. The git proxy answers `git push --delete` with a 403, so
  both have to be removed from the GitHub branches page by hand.
