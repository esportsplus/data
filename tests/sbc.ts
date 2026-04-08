import { describe, expect, it } from 'vitest';
import { buildSchema, compileSchema, createCodec, createInternPool, createRegistry, createSchemaStore, deserializeRegistry, inferSchema, registerSchema, serializeFieldType, serializeRegistry } from '../src/sbc';
import { readVarint, readZigzag, varintResult, writeVarint, writeZigzag } from '../src/sbc/platform';
import { decodeTypedArray, encodeTypedArrayInto, getTypedArrayType } from '../src/typed-array-codec';


describe('T-001: decodeAt', () => {
    it('decodes a primitive at offset 0', () => {
        let codec = createCodec();
        let buf = codec.encode(42);

        expect(codec.decodeAt(buf, 0)).toBe(42);
    });

    it('decodes a primitive at a non-zero offset', () => {
        let codec = createCodec();
        let buf1 = codec.encode(10);
        let buf2 = codec.encode(99);
        let combined = new Uint8Array(buf1.length + buf2.length);

        combined.set(buf1, 0);
        combined.set(buf2, buf1.length);

        expect(codec.decodeAt(combined, buf1.length)).toBe(99);
    });

    it('decodes an object at offset 0', () => {
        let codec = createCodec();
        let obj = { age: 30, name: 'alice' };
        let buf = codec.encode(obj);

        expect(codec.decodeAt(buf, 0)).toEqual(obj);
    });

    it('decodes an object at a non-zero offset', () => {
        let codec = createCodec();
        let obj = { score: 100, tag: 'test' };
        let encoded = codec.encode(obj);
        let combined = Buffer.alloc(5 + encoded.length);

        combined.set(encoded, 5);

        expect(codec.decodeAt(combined, 5)).toEqual(obj);
    });

    it('decodes a string at offset 0', () => {
        let codec = createCodec();
        let buf = codec.encode('hello');

        expect(codec.decodeAt(buf, 0)).toBe('hello');
    });

    it('decodes a boolean at offset 0', () => {
        let codec = createCodec();
        let buf = codec.encode(true);

        expect(codec.decodeAt(buf, 0)).toBe(true);
    });

    it('decodes null at offset 0', () => {
        let codec = createCodec();
        let buf = codec.encode(null);

        expect(codec.decodeAt(buf, 0)).toBe(null);
    });

    it('decodes uint8 (tag 255) at offset 0', () => {
        let codec = createCodec();
        let buf = codec.encode(200);

        expect(codec.decodeAt(buf, 0)).toBe(200);
    });
});


describe('T-002: extractField', () => {
    it('extracts a fixed-size field (float64)', () => {
        let codec = createCodec();
        let obj = { score: 3.14, tag: 'x' };

        codec.encode(obj);

        let buf = codec.encode(obj);

        expect(codec.extractField(buf, 'score')).toBe(3.14);
    });

    it('extracts a boolean field', () => {
        let codec = createCodec();
        let obj = { active: true, name: 'test' };

        codec.encode(obj);

        let buf = codec.encode(obj);

        expect(codec.extractField(buf, 'active')).toBe(true);
    });

    it('extracts a string field', () => {
        let codec = createCodec();
        let obj = { id: 1, name: 'alice' };

        codec.encode(obj);

        let buf = codec.encode(obj);

        expect(codec.extractField(buf, 'name')).toBe('alice');
    });

    it('returns undefined for a nonexistent field', () => {
        let codec = createCodec();
        let obj = { id: 1, name: 'bob' };

        codec.encode(obj);

        let buf = codec.encode(obj);

        expect(codec.extractField(buf, 'missing')).toBeUndefined();
    });

    it('returns undefined for a non-object buffer', () => {
        let codec = createCodec();
        let buf = codec.encode('just a string');

        expect(codec.extractField(buf, 'anything')).toBeUndefined();
    });

    it('returns undefined for a buffer shorter than 9 bytes', () => {
        let codec = createCodec();
        let buf = new Uint8Array(5);

        expect(codec.extractField(buf, 'field')).toBeUndefined();
    });
});


