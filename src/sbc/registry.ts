// Schema Binary Codec — Registry
// Schema management, lookup, inference, intern pool, schema store

import { buildSchema, buildSchemaFromDef, compileSchema, validateFieldName, validateFieldTypeString } from './codegen';
import { byteLen, FIELD_SIZES, fromUtf8, readU32, textDecoder, toUtf8, writeU32, writeUtf8 } from './platform';

import type { FieldDef, FieldType, InternDb, InternPool, Schema, SchemaRegistry, SchemaStoreInterface } from './platform';


const MAX_FIELD_COUNT = 256;

const MAX_FIELD_DEPTH = 32;

const MAX_FIELD_NAME_LENGTH = 1024;

const hasOwn = Object.prototype.hasOwnProperty;


function computeObjShapeHash(obj: Record<string, unknown>, keys: string[]): number {
    let first = true,
        hash = 0x811c9dc5;

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;

        if (obj[key] === undefined) {
            continue;
        }

        // Separator between fields (comma between key:type pairs)
        if (!first) {
            hash = fnv1aFeedChar(hash, 44); // ','
        }

        first = false;

        // Feed key name
        hash = fnv1aFeed(hash, key);

        // Feed ':' separator
        hash = fnv1aFeedChar(hash, 58); // ':'

        // Feed serialized type — serializeFieldType returns a string, feed it directly
        hash = fnv1aFeed(hash, serializeFieldType(inferFieldType(obj[key])));
    }

    return hash;
}

function createRegistry(): SchemaRegistry {
    return {
        constructorCache: new WeakMap(),
        lastSchema: null,
        nextId: 1,
        schemas: new Map(),
        schemasByCount: new Map(),
        schemasByHash: new Map(),
    };
}

// Binary format for persisting schema field definitions:
// [fieldCount: uint16] then per field: [nameLen: uint16][name: utf8][typeLen: uint16][type: utf8]
function decodeFieldDefs(bytes: Uint8Array): { name: string; type: string }[] {
    if (bytes.byteLength < 2) {
        throw new Error('SBC: truncated schema — missing field count');
    }

    let byteLength = bytes.byteLength,
        view = new DataView(bytes.buffer, bytes.byteOffset, byteLength),
        count = view.getUint16(0, true),
        offset = 2,
        result: { name: string; type: string }[] = [];

    if (count > MAX_FIELD_COUNT) {
        throw new Error('SBC: schema field count exceeds limit (' + count + ' > ' + MAX_FIELD_COUNT + ')');
    }

    for (let i = 0; i < count; i++) {
        if (offset + 2 > byteLength) {
            throw new Error('SBC: truncated schema at field ' + i + ' — missing name length');
        }

        let nameLen = view.getUint16(offset, true);

        if (nameLen > MAX_FIELD_NAME_LENGTH) {
            throw new Error('SBC: field name too long (' + nameLen + ' > ' + MAX_FIELD_NAME_LENGTH + ')');
        }

        offset += 2;

        if (offset + nameLen > byteLength) {
            throw new Error('SBC: truncated schema at field ' + i + ' — name extends beyond buffer');
        }

        let name = textDecoder.decode(bytes.subarray(offset, offset + nameLen));

        validateFieldName(name);

        offset += nameLen;

        if (offset + 2 > byteLength) {
            throw new Error('SBC: truncated schema at field ' + i + ' — missing type length');
        }

        let typeLen = view.getUint16(offset, true);

        offset += 2;

        if (offset + typeLen > byteLength) {
            throw new Error('SBC: truncated schema at field ' + i + ' — type extends beyond buffer');
        }

        let type = textDecoder.decode(bytes.subarray(offset, offset + typeLen));

        validateFieldTypeString(type);

        offset += typeLen;
        result.push({ name, type });
    }

    return result;
}

function deserializeRegistry(data: unknown[] | { schemas: unknown[]; v: number }): SchemaRegistry {
    let items: unknown[];

    if (Array.isArray(data)) {
        // Legacy bare-array format (v0)
        items = data;
    }
    else if (data && typeof data === 'object' && 'v' in data) {
        if ((data as { v: number }).v !== 1) {
            throw new Error('SBC: unknown registry version ' + (data as { v: number }).v);
        }

        items = (data as { schemas: unknown[] }).schemas;

        if (!Array.isArray(items)) {
            throw new Error('SBC: invalid registry format — expected schemas array');
        }
    }
    else {
        throw new Error('SBC: invalid registry format — expected array or versioned object');
    }

    let maxId = 0,
        registry = createRegistry();

    for (let i = 0, n = items.length; i < n; i++) {
        let def = items[i] as { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number };

        if (
            !def ||
            typeof def.hash !== 'number' ||
            typeof def.id !== 'number' ||
            typeof def.nullableCount !== 'number' ||
            !Array.isArray(def.fields)
        ) {
            throw new Error('SBC: malformed schema definition at index ' + i);
        }

        for (let j = 0, m = def.fields.length; j < m; j++) {
            let f = def.fields[j]!;

            if (!f || typeof f.name !== 'string' || typeof f.type !== 'string' || typeof f.fixedSize !== 'number') {
                throw new Error('SBC: malformed field definition at schema index ' + i + ', field index ' + j);
            }
        }

        let schema = buildSchemaFromDef(def, parseFieldType);

        insertSchema(schema, registry);
        compileSchema(schema);

        if (schema.id > maxId) {
            maxId = schema.id;
        }
    }

    registry.nextId = maxId + 1;

    // Set monomorphic state if exactly 1 schema
    if (registry.schemas.size === 1) {
        registry.lastSchema = registry.schemas.values().next().value as Schema;
    }

    return registry;
}

function encodeFieldDefs(defs: { name: string; type: string }[]): Uint8Array {
    if (defs.length > MAX_FIELD_COUNT) {
        throw new Error('SBC: schema field count exceeds limit (' + defs.length + ' > ' + MAX_FIELD_COUNT + ')');
    }

    // Single-pass: compute total size via byteLen, then write directly
    let totalSize = 2; // fieldCount header

    for (let i = 0, n = defs.length; i < n; i++) {
        let def = defs[i]!;

        totalSize += 4 + byteLen(def.name) + byteLen(def.type);
    }

    let result = new Uint8Array(totalSize),
        view = new DataView(result.buffer),
        offset = 0;

    view.setUint16(offset, defs.length, true);
    offset += 2;

    for (let i = 0, n = defs.length; i < n; i++) {
        let def = defs[i]!,
            nameLen = byteLen(def.name);

        view.setUint16(offset, nameLen, true);
        offset += 2;
        writeUtf8.call(result, def.name, offset, nameLen);
        offset += nameLen;

        let typeLen = byteLen(def.type);

        view.setUint16(offset, typeLen, true);
        offset += 2;
        writeUtf8.call(result, def.type, offset, typeLen);
        offset += typeLen;
    }

    return result;
}

function fieldTypeEqual(a: FieldType, b: FieldType): boolean {
    if (typeof a === 'string') {
        return a === b;
    }

    if (typeof b === 'string') {
        return false;
    }

    if (a.kind !== b.kind) {
        return false;
    }

    if (a.kind === 'array' && b.kind === 'array') {
        return fieldTypeEqual(a.element, b.element);
    }

    if (a.kind === 'nullable' && b.kind === 'nullable') {
        return fieldTypeEqual(a.inner, b.inner);
    }

    if (a.kind === 'object' && b.kind === 'object') {
        return a.schemaId === b.schemaId;
    }

    return false;
}

function fieldTypeSize(type: FieldType): number {
    if (typeof type === 'string') {
        return FIELD_SIZES[type] ?? 0;
    }

    return 0;
}

// Continue FNV-1a from a running hash state — feeds str char-by-char, no alloc
function fnv1aFeed(hash: number, str: string): number {
    for (let i = 0, n = str.length; i < n; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }

    return hash;
}

// Feed a single char code into FNV-1a
function fnv1aFeedChar(hash: number, ch: number): number {
    hash ^= ch;

    return (hash * 0x01000193) >>> 0;
}

function inferFieldType(value: unknown, depth: number = 0): FieldType {
    if (depth > MAX_FIELD_DEPTH) {
        return 'mixed';
    }

    if (value === null || value === undefined) {
        return { inner: 'uint8', kind: 'nullable' };
    }

    switch (typeof value) {
        case 'bigint':
            return 'bigint';
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'float64';
        case 'object': {
            if (value instanceof Date) {
                return 'date';
            }

            if (value instanceof Uint8Array) {
                return 'bytes';
            }

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    return { element: 'float64', kind: 'array' };
                }

                let elementType = inferFieldType(value[0], depth + 1);

                // Check up to 10 elements for type consistency
                for (let i = 1, n = Math.min(value.length, 10); i < n; i++) {
                    if (!fieldTypeEqual(inferFieldType(value[i], depth + 1), elementType)) {
                        return { element: 'mixed', kind: 'array' };
                    }
                }

                return { element: elementType, kind: 'array' };
            }

            return { kind: 'object', schemaId: 0 };
        }
        case 'string':
            return 'string';
        default:
            return 'string';
    }
}

function inferSchema(obj: Record<string, unknown>, registry: SchemaRegistry, sortedKeys?: string[], depth: number = 0): Schema {
    if (depth > MAX_FIELD_DEPTH) {
        throw new Error('SBC: max nesting depth exceeded');
    }

    let fields: FieldDef[] = [],
        keys = sortedKeys ?? Object.keys(obj).sort();

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;

        // Skip undefined fields — treat as absent, not as a distinct schema shape
        if (obj[key] === undefined) {
            continue;
        }

        let type = inferFieldType(obj[key], depth);

        fields.push({
            fixedSize: fieldTypeSize(type),
            name: key,
            offset: 0,
            type,
        });
    }

    return buildSchema(fields, computeObjShapeHash(obj, keys), registry.nextId);
}

function insertSchema(schema: Schema, registry: SchemaRegistry): void {
    registry.schemas.set(schema.id, schema);
    registry.schemasByHash.set(schema.hash, schema);

    let count = schema.fields.length,
        bucket = registry.schemasByCount.get(count);

    if (bucket) {
        bucket.push(schema);
    }
    else {
        registry.schemasByCount.set(count, [schema]);
    }
}

const lookupSchema = (obj: Record<string, unknown>, registry: SchemaRegistry, outKeys?: string[][]): Schema | null => {
    // Tier 1: Constructor-keyed cache (non-plain objects only)
    let ctor = obj.constructor;

    if (ctor !== Object && ctor !== undefined) {
        let cached = registry.constructorCache.get(ctor);

        if (cached) {
            return cached;
        }
    }

    // Tier 2: Monomorphic fast path — single schema, verify via property lookups (no sort/join)
    if (registry.lastSchema !== null) {
        let schema = registry.lastSchema,
            fields = schema.fields,
            n = fields.length;

        // Verify all schema fields are defined in obj — N property lookups, no alloc
        let match = true;

        for (let i = 0; i < n; i++) {
            if (obj[fields[i]!.name] === undefined) {
                match = false;
                break;
            }
        }

        if (match) {
            // Count own defined fields without allocating Object.keys array
            let defined = 0;

            for (let k in obj) {
                if (hasOwn.call(obj, k) && obj[k] !== undefined) {
                    defined++;
                }
            }

            if (defined === n) {
                if (ctor !== Object && ctor !== undefined) {
                    registry.constructorCache.set(ctor, schema);
                }

                return schema;
            }
        }

        // lastSchema non-null iff exactly 1 schema registered; mismatch = no match possible
        return null;
    }

    // Tier 3: Field-count prefilter — narrow candidates by defined field count
    let count = 0;

    for (let k in obj) {
        if (hasOwn.call(obj, k) && obj[k] !== undefined) {
            count++;
        }
    }

    let bucket = registry.schemasByCount.get(count);

    if (!bucket) {
        return null;
    }

    // Sorted keys needed for deterministic hash — deferred past count prefilter
    let keys = Object.keys(obj).sort();

    if (outKeys) {
        outKeys[0] = keys;
    }

    // Hash lookup — distinguishes schemas by field names AND types
    let hash = computeObjShapeHash(obj, keys),
        schema = registry.schemasByHash.get(hash) ?? null;

    if (schema && !verifySchemaFields(obj, schema)) {
        // FNV-1a collision — different field names, same hash
        return null;
    }

    if (schema && ctor !== Object && ctor !== undefined) {
        registry.constructorCache.set(ctor, schema);
    }

    return schema;
};

