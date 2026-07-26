# @esportsplus/data

TypeScript validation and binary encoding. Validators are generated at compile time. The binary codec (SBC) works at runtime with optional compile-time optimization.

## Features

- **Compile-Time Validators**: Type-safe validation functions generated from TypeScript types
- **Runtime Binary Codec**: Encode/decode any JS value to compact binary — no compiler required
- **Compile-Time Codec Optimization**: Optional type hints skip runtime inference for known shapes
- **Custom Validators**: Add sync/async validation logic
- **Branded Type Validators**: Register validators for branded types
- **Schema Pre-Registration**: Define schemas upfront with `defineSchema` for known object shapes
- **Persistent Schema Store**: Share schemas across codec instances or persist to storage

## Installation

```bash
npm install @esportsplus/data
```

## Binary Codec (SBC)

High-performance binary codec with JIT-compiled per-shape encode/decode. Works at runtime without a compiler — schemas are inferred from values on first encode.

```typescript
import { codec } from '@esportsplus/data';

let c = codec();

// Encode any value to binary
let buffer = c.encode({ name: 'Alice', age: 30, active: true });

// Decode back
let user = c.decode(buffer);
// { active: true, age: 30, name: 'Alice' }
```

### Supported Values

Primitives, objects, arrays, nested structures, and typed collections:

```typescript
let c = codec();

// Primitives
c.encode(null);
c.encode(true);
c.encode(42);
c.encode(3.14);
c.encode('hello');
c.encode(123n);
c.encode(new Date());

// Arrays
c.encode([1, 2, 3]);
c.encode(['a', 'b', 'c']);

// Nested objects
c.encode({
    user: { name: 'Alice', scores: [100, 95, 87] },
    timestamp: Date.now()
});

// Uint8Array, typed arrays
c.encode(new Uint8Array([0xFF, 0x00]));
c.encode(new Float64Array([1.1, 2.2]));

// Map and Set are NOT encodable — encode() throws a `Codec2:` error for both
// c.encode(new Map([['key', 'value']])); // throws
// c.encode(new Set([1, 2, 3]));          // throws
```

### Wire Format

| Value Type | Tag | Wire Format |
|------------|-----|-------------|
| `null` / `undefined` | 0 | Tag only |
| `boolean` | 1/2 | Tag only (1=false, 2=true) |
| `uint8` (0–255) | 3 | 1 byte |
| `float64` | 4 | 8 bytes |
| `string` | 5 | u32 length + UTF-8 |
| `Uint8Array` | 6 | u32 length + raw bytes (decodes to a fresh copy, never a view into the source buffer) |
| `Array` | 7 | u32 count + tagged elements |
| `object` | 8 | u32 hash + u32 length + compiled fields |
| `int64` | 9 | 8 bytes |
| `Date` | 10 | f64 (timestamp) |
| `int32` | 11 | 4 bytes |
| packed `number[]` | 12 | u8 typeId + u32 byteLen + raw little-endian elements |
| typed array | 17 | u8 typeId + u32 byteLen + raw bytes |
| compressed object | 18 | u32 hash + u32 length + packed fields |

Tag 12 is an internal encoder optimization for a plain JS `Array` whose every element is a number:
the classifier picks the narrowest lossless element width (uint8/int8/uint16/int16/uint32/int32/
float64) and packs the elements at that width, decoding back to a plain `number[]` — not a typed
array. A real `Uint8Array[]` (array of `Uint8Array` instances) encodes as tag 7 (`Array`) with each
element as a tag-6 `Uint8Array`. `Map` and `Set` have no wire tag: they are not encodable (see
below).

`undefined` values and array holes both encode as tag 0 (`null`) and decode back as `null`, never
`undefined`. A value with no representable tag (`Map`, `Set`, a function, a symbol, a class
instance) throws a `Codec2:` error from `encode()`.

### Schema Pre-Registration

For known object shapes, pre-register schemas with `defineSchema` to skip runtime inference:

```typescript
let c = codec();

// Returns a hash identifying this schema
let hash = c.defineSchema([
    { name: 'active', type: 'boolean' },
    { name: 'age', type: 'uint8' },
    { name: 'name', type: 'string' },
]);

// Objects matching this shape use the pre-registered schema
let buf = c.encode({ name: 'Alice', age: 30, active: true });
let obj = c.decode(buf);
```

