# Lonelog spec review — defects and inconsistencies

Findings from a read of core v1.5.0 and the four add-ons. Ordered by severity.
These are upstream issues; the vendored specs in `docs/spec/` are unmodified.

## 1. `=>` misused as an operator (wargaming add-on)

Core §3.3 and Appendix C state `=>` is **consequences only** — the v1.0→v1.5
history explicitly de-overloaded it. The wargaming add-on uses it as an
arithmetic/equals operator:

```
[Wealth:Gold 50gc+7gc] => [Wealth: Gold 57gc]
[Wealth:Gold 57gc+38gc] => [Wealth:Gold 95gc]
```

This is a direct spec violation and breaks any parser that treats `=>` as a
consequence line. The Resource Tracking Add-on already defines the correct form:
`[Wealth:Gold+7]`, optionally followed by an explicit total `[Wealth:Gold 57]`.

**Fix:** `[Wealth:Gold+7gc] [Wealth:Gold 57gc]` — two tags, no `=>`.

## 2. Proposed `!` symbol contradicts the Combat Add-on

Wargaming FAQ: *"a proposed `!` symbol for external/world events is under
consideration for a future core notation update."*

Combat Add-on Best Practices lists exactly that as a **Don't**:

```
X ! Thug attacks: d20+3=17 -> Hit => PC HP-4
```

and core §10.5 says an add-on that invents its own action symbol "isn't a Lonelog
add-on — it's a fork." Two official documents give opposite guidance on the same
character.

**Fix:** drop the teaser, or move the proposal into core with the Combat Add-on
updated in the same release.

## 3. `[E:]` and `[Clock:]` are redundant

Core §4.1.3 defines `[E:Name X/Y]` for "events & clocks"; §4.2 defines
`[Clock:Name X/Y]` for the same X/Y semantics. Both appear in core's own worked
examples (`[E:AlertClock 2/6]` alongside `[Clock:Suspicion 3/6]`), sometimes in
the same log. Appendix A lists them separately without distinguishing them.

**Fix:** deprecate `[E:]` in favour of `[Clock:]`/`[Track:]`, or define the
boundary explicitly (e.g. `[E:]` = plot milestone, `[Clock:]` = pressure).

## 4. Group-notation examples are wrong (Combat Add-on)

Quick Reference row for grouped combatants:

| Track a group of identical combatants | `[F:Namex#\|stats]` | `[F: Goblin 3\|HP 3 each\|Close]` |

The example reads as "Goblin #3", not a group of three. Should be
`[F:Goblinx3|HP 3 each|Close]`.

Same defect in the Cross-Add-on example: `[F:Guard 2|HP 5 each|Close|armed]`
declares one group, then the rounds address `Guard 1` and `Guard 2` as
individuals. `HP 5 each` only makes sense for a group.

**Fix:** `[F:Guardx2|HP 5 each|Close|armed]`, and split to `[F:Guard 1]` /
`[F:Guard 2]` at the point they diverge.

## 5. `[N:]` vs `[F:]` guidance conflicts across add-ons

Combat Add-on §3: `[F:]` is for combatants, `[N:]` for narrative NPCs; a
recurring villain "gains a `[F:]` when the swords come out."

Wargaming Add-on keeps named heroes in `[N:]` *inside* `[BATTLE]` blocks and
applies combat damage to them there (`[N:Captain Streng|knocked down|HP-1]`),
while also opening `[COMBAT]` blocks with `[F:]` for the same class of actor.

**Fix:** state the rule once — `[N:]` for campaign-persistent actors including
during battles, `[F:]` only for disposable combatants — and make the wargaming
Mordheim example consistent with it.

## 6. `[Scenario:]` is undocumented in Quick Reference

The wargaming add-on defines `[Scenario:Name|objective|turn limit|special rules]`
in §3 and uses it in every example, but the Quick Reference "New Tags" table lists
only `[Unit:]`, `[#Unit:]`, and `[Force:]`. A reader working from the cheat sheet
never sees it.

## 7. Multiplier notation is inconsistent

Four spellings appear across the add-ons for the same idea:

- `[Inv:Arrow x 20]`, `[Inv:Arrowx15]`, `[Inv:Arrow×12]` (resources)
- `[F:Goblinsx4]`, `[F:Piratex2]` (combat)
- `[Unit:Kit Fox A x3]` (wargaming)
- `[Inv:Scroll of Push | x1]` (wargaming — `x1` in the **quantity** field, where
  resources spec says a plain number: `[Inv:Scroll of Push|1]`)

**Fix:** one rule — `Namex<N>` suffix for grouped entities (`[F:]`, `[Unit:]`),
plain integer for the `[Inv:]` quantity field. Accept `x`/`×` and optional spaces
on input; emit the canonical form.

## 8. Whitespace is unnormalised throughout

`[Inv: Torch|3]`, `[Inv:Torch|3]`, `[Inv: Torch | 3]`, `[PC:Kael | Supply d8]`,
`[PC:Kael|Supply d8]` all appear, often within one section. Harmless for humans,
but the specs never state that leading/trailing whitespace around `:` and `|` is
insignificant.

**Fix:** one sentence in core §4.1 declaring it insignificant, then normalise the
examples.

## 9. Core §10.4 add-on table is stale

Lists three add-ons (combat, dungeon, resources). The Solo Wargaming Add-on
v1.0.0 exists and its credits cite the Combat Add-on's scope note as its mandate,
but core never lists it. Core is v1.5.0; §10.4 has not been updated since v1.2.0.

## 10. Minor

- Resource add-on §2.2 says a Supply track is "functionally the same as
  `[Timer:]`" — but `[Timer:]` is a single countdown value (`[Timer:Dawn 3]`)
  while Supply is `X/Y`. The analogue is `[Track:]` inverted, not `[Timer:]`.
- Dungeon add-on's `exits` field is positional in the format line
  (`[R:ID|status|desc|exits ...]`) but appears standalone in §2
  (`[R:3|exits E:R7(secret)]`). Fine if fields are name-addressed, but the spec
  presents them as positional.
- Core Appendix A.7 gives the narrative block delimiter as `--- text ---`, while
  §4.4 defines the asymmetric `\--- text ---\`. The asymmetric form is the one
  that avoids markdown `<hr>` collisions.
