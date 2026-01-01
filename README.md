# @esportsplus/data

Compile-time TypeScript validation and binary encoding with zero runtime overhead. Validators and codecs are generated at build time from your TypeScript types.

## Features

- **Zero Runtime Overhead**: Validators and codecs generated at compile time
- **Type-Safe**: Full TypeScript type inference
- **No Schema Duplication**: Use your existing TypeScript types
- **Multiple Build Tools**: Support for Vite, esbuild, and tsc
- **Custom Validators**: Add sync/async validation logic
- **Branded Type Validators**: Register validators for branded types
- **Binary Codec**: Encode/decode TypeScript types to protobuf-style binary

## Installation

```bash
npm install @esportsplus/data
```

## Quick Start

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

## Build Tool Setup

The library requires a build-time transformer. Choose one based on your setup:

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { plugin } from '@esportsplus/data';

export default defineConfig({
    plugins: [plugin()]
});
```

### esbuild

```typescript
// build.ts
import * as esbuild from 'esbuild';
import { plugin } from '@esportsplus/data/esbuild';

await esbuild.build({
    entryPoints: ['src/index.ts'],
    outdir: 'dist',
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [plugin()]
});
```

### tsc (via ts-patch)

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
            { "transform": "@esportsplus/data/transformer" }
        ]
    }
}
```

## Supported Types

### Primitives

```typescript
type Data = {
    name: string;
    age: number;
    count: bigint;
    active: boolean;
};
```

### Branded Types

Use `integer` and `float` for numeric validation:

```typescript
import type { integer, float } from '@esportsplus/data';

type Product = {
    quantity: integer;  // Must be whole number
    price: float;       // 32-bit float (for codec)
};
```

### Optional & Nullable

```typescript
type User = {
    name: string;
    nickname?: string;      // Optional - skipped if undefined
    deletedAt: Date | null; // Nullable - accepts null
    bio: string | null;     // Nullable string
};
```

### Arrays

```typescript
type Data = {
    tags: string[];
    scores: number[];
    users: User[];
};
```

### Nested Objects

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

### Union Types

```typescript
type Config = {
    mode: 'development' | 'production';
    level: 1 | 2 | 3;
    id: string | number;
};
```

### Literal Types

```typescript
type Config = {
    version: 1;
    type: 'admin';
    enabled: true;
};
```

### Enums

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

### Tuples

```typescript
type Point = {
    coords: [number, number];
    data: [string, number, boolean];
};
```

### Date

```typescript
type Event = {
    createdAt: Date;
};
```

### Record / Index Signatures

```typescript
type Config = {
    settings: Record<string, number>;
    headers: { [key: string]: string };
};
```

### Utility Types

```typescript
type Base = { a?: string; b?: number };
type Required = Required<Base>;  // Both a and b are required
type Partial = Partial<Base>;    // Both a and b are optional
```

### any / unknown

Properties typed as `any` or `unknown` pass through without validation:

```typescript
type Flexible = {
    id: number;
    metadata: any;      // Kept as-is
    payload: unknown;   // Kept as-is
};
```

### never

Properties typed as `never` are excluded from output:

```typescript
type Data = {
    id: number;
    _internal: never;  // Removed from output
};
```

## Custom Validators

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

### Built-in Validators

| Validator | Description |
|-----------|-------------|
| `min(n)` | Minimum value/length |
| `max(n)` | Maximum value/length |
| `range(min, max)` | Value/length between min and max |

### Multiple Validators

```typescript
const validate = validator.build<User>({
    name: [min(2), max(50)],
    age: [min(0), max(150)]
});
```

### Async Validators

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

## Branded Type Validators

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

## Custom Error Messages

Override default error messages:

```typescript
const validate = validator.build<User, {
    name: 'Please enter your name';
    age: 'Age must be a valid number';
}>();
```

## Validation Result

```typescript
type ValidationResult<T> =
    | { ok: true; data: T; errors: undefined }
    | { ok: false; data: unknown; errors: ValidationError[] };

type ValidationError = {
    message: string;
    path: string;
};
```

### Usage

```typescript
const result = validate(input);

if (result.ok) {
    // result.data is typed as T
    console.log(result.data.name);
}
else {
    // result.errors is ValidationError[]
    for (const error of result.errors) {
        console.log(`${error.path}: ${error.message}`);
    }
}
```

## Binary Codec

Encode and decode TypeScript types to/from binary (protobuf-style encoding):

```typescript
import { codec } from '@esportsplus/data';
import type { integer } from '@esportsplus/data';

type Message = {
    id: integer;
    text: string;
    timestamp: bigint;
};

// Generated at compile time
const messageCodec = codec<Message>();

// Encode to binary
const buffer: Uint8Array = messageCodec.encode({
    id: 1,
    text: 'Hello',
    timestamp: 1234567890n
});

// Decode from binary
const message: Message = messageCodec.decode(buffer);
```

### Default Values

Provide defaults for optional properties when decoding:

```typescript
type Config = {
    host: string;
    port?: integer;
    debug?: boolean;
};

const configCodec = codec<Config>({
    port: 8080,
    debug: false
});

// Missing optional fields get default values
const config = configCodec.decode(buffer);
```

### Supported Types for Codec

| TypeScript Type | Wire Format |
|-----------------|-------------|
| `boolean` | Varint (0 or 1) |
| `number` | Double (64-bit float) |
| `integer` | Varint (32-bit signed) |
| `float` | Fixed32 (32-bit float) |
| `bigint` | Varint (64-bit signed) |
| `string` | Length-delimited UTF-8 |
| `T[]` | Packed repeated |
| `{ ... }` | Embedded message |

## How It Works

At compile time, the transformer:

1. Detects `validator.build<T>()` and `codec<T>()` calls
2. Analyzes the TypeScript type `T`
3. Generates optimized validation/encoding code
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

## Performance

Generated validators are highly optimized:

- **Lazy error allocation**: Error array only created when errors occur
- **Number coercion**: Strings automatically coerced to numbers
- **Boolean coercion**: Strings/numbers coerced to booleans
- **Inline extraction**: Copies only known properties (prevents prototype pollution)
- **Conditional async**: Only async when custom validators require it
- **Pre-computed paths**: Static error paths computed at compile time

## API Reference

### validator.build\<T\>()

Creates a validator function for type `T`.

```typescript
function build<T, TErrors extends ErrorMessages<T> = {}>(
    config?: ValidatorConfig<T>
): ValidatorFn<T>;

type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;
```

### validator.set()

Registers a validator for a branded type.

```typescript
function set<T extends BrandBase>(
    fn: (value: T, errors: ErrorType) => void | Promise<void>
): void;
```

### codec\<T\>()

Creates an encoder/decoder for type `T`.

```typescript
function codec<T>(defaults?: Partial<T>): Codec<T>;

type Codec<T> = {
    encode: (data: T) => Uint8Array;
    decode: (buffer: Uint8Array) => T;
};
```

### Built-in Validators

```typescript
function min(value: number, message?: string): ValidatorFunction<unknown>;
function max(value: number, message?: string): ValidatorFunction<unknown>;
function range(min: number, max: number, message?: string): ValidatorFunction<unknown>;
```

## Requirements

- TypeScript >= 5.0
- Build tool with transformer support (Vite, esbuild, or ts-patch)

## License

MIT