A declared schema is honored for every object whose keys AND value types match — not only the
first shape the codec happens to see — so pre-registering ahead of the first `encode()` call
guarantees the fast path regardless of call order.

#### Field Types

| Type | Description |
|------|-------------|
| `boolean` | true/false |
| `uint8` | 0–255 |
| `uint16` | 0–65535 |
| `uint32` | 0–4294967295 |
| `int8` | -128–127 |
| `int16` | -32768–32767 |
| `int32` | -2147483648–2147483647 |
| `float64` | 64-bit float |
| `int64` | 64-bit signed |
| `string` | UTF-8 string |
| `bytes` | Raw bytes (Uint8Array) |
| `date` | Date object (stored as f64) |
| `array` | Generic array |
| `array<T>` | Typed array (e.g. `array<uint8>`) |
| `object(hash)` | Nested object referencing another schema |
| `typedarray` | TypedArray (Float32Array, etc.) |
| `mixed` | Any value (tagged encoding) |

Nullable fields:

```typescript
c.defineSchema([
    { name: 'bio', nullable: true, type: 'string' },
    { name: 'id', type: 'uint32' },
]);
```

### Compression

Enable compression for schemas with boolean, float64, or integer fields:

```typescript
let c = codec({ compress: true });

// Booleans are bit-packed, numerics use fixed-width encoding
let buf = c.encode({ a: true, b: false, c: true, score: 99.5 });
```

### Field Extraction

Read a single field from an encoded buffer without full decode:

```typescript
let c = codec();

c.defineSchema([
    { name: 'active', type: 'boolean' },
    { name: 'age', type: 'uint8' },
    { name: 'name', type: 'string' },
]);

let buf = c.encode({ name: 'Alice', age: 30, active: true });

c.extractField(buf, 'age');    // 30
c.extractField(buf, 'name');   // 'Alice'
```

### Schema Serialization

Persist and restore the schema registry:

```typescript
let c1 = codec();

c1.defineSchema([
    { name: 'id', type: 'uint32' },
    { name: 'name', type: 'string' },
]);

// Serialize registry to binary
let registryData = c1.serializeRegistry();

// Restore on another codec instance
let c2 = codec();

c2.deserializeRegistry(registryData);
```

### Persistent Store

Share schemas across codec instances via a custom store:

```typescript
let store = new Map<number, { fields: FieldSpec[]; hash: number }>();

let c = codec({
    store: {
        get: (hash) => store.get(hash) ?? null,
        set: (hash, schema) => store.set(hash, schema),
    }
});
```

### Schema Hints (Encode/Decode)

Pass schema hints to skip runtime matching:

```typescript
let c = codec();

let hash = c.defineSchema([
    { name: 'x', type: 'float64' },
    { name: 'y', type: 'float64' },
]);

// Hint by hash — skips WeakMap lookup, matchSchema, inferAndRegister
let buf = c.encode({ x: 1.5, y: 2.5 }, { schema: hash });
let pt = c.decode(buf, { schema: hash });

// Hint by field specs — auto-registers if not already defined
let buf2 = c.encode({ x: 3, y: 4 }, {
    schema: [{ name: 'x', type: 'float64' }, { name: 'y', type: 'float64' }]
});
```

An unknown schema hash — one never `defineSchema`'d or restored via `deserializeRegistry` —
throws `Codec2: unknown schema hash <n>` rather than silently falling back to inference.

### View Mode (Zero-Copy Encode)

Return a subarray of the internal buffer instead of copying:

```typescript
let c = codec();

// view=true — zero-copy, but invalidated by next encode() call
let view = c.encode({ x: 1 }, true);

// Or via options
let view2 = c.encode({ x: 1 }, { view: true });
```

### Computing Encoded Size

`computeSize(value)` returns the exact encoded byte length, without encoding. It is total over
`encode`'s domain: for every value `encode()` accepts, `computeSize(value) === encode(value).length`
— primitives (`null`, `boolean`, `number`, `bigint`, `string`, `Date`, `Uint8Array`), every other
`TypedArray`, arrays (packed and generic), and plain objects (registered or inferred, nested and
nullable fields included), under both uncompressed and compressed (`{ compress: true }`) codecs.

```typescript
let c = codec();

c.computeSize({ name: 'Alice', age: 30 }); // exact byte length, no encode() call
c.computeSize([1, 2, 3]);                  // exact byte length
c.computeSize(new Float32Array(3));        // exact byte length
```

