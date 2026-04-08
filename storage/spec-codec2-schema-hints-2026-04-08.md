# Spec: Schema Hints for encode/decode + Build-Time Type Compilation

**Date**: 2026-04-08
**Scope**: Phase 1 — runtime schema hint API. Phase 2 — build-time TypeScript compiler plugin.
**Files**: Phase 1: `src/codec2/index.ts`. Phase 2: `src/compiler/`, `src/codec2/index.ts`
**Validation**: `pnpm test`, `pnpm tsc --noEmit`, `npx tsx tests/bench/codec2-standalone.ts`

---

## Motivation

codec2's fresh-object encode path is 0.35x vs MsgPack because every new object reference must:
1. WeakMap miss (~50ns wasted)
2. Ring buffer scan (up to 4 slots × `inferType` per field)
3. Possibly `inferAndRegister` (Object.keys, sort, hash, compile)

In production (lmdb `put`, WebSocket send, etc.), callers almost always know the schema at the call site — either from a `defineSchema` hash or from the TypeScript type. Passing this knowledge to `encode`/`decode` skips all inference overhead.

Phase 2 makes this zero-effort: the build-time compiler reads the generic type argument and injects the schema automatically, so `codec.encode<User>(obj)` is rewritten to `codec.encode(obj, { schema: [...] })` at compile time.

---

## Phase 1: Runtime Schema Hint API

### 1.1 Encode Options

```typescript
type EncodeOptions = {
    schema?: number | FieldSpec[];
    view?: boolean;
};

// Overloads:
encode(value: unknown): Uint8Array;
encode(value: unknown, view: boolean): Uint8Array;
encode(value: unknown, options: EncodeOptions): Uint8Array;
```

The existing `view` boolean parameter is preserved for backward compatibility. When options is an object, `view` moves inside it.

**`schema` as `number` (hash)**:
```typescript
let hash = codec.defineSchema([...]);
codec.encode(obj, { schema: hash });
```
- Look up schema directly: `registry.schemas.get(hash)`
- If not found → throw `Error('Codec2: unknown schema hash')`
- Skip WeakMap, skip matchSchema, skip inferAndRegister
- Call `schema.encodeFn(obj, encodeBuf, 9)` directly

**`schema` as `FieldSpec[]`**:
```typescript
codec.encode(obj, { schema: [
    { name: 'name', type: 'string' },
    { name: 'age', type: 'uint8' },
]});
```
- Compute hash from fields (same as `defineSchema`)
- If hash already registered → use existing compiled schema
- If not → register via `defineSchema` (one-time cost, amortized to zero)
- Then encode using the resolved schema

This path is designed for the build-time compiler: it injects the full `FieldSpec[]` so the schema is auto-registered on first call and cached by hash thereafter.

### 1.2 Decode Options

```typescript
type DecodeOptions = {
    schema?: number | FieldSpec[];
};

// Overloads:
decode(buffer: Uint8Array): unknown;
decode(buffer: Uint8Array, length: number): unknown;
decode(buffer: Uint8Array, options: DecodeOptions): unknown;
```

The existing `length` number parameter is preserved for backward compatibility.

**`schema` as `number` (hash)**:
- Used as a hint to skip the tag-8/18 hash read + registry lookup
- Still validates: if buffer's embedded hash doesn't match → fall through to normal decode
- When hash matches → call `schema.decodeFn(buffer, 9, 0)` directly