describe('T-003: compression path (tag 245)', () => {
    it('encodes and decodes a simple object', () => {
        let codec = createCodec(undefined, { compression: true });
        let obj = { count: 42, label: 'test' };
        let buf = codec.encode(obj);
        let decoded = codec.decode(buf);

        expect(decoded).toEqual(obj);
    });

    it('encodes and decodes with multiple field types', () => {
        let codec = createCodec(undefined, { compression: true });
        let obj = { active: true, name: 'alice', score: 99.5 };
        let buf = codec.encode(obj);
        let decoded = codec.decode(buf);

        expect(decoded).toEqual(obj);
    });

    it('compressed encoding differs from uncompressed', () => {
        let compressed = createCodec(undefined, { compression: true });
        let uncompressed = createCodec();
        let obj = { count: 42, label: 'test' };
        let compBuf = compressed.encode(obj);
        let uncBuf = uncompressed.encode(obj);

        expect(compBuf[0]).toBe(245);
        expect(uncBuf[0]).toBe(246);
        expect(compBuf.length).not.toBe(uncBuf.length);
    });

    it('round-trips with nested array values', () => {
        let codec = createCodec(undefined, { compression: true });
        let obj = { items: [1, 2, 3], name: 'list' };
        let buf = codec.encode(obj);
        let decoded = codec.decode(buf);

        expect(decoded).toEqual(obj);
    });
});


describe('T-004: serializeRegistry / deserializeRegistry', () => {
    it('serializes empty registry and deserializes to no schemas', () => {
        let registry = createRegistry();
        let serialized = serializeRegistry(registry);
        let restored = deserializeRegistry(serialized);

        expect(restored.schemas.size).toBe(0);
    });

    it('round-trips a single schema', () => {
        let registry = createRegistry();
        let schema = inferSchema({ age: 30, name: 'test' }, registry);

        registerSchema(schema, registry);

        let serialized = serializeRegistry(registry);
        let restored = deserializeRegistry(serialized);

        expect(restored.schemas.size).toBe(1);

        let restoredSchema = restored.schemasByHash.get(schema.hash);

        expect(restoredSchema).toBeDefined();
        expect(restoredSchema!.hash).toBe(schema.hash);
    });

    it('round-trips multiple schemas', () => {
        let registry = createRegistry();
        let s1 = inferSchema({ x: 1, y: 2 }, registry);
        let s2 = inferSchema({ active: true, name: 'test' }, registry);

        registerSchema(s1, registry);
        registerSchema(s2, registry);

        let serialized = serializeRegistry(registry);
        let restored = deserializeRegistry(serialized);

        expect(restored.schemas.size).toBe(2);
        expect(restored.schemasByHash.has(s1.hash)).toBe(true);
        expect(restored.schemasByHash.has(s2.hash)).toBe(true);
    });

    it('preserves field names and types', () => {
        let registry = createRegistry();
        let schema = inferSchema({ count: 42, label: 'hello' }, registry);

        registerSchema(schema, registry);

        let serialized = serializeRegistry(registry);
        let restored = deserializeRegistry(serialized);
        let restoredSchema = restored.schemasByHash.get(schema.hash)!;
        let fieldNames = restoredSchema.fields.map((f) => f.name).sort();
        let fieldTypes = restoredSchema.fields.reduce((acc, f) => { acc[f.name] = serializeFieldType(f.type); return acc; }, {} as Record<string, string>);

        expect(fieldNames).toEqual(['count', 'label']);
        expect(fieldTypes['count']).toBe('float64');
        expect(fieldTypes['label']).toBe('string');
    });

    it('restores nextId so new schemas get higher ids', () => {
        let registry = createRegistry();
        let s1 = inferSchema({ a: 1 }, registry);
        let s2 = inferSchema({ b: 'x' }, registry);

        registerSchema(s1, registry);
        registerSchema(s2, registry);

        let maxId = Math.max(s1.id, s2.id);
        let serialized = serializeRegistry(registry);
        let restored = deserializeRegistry(serialized);

        expect(restored.nextId).toBeGreaterThan(maxId);

        let s3 = inferSchema({ c: true }, restored);

        registerSchema(s3, restored);

        expect(s3.id).toBeGreaterThan(maxId);
    });
});


