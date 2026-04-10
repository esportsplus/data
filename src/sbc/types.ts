import type { StoredSchema } from './cache';


type CodecOptions = {
    compress?: boolean;
    store?: PersistentStore;
};

type DecodeOptions = {
    schema?: number | FieldSpec[];
};

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
    nextId: number;
    schemas: Map<number, import('./codegen').Schema>;
};


export type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry };
