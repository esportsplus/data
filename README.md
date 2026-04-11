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

// Maps, Sets, Uint8Array, typed arrays
c.encode(new Map([['key', 'value']]));
c.encode(new Set([1, 2, 3]));
c.encode(new Uint8Array([0xFF, 0x00]));
c.encode(new Float64Array([1.1, 2.2]));
```

### Wire Format

| Value Type | Tag | Wire Format |
|------------|-----|-------------|
| `null` / `undefined` | 0 | Tag only |
| `boolean` | 1/2 | Tag only (1=false, 2=true) |
| `uint8` (0–255) | 3 | 1 byte |
| `float64` | 4 | 8 bytes |
| `string` | 5 | u32 length + UTF-8 |
| `Uint8Array` | 6 | u32 length + raw bytes |
| `Array` | 7 | u32 count + tagged elements |
| `object` | 8 | u32 hash + u32 length + compiled fields |
| `bigint` | 9 | 8 bytes |
| `Date` | 10 | f64 (timestamp) |
| `int32` | 11 | 4 bytes |
| packed `Uint8Array[]` | 12 | u32 count + raw bytes |
| packed `Float64Array[]` | 13 | u32 count + raw f64s |
| packed `Int32Array[]` | 14 | u32 count + raw i32s |
| `Map` | 15 | u32 count + key/value pairs |
| `Set` | 16 | u32 count + elements |
| typed array | 17 | u8 typeId + u32 byteLen + raw bytes |
| compressed object | 18 | u32 hash + u32 length + packed fields |

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
| `bigint` | 64-bit signed |
| `string` | UTF-8 string |
| `bytes` | Raw bytes (Uint8Array) |
| `date` | Date object (stored as f64) |
| `array` | Generic array |
| `array<T>` | Typed array (e.g. `array<uint8>`) |
| `object(hash)` | Nested object referencing another schema |
| `map` | Map / Record |
| `set` | Set |
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

### View Mode (Zero-Copy Encode)

Return a subarray of the internal buffer instead of copying:

```typescript
let c = codec();

// view=true — zero-copy, but invalidated by next encode() call
let view = c.encode({ x: 1 }, true);

// Or via options
let view2 = c.encode({ x: 1 }, { view: true });
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

When using the compiler plugin, type-parameterized `encode<T>()` and `decode<T>()` calls are transformed to inject schema hints automatically:

```typescript
type Point = { x: number; y: number };

// Before (source):
c.encode<Point>({ x: 1, y: 2 });

// After (compiled):
c.encode({ x: 1, y: 2 }, { schema: [{ name: 'x', type: 'float64' }, { name: 'y', type: 'float64' }] });
```

This skips runtime type inference on the first encode of a shape. Without the compiler, the codec infers the schema from the value's runtime types — identical behavior, one extra inference step on first encounter.

## Validators (Compile-Time)

Validators require the build-time transformer. Without it, `validator.build()` and `validator.set()` throw.

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

// Validator is generated at compile time
const validate = validator.build<User>();

const result = validate({
    name: 'John',
    age: 25
});

if (result.ok) {
    console.log(result.data); // Typed as User
}
else {
    console.log(result.errors); // ValidationError[]
}
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
    price: float;       // 32-bit float (for codec)
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
import { validator, min, max, range } from '@esportsplus/data';

type User = {
    name: string;
    age: number;
    email: string;
};

const validate = validator.build<User>({
    name: min(2, 'Name must be at least 2 characters'),
    age: range(18, 120, 'Must be between 18 and 120'),
    email: (value, errors) => {
        if (!value.includes('@')) {
            errors.push('Invalid email format');
        }
    }
});
```

#### Built-in Validators

| Validator | Description |
|-----------|-------------|
| `min(n)` | Minimum value/length |
| `max(n)` | Maximum value/length |
| `range(min, max)` | Value/length between min and max |

#### Multiple Validators

```typescript
const validate = validator.build<User>({
    name: [min(2), max(50)],
    age: [min(0), max(150)]
});
```

#### Async Validators

```typescript
const validate = validator.build<User>({
    email: async (value, errors) => {
        const exists = await checkEmailInDatabase(value);
        if (exists) {
            errors.push('Email already registered');
        }
    }
});

// Result is a Promise when async validators are used
const result = await validate(data);
```

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
const validate = validator.build<User>();
```

### Custom Error Messages

Override default error messages:

```typescript
const validate = validator.build<User, {
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
): ValidatorFn<T>;

type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;
```

```typescript
function set<T extends BrandBase>(
    fn: (value: T, errors: ErrorType) => void | Promise<void>
): void;
```

```typescript
function min(value: number, message?: string): ValidatorFunction<unknown>;
function max(value: number, message?: string): ValidatorFunction<unknown>;
function range(min: number, max: number, message?: string): ValidatorFunction<unknown>;
```

### How Validators Work

At compile time, the transformer:

1. Detects `validator.build<T>()` calls
2. Analyzes the TypeScript type `T`
3. Generates an optimized validation function
4. Replaces the call with the generated function

**Before (source):**
```typescript
const validate = validator.build<User>();
```

**After (compiled):**
```javascript
const validate = (_input) => {
    let _error;

    if (typeof _input.name !== 'string') {
        (_error ??= []).push({ message: 'must be a string', path: 'name' });
    }
    if (typeof _input.age !== 'number' && isNaN(_input.age = +_input.age)) {
        (_error ??= []).push({ message: 'must be a number', path: 'age' });
    }

    if (_error) {
        return { ok: false, data: _input, errors: _error };
    }

    return { ok: true, data: { age: _input.age, name: _input.name }, errors: undefined };
};
```

**Generated validator optimizations:**

- **Lazy error allocation**: Error array only created when errors occur
- **Number coercion**: Strings automatically coerced to numbers
- **Boolean coercion**: Strings/numbers coerced to booleans
- **Inline extraction**: Copies only known properties (prevents prototype pollution)
- **Conditional async**: Only async when custom validators require it
- **Pre-computed paths**: Static error paths computed at compile time

## Requirements

- TypeScript >= 5.0
- **Validators**: Build tool with transformer support (Vite or ts-patch)
- **Binary Codec**: No build tool required — works at runtime. Compiler plugin is an optional optimization.