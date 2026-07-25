---
type: feature
recommended-model: sonnet
status: PENDING
depends-on: agent-test-script
files-own: [src/index.ts, src/types.ts]
tests: [tests/transformer.ts]
api-impact: none
---

# Public surface: Validator.toJsonSchema signature, JsonSchema type, runtime stub

## Rationale
The feature's public contract must exist before the compiler items can be typed against it: the `Validator` interface today carries only `build` and `set` (S2 — src/types.ts:22-30), and the runtime `validator` object throws a must-be-transformed error for both (S1 — src/index.ts:5-18). `toJsonSchema` follows the identical additive pattern.

## Changes
Public type surface gains a `JsonSchema` structural type and a `toJsonSchema` method on `Validator`; the runtime stub object gains a matching method that throws the same-shaped not-transformed error. Purely additive — no existing export changes.

## Design
1. `src/types.ts` — add a `JsonSchema` interface (after the brand types, alphabetical within the type declarations) modeling exactly the Draft 2020-12 subset the emitter can produce, all members optional, alphabetized with `$schema` leading (symbol-prefixed key group):

```ts
interface JsonSchema {
    $schema?: string;
    additionalProperties?: JsonSchema | boolean;
    allOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    const?: boolean | number | string | null;
    enum?: (boolean | number | string)[];
    exclusiveMaximum?: number;
    exclusiveMinimum?: number;
    format?: string;
    items?: JsonSchema | false;
    maximum?: number;
    maxItems?: number;
    maxLength?: number;
    minimum?: number;
    minItems?: number;
    minLength?: number;
    multipleOf?: number;
    not?: JsonSchema;
    pattern?: string;
    prefixItems?: JsonSchema[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    type?: string | string[];
}
```

2. `src/types.ts` — extend `Validator` (member order stays alphabetical: build, set, toJsonSchema):

```ts
toJsonSchema: <T>(_config?: ValidatorConfig<T>) => JsonSchema;
```

The type parameter exists to type the config arg; the return is the non-generic structural `JsonSchema` (the emitted value is plain data — a generic return would promise a precision the transform does not deliver).

3. `src/types.ts` — add `JsonSchema` to the export type block, alphabetical position.

4. `src/index.ts` — add to the `validator` object (after `set`, keeping alphabetical order):

```ts
toJsonSchema: () => {
    throw new Error(
        `${PACKAGE_NAME}: validator.toJsonSchema<T>() must be transformed at compile-time. ` +
        'Ensure the validation plugin is configured in your build tool.'
    );
}
```

— byte-for-byte the same sentence shape as the `build`/`set` stubs (S1).

## Reads
- src/types.ts — the interface being extended and the ValidatorConfig/ValidatorFunction shapes the signature reuses
- src/index.ts — the stub object and error-message shape being mirrored
- src/constants.ts — PACKAGE_NAME

## Acceptance
`npx tsc --noEmit` green; `JsonSchema` and the extended `Validator` are exported from the package root types; 0 regressions in tests/transformer.ts, run scoped. The stub-throws behavior is asserted by json-schema-transform-wiring's tests/json-schema.ts (this item runs before that file exists).

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/transformer.ts

## Notes
The keyword set above is closed by design — it is exactly what json-schema-emitter may emit; a keyword the emitter grows later is added here in the same change. `items?: JsonSchema | false` exists because tuple emission uses `items: false`; no other boolean-schema position is modeled.
