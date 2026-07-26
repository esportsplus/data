---
type: docs
recommended-model: sonnet
status: BLOCKED
priority: P2
source: findings C22, D10 + doc consequences of D2, D5, D6, D9, D13, C15, E-P2 (audit sections C, D, E)
depends-on: [compiler-annotation-extraction, output-construction-safety, plugin-self-assertion, runtime-tojsonschema, sbc-compute-size, sbc-encode-safety, sbc-schema-preregistration, repair-brand-registration, sbc-compile-time-parity, format-validators-correctness]
files-own: [README.md]
blocked-reason: FABLE_REPLAN budget exhausted (1/1) — hard band (severity high, multi-file, or root cause unknown) — critic evidence: FAIL (high) — Gate evidence copied verbatim: scoped:readme-accuracy RED (979ms). tests_run=true (the gate executed), tests_failed set to 1 as the RED status confirms at least one failure — the injected evidence gives only a pass/fail status plus elapsedMs, no numeric count. The item's Acceptance and ## Checks both require `npx tsc -p tsconfig.build.json --noEmit` clean; the injected RED result directly contradicts that clause regardless of the docs-only diff content, so the acceptance is unmet and the verdict cannot be PASS or CONCERNS. root_cause_known=false because this unit's diff touches only README.md and two storage/*.md files — a build-wide tsc failure implicates code outside this unit's files-own surface, which is outside what the injected evidence or diff can explain from this re…; salvage ref salvage/5776b305-u1 @ b080c13005ca81adf40c4a9ec7cf7669978fe189 — the unit branch tip survives as this tag; cherry-pick the item's [readme-accuracy] commits to recover
---

# README tells the truth about the shipped surface

## Rationale

C22: README:527 and :661-663 import `min, max, range` from the package ROOT — verified against built `build/index.d.ts`, the builtins live only at `@esportsplus/data/validators`. README:681-697's "After (compiled)" block is wrong on every load-bearing line (`_error` vs `_errors`, wrong guard shape, a coercion line matching nothing in validator.ts). README:394 documents `float` as "32-bit float" but no float32 rounding occurs and no float brand validator exists. README:308 misstates the no-plugin throw set. D10: the wire-format table's tags 12/13/14 describe packed typed-array-of-arrays that are actually packed arrays of plain NUMBERS (`src/sbc/tagged.ts:691-744`); a real `Uint8Array[]` encodes as tag 7. Plus every behavior this spec CHANGES needs its documentation moved to the new truth.

## Changes

README only — corrections for measured falsehoods and documentation of the landed surface.

## Design

**What the old design got wrong:** it gated a prose-only item on repo-wide `npx tsc --noEmit` — red from out-of-scope test files (`test/sbc/size.test.ts`, authored for the still-unlanded sbc-compute-size) that no README edit can touch — and corrections 10/11 documented sbc-compute-size's unlanded fix and Map/Set field support as landed fact after remove-map-set-tags had retired wire tags 15/16.

Gate anchor (moved with this replan via set-section): `## Checks` is now `npx tsc -p tsconfig.build.json --noEmit` — the repo's own build gate (`pnpm build` config, src-only), measured green (exit 0) at replan time. The test-surface tsc redness belongs to the in-flight sbc items and is the stage merger's full-suite concern, never this item's.

Exact correction list (single pass, ordered by README position; anchors re-verified at replan time):

1. :308 — with the plugin, `validator.set` calls are consumed at compile time; without it, both `build` and `set` throw the stub error.
2. :393 — `float` brand: float64 storage, no 32-bit rounding occurs; delete the "32-bit float" claim.
3. :527 and :661-663 — builtins import from the subpath: `import { min, max, range } from '@esportsplus/data/validators'` (the package root exports no builtins — checked against `build/index.d.ts`; run `pnpm build` first if `build/` is stale).
4. :681-697 — regenerate the "After (compiled)" block from the REAL transformer. Concrete method: a scratch runner OUTSIDE the repo (OS temp dir) that imports THIS worktree's `src/compiler` transformer exactly the way `test/compiler/annotations.test.ts`'s harness does, runs it on the README's `User` source snippet, and the emitted output is pasted verbatim. The emitted error array is `_errors` (`src/compiler/error.ts:5` `ERRORS_VARIABLE = '_errors'`); guard and coercion shapes come from the run, never from memory.
5. :704 — coercion bullets: number coercion is strings-only (decimal/scientific forms); boolean coercion per the landed table; state explicitly that zod coerces nothing (divergence note).
6. :705 — prototype-pollution bullet: state the landed `__proto__` own-property behavior (C16 fix landed).
7. :80 — `Uint8Array` row: bytes decode as a fresh `Uint8Array` copy (D9 landed); note the copy semantics.
8. :86-90 — wire-format table, two landed changes: (a) tags 12/13/14 rows describe packed arrays of plain NUMBERS (uint8/float64/int32 element widths), not typed-array-of-arrays — a real `Uint8Array[]` encodes as tag 7 with tag-6 elements (`src/sbc/tagged.ts` packed arms); (b) DELETE the `Map` (15) and `Set` (16) rows — remove-map-set-tags retired them; `Map`/`Set` are non-encodable (`Encodable` in `src/sbc/types.ts` excludes them) and `encode` throws a `Codec2:` error. Typed array (17) and compressed object (18) rows stay.
9. :94-110 and :139-146 — pre-registration: declared schemas honored for ALL shapes (D2 fix landed); the nullable example works as printed; unknown encode hints throw.
10. :259 — `computeSize`: document the LANDED shape — sbc-compute-size DID NOT land (still PENDING; verified at replan: `src/sbc/size.ts:55-171` still returns `-1`). Write the truth: exact byte length for primitives and schema-registered objects; returns `-1` for arrays, Map, Set, typed arrays, and shapes containing them; no compression-aware sizing. This fixes finding D6's documentation side (the undocumented sentinel) without claiming the unlanded fix. Then record the rot risk via the sanctioned spec followups mutator (the same spec CLI every seat uses, followups subcommand, this spec directory) with the line: `- [ ] README:259 computeSize prose re-documents exact-size (no sentinel) behavior when sbc-compute-size lands`.
11. :296-304 — compile-time SBC: parity-or-omit hint rule; "identical behavior" is now literally true (landed c0d1bf1); typed-array fields supported; Map/Set fields are NOT (non-encodable per 8b) — the prior list's "Map/Set fields supported" claim must not be written.
12. Beside the wire-format section, the D13 kept-behavior note: `undefined` encodes as `null`, array holes as `null`; non-encodable values throw `Codec2:` errors.
13. Verify no typed-array-CODEC (removed API) mentions exist anywhere in the README; delete any found.
14. NEW surface docs (owning items all landed): annotation chains (`describe`/`default`/`meta` with parse-time default-fill), the `fn()` identity wrapper, the PLAIN-OBJECT `Schema<T>` return — every `validator.build<User>()` usage example changes from calling the result to `v.validate(input)`, with `v.toJsonSchema()` beside it and the kept standalone `validator.toJsonSchema<T>()` shorthand noted — the `@esportsplus/data/runtime` builder (enum-from-runtime-ids example), residue-check wiring for consumer `build`/`prepublishOnly` scripts per the LANDED shape (read `src/compiler/residue.ts` and this repo's `package.json` for the shipped form), and `trim()`/`normalize()` documented as ASSERTIONS (names kept).
15. Contributor docs: update any `tests/bench` path mentions to the relocated `test/` + `bench/` layout.

Every block claiming to be compiler OUTPUT is generated from the real pipeline at authoring time (method in 4) — hand-typing is how :681-697 rotted. `src/` and `test/` are read-only reference; the ONLY writable path is README.md (plus the sanctioned followups row in 10).

## Reads

- build/index.d.ts — the root export surface documented claims are checked against (regenerate via the repo build before verifying)
- src/sbc/tagged.ts — tag semantics for the wire-format table
- src/compiler/validator.ts — emission shapes the compiled example must match

## Acceptance

- All 15 corrections present and matching the LANDED tree: :259 documents the shipped `-1` sentinel (sbc-compute-size unlanded), the Map/Set wire-table rows are deleted, and no "Map/Set fields supported" claim appears.
- No README code example imports builtins from the package root; the compiled example at :681-697 is verbatim transformer output (`_errors` naming, real guard/coercion shapes).
- Only README.md is modified (plus the one sanctioned followups row).
- `npx tsc -p tsconfig.build.json --noEmit` clean — the build-surface standing invariant this item can actually own; full-suite/test-surface state is judged by the stage merger, not this item.

## Checks

- npx tsc -p tsconfig.build.json --noEmit

## Notes

The README-content clauses admit no quote-free literal gate predicate (gate commands reject quoted arguments), so correction 3 is critic/review evidence rather than a `## Checks` line. Lands LAST (document order) — it documents every predecessor's final behavior. If any predecessor's discretion point resolved differently than assumed here (e.g. residue check as bin script), document the LANDED shape, not this list's phrasing.
DEFERRED 2026-07-26T08:28:15.511Z run=f177cf28 class=dependency reason="dependency sbc-compute-size did not land — deferred" salvage=none
REPLANNED 2026-07-26 run=f177cf28: gate re-anchored from repo-wide npx tsc --noEmit (red from out-of-scope test files of unlanded sbc-compute-size) to the build-surface tsconfig.build.json; corrections 8/10/11 updated to landed truth (wire tags 15/16 retired by remove-map-set-tags; computeSize -1 sentinel still shipped).
FABLE_REPLAN ledger: [{'role':'critic','verdict':'FAIL'},{'role':'replanner','status':'completed'},{'role':'implementer','status':'COMPLETED'},{'role':'critic','verdict':'FAIL'}]
