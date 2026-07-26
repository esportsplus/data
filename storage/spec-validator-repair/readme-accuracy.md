---
type: docs
recommended-model: sonnet
status: PENDING
priority: P2
source: findings C22, D10 + doc consequences of D2, D5, D6, D9, D13, C15, E-P2 (audit sections C, D, E)
depends-on: [compiler-annotation-extraction, output-construction-safety, plugin-self-assertion, runtime-tojsonschema, sbc-compute-size, sbc-encode-safety, sbc-schema-preregistration, repair-brand-registration, sbc-compile-time-parity, format-validators-correctness]
files-own: [README.md]
---

# README tells the truth about the shipped surface

## Rationale

C22: README:527 and :661-663 import `min, max, range` from the package ROOT — verified against built `build/index.d.ts`, the builtins live only at `@esportsplus/data/validators`. README:681-697's "After (compiled)" block is wrong on every load-bearing line (`_error` vs `_errors`, wrong guard shape, a coercion line matching nothing in validator.ts). README:394 documents `float` as "32-bit float" but no float32 rounding occurs and no float brand validator exists. README:308 misstates the no-plugin throw set. D10: the wire-format table's tags 12/13/14 describe packed typed-array-of-arrays that are actually packed arrays of plain NUMBERS (`src/sbc/tagged.ts:691-744`); a real `Uint8Array[]` encodes as tag 7. Plus every behavior this spec CHANGES needs its documentation moved to the new truth.

## Changes

README only — corrections for measured falsehoods and documentation of the landed surface.

## Design

Exact correction list (single pass, ordered by README position):

1. :308 — with the plugin, `validator.set` calls are consumed at compile time (post repair-brand-registration); without it, both `build` and `set` throw the stub error.
2. :394 — `float` brand: document actual behavior (float64 storage; no 32-bit rounding); remove the "32-bit" claim.
3. :527, :661-663 — import examples: `import { min, max, range } from '@esportsplus/data/validators'`.
4. :681-697 — regenerate the "After (compiled)" example from a REAL post-spec transform (run it, paste it): `_errors` naming, the actual guard, the strict coercion shape from output-construction-safety.
5. :704 — coercion table: strings-only number coercion (decimal/scientific), the documented boolean table; note zod-divergence explicitly (zod coerces nothing).
6. :705 — prototype-pollution claim becomes true (C16 fix); state the `__proto__` own-property behavior.
7. :80 — bytes decode as `Uint8Array` (now true, D9); note the copy semantics.
8. :86-88 — wire-format tags 12/13/14: packed arrays of plain numbers; `Uint8Array[]` is tag 7.
9. :94-110, :139-146 — pre-registration section: declared schemas honored for ALL shapes (D2 fix); the nullable example works as printed; unknown encode hints throw.
10. :259 — `computeSize` returns exact byte length for every encodable value, compress included; throws on unencodable input; no `-1` sentinel.
11. :296-304 — compile-time SBC: parity-or-omit hint rule; "identical behavior" now literally true; Map/Set/typed-array fields supported.
12. D13 kept-behavior note: `undefined` → `null`, array holes → `null`; non-encodable types throw `Codec2:` errors.
13. Removed API: delete any typed-array-codec mentions (there were none documented — verify and confirm none crept in).
14. NEW surface docs: annotation chains (`describe`/`default`/`meta` with the parse-time default-fill semantics), the `fn()` identity wrapper, the PLAIN-OBJECT `Schema<T>` return (Q1 answered) — every `validator.build<User>()` usage example changes from calling the result to `v.validate(input)`, with `v.toJsonSchema()` beside it and the kept standalone `validator.toJsonSchema<T>()` shorthand noted — the `@esportsplus/data/runtime` builder (enum-from-runtime-ids example), the residue check wiring for consumer `build`/`prepublishOnly` scripts (per plugin-self-assertion's landed shape), and `trim()`/`normalize()` documented as ASSERTIONS (Q2 answered: names kept).
15. `agent:bench`/bench relocation: update any contributor docs mentioning `tests/bench` paths.

Every code block that claims to be compiler OUTPUT must be generated from the real pipeline at authoring time, never hand-typed — that is how :681-697 rotted.

## Reads

- build/index.d.ts — the root export surface documented claims are checked against (regenerate via the repo build before verifying)
- src/sbc/tagged.ts — tag semantics for the wire-format table
- src/compiler/validator.ts — emission shapes the compiled example must match

## Acceptance

- All 15 corrections present; no README code example imports builtins from the package root; the compiled example matches real transform output.
- `npx tsc --noEmit` clean (no code touched; the gate is the standing invariant).

## Checks

- npx tsc --noEmit

## Notes

The README-content clauses admit no quote-free literal gate predicate (gate commands reject quoted arguments), so correction 3 is critic/review evidence rather than a `## Checks` line. Lands LAST (document order) — it documents every predecessor's final behavior. If any predecessor's discretion point resolved differently than assumed here (e.g. residue check as bin script), document the LANDED shape, not this list's phrasing.