function parseFieldType(str: string, depth: number = 0): FieldType {
    if (depth > MAX_FIELD_DEPTH) {
        throw new Error('SBC: field type nesting exceeds maximum depth (' + MAX_FIELD_DEPTH + '): ' + str);
    }

    if (str.startsWith('array<') && str.endsWith('>')) {
        return { element: parseFieldType(str.slice(6, -1), depth + 1), kind: 'array' };
    }

    if (str.startsWith('nullable<') && str.endsWith('>')) {
        return { inner: parseFieldType(str.slice(9, -1), depth + 1), kind: 'nullable' };
    }

    if (str.startsWith('object(') && str.endsWith(')')) {
        return { kind: 'object', schemaId: parseInt(str.slice(7, -1), 10) };
    }

    return str as FieldType;
}

function registerSchema(schema: Schema, registry: SchemaRegistry): void {
    schema.id = registry.nextId++;
    insertSchema(schema, registry);

    // Maintain monomorphic state
    if (registry.schemas.size === 1) {
        registry.lastSchema = schema;
    }
    else {
        registry.lastSchema = null;
    }
}

const resolveSchema = (obj: Record<string, unknown>, registry: SchemaRegistry): Schema => {
    let keysOut: string[][] = [],
        existing = lookupSchema(obj, registry, keysOut);

    if (existing) {
        return existing;
    }

    let schema = inferSchema(obj, registry, keysOut[0]);

    registerSchema(schema, registry);

    // Populate constructor cache for the newly registered schema
    let ctor = obj.constructor;

    if (ctor !== Object && ctor !== undefined) {
        registry.constructorCache.set(ctor, schema);
    }

    return schema;
};

function serializeFieldType(type: FieldType): string {
    if (typeof type === 'string') {
        return type;
    }

    if (type.kind === 'array') {
        return 'array<' + serializeFieldType(type.element) + '>';
    }

    if (type.kind === 'nullable') {
        return 'nullable<' + serializeFieldType(type.inner) + '>';
    }

    if (type.kind === 'object') {
        return 'object(' + type.schemaId + ')';
    }

    throw new Error('SBC: unknown field type kind: ' + (type as { kind: string }).kind);
}

function serializeRegistry(registry: SchemaRegistry): { schemas: unknown[]; v: 1 } {
    let result: unknown[] = [];

    registry.schemas.forEach((schema) => {
        result.push({
            fields: schema.fields.map((f) => ({
                fixedSize: f.fixedSize,
                name: f.name,
                type: serializeFieldType(f.type),
            })),
            hash: schema.hash,
            id: schema.id,
            nullableCount: schema.nullableCount,
        });
    });

    return { schemas: result, v: 1 };
}

// Verify all schema field names are defined in obj — N property lookups, no alloc
function verifySchemaFields(obj: Record<string, unknown>, schema: Schema): boolean {
    let fields = schema.fields;

    for (let i = 0, n = fields.length; i < n; i++) {
        if (obj[fields[i]!.name] === undefined) {
            return false;
        }
    }

    return true;
}


