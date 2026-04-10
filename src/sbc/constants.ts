const FIELD_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const MAX_ARRAY_COUNT = 1048576; // 2^20 — guard against DoS from untrusted u32 counts

const MAX_SCHEMA_COUNT = 1024; // guard against DoS from untrusted u16 schema count


// FNV-1a
const FNV_OFFSET = 0x811c9dc5 | 0;

const FNV_PRIME = 0x01000193 | 0;

const FIELD_SIZES: Record<string, number> = {
    bigint: 8,
    boolean: 1,
    date: 8,
    float64: 8,
    int8: 1,
    int16: 2,
    int32: 4,
    uint8: 1,
    uint16: 2,
    uint32: 4,
};

const KNOWN_TYPES: Record<string, number> = {
    array: 1,
    bigint: 1,
    boolean: 1,
    bytes: 1,
    date: 1,
    float64: 1,
    int8: 1,
    int16: 1,
    int32: 1,
    map: 1,
    mixed: 1,
    object: 1,
    set: 1,
    string: 1,
    typedarray: 1,
    uint8: 1,
    uint16: 1,
    uint32: 1,
};


export { FIELD_NAME_RE, FIELD_SIZES, FNV_OFFSET, FNV_PRIME, KNOWN_TYPES, MAX_ARRAY_COUNT, MAX_SCHEMA_COUNT };