**`schema` as `FieldSpec[]`**:
- Same auto-register behavior as encode
- Ensures the schema is compiled before decoding (useful when receiving data from a peer whose registry you haven't imported)

### 1.3 Encode Fast Path Implementation

```typescript
function encode(value: unknown, optionsOrView?: boolean | EncodeOptions): Uint8Array {
    let schema: Schema | null = null,
        view = false;

    if (typeof optionsOrView === 'boolean') {
        view = optionsOrView;
    }
    else if (optionsOrView) {
        view = optionsOrView.view ?? false;

        if (optionsOrView.schema != null) {
            schema = resolveSchemaForEncode(optionsOrView.schema);
        }
    }

    if (schema) {
        // Direct encode — skip WeakMap, matchSchema, inferAndRegister
        let obj = value as Record<string, unknown>,
            end: number,
            h = schema.hash,
            useCompressed = compress && schema.compressible && schema.compressedEncodeFn;

        if (useCompressed) {
            end = schema.compressedEncodeFn!(obj, encodeBuf, 9);
            // ... overflow handling ...
            encodeBuf[0] = 18;
        }
        else {
            end = schema.encodeFn!(obj, encodeBuf, 9);
            // ... overflow handling ...
            encodeBuf[0] = 8;
        }

        // ... write header, return buffer ...
    }

    // ... existing path (typeof check, WeakMap, matchSchema, etc.) ...
}
```

**Key**: when `schema` is provided, no type checking on `value` occurs at the codec level — the caller asserts the value matches the schema. Type safety is enforced at build time (Phase 2) or by the caller.

### 1.4 `resolveSchema` Helpers

Encode and decode have different miss semantics:

```typescript
// Encode: hash is a hint — miss falls through to inference from value
function resolveSchemaForEncode(hint: number | FieldSpec[]): Schema | null {
    if (typeof hint === 'number') {
        return registry.schemas.get(hint) ?? null;
    }

    // FieldSpec[] — auto-register on first call, cached by hash thereafter
    let hash = defineSchema(hint);

    return registry.schemas.get(hash)!;
}

// Decode: hash is required — miss throws (no value to infer from)
function resolveSchemaForDecode(hint: number | FieldSpec[]): Schema {
    if (typeof hint === 'number') {
        let s = registry.schemas.get(hint);

        if (!s) {
            throw new Error('Codec2: unknown schema hash ' + hint);
        }

        return s;
    }

    // FieldSpec[] — auto-register on first call, cached by hash thereafter
    let hash = defineSchema(hint);

    return registry.schemas.get(hash)!;
}
```

**Encode miss behavior**: when a hash hint misses, encode falls through to the normal path (WeakMap → ring buffer → inferAndRegister). The value is right there — no reason to throw when we can infer.

**Decode miss behavior**: throws. There's no value to infer from — just bytes that need a known schema to interpret.

### 1.5 Performance Expectations

| Path | Cost | Expected Ratio |
|---|---|---|
| WeakMap hit (same reference) | O(1) hash probe | ~2.6x (current cached) |
| Schema hint (hash) | O(1) Map.get | ~2.6x (same as cached, works for fresh objects) |
| Schema hint (FieldSpec[]) | O(1) Map.get after first call | ~2.6x after warmup, first call pays defineSchema cost |
| No hint, fresh object | WeakMap miss + ring buffer + inferType | ~0.35x (current fresh) |

---

## Phase 2: Build-Time Type Compilation

### 2.1 Overview

A TypeScript compiler plugin (Vite + TSC) that detects `encode<T>(value)` and `decode<T>(buffer)` calls on codec2 instances, parses `T` into a `FieldSpec[]`, and rewrites the call to pass `{ schema: [...] }`.

**Before (user code)**:
```typescript
import { createCodec } from '@esportsplus/data';

type User = {
    age: number;
    email: string;
    name: string;
};

let codec = createCodec();
let encoded = codec.encode<User>(user);
let decoded = codec.decode<User>(buffer);
```

**After (compiled output)**:
```typescript
import { createCodec } from '@esportsplus/data';

let codec = createCodec();
let encoded = codec.encode(user, { schema: [{"name":"age","type":"uint8"},{"name":"email","type":"string"},{"name":"name","type":"string"}] });
let decoded = codec.decode(buffer, { schema: [{"name":"age","type":"uint8"},{"name":"email","type":"string"},{"name":"name","type":"string"}] });
```

The generic type parameter is erased (as TypeScript normally does) and replaced with a runtime schema hint.

### 2.2 Type-Safety: Compile-Time Value Validation

When `encode<T>(value)` is used, the compiler enforces that `value` is assignable to `T`. This is standard TypeScript generic constraint behavior — if the value doesn't match, `tsc` reports an error before the compiler plugin even runs.

To make this work, the codec's type signature must constrain the value parameter:

```typescript
// In codec2 type declarations:
interface Codec {
    encode<T extends Record<string, unknown> = Record<string, unknown>>(
        value: T,
        options?: EncodeOptions
    ): Uint8Array;

    decode<T = unknown>(
        buffer: Uint8Array,
        options?: DecodeOptions
    ): T;
}
```

This means:
- `codec.encode<User>({ name: 123 })` → **tsc error**: `number` is not assignable to `string`
- `codec.encode<User>(unknownObj)` → **tsc error**: unless `unknownObj` is typed as `User`
- `codec.encode(anyObj)` → no type check, no schema hint (existing behavior)

No runtime type validation is needed — TypeScript's type system handles it at compile time. The compiler plugin only transforms calls that already pass type checking.

### 2.3 TypeScript Type → FieldSpec Mapping

Reuse the existing `type-analyzer.ts` infrastructure. Add a new mapping layer:

**`analyzePropertyToFieldSpec(prop: AnalyzedProperty): FieldSpec`**

| AnalyzedProperty.type | FieldSpec.type | Notes |
|---|---|---|
| `'bigint'` | `'bigint'` | Direct |
| `'boolean'` | `'boolean'` | Direct |
| `'date'` | `'date'` | Direct |
| `'number'` (brand: `'integer'`) | `'int32'` | Branded integer |
| `'number'` (brand: `'float'`) | `'float64'` | Branded float |
| `'number'` (no brand) | `'float64'` | Default: numbers are float64 |
| `'string'` | `'string'` | Direct |
| `'object'` | `'object'` | Nested object → `'object'` (or `'object(hash)'` if recursive types implemented) |
| `'array'` (itemType: number) | `'array<uint8>'` / `'array<float64>'` | Typed array (if recursive types spec implemented) |
| `'array'` (itemType: object) | `'array<object>'` / `'array'` | Depending on recursive types |
| `'array'` (itemType: string) | `'array<string>'` / `'array'` | Depending on recursive types |
| `'array'` (itemType: mixed/union) | `'array'` | Mixed array, generic path |
| `'null'` | N/A | Sets `nullable: true` on the field |
| `'union'` with null | inner type + `nullable: true` | Union of T \| null |
| `'record'` | `'map'` | Record<K, V> → Map encoding |
| `'unknown'` / `'any'` | `'mixed'` | Dynamic field |

**Number type inference heuristic**:
- `number` without brand → `'float64'` (safe default — handles all JS numbers)
- `number & { __brand: 'integer' }` → `'int32'`
- `number & { __brand: 'uint8' }` → `'uint8'`
- etc.

To support fine-grained integer types without brands, accept JSDoc or a type alias convention:

```typescript
// Brand approach (existing infrastructure):
type Age = number & { __brand: 'uint8' };

// Or plain number → defaults to float64 (safe)
type User = { age: number };  // → float64
```

### 2.4 Compiler Plugin Detection

The plugin detects calls matching these patterns:

```
<codec-expr>.encode<T>(value)
<codec-expr>.encode<T>(value, options)
<codec-expr>.decode<T>(buffer)
<codec-expr>.decode<T>(buffer, options)
```

Where `<codec-expr>` is the return value of `createCodec()` from `@esportsplus/data`.

**Detection steps**:
1. Call expression with type arguments (`.typeArguments.length > 0`)
2. Property access: `.encode` or `.decode` on an expression
3. The expression's type traces back to `createCodec` return type from `@esportsplus/data`
4. The type argument resolves to an object type (not a primitive)

### 2.5 Transformation

For `codec.encode<T>(value)`:

1. `analyzeType(typeArg, checker)` → `AnalyzedType`
2. Map each property → `FieldSpec` via `analyzePropertyToFieldSpec`
3. Sort by name (already done by type-analyzer)
4. Serialize as JSON literal: `[{"name":"age","type":"uint8"}, ...]`
5. Replace the call:
   - If no existing options arg: `codec.encode(value, { schema: [...] })`
   - If existing options arg (object literal): merge `schema` into it
   - If existing options arg (variable): `codec.encode(value, { ...opts, schema: [...] })`

For `codec.decode<T>(buffer)`:

1. Same type analysis → `FieldSpec[]`
2. Replace: `codec.decode(buffer, { schema: [...] })`
3. Add type assertion if needed for return type: `codec.decode(buffer, { schema: [...] }) as T`

### 2.6 Nested Object Handling

For types with nested objects:

```typescript
type Address = { city: string; zip: string };
type User = { address: Address; name: string };

codec.encode<User>(user);
```

The compiler generates schema for all nested objects. Two approaches:

**Approach A — Flat (simpler, Phase 2 initial)**:
```typescript
codec.encode(user, { schema: [
    { name: 'address', type: 'object' },
    { name: 'name', type: 'string' },
]});
```
The nested `Address` auto-infers at runtime on first encode. Simple, no recursive schema management.

**Approach B — Recursive (after recursive types spec)**:
```typescript
// Compiler emits a setup block:
let __s0 = codec.defineSchema([{ name: 'city', type: 'string' }, { name: 'zip', type: 'string' }]);
codec.encode(user, { schema: [
    { name: 'address', type: `object(${__s0})` },
    { name: 'name', type: 'string' },
]});
```
Full compile-time schema resolution. Maximum performance. Requires the recursive types spec to be implemented first.

### 2.7 Caching

The compiler plugin caches `AnalyzedType → FieldSpec[]` mapping per type node (using the existing `WeakMap<ts.TypeNode, AnalyzedType>` in type-analyzer.ts). Multiple call sites with the same `<T>` produce the same schema literal — the JS minifier can deduplicate if desired.

At runtime, `resolveSchema(FieldSpec[])` calls `defineSchema` which checks `registry.schemas.has(hash)` — second and subsequent calls are a hash lookup only.

---

## Phase 2.5: Optional Runtime Type Validation (Future)

If runtime validation is desired (e.g., in development mode or for untrusted data), the compiler could additionally emit a validator:

```typescript
// Development build:
codec.encode(user, {
    schema: [...],
    validate: (v) => { if (typeof v.name !== 'string') throw new TypeError('...'); ... }
});
```

This is out of scope for this spec but the options object design accommodates it. The existing `validator.ts` compiler infrastructure could generate these validators.

---

## Implementation Order

### Phase 1 (Runtime API)
| Step | Description | Effort |
|---|---|---|
| 1 | Add `EncodeOptions` / `DecodeOptions` types | Small |
| 2 | Add `resolveSchema` helper | Small |
| 3 | Update `encode` to accept options object, dispatch to schema fast path | Medium |
| 4 | Update `decode` to accept options object, use schema hint | Medium |
| 5 | Update `createCodec` return type signature with generics | Small |
| 6 | Tests: encode with hash hint, encode with FieldSpec[], decode with hint | Medium |
| 7 | Benchmark: fresh objects with schema hint vs without | Small |

### Phase 2 (Build-Time Compiler)
| Step | Description | Effort |
|---|---|---|
| 1 | Add `analyzePropertyToFieldSpec` mapping in a new `src/compiler/codec2/` directory | Medium |
| 2 | Add detection for `codec.encode<T>` / `codec.decode<T>` in compiler `visit` | Medium |
| 3 | Generate schema literal + rewrite call expression | Medium |
| 4 | Handle nested objects (Approach A — flat) | Small |
| 5 | Handle arrays, unions, nullable, optional | Medium |
| 6 | Handle edge cases: no type arg (skip), primitive type arg (error), circular refs | Medium |
| 7 | Vite plugin + TSC plugin integration | Small |
| 8 | End-to-end tests: compile + run round-trip | Large |

---

## Test Plan

### Phase 1
- [ ] `encode(obj, { schema: hash })` — correct output, matches `encode(obj)` without hint
- [ ] `encode(obj, { schema: hash })` with wrong hash → throws
- [ ] `encode(obj, { schema: fieldSpecs })` — auto-registers, correct output
- [ ] `encode(obj, { schema: fieldSpecs })` called twice — second call skips defineSchema
- [ ] `encode(obj, { schema: hash, view: true })` — view semantics preserved
- [ ] `encode(obj, true)` — backward compatible, view=true
- [ ] `decode(buffer, { schema: hash })` — correct decode, skips hash lookup
- [ ] `decode(buffer, { schema: fieldSpecs })` — auto-registers schema, correct decode
- [ ] `decode(buffer, 18)` — backward compatible, length parameter
- [ ] Benchmark: fresh objects with `{ schema: hash }` ≈ cached object performance
- [ ] Benchmark: fresh objects with `{ schema: fieldSpecs }` — first call slow, subsequent fast
- [ ] Nullable fields via schema hint round-trip correctly

### Phase 2
- [ ] `encode<SimpleType>(obj)` → compiler emits `encode(obj, { schema: [...] })`
- [ ] `decode<SimpleType>(buf)` → compiler emits `decode(buf, { schema: [...] })`
- [ ] Type mismatch: `encode<User>({ wrong: true })` → tsc error (not runtime)
- [ ] Nested objects: `encode<UserWithAddress>(obj)` → address field is `'object'`
- [ ] Nullable union: `string | null` → `{ nullable: true, type: 'string' }`
- [ ] Optional field: `age?: number` → `{ nullable: true, type: 'float64' }`
- [ ] Array field: `tags: string[]` → `{ type: 'array' }` (or `'array<string>'` with recursive types)
- [ ] Map field: `Record<string, number>` → `{ type: 'map' }`
- [ ] Number brands: `number & { __brand: 'uint8' }` → `{ type: 'uint8' }`
- [ ] Plain number → `{ type: 'float64' }` (safe default)
- [ ] No type arg: `encode(obj)` → no transformation (pass-through)
- [ ] Compiled output executes correctly end-to-end (compile → encode → decode → verify)

---

## Wire Format

No changes. The schema hint only affects how the schema is resolved — the encoded bytes are identical whether the schema was auto-inferred, explicitly defined, or compiler-injected.
