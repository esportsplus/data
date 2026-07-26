---
type: fix
recommended-model: opus
status: REVERTED
priority: P0
files-own: [src/compiler/validator.ts, test/compiler/recursive-types.test.ts]
files-shared: [src/compiler/type-analyzer.ts]
tests: [test/compiler/recursive-types.test.ts]
blocked-reason: merge suite_red: reverted — salvage red — the narrowed selection cherry-picks onto a commit an excluded sibling owns — infeasible, nothing landed; salvage ref salvage/f177cf28-u1 @ 24af36d31a68d99e2b578d8ac4dc356d123365b8 — the unit branch tip survives as this tag; cherry-pick the item's [validator-recursive-types] commits to recover
---

# Generated validator recurses through named functions instead of dropping ref nodes

## Rationale

The analyzer cuts recursive back-edges into ref nodes carrying no properties (src/compiler/type-analyzer.ts:116, :126). src/json-schema.ts:142-145 honours ref and emits an anchor; src/compiler/validator.ts never reads the field — a grep returns zero hits — so generateObjectValidation builds an empty container from an empty properties list and assigns it (:417-421). A recursive sub-object is therefore not merely unvalidated, its data is replaced by an empty object: Node with next set to a real value validates ok:true and returns next as an empty object. No recursive-type test exists in any validator suite.

## Changes

The generated validator gains named recursive functions — one per `$defs` entry plus one for the root — so a `ref` node emits a CALL rather than an inline body, and each carries a depth ceiling that pushes a named error on a cyclic INPUT instead of spinning. `src/compiler/validator.ts` stops silently replacing recursive sub-objects with `{}`; `src/compiler/type-analyzer.ts` supplies the stable `$defs` keys the emitted function names derive from. `src/json-schema.ts` is unchanged and is the reference behavior being matched.

## Design

Replan (single fresh retry). What the old design got wrong, in one line: it settled the *what* (named recursive functions) but not the *wiring*, and the landed attempt (95ef82f, merged — the retry EDITS the current tree in place) deviated four ways: the root `'#'` shape was DUPLICATED into a simplified parallel body that silently drops config validators and defaults at depth ≥ 1; recursion wiring rides a module-level `RECURSION` WeakMap plus an order-dependent `state.depthArg` mutation (static state + temporal coupling); depth ≥ 2 error paths render as `["next.next"].value` because the runtime `_path` threads through error.ts `resolvePath`'s record arm, which id-safe-wraps any dotted string; and an async brand inside a recursive shape splices an `await`-bearing body into a plain nested `function` (a SyntaxError in the emitted module), with ref calls never awaited. The failed machinery sits at `src/compiler/validator.ts:23-30` (RecursionState), `:57-62` (WeakMap + message constant), `:436-449` (ref arm), `:554-606` (generateRecursiveBody/Function), `:925-976` (prepareRecursion), `:998-1046` (renderChildPath), with injection at `:1093` and `:1188`.

Settled decisions:

- **Relative static paths + a boundary prefix fix-up replace runtime path threading.** Each generated recursive function validates with paths relative to its OWN shape — compile-time segments, base `[]`, the standard `error.generate` machinery, so message text, custom-message lookup and path rendering behave exactly as the inline path does — and then prefixes what it appended, once, at the function boundary:

  ```
  function <fn>(_src, _path, _depth) {
      let _o = {},
          _e = _errors?.length ?? 0;

      if (_depth > 512) { <error.generate(RECURSION_DEPTH_MESSAGE, {segments: []}, context)> }
      else if (_src === null || typeof _src !== 'object' || Array.isArray(_src)) { <error.generate('must be an object', {segments: []}, context)> }
      else { <shared property body: source _src, container _o, base segments []> }

      if (_path !== '' && _errors !== undefined) {
          for (let _i = _e, _n = _errors.length; _i < _n; _i++) {
              let _r = _errors[_i].path;

              _errors[_i].path = _r === '' ? _path : (_r[0] === '[' ? _path + _r : _path + '.' + _r);
          }
      }

      return _o;
  }
  ```

  Prefixing composes across depths (an inner call prefixes its own appends before returning, so the outer loop sees already-relative-to-me paths); a relative path opening with `[` (index or bracket-quoted dotted key) joins without a dot; a container-level error (relative `''`) takes `_path` bare; union backtracking still truncates correctly because prefixing happens before return. The fixed `_e/_i/_n/_r/_o/_src/_path/_depth` locals cannot collide with the uid-minted body locals. BOTH failure arms return `_o` (fresh, empty) — never `_src`, so a raw (possibly cyclic) input reference is never placed into output structure. `MAX_RECURSION_DEPTH` (512) and `RECURSION_DEPTH_MESSAGE` stay as the module constants they are. Delete `generateRecursiveBody` and the two raw `_errors.push` sites (`:588`, `:594`) — every error goes through `error.generate`.