describe('T-005: typed-array-codec', () => {
    describe('getTypedArrayType', () => {
        it('returns correct type for Float32Array', () => {
            expect(getTypedArrayType(new Float32Array(1))).not.toBe(-1);
        });

        it('returns correct type for Float64Array', () => {
            expect(getTypedArrayType(new Float64Array(1))).not.toBe(-1);
        });

        it('returns correct type for Int8Array', () => {
            expect(getTypedArrayType(new Int8Array(1))).not.toBe(-1);
        });

        it('returns correct type for Int16Array', () => {
            expect(getTypedArrayType(new Int16Array(1))).not.toBe(-1);
        });

        it('returns correct type for Int32Array', () => {
            expect(getTypedArrayType(new Int32Array(1))).not.toBe(-1);
        });

        it('returns correct type for Uint8Array', () => {
            expect(getTypedArrayType(new Uint8Array(1))).not.toBe(-1);
        });

        it('returns correct type for Uint8ClampedArray', () => {
            expect(getTypedArrayType(new Uint8ClampedArray(1))).not.toBe(-1);
        });

        it('returns correct type for Uint16Array', () => {
            expect(getTypedArrayType(new Uint16Array(1))).not.toBe(-1);
        });

        it('returns correct type for Uint32Array', () => {
            expect(getTypedArrayType(new Uint32Array(1))).not.toBe(-1);
        });

        it('returns correct type for BigInt64Array', () => {
            expect(getTypedArrayType(new BigInt64Array(1))).not.toBe(-1);
        });

        it('returns correct type for BigUint64Array', () => {
            expect(getTypedArrayType(new BigUint64Array(1))).not.toBe(-1);
        });

        it('returns -1 for plain array', () => {
            expect(getTypedArrayType([1, 2, 3])).toBe(-1);
        });

        it('returns -1 for object', () => {
            expect(getTypedArrayType({ x: 1 })).toBe(-1);
        });

        it('returns -1 for null', () => {
            expect(getTypedArrayType(null)).toBe(-1);
        });
    });

    describe('encodeTypedArrayInto + decodeTypedArray round-trip', () => {
        it('round-trips Float32Array', () => {
            let input = new Float32Array([1.5, 2.5, 3.5]);
            let buf = new Uint8Array(4 + input.byteLength);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(buf.length);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(Float32Array);
            expect(Array.from(decoded as Float32Array)).toEqual([1.5, 2.5, 3.5]);
        });

        it('round-trips Float64Array', () => {
            let input = new Float64Array([1.1, 2.2, 3.3]);
            let buf = new Uint8Array(4 + input.byteLength);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(buf.length);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(Float64Array);
            expect(Array.from(decoded as Float64Array)).toEqual([1.1, 2.2, 3.3]);
        });

        it('round-trips Int32Array', () => {
            let input = new Int32Array([-1, 0, 100]);
            let buf = new Uint8Array(4 + input.byteLength);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(buf.length);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(Int32Array);
            expect(Array.from(decoded as Int32Array)).toEqual([-1, 0, 100]);
        });

        it('round-trips Uint8Array directly via codec functions', () => {
            let input = new Uint8Array([10, 20, 30]);
            let buf = new Uint8Array(4 + input.byteLength);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(buf.length);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded as Uint8Array)).toEqual([10, 20, 30]);
        });

        it('round-trips BigInt64Array', () => {
            let input = new BigInt64Array([1n, -2n, 3n]);
            let buf = new Uint8Array(4 + input.byteLength);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(buf.length);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(BigInt64Array);
            expect(Array.from(decoded as BigInt64Array)).toEqual([1n, -2n, 3n]);
        });

        it('round-trips empty typed array', () => {
            let input = new Float32Array(0);
            let buf = new Uint8Array(4);
            let end = encodeTypedArrayInto(input, buf, 0);

            expect(end).toBe(4);

            let decoded = decodeTypedArray(buf);

            expect(decoded).toBeInstanceOf(Float32Array);
            expect((decoded as Float32Array).length).toBe(0);
        });
    });

    describe('decodeTypedArray edge cases', () => {
        it('returns null for buffer shorter than 4 bytes', () => {
            expect(decodeTypedArray(new Uint8Array(3))).toBeNull();
        });

        it('returns null for wrong magic marker', () => {
            let buf = new Uint8Array([0xFF, 0, 0, 0]);

            expect(decodeTypedArray(buf)).toBeNull();
        });

        it('returns null for invalid type enum', () => {
            let buf = new Uint8Array([0x54, 99, 0, 0]);

            expect(decodeTypedArray(buf)).toBeNull();
        });

        it('returns null when data length not divisible by element size', () => {
            // Float32 = 4 bytes per element; 5 data bytes is invalid
            let buf = new Uint8Array([0x54, 0, 0, 0, 0, 0, 0, 0, 0]);

            expect(decodeTypedArray(buf)).toBeNull();
        });
    });
});