const createSchemaStore = (db: { getBinary(key: unknown): Uint8Array | undefined; putSync(key: unknown, value: unknown): boolean; transactionSync<T>(fn: () => T): T }, prefix?: string): SchemaStoreInterface => {
    let cache = new Map<number, Schema>(),
        helpers = {
            decodeSbc: ((_buf: Uint8Array, _offset: number, _len: number): unknown => { throw new Error('SBC: codec not initialized — call createCodec() before using schema store'); }) as (buf: Uint8Array, offset: number, len: number) => unknown,
            encodeSbc: ((_value: unknown, _buf: Uint8Array, _pos: number): number => { throw new Error('SBC: codec not initialized — call createCodec() before using schema store'); }) as (value: unknown, buf: Uint8Array, pos: number) => number,
        },
        internDecode = undefined as ((buf: Uint8Array, pos: number) => string) | undefined,
        internEncode = undefined as ((field: string, value: string, buf: Uint8Array, pos: number) => number) | undefined,
        internFields = undefined as Set<string> | undefined,
        keyPrefix = prefix ? prefix + ':' : '',
        reg = createRegistry();

    return {
        get(hash: number): Schema | null {
            let cached = cache.get(hash);

            if (cached) {
                return cached;
            }

            // Fetch from schema DB — uses getBinary (copies buffer, no clobbering)
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + hash) as unknown as never);
            }
            catch {
                return null;
            }

            if (!bytes) {
                return null;
            }

            let defs: { name: string; type: string }[];

            try {
                defs = decodeFieldDefs(bytes);
            }
            catch {
                return null;
            }

            // Build schema from persisted field definitions
            let fields: FieldDef[] = defs.map((d) => {
                let type = parseFieldType(d.type);

                return { fixedSize: fieldTypeSize(type), name: d.name, offset: 0, type };
            });

            let schema = buildSchema(fields, hash, reg.nextId);

            registerSchema(schema, reg);
            compileSchema(schema, reg, helpers, false, internFields, internEncode, internDecode, lookupSchema);
            cache.set(hash, schema);

            return schema;
        },

        getCached(hash: number): Schema | null {
            return cache.get(hash) ?? null;
        },

        has(hash: number): boolean {
            return cache.has(hash);
        },

        register(hash: number, schema: Schema): void {
            cache.set(hash, schema);

            let encoded = encodeFieldDefs(schema.fields.map((f) => ({
                name: f.name,
                type: serializeFieldType(f.type),
            })));

            // Persist to schema DB. Use try/catch — may fail if called during
            // nested transactionSync (encode within user's transactionSync).
            // Schema DB is a separate DBI so transactionSync is safe from the
            // main thread outside write transactions.
            try {
                db.transactionSync(() => {
                    db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                });
            }
            catch {
                // If sync fails (nested txn), defer via microtask
                queueMicrotask(() => {
                    try {
                        db.transactionSync(() => {
                            db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                        });
                    }
                    catch (e) {
                        console.error('SBC: schema persistence failed for hash ' + hash, e);
                    }
                });
            }
        },

        // Called by createCodec to wire up the decode/encode helpers after creation
        _setHelpers(h: typeof helpers) {
            helpers.decodeSbc = h.decodeSbc;
            helpers.encodeSbc = h.encodeSbc;
        },

        _setIntern(pool: InternPool) {
            internDecode = pool.decode;
            internEncode = pool.encode;
            internFields = pool.fields;
        },
    } as SchemaStoreInterface;
};

const DEFAULT_INTERN_MAX_SIZE = 10000;

// Evict oldest entries from the intern pool until size <= maxSize.
// Uses Map insertion-order: first key = oldest entry.
function evictInternPool(idToString: Map<number, string>, stringToId: Map<string, number>, maxSize: number): void {
    while (idToString.size > maxSize) {
        let oldest = idToString.keys().next().value;

        if (oldest === undefined) {
            break;
        }

        let str = idToString.get(oldest);

        idToString.delete(oldest);

        if (str !== undefined) {
            stringToId.delete(str);
        }
    }
}

// Touch an entry in the LRU Maps — delete + re-insert moves it to end (most recent).
function touchInternEntry(id: number, str: string, idToString: Map<number, string>, stringToId: Map<string, number>): void {
    idToString.delete(id);
    idToString.set(id, str);
    stringToId.delete(str);
    stringToId.set(str, id);
}

const createInternPool = (db: InternDb, fieldNames: string[], prefix?: string, maxSize?: number): InternPool => {
    let fields = new Set(fieldNames),
        idToString = new Map<number, string>(),
        keyPrefix = prefix ? prefix + ':' : '',
        limit = maxSize ?? DEFAULT_INTERN_MAX_SIZE,
        nextId = 1,
        stringToId = new Map<string, number>();

    function internString(value: string): number {
        let id = stringToId.get(value);

        if (id !== undefined) {
            touchInternEntry(id, value, idToString, stringToId);

            return id;
        }

        id = nextId++;
        idToString.set(id, value);
        stringToId.set(value, id);
        evictInternPool(idToString, stringToId, limit);

        let encoded = fromUtf8(value);

        try {
            db.transactionSync(() => {
                db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
            });
        }
        catch {
            queueMicrotask(() => {
                try {
                    db.transactionSync(() => {
                        db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
                    });
                }
                catch {
                    // Ignore — DB may be closing
                }
            });
        }

        return id;
    }

    return {
        fields,

        encode(_field: string, value: string, buf: Uint8Array, pos: number): number {
            let bLen = byteLen(value);

            // Threshold 16: strings shorter than 16 bytes cost less to inline than to look up by ID.
            // The sentinel (8 bytes) + ID u32 (4 bytes) = 12 bytes overhead makes interning break-even at ~16.
            if (bLen < 16) {
                writeU32.call(buf, bLen, pos);
                pos += 4;
                pos += writeUtf8.call(buf, value, pos, bLen);

                return pos;
            }

            let id = internString(value);

            // Sentinel 0xFFFFFFFF cannot collide with inlined string bytes: valid UTF-8 never
            // produces 0xFF bytes (U+FFFE/U+FFFF are excluded by the Unicode standard),
            // so readU32 on an inlined string length prefix can never equal 0xFFFFFFFF.
            writeU32.call(buf, 0xFFFFFFFF, pos);
            writeU32.call(buf, id, pos + 4);

            return pos + 8;
        },

        decode(buf: Uint8Array, pos: number): string {
            let id = readU32.call(buf, pos),
                cached = idToString.get(id);

            if (cached !== undefined) {
                touchInternEntry(id, cached, idToString, stringToId);

                return cached;
            }

            // Fallback: read from DB
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + id) as unknown as never);
            }
            catch (err) {
                throw new Error('SBC: intern pool DB read failed for id ' + id + ': ' + (err instanceof Error ? err.message : err));
            }

            if (!bytes) {
                throw new Error('SBC: intern ID not found: ' + id);
            }

            let str = toUtf8(bytes);

            idToString.set(id, str);
            stringToId.set(str, id);
            evictInternPool(idToString, stringToId, limit);

            return str;
        },

        load(): void {
            let entries: { id: number; str: string }[] = [],
                maxId = 0;

            try {
                for (let entry of db.getRange({ start: keyPrefix as unknown as never })) {
                    let k = String(entry.key);

                    if (!k.startsWith(keyPrefix)) {
                        break;
                    }

                    let idStr = k.slice(keyPrefix.length),
                        id = parseInt(idStr, 10);

                    if (isNaN(id)) {
                        continue;
                    }

                    let str = toUtf8(entry.value as Uint8Array);

                    entries.push({ id, str });

                    if (id > maxId) {
                        maxId = id;
                    }
                }
            }
            catch (err) {
                // getRange on empty DB returns empty iterable (no throw).
                // Any error here is a real DB failure — re-throw to prevent
                // ID collisions from stale nextId.
                console.error('SBC: intern pool load failed:', err instanceof Error ? err.message : err);
                throw err;
            }

            // If more entries than limit, keep only the most recent (highest IDs).
            // Sort ascending by id so Map insertion order = oldest first (LRU order).
            if (entries.length > limit) {
                entries.sort((a, b) => a.id - b.id);
                entries = entries.slice(entries.length - limit);
            }
            else {
                entries.sort((a, b) => a.id - b.id);
            }

            for (let i = 0, n = entries.length; i < n; i++) {
                let e = entries[i]!;

                idToString.set(e.id, e.str);
                stringToId.set(e.str, e.id);
            }

            nextId = maxId + 1;
        },
    };
};


export { createInternPool, createRegistry, createSchemaStore, decodeFieldDefs, deserializeRegistry, inferFieldType, inferSchema, lookupSchema, parseFieldType, registerSchema, resolveSchema, serializeFieldType, serializeRegistry };