- **One body per shape — the root `'#'` function IS the top-level body.** Extract `generateValidator`'s root property loop (`:1106-1179`: probe/seed, the config arm with `_config.path = "<name>"` + `configInvocations`, the defaults arm, `validateInto`) into a module-level `generateRootParts(properties, config, defaults, source, container, context, recursion)` whose emission is UNCHANGED — a type with no refs generates with `(_input, _output, recursion = null)` and emits byte-identical output; the full 1775-test suite rides on that parity. When the collected refs contain `'#'`: the root function's body is `generateRootParts(type.properties, config, defaults, '_src', '_o', context, {depthArg: '_depth + 1', names})`, and the top level keeps its inline non-object guard + early return (`:1190-1194`) verbatim, then emits `_output = <await?><rootFn>(_input, '', 0);` in place of the inline parts. Config validators and default fills therefore execute at EVERY depth; config error paths stay the static property name and the boundary fix-up renders `next.value` at depth 1 while depth 0 is byte-identical to today (`_path === ''` → no prefix). `_config` (declared at `:1187`) and the hoisted default locals reach the nested function via closure. `$defs` functions use the same generator with `config`/`defaults` undefined — config keys are root property names by construction (`src/compiler/index.ts:144-166`). A `$defs` entry is always object-shaped with `properties` set (`defSchema`, `src/compiler/type-analyzer.ts:463-474`), so read `ir.properties!` with a one-line why — not the current `?? []` empty-shape fallback that silently regenerates the original drop-to-`{}` bug for a hypothetically malformed def.

- **Recursion state threads as a parameter — delete the static state.** `RecursionState = { depthArg: string; names: Map<string, string> }` becomes the trailing parameter of `generateTypeValidation`, `validateOrCopy`, `validateInto` and every `TYPE_VALIDATORS` generator (`TypeValidator` gains `recursion: RecursionState | null`); leaf generators accept and ignore it, container generators forward it. Two immutable state objects share one `names` map: `{depthArg: '1', names}` for all top-level generation (both root branches), `{depthArg: '_depth + 1', names}` for function bodies. Delete the `RECURSION` WeakMap (`:57-60`) and the post-generation `state.depthArg = '1'` mutation (`:973`). The ref arm of `generateObjectValidation` becomes `${target} = <await?>${fnName}(${source}, ${renderChildPath(pathMode.segments)}, ${recursion.depthArg});` and a ref with no wiring (recursion null) is unreachable by construction — prepareRecursion mints a name for every collected ref before any body generates.

- **Async is settled BEFORE emission.** `context.hasAsync` currently flips mid-generation when a brand validator inlines (`:397-405` number, `:664-673` string) while `validators.inline` splices `await`-bearing bodies verbatim (`src/compiler/validators.ts:126-130`, `:216-231`). In `prepareRecursion`, when any ref exists, pre-walk the root plus every `$defs` entry using the SAME child/list field walk `collectRefsInto` uses — extract that walk into one shared helper instead of duplicating the field list — and set `context.hasAsync = true` if any node's brand resolves to an async entry of `context.brandValidators` (number nodes: any brand; string nodes: brand set and not `'template'`). Config asyncness is already known upfront (`src/compiler/index.ts:253`). With the flag stable, every recursive decl emits `<async?>function` and every ref call site — including the top-level root call — emits `<await?>`. Types without refs never run the pre-walk, keeping today's late-set behavior untouched.

- **`renderChildPath` stays, as a documented private mirror.** It renders the call-site path VALUE (`'next'`, `"tags[" + i + "]"`, id-safe-wrapped map keys) and duplicates `error.ts` `resolvePath` only because resolvePath is unexported and `error.ts` is outside this item's writable surface — say exactly that in its one comment. With relative bodies its record arm now serves only genuine record/map-key segments, where the id-safe wrap is CORRECT; delete the stale "record base renders raw" rationale.

- **Function names derive from the analyzer's keys**: `uid('recurse_root')` for `'#'`, `uid('recurse_' + key)` per `$defs` entry — `defName` guarantees identifier-safe keys (`src/compiler/type-analyzer.ts:449-457`).

- **Accepted limitation (record in `## Notes` via append-notes and one code comment at the base-`[]` call):** custom messages resolve by schema position relative to the FUNCTION's shape, so a `'#'` root shape resolves its own keys at every depth (JSON-Schema `$ref` semantics: one schema, one message set) while `$defs` shapes resolve none (flattened keys are root-relative). No behavior is lost — recursive shapes never validated at all before this item and no custom-message test touches them.

- **Do NOT change** `src/json-schema.ts`, `src/compiler/error.ts`, `src/compiler/types.ts`, or `src/compiler/type-analyzer.ts` — the analyzer's ref/defs output is correct as-is; this replan names no shared-file change.

Test plan (extend `test/compiler/recursive-types.test.ts`; the 9 existing tests stay verbatim and green):

7. Deep error-path fidelity — `{value: 1, next: {value: 2, next: {value: 'x'}}}` returns ok false with errors exactly `[{message: 'must be a number', path: 'next.next.value'}]`. This FAILS on the current tree (it renders `["next.next"].value`), pinning the resolvePath-wrap defect.
8. Config validators run at every depth — mirror `test/compiler/config.test.ts`'s build-config syntax: a per-property config validator on `value` that pushes on a sentinel value; violating at depth 1 reports the config message at path `next.value`; violating at depth 0 keeps path `value`.
9. Defaults fill at every depth — mirror `test/compiler/annotations.test.ts:62`'s `.default()` form on an optional property of the recursive shape; `{value: 1, next: {value: 2}}` comes back with the default present on BOTH `data` and `data.next`.
10. An async brand inside the recursive shape emits a runnable async validator — mirror the registration precedent in `test/compiler/async-validators.test.ts` / `test/compiler/branded-strings.test.ts`: assert the transformed source contains `async function` for the recursion decl and an `await`ed recurse call, then `await validate(valid)` resolves ok true (building the validator at all proves the emitted module parses — the current tree emits a SyntaxError for this shape).
11. Pay-for-what-you-use guard — the transformed source of a NON-recursive type contains neither a `recurse` identifier nor `_depth`.

Self-check before returning: `pnpm agent:test test/compiler/recursive-types.test.ts`, then `pnpm agent:test test/compiler` (the root-loop extraction must not shift ANY sibling suite — byte-parity is the claim), then `npx tsc --noEmit`. The stage merger's full-suite run is the final arbiter.

## Reads

- src/json-schema.ts — the `ref` handling at :142-145, the correct behavior this item brings the validator into line with
- src/compiler/types.ts — GeneratorContext / PathMode, threaded through the new recursive functions

## Acceptance

- `type Node = { value: number; next?: Node }` fed `{value: 1, next: {value: 2}}` returns `ok: true` with data DEEP-EQUAL to the input — it returns `{value: 1, next: {}}` before the fix.
- An invalid recursive leaf reports `ok: false` with the error path pointing at `next.value`; mutual recursion round-trips both directions, covering the `$defs` path as well as the root `'#'` path.
- A cyclic INPUT terminates with a named depth error, asserted under a vitest timeout rather than hanging the suite.
- The JSON Schema emitted for the same recursive type still carries `$ref`/`$defs` exactly as at baseline.
- 0 regressions in test/compiler/recursive-types.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/recursive-types.test.ts
- npx tsc --noEmit

## Notes

Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
