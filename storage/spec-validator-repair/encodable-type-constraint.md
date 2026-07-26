---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [remove-map-set-tags, unify-packed-numeric-tags]
files-own: [src/sbc/types.ts, src/sbc/tagged.ts, test/sbc/types.test.ts]
files-shared: [src/sbc/index.ts]
tests: [test/sbc/types.test.ts, test/sbc/index.test.ts]
---

# Encodable constraint on encode; named throw for unrepresentable values

## Rationale

encode<T>(value: T) is unconstrained (src/sbc/index.ts:47), so passing a WeakMap, a Promise, a class instance or a function type-checks today and silently produces a wrong buffer — and the encoder compounds it by encoding an unrecognized ArrayBufferView as tag 0, which is null (src/sbc/tagged.ts:571-574). The user's rule is that an unsupported value must be a TypeScript error at the call site, never a JavaScript fallback at runtime. This item installs the compile-time gate and the single named runtime backstop, and it is the hard successor to remove-map-set-tags, which deliberately leaves the Map fall-through for this guard to own.

## Changes

`encode` and `computeSize` gain an `Encodable` constraint declared in `src/sbc/types.ts`, so an unsupported value is a TypeScript error at the call site; `src/sbc/tagged.ts` loses its silent tag-0 fallback for unrecognized views and gains one named unrepresentable-value throw covering Map, Set, WeakMap, RegExp, Promise, functions, symbols and class instances. Public API break: both signatures narrow, and values previously accepted-and-corrupted now fail.

## Design

Settled decisions. The user's rule, stated directly: an unsupported value must be a TYPESCRIPT error at the call site, not a JavaScript fallback at runtime. Silent representation-substitution is refused everywhere.

- **Constrain `encode`.** `src/sbc/index.ts:47` declares `encode<T>(value: T, viewOrOptions?: boolean | EncodeOptions): Uint8Array` — `T` is unconstrained, so `codec().encode(new WeakMap())` type-checks today and produces garbage. Introduce an exported recursive `Encodable` type in `src/sbc/types.ts` and constrain the method to `encode<T extends Encodable>(value: T, …)`. The union covers exactly what the tag surface represents AFTER remove-map-set-tags and unify-packed-numeric-tags land: `null | undefined | boolean | number | bigint | string | Date | Uint8Array | ArrayBufferView | Encodable[] | { [key: string]: Encodable }`. It does NOT include Map, Set, WeakMap, WeakSet, Promise, Function, Symbol, RegExp, or class instances with methods.
- **`computeSize` takes the same constraint.** `computeSize(value: unknown)` (`src/sbc/index.ts:42`) becomes `computeSize(value: Encodable)`; a caller must not be able to presize something it cannot encode.
- **`decode` is NOT constrained and must not be.** `decode<T = unknown>` reads bytes off the wire from a producer this process does not control, so its rejection is necessarily a runtime throw — and it already has one: `src/sbc/tagged.ts:304-305` throws `Codec2: unknown tag <n>`. Leave that path alone; it is the correct shape.
- **Delete the silent tag-0 fallback.** `src/sbc/tagged.ts:571-574` encodes an `ArrayBufferView` whose constructor is absent from `TYPED_ARRAY_IDS` as `buf[pos] = 0` — tag 0 is null, so a `DataView`-adjacent view silently becomes `null` on the wire. Replace with `throw new Error('Codec2: unrepresentable value of type ' + <ctor name>)`. This is the SAME guard the Map/Set fall-through needs.
- **Install the single unrepresentable guard.** In `encodeSbc`'s `case 'object':` arm, after the Date / Uint8Array / ArrayBufferView / Array checks and BEFORE the generic `Object.keys` object arm, reject any value whose prototype is not `Object.prototype` or `null` with the same named throw. That one guard catches Map, Set, WeakMap, RegExp, Promise, and class instances — the TypeScript constraint is the primary gate, this is the runtime backstop for `any`-typed and JS call sites. `case 'function'`, `case 'symbol'` and `case 'undefined'` in the outer `typeof` switch get the same named throw rather than falling to `default`.

TypeScript-strictness note: `Encodable` must not be so tight that a legitimate interface fails to assign. An `interface Foo { a: number }` does NOT satisfy `{ [key: string]: Encodable }` under TS's implicit-index-signature rule, while a `type Foo = { a: number }` does. Resolve with a mapped conditional (`{ [K in keyof T]: Encodable }` over a generic `T extends object`) rather than a bare index signature, and pin the behavior with a `tsd`-style compile assertion in the suite: an interface-typed value, a type-alias-typed value, and a class instance must accept / accept / REJECT respectively.

Test plan (`test/sbc/types.test.ts`, new mirror for `src/sbc/types.ts`, plus `test/sbc/index.test.ts` for runtime):

1. Compile-time: `@ts-expect-error` on `encode(new Map())`, `encode(new Set())`, `encode(new WeakMap())`, `encode(() => {})`, `encode(Symbol('x'))`, and on `computeSize(new Map())`. Each line fails the build if the constraint ever loosens.
2. Compile-time: an `interface`-typed object, a `type`-alias object, a nested array-of-objects, a `Date`, a `Uint8Array`, and a `Float32Array` all assign to `Encodable` with no error.
3. Runtime: `encode(new Map() as never)` throws `Codec2: unrepresentable value of type Map` — the backstop fires for an untyped call site.
4. Runtime: a `DataView` and a class instance each throw the same named error instead of encoding as null or as `{}`.
5. Runtime: `decode` of a buffer carrying a retired tag still throws `Codec2: unknown tag <n>` — proves the decode path was not touched.

## Reads

- src/sbc/schema.ts — inferType, the value classes the encoder actually represents
- README.md — the documented accepted-value list, corrected later by readme-accuracy

## Acceptance

- Every `@ts-expect-error` line in test/sbc/types.test.ts compiles as an error, and the accepted shapes (interface, type alias, nested arrays, Date, Uint8Array, Float32Array) compile clean.
- `encode` of a Map, a DataView, or a class instance throws the named unrepresentable error; no value encodes as tag 0 unless it is `null` or `undefined`.
- `decode` still throws `Codec2: unknown tag` for a retired tag — the decode path is unchanged.
- 0 regressions in test/sbc/types.test.ts and test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/types.test.ts test/sbc/index.test.ts
- npx tsc --noEmit