For every value `encode()` rejects, `computeSize` throws the SAME `Codec2:` error `encode()` would
throw — `Map`, `Set`, `RegExp`, class instances, functions, symbols, and out-of-int64 `bigint`
values are all non-encodable and raise rather than returning a bogus number.

```typescript
c.computeSize(new Map()); // throws: Codec2: unrepresentable value of type Map
```

### Codec API Reference

```typescript
function codec(options?: CodecOptions): SbcCodec;

type CodecOptions = {
    compress?: boolean;
    store?: PersistentStore;
};

type SbcCodec = {
    computeSize(value: unknown): number;
    decode(buffer: Uint8Array, lengthOrOptions?: number | DecodeOptions): unknown;
    decodeAt(buffer: Uint8Array, offset: number): unknown;
    defineSchema(fields: FieldSpec[]): number;
    deserializeRegistry(data: Uint8Array): void;
    encode(value: unknown, viewOrOptions?: boolean | EncodeOptions): Uint8Array;
    extractField(buffer: Uint8Array, fieldName: string): unknown;
    serializeRegistry(): Uint8Array;
};

type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: string;
};

type DecodeOptions = {
    schema?: number | FieldSpec[];
};

type EncodeOptions = {
    schema?: number | FieldSpec[];
    view?: boolean;
};

type PersistentStore = {
    get(hash: number): StoredSchema | null;
    set(hash: number, schema: StoredSchema): void;
};
```

### Compile-Time Optimization (Optional)