describe('F-001: extractField nullable variable-length fields', () => {
    it('compiles extractor for nullable<string> field', () => {
        let schema = buildSchema([
            { fixedSize: 0, name: 'label', offset: 0, type: { inner: 'string', kind: 'nullable' } as any },
            { fixedSize: 8, name: 'score', offset: 0, type: 'float64' },
        ], 12345, 1);

        compileSchema(schema);

        expect(schema.fieldExtractors).not.toBeNull();
        expect(schema.fieldExtractors!.has('label')).toBe(true);
        expect(schema.nullIndexMap).not.toBeNull();
        expect(schema.nullIndexMap!.has('label')).toBe(true);
    });

    it('compiles extractor for nullable<bytes> field', () => {
        let schema = buildSchema([
            { fixedSize: 0, name: 'data', offset: 0, type: { inner: 'bytes', kind: 'nullable' } as any },
            { fixedSize: 8, name: 'id', offset: 0, type: 'float64' },
        ], 12346, 2);

        compileSchema(schema);

        expect(schema.fieldExtractors).not.toBeNull();
        expect(schema.fieldExtractors!.has('data')).toBe(true);
    });

    it('extractor returns correct value for non-null nullable<string>', () => {
        let schema = buildSchema([
            { fixedSize: 0, name: 'label', offset: 0, type: { inner: 'string', kind: 'nullable' } as any },
            { fixedSize: 8, name: 'score', offset: 0, type: 'float64' },
        ], 12345, 1);

        compileSchema(schema);

        // Buffer layout: header(9) + bitmap(1) + score(float64=8) + label_len(u32=4) + label_data
        let str = 'hello',
            strBytes = Buffer.from(str, 'utf8'),
            buf = Buffer.alloc(9 + 1 + 8 + 4 + strBytes.length);

        buf[0] = 246;
        buf.writeUInt32LE(12345, 1);
        buf.writeUInt32LE(buf.length - 9, 5);
        buf[9] = 0x01; // null bitmap: bit 0 = label is non-null
        buf.writeDoubleLE(3.14, 10);
        buf.writeUInt32LE(strBytes.length, 18);
        strBytes.copy(buf, 22);

        let bitmapBytes = 1,
            extractor = schema.fieldExtractors!.get('label')!;

        expect(extractor(buf, 9 + bitmapBytes)).toBe('hello');
    });

    it('nullable<string> extractor skips preceding nullable field correctly', () => {
        let schema = buildSchema([
            { fixedSize: 0, name: 'first', offset: 0, type: { inner: 'string', kind: 'nullable' } as any },
            { fixedSize: 0, name: 'second', offset: 0, type: { inner: 'string', kind: 'nullable' } as any },
        ], 12347, 3);

        compileSchema(schema);

        expect(schema.fieldExtractors!.has('first')).toBe(true);
        expect(schema.fieldExtractors!.has('second')).toBe(true);

        // Buffer: header(9) + bitmap(1) + first_len(4) + first_data(5) + second_len(4) + second_data(5)
        let firstBytes = Buffer.from('alice', 'utf8'),
            secondBytes = Buffer.from('world', 'utf8'),
            buf = Buffer.alloc(9 + 1 + 4 + firstBytes.length + 4 + secondBytes.length);

        buf[0] = 246;
        buf.writeUInt32LE(12347, 1);
        buf.writeUInt32LE(buf.length - 9, 5);
        buf[9] = 0x03; // both nullable fields non-null (bits 0 and 1 set)

        let pos = 10;

        buf.writeUInt32LE(firstBytes.length, pos);
        firstBytes.copy(buf, pos + 4);
        pos += 4 + firstBytes.length;
        buf.writeUInt32LE(secondBytes.length, pos);
        secondBytes.copy(buf, pos + 4);

        let bitmapBytes = 1;

        expect(schema.fieldExtractors!.get('second')!(buf, 9 + bitmapBytes)).toBe('world');
    });
});


describe('F-006: decode() uncompressed object path', () => {
    it('round-trips a tag-246 object via codec.decode()', () => {
        let codec = createCodec();
        let obj = { age: 25, name: 'bob' };
        let buf = codec.encode(obj);

        expect(buf[0]).toBe(246);

        let decoded = codec.decode(buf);

        expect(decoded).toEqual(obj);
    });

    it('round-trips multiple objects with different schemas via decode()', () => {
        let codec = createCodec();
        let obj1 = { x: 1, y: 2 };
        let obj2 = { active: true, label: 'test' };

        // encode() returns owned copies by default that survive subsequent encodes
        let buf1 = codec.encode(obj1);
        let buf2 = codec.encode(obj2);

        expect(codec.decode(buf1)).toEqual(obj1);
        expect(codec.decode(buf2)).toEqual(obj2);
    });

    it('decode() with length parameter truncates correctly', () => {
        let codec = createCodec();
        let obj = { count: 42, tag: 'hello' };
        let buf = codec.encode(obj);

        // Passing exact length should decode correctly
        let decoded = codec.decode(buf, buf.length);

        expect(decoded).toEqual(obj);
    });

    it('decode() with length shorter than buffer uses only that portion', () => {
        let codec = createCodec();
        let obj = { a: 1, b: 2 };
        let buf = codec.encode(obj);

        // Create a larger Buffer with the encoded data at the start
        let padded = Buffer.alloc(buf.length + 100);

        padded.set(buf, 0);

        let decoded = codec.decode(padded, buf.length);

        expect(decoded).toEqual(obj);
    });

    it('decode() handles primitives correctly', () => {
        let codec = createCodec();

        expect(codec.decode(codec.encode(42))).toBe(42);
        expect(codec.decode(codec.encode('hello'))).toBe('hello');
        expect(codec.decode(codec.encode(true))).toBe(true);
        expect(codec.decode(codec.encode(null))).toBe(null);
    });
});


describe('F-008: readVarint/writeVarint', () => {
    it('round-trips value 0', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 0);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(0);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 1', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 1);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(1);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 127 (max 1-byte)', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 127);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(127);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 128 (min 2-byte)', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 128);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(128);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 16383 (max 2-byte)', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 16383);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(16383);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 16384 (min 3-byte)', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 16384);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(16384);
        expect(varintResult.pos).toBe(end);
    });

    it('round-trips value 2097151 (max 3-byte)', () => {
        let buf = new Uint8Array(5);
        let end = writeVarint(buf, 0, 2097151);

        readVarint(buf, 0);

        expect(varintResult.value).toBe(2097151);
        expect(varintResult.pos).toBe(end);
    });

    it('writeVarint uses 1 byte for values 0-127', () => {
        let buf = new Uint8Array(5);

        expect(writeVarint(buf, 0, 0)).toBe(1);
        expect(writeVarint(buf, 0, 127)).toBe(1);
    });

    it('writeVarint uses 2 bytes for values 128-16383', () => {
        let buf = new Uint8Array(5);

        expect(writeVarint(buf, 0, 128)).toBe(2);
        expect(writeVarint(buf, 0, 16383)).toBe(2);
    });

    it('writeVarint uses 3 bytes for values 16384-2097151', () => {
        let buf = new Uint8Array(5);

        expect(writeVarint(buf, 0, 16384)).toBe(3);
        expect(writeVarint(buf, 0, 2097151)).toBe(3);
    });

    it('readVarint throws on empty buffer (pos >= buf.length)', () => {
        let buf = new Uint8Array(0);

        expect(() => readVarint(buf, 0)).toThrow(RangeError);
    });

    it('readVarint throws when pos equals buf.length', () => {
        let buf = new Uint8Array(3);

        expect(() => readVarint(buf, 3)).toThrow(RangeError);
    });

    it('readVarint throws when continuation byte extends past buffer end', () => {
        // Write a byte with continuation bit set, but no following byte
        let buf = new Uint8Array(1);

        buf[0] = 0x80; // continuation bit set

        expect(() => readVarint(buf, 0)).toThrow(RangeError);
    });
});


describe('F-009: readZigzag/writeZigzag', () => {
    it('round-trips value 0', () => {
        let buf = new Uint8Array(5);

        writeZigzag(buf, 0, 0);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(0);
    });

    it('round-trips value 1', () => {
        let buf = new Uint8Array(5);

        writeZigzag(buf, 0, 1);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(1);
    });

    it('round-trips value -1', () => {
        let buf = new Uint8Array(5);

        writeZigzag(buf, 0, -1);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(-1);
    });

    it('round-trips value 127', () => {
        let buf = new Uint8Array(5);

        writeZigzag(buf, 0, 127);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(127);
    });

    it('round-trips value -128', () => {
        let buf = new Uint8Array(5);

        writeZigzag(buf, 0, -128);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(-128);
    });

    it('round-trips value 2147483647 (max int32)', () => {
        let buf = new Uint8Array(10);

        writeZigzag(buf, 0, 2147483647);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(2147483647);
    });

    it('round-trips value -2147483648 (min int32)', () => {
        let buf = new Uint8Array(10);

        writeZigzag(buf, 0, -2147483648);
        readZigzag(buf, 0);

        expect(varintResult.value).toBe(-2147483648);
    });

    it('writeZigzag throws RangeError for value above int32 max', () => {
        let buf = new Uint8Array(10);

        expect(() => writeZigzag(buf, 0, 2147483648)).toThrow(RangeError);
    });

    it('writeZigzag throws RangeError for value below int32 min', () => {
        let buf = new Uint8Array(10);

        expect(() => writeZigzag(buf, 0, -2147483649)).toThrow(RangeError);
    });
});


describe('F-010: deserializeRegistry error paths', () => {
    it('throws on unknown version number', () => {
        expect(() => deserializeRegistry({ schemas: [], v: 99 })).toThrow('unknown registry version');
    });

    it('throws on completely invalid data (non-array, non-object)', () => {
        expect(() => deserializeRegistry('bad' as unknown as { schemas: []; v: number })).toThrow('invalid registry format');
    });

    it('legacy bare-array format works with empty array', () => {
        let registry = deserializeRegistry([]);

        expect(registry.schemas.size).toBe(0);
    });

    it('legacy bare-array format works with valid schema entries', () => {
        // Build a valid schema definition that matches what serializeRegistry produces
        let reg = createRegistry();
        let schema = inferSchema({ x: 1 }, reg);

        registerSchema(schema, reg);

        let serialized = serializeRegistry(reg);

        // Pass just the schemas array as a bare array (legacy format)
        let restored = deserializeRegistry(serialized.schemas as unknown[]);

        expect(restored.schemas.size).toBe(1);
    });

    it('throws on malformed schema entry (null in schemas array)', () => {
        expect(() => deserializeRegistry({ schemas: [null], v: 1 })).toThrow('malformed schema definition');
    });

    it('throws on schema entry missing required fields', () => {
        expect(() => deserializeRegistry({ schemas: [{ hash: 1 }], v: 1 })).toThrow('malformed schema definition');
    });

    it('throws when schemas property is not an array', () => {
        expect(() => deserializeRegistry({ schemas: 'not-array' as unknown as unknown[], v: 1 })).toThrow('invalid registry format');
    });
});


describe('F-011: createSchemaStore', () => {
    function createMockDb() {
        let store = new Map<string, Uint8Array>();

        return {
            getBinary(key: unknown): Uint8Array | undefined { return store.get(String(key)); },
            putSync(key: unknown, value: unknown): boolean { store.set(String(key), value as Uint8Array); return true; },
            transactionSync<T>(fn: () => T): T { return fn(); },
        };
    }

    it('registers a schema then retrieves it by hash', () => {
        let db = createMockDb();
        let schemaStore = createSchemaStore(db);
        let registry = createRegistry();
        let schema = inferSchema({ age: 30, name: 'test' }, registry);

        registerSchema(schema, registry);
        compileSchema(schema);
        schemaStore.register(schema.hash, schema);

        // getCached should return it immediately
        let cached = schemaStore.getCached(schema.hash);

        expect(cached).not.toBeNull();
        expect(cached!.hash).toBe(schema.hash);
    });

    it('get() retrieves a schema persisted to DB', () => {
        let db = createMockDb();
        let store1 = createSchemaStore(db);
        let registry = createRegistry();
        let schema = inferSchema({ score: 99.5, tag: 'hi' }, registry);

        registerSchema(schema, registry);
        compileSchema(schema);
        store1.register(schema.hash, schema);

        // Create a new store over the same DB — cache is empty, must fetch from DB
        let store2 = createSchemaStore(db);
        let fetched = store2.get(schema.hash);

        expect(fetched).not.toBeNull();
        expect(fetched!.hash).toBe(schema.hash);
    });

    it('get() returns null for unknown hash', () => {
        let db = createMockDb();
        let schemaStore = createSchemaStore(db);

        expect(schemaStore.get(999999)).toBeNull();
    });

    it('getCached() returns null for unknown hash', () => {
        let db = createMockDb();
        let schemaStore = createSchemaStore(db);

        expect(schemaStore.getCached(12345)).toBeNull();
    });

    it('has() returns true for registered schemas', () => {
        let db = createMockDb();
        let schemaStore = createSchemaStore(db);
        let registry = createRegistry();
        let schema = inferSchema({ id: 1 }, registry);

        registerSchema(schema, registry);
        compileSchema(schema);
        schemaStore.register(schema.hash, schema);

        expect(schemaStore.has(schema.hash)).toBe(true);
        expect(schemaStore.has(999999)).toBe(false);
    });

    it('supports prefix for key namespacing', () => {
        let db = createMockDb();
        let store1 = createSchemaStore(db, 'ns1');
        let store2 = createSchemaStore(db, 'ns2');
        let registry = createRegistry();
        let schema = inferSchema({ val: 42 }, registry);

        registerSchema(schema, registry);
        compileSchema(schema);
        store1.register(schema.hash, schema);

        // store2 should not find it in its cache
        expect(store2.getCached(schema.hash)).toBeNull();
    });
});


describe('F-012: createInternPool', () => {
    function createMockInternDb() {
        let store = new Map<string, Uint8Array>();

        return {
            getBinary(key: unknown): Uint8Array | undefined { return store.get(String(key)); },
            getRange(options?: { start?: unknown }): Iterable<{ key: unknown; value: unknown }> {
                let prefix = options?.start ? String(options.start) : '';
                let results: { key: unknown; value: unknown }[] = [];

                for (let [k, v] of store) {
                    if (k >= prefix) {
                        results.push({ key: k, value: v });
                    }
                }

                results.sort((a, b) => String(a.key).localeCompare(String(b.key)));

                return results;
            },
            putSync(key: unknown, value: unknown): boolean { store.set(String(key), value as Uint8Array); return true; },
            transactionSync<T>(fn: () => T): T { return fn(); },
        };
    }

    it('encode then decode round-trips a string', () => {
        let db = createMockInternDb();
        let pool = createInternPool(db, ['name']);
        let buf = new Uint8Array(256);

        // Encode a string long enough to be interned (>= 16 bytes)
        let longStr = 'abcdefghijklmnopqrstuvwxyz';
        let end = pool.encode('name', longStr, buf, 0);

        expect(end).toBeGreaterThan(0);

        // The interned format writes sentinel 0xFFFFFFFF + u32 id = 8 bytes
        let view = new DataView(buf.buffer);

        expect(view.getUint32(0, true)).toBe(0xFFFFFFFF);

        // Decode from the intern ID (at offset 4)
        let decoded = pool.decode(buf, 4);

        expect(decoded).toBe(longStr);
    });

    it('short strings (< 16 bytes) inline without interning', () => {
        let db = createMockInternDb();
        let pool = createInternPool(db, ['tag']);
        let buf = new Uint8Array(256);

        // Short string — should be inlined (length prefix + raw bytes, no sentinel)
        let shortStr = 'hi';
        let end = pool.encode('tag', shortStr, buf, 0);

        // Inlined format: u32 length + raw bytes = 4 + 2 = 6
        expect(end).toBe(6);

        let view = new DataView(buf.buffer);

        // First 4 bytes should be the string length, not the sentinel
        expect(view.getUint32(0, true)).toBe(2);
        expect(view.getUint32(0, true)).not.toBe(0xFFFFFFFF);
    });

    it('re-encoding the same string returns same intern id', () => {
        let db = createMockInternDb();
        let pool = createInternPool(db, ['field']);
        let buf1 = new Uint8Array(256);
        let buf2 = new Uint8Array(256);
        let longStr = 'this_is_a_longer_string_for_interning';

        pool.encode('field', longStr, buf1, 0);
        pool.encode('field', longStr, buf2, 0);

        // Both should write the same intern ID
        let view1 = new DataView(buf1.buffer);
        let view2 = new DataView(buf2.buffer);

        expect(view1.getUint32(4, true)).toBe(view2.getUint32(4, true));
    });

    it('fields set contains the configured field names', () => {
        let db = createMockInternDb();
        let pool = createInternPool(db, ['alpha', 'beta']);

        expect(pool.fields.has('alpha')).toBe(true);
        expect(pool.fields.has('beta')).toBe(true);
        expect(pool.fields.has('gamma')).toBe(false);
    });

    it('load() restores previously persisted interned strings', () => {
        let db = createMockInternDb();
        let pool1 = createInternPool(db, ['name']);
        let buf = new Uint8Array(256);
        let longStr = 'a_very_long_interned_string_value';

        pool1.encode('name', longStr, buf, 0);

        // Create a new pool over the same DB and load
        let pool2 = createInternPool(db, ['name']);

        pool2.load();

        // Should be able to decode the intern ID written by pool1
        let decoded = pool2.decode(buf, 4);

        expect(decoded).toBe(longStr);
    });
});
