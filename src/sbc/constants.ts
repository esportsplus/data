const INT64_MIN = -(2n ** 63n);

const INT64_OVERFLOW = 2n ** 63n;

const MAX_ARRAY_COUNT = 1048576; // 2^20 — guard against DoS from untrusted u32 counts

const MAX_SCHEMA_COUNT = 1024; // guard against DoS from untrusted u16 schema count

// Wire-format version. Bumped whenever the byte layout or the schema-hash derivation
// changes in a way that is not back-compatible:
//   v1 — delimiter-joined shape hash (0xFF/0xFE ambiguous) + object-ref layout chosen by
//        local registration order.
//   v2 — length-prefixed shape hash (unambiguous) + one canonical object-ref layout
//        (varint length-prefixed child payload, resolved by refHash at runtime when the
//        child is not locally compiled) + explicit payload-end bounds + a compiled-path
//        depth budget. Mixed into computeShapeHash so every prior hash is retired.
const WIRE_VERSION = 2;


// FNV-1a
const FNV_OFFSET = 0x811c9dc5 | 0;

const FNV_PRIME = 0x01000193 | 0;

const FIELD_SIZES: Record<string, number> = {
    boolean: 1,
    date: 8,
    float64: 8,
    int8: 1,
    int16: 2,
    int32: 4,
    int64: 8,
    uint8: 1,
    uint16: 2,
    uint32: 4,
};

const KNOWN_TYPES: Record<string, number> = {
    array: 1,
    boolean: 1,
    bytes: 1,
    date: 1,
    float64: 1,
    int8: 1,
    int16: 1,
    int32: 1,
    int64: 1,
    mixed: 1,
    object: 1,
    string: 1,
    typedarray: 1,
    uint8: 1,
    uint16: 1,
    uint32: 1,
};


export { FIELD_SIZES, FNV_OFFSET, FNV_PRIME, INT64_MIN, INT64_OVERFLOW, KNOWN_TYPES, MAX_ARRAY_COUNT, MAX_SCHEMA_COUNT, WIRE_VERSION };