When using the compiler plugin, type-parameterized `encode<T>()` and `decode<T>()` calls on a
codec (any receiver whose type carries a `defineSchema` method) are transformed to inject schema
hints automatically — but only under a **parity-or-omit** rule: a hint is injected only when
every property of `T` is *width-determinate*, meaning its static type always resolves to the same
field type the runtime inferrer would assign to every value it admits. A single non-determinate
property makes the WHOLE call hint-free rather than shipping a hint that could diverge from
runtime inference. An unbranded `number` is never determinate (its width depends on the runtime
value); `Map`, `Set`, `Promise`, `RegExp`, `WeakMap`, and `WeakSet` fields are never determinate
either (they aren't encodable — see Wire Format). `string`, `boolean`, `bigint`, `Date`,
`Uint8Array`, other typed arrays, nested objects, and branded `uint8` numbers ARE supported hint
sources.

```typescript
type Point = { x: number; y: number };

// x/y are plain `number` — non-determinate — so this call is left UNCHANGED by the compiler:
c.encode<Point>({ x: 1, y: 2 });
```

```typescript
type Event = { name: string; active: boolean };

// Before (source):
c.encode<Event>({ name: 'login', active: true });

// After (compiled) — every field is determinate, so a hint is injected:
c.encode({ name: 'login', active: true }, { schema: [{ name: 'active', type: 'boolean' }, { name: 'name', type: 'string' }] });
```

Because parity-or-omit never ships a hint that could diverge from runtime inference, "identical
behavior" is now literally true: a hinted call and its uncompiled equivalent always produce the
same bytes. Without the compiler, the codec infers the schema from the value's runtime types —
identical behavior, one extra inference step on first encounter.

## Validators (Compile-Time)

Validators require the build-time transformer. With it, `validator.build()`, `validator.set()`,
and `validator.toJsonSchema()` calls are consumed at compile time and replaced with generated
code. Without it, all three throw a stub error at runtime.

### Build Tool Setup

#### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import data from '@esportsplus/data/compiler/vite';

export default defineConfig({
    plugins: [data]
});
```

#### tsc (via ts-patch)

Standard `tsc` doesn't support custom transformers. Use [ts-patch](https://github.com/nonara/ts-patch):

```bash
npm install ts-patch -D
npx ts-patch install
```

```json
// tsconfig.json
{
    "compilerOptions": {
        "plugins": [
            { "transform": "@esportsplus/data/compiler/tsc" }
        ]
    }
}
```

### Quick Start

```typescript
import { validator } from '@esportsplus/data';

type User = {
    name: string;
    age: number;
    email?: string;
};

// validator.build<T>() returns a plain object: { validate, toJsonSchema }
const v = validator.build<User>();

const result = v.validate({
    name: 'John',
    age: 25
});

if (result.ok) {
    console.log(result.data); // Typed as User
}
else {
    console.log(result.errors); // ValidationError[]
}

v.toJsonSchema(); // draft 2020-12 JSON Schema for User
```

### Supported Types

#### Primitives

```typescript
type Data = {
    name: string;
    age: number;
    count: bigint;
    active: boolean;
};
```

#### Branded Types

Use `integer` and `float` for numeric validation:

```typescript
import type { integer, float } from '@esportsplus/data';

type Product = {
    quantity: integer;  // Must be whole number
    price: float;       // Nominal brand for numeric intent — stored as float64, no 32-bit rounding
};
```

#### Optional & Nullable

```typescript
type User = {
    name: string;
    nickname?: string;      // Optional - skipped if undefined
    deletedAt: Date | null; // Nullable - accepts null
    bio: string | null;     // Nullable string
};
```

#### Arrays

```typescript
type Data = {
    tags: string[];
    scores: number[];
    users: User[];
};
```

#### Nested Objects

```typescript
type User = {
    profile: {
        bio: string;
        settings: {
            theme: string;
        };
    };
};
```

#### Union Types

```typescript
type Config = {
    mode: 'development' | 'production';
    level: 1 | 2 | 3;
    id: string | number;
};
```

#### Literal Types

```typescript
type Config = {
    version: 1;
    type: 'admin';
    enabled: true;
};
```

#### Enums

```typescript
enum Status {
    Pending = 0,
    Active = 1,
    Closed = 2
}

type Task = {
    status: Status;
};
```

#### Tuples

```typescript
type Point = {
    coords: [number, number];
    data: [string, number, boolean];
};
```

#### Date

```typescript
type Event = {
    createdAt: Date;
};
```

#### Record / Index Signatures

```typescript
type Config = {
    settings: Record<string, number>;
    headers: { [key: string]: string };
};
```

#### Utility Types

```typescript
type Base = { a?: string; b?: number };
type Required = Required<Base>;  // Both a and b are required
type Partial = Partial<Base>;    // Both a and b are optional
```

#### any / unknown

Properties typed as `any` or `unknown` pass through without validation:

```typescript
type Flexible = {
    id: number;
    metadata: any;      // Kept as-is
    payload: unknown;   // Kept as-is
};
```

#### never

Properties typed as `never` are excluded from output:

```typescript
type Data = {
    id: number;
    _internal: never;  // Removed from output
};
```

### Custom Validators

Add custom validation logic:

```typescript
import { validator } from '@esportsplus/data';
import { min, max, range } from '@esportsplus/data/validators';

type User = {
    name: string;
    age: number;
    email: string;
};

const v = validator.build<User>({
    name: min(2, 'Name must be at least 2 characters'),
    age: range(18, 120, 'Must be between 18 and 120'),
    email: (value, errors) => {
        if (!value.includes('@')) {
            errors.push('Invalid email format');
        }
    }
});
```

Built-in validators live at `@esportsplus/data/validators` (never the package root — the root
export surface is only `codec`, `validator`, and shared types).

#### Built-in Validators

`@esportsplus/data/validators` ships many more assertions (string format, numeric bounds, IDs,
...) beyond this short list — `min`/`max`/`range`, plus `trim`/`normalize`, are the ones this
README documents by name:

| Validator | Description |
|-----------|-------------|
| `min(n)` | Minimum value/length |
| `max(n)` | Maximum value/length |
| `range(min, max)` | Value/length between min and max |
| `trim()` / `trim.start()` / `trim.end()` | Asserts the string has no leading/trailing whitespace (does not trim it) |
| `normalize()` / `.nfd()` / `.nfkc()` / `.nfkd()` | Asserts the string is already Unicode-normalized in the given form (does not normalize it) |

`trim`/`normalize` are **assertions**, not transforms: they push an error when the input isn't
already in the expected form; they never mutate the value.

#### Multiple Validators

```typescript
const v = validator.build<User>({
    name: [min(2), max(50)],
    age: [min(0), max(150)]
});
```

#### Async Validators

```typescript
const v = validator.build<User>({
    email: async (value, errors) => {
        const exists = await checkEmailInDatabase(value);
        if (exists) {
            errors.push('Email already registered');
        }
    }
});

// Result is a Promise when async validators are used
const result = await v.validate(data);
```

#### Annotations (`describe` / `default` / `meta`)

Built-in validators and custom validators wrapped with `fn()` carry a chainable
`.describe(text)` / `.default(value)` / `.meta(object)` annotation API. Chains are peeled at
compile time and folded into the property's JSON Schema fragment — they never run at validation
time.

```typescript
import { validator } from '@esportsplus/data';
import { fn, min, range } from '@esportsplus/data/validators';

type Profile = {
    name: string;
    age: number;
    tags: string[];
};

const v = validator.build<Profile>({
    name: min(2).describe("the user's display name"),
    age: range(18, 120).meta({ examples: [25] }),
    tags: fn((value: string[], errors) => {
        if (value.length === 0) {
            errors.push('must have at least one tag');
        }
    }).default([])
});
```

- `.describe(text)` sets the property's JSON Schema `description`.
- `.meta(object)` shallow-merges arbitrary keys (`title`, `examples`, ...) into the property schema.
- `.default(value)` sets the JSON Schema `default` AND fills the input at validation time when the
  property is `undefined`. An array/object literal default mints a **fresh** instance on every
  fill — no shared-reference mutation across calls; a scalar default reuses the literal directly.
- `fn(customValidatorFn)` attaches the same chain to a bare custom validator function so it can be
  annotated exactly like a built-in.

### Branded Type Validators

Register validators for branded types. Once registered, the validator is automatically applied wherever that branded type is used.

```typescript
// types.ts
import type { Brand } from '@esportsplus/utilities';

type UUID = Brand<string, 'UUID'>;
type Email = Brand<string, 'Email'>;

type User = {
    id: UUID;
    email: Email;
    name: string;
};
```

```typescript
// validation.ts
import { validator } from '@esportsplus/data';
import type { ErrorType } from '@esportsplus/data';
import type { UUID, Email, User } from './types';

// Register branded type validators
validator.set((value: UUID, errors: ErrorType) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        errors.push('must be a valid UUID');
    }
});

