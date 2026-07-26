import type { StoredSchema } from './cache';


type CodecOptions = {
    compress?: boolean;
    store?: PersistentStore;
};

type DecodeOptions = {
    schema?: number | FieldSpec[];
};

// Recursive constraint for encode/computeSize, applied as `value: T & Encodable<T>`
// (naked `T` drives inference; the intersection validates, sidestepping the circular
// constraint an `extends` bound would raise). Expressed as a validating mapped
// conditional over a generic `T` — a bare `{ [key: string]: Encodable }` index
// signature would reject interface-typed values (TS gives them no implicit index
// signature), while the mapped `{ [K in keyof T]: … }` form resolves an interface's
// members and accepts it. Anything whose members are not themselves Encodable
// (Map/Set/WeakMap/RegExp/Promise/class methods/functions/symbols) collapses to a
// `never` member, so the argument fails to assign at the call site. `any`/`unknown`
// (including `Record<string, unknown>` values) pass the static gate — the type cannot
// prove them unsupported — and rely on the runtime unrepresentable-value backstop.
type Encodable<T> =
    unknown extends T
        ? T
        : T extends EncodablePrimitive
            ? T
            : T extends readonly (infer U)[]
                ? readonly Encodable<U>[]
                : T extends (...args: never[]) => unknown
                    ? never
                    : T extends object
                        ? { [K in keyof T]: Encodable<T[K]> }
                        : never;

type EncodablePrimitive =
    | ArrayBufferView
    | bigint
    | boolean
    | Date
    | null
    | number
    | string
    | undefined;

type EncodeOptions = {
    schema?: number | FieldSpec[];
    /**
     * When `true`, returns a live `subarray` alias of the internal encode buffer
     * instead of copying into a new `Uint8Array`. This avoids an allocation but
     * the returned slice is **borrowed** — the next `encode()` call on the same
     * codec instance overwrites the underlying buffer, mutating the previously
     * returned view in place.
     *
     * Caller must `.slice()` or fully consume the bytes before calling `encode()`
     * again. Failure to do so causes data corruption / cross-message leakage in
     * pipelined scenarios.
     */
    view?: boolean;
};

type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: string;
};

type PersistentStore = {
    get(hash: number): StoredSchema | null;
    set(hash: number, schema: StoredSchema): void;
};

type SchemaRegistry = {
    byNameHash: Map<number, import('./codegen').Schema[]>;
    nextId: number;
    schemas: Map<number, import('./codegen').Schema>;
};


export type { CodecOptions, DecodeOptions, Encodable, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry };
