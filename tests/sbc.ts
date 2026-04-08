import { describe, expect, it } from 'vitest';
import { createCodec, createRegistry, deserializeRegistry, inferSchema, registerSchema, serializeFieldType, serializeRegistry } from '../src/sbc';
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