validator.set((value: Email, errors: ErrorType) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push('must be a valid email');
    }
});

// UUID and Email validators automatically applied
const v = validator.build<User>();
```

### Custom Error Messages

Override default error messages:

```typescript
const v = validator.build<User, {
    name: 'Please enter your name';
    age: 'Age must be a valid number';
}>();
```

### Validation Result

```typescript
type ValidationResult<T> =
    | { ok: true; data: T; errors: undefined }
    | { ok: false; data: unknown; errors: ValidationError[] };

type ValidationError = {
    message: string;
    path: string;
};
```

### Validator API Reference

```typescript
function build<T, TErrors extends ErrorMessages<T> = {}>(
    config?: ValidatorConfig<T>
): Schema<T>;

function toJsonSchema<T>(config?: ValidatorConfig<T>): JsonSchema;

type Schema<T> = {
    toJsonSchema(): JsonSchema;
    validate: ValidatorFn<T>;
};

type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;
```

```typescript
function set<T extends BrandBase>(
    fn: (value: T, errors: ErrorType) => void | Promise<void>
): void;
```

Built-in validators (imported from `@esportsplus/data/validators`, not the package root):

```typescript
function min(value: number, message?: string): ValidatorFunction<unknown>;
function max(value: number, message?: string): ValidatorFunction<unknown>;
function range(min: number, max: number, message?: string): ValidatorFunction<unknown>;
```

### How Validators Work

At compile time, the transformer:

1. Detects `validator.build<T>()` calls
2. Analyzes the TypeScript type `T`
3. Generates an optimized validation function plus a JSON Schema for `T`
4. Replaces the call with a hoisted `{ toJsonSchema, validate }` object literal

**Before (source):**
```typescript
type User = {
    name: string;
    age: number;
    email?: string;
};

const v = validator.build<User>();
```

**After (compiled)** — real transformer output for the type above, reformatted for readability
(hoisted names are generator-assigned and will differ run to run):
```javascript
const schema = {"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false,"properties":{"age":{"type":"number"},"email":{"type":"string"},"name":{"type":"string"}},"required":["age","name"],"type":"object"};

const v = {
    toJsonSchema: () => schema,
    validate: (_input) => {
        let _errors, _output;

        if (_input === null || typeof _input !== 'object' || Array.isArray(_input)) {
            (_errors ??= []).push({ message: 'must be an object', path: '' });

            return { ok: false, data: _input, errors: _errors };
        }

        _output = {};

        {
            let n = (typeof _input.age === 'number' || (typeof _input.age === 'string' && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(_input.age))) ? +_input.age : NaN;

            if (!isFinite(n)) {
                (_errors ??= []).push({ message: 'must be a number', path: 'age' });
            }
            else {
                _output.age = n;
            }
        }

        if (_input.email !== undefined) {
            if (typeof _input.email !== 'string') {
                (_errors ??= []).push({ message: 'must be a string', path: 'email' });
            }
            else {
                _output.email = _input.email;
            }
        }

        if (typeof _input.name !== 'string') {
            (_errors ??= []).push({ message: 'must be a string', path: 'name' });
        }
        else {
            _output.name = _input.name;
        }

        if (_errors && _errors.length > 0) {
            return { ok: false, data: _input, errors: _errors };
        }

        return { ok: true, data: _output, errors: undefined };
    }
};
```

Note the emitted error array is `_errors` (plural) and property checks run in alphabetical
property order (`age`, `email`, `name`), not declaration order — both are generator details, not
guarantees to code against.

**Generated validator optimizations:**

- **Lazy error allocation**: Error array only created when errors occur
- **Number coercion**: strings-only — decimal/scientific numeric forms (`/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/`) coerce to `number`; no hex, no empty/whitespace-only strings, no booleans/arrays/objects. (Divergence from zod: `z.number()` does not coerce by default — this package always attempts numeric/boolean coercion for `number`/`boolean`-typed fields.)
- **Boolean coercion**: `'true'`, `1`, `'1'` coerce to `true`; `'false'`, `0`, `'0'` coerce to `false`
- **Inline extraction**: copies only known properties into a fresh output object; a `__proto__`-named property is written via `Object.defineProperty` as an own enumerable property, so it can never mutate the output's prototype (prevents prototype pollution)
- **Conditional async**: Only async when custom validators require it
- **Pre-computed paths**: Static error paths computed at compile time

### Runtime Schema Builder (no compiler)

`@esportsplus/data/runtime` builds JSON Schema fragments programmatically for shapes whose exact
literals are only known at runtime — e.g. an enum sourced from a database — and converts them to a
draft 2020-12 JSON Schema. It does not validate input itself; combine it with an external JSON
Schema validator, or model runtime-known shapes structurally in your own code.

```typescript
import { schema, toJsonSchema } from '@esportsplus/data/runtime';

// Ids fetched at runtime — not a compile-time literal union
let roleIds = await fetchRoleIds(); // ['admin', 'editor', 'viewer']

let userSchema = schema.object({
    id: schema.string(),
    role: schema.enum(roleIds)
});

toJsonSchema(userSchema);
// {
//     $schema: 'https://json-schema.org/draft/2020-12/schema',
//     additionalProperties: false,
//     properties: { id: { type: 'string' }, role: { enum: ['admin', 'editor', 'viewer'] } },
//     required: ['id', 'role'],
//     type: 'object'
// }
```

`schema` also exposes `array`, `boolean`, `literal`, `number`, `record`, `union`, and `unknown`
node builders, each accepting an optional `{ default, description, nullable, optional }` options
object.

### Build Output Residue Check

The transformer replaces every `validator.build()` / `.set()` / `.toJsonSchema()` call it detects
and throws at build time if one survives untransformed (a missing type argument, for example) —
but that only catches call sites, not a misconfigured build tool that skips the plugin file
entirely. `@esportsplus/data/compiler/residue` scans emitted `.js` output for surviving
`validator.*` calls or a root import binding the compile-time-only `validator` export, so wire it
into your own `build` / `prepublishOnly` script as a second, independent check:

```javascript
// check-residue.mjs
import { assertNoResidue } from '@esportsplus/data/compiler/residue';

assertNoResidue('build'); // throws, naming file:line:col, if a validator.* call escaped the transform
```

```json
{
    "scripts": {
        "build": "tsc -p tsconfig.build.json && node check-residue.mjs",
        "prepublishOnly": "pnpm build"
    }
}
```

## Requirements

- TypeScript >= 5.0
- **Validators**: Build tool with transformer support (Vite or ts-patch)
- **Binary Codec**: No build tool required — works at runtime. Compiler plugin is an optional optimization.