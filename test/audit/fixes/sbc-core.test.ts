// Proof-of-fix for the SBC wire/correctness findings (B4, B1, H1, H2, M1a, M1b, M2,
// M3, M7b, M7c). Every assertion here states the CORRECTED behaviour and must stay green.
//
// The companion characterization specs under test/audit/ assert the old buggy behaviour and
// are intentionally red after these fixes.

import { describe, expect, it } from 'vitest';

import { codec } from '../../../src/sbc';
import { MAX_ARRAY_COUNT, MAX_SCHEMA_COUNT } from '../../../src/sbc/constants';
import { browser } from '../../../src/sbc/platform';
import { computeShapeHash, parseFieldType } from '../../../src/sbc/schema';


function writeU32(buf: Uint8Array, off: number, value: number): void {
    buf[off] = value & 0xFF;
    buf[off + 1] = (value >>> 8) & 0xFF;
    buf[off + 2] = (value >>> 16) & 0xFF;
    buf[off + 3] = (value >>> 24) & 0xFF;
}


describe('B4 — unambiguous shape hash + defineSchema collision verification', () => {
    it('no longer collides a two-field shape with a delimiter-smuggling single-field name', () => {
        let twoFields = computeShapeHash(['a', 'b'], ['uint8', 'uint8']),
            oneField = computeShapeHash(['a\u00ffuint8\u00feb'], ['uint8']);

        expect(twoFields).not.toBe(oneField);
    });

    it('defineSchema returns distinct hashes and each shape round-trips independently', () => {
        let c = codec(),
            hTwo = c.defineSchema([{ name: 'a', type: 'uint8' }, { name: 'b', type: 'uint8' }]),
            hOne = c.defineSchema([{ name: 'a\u00ffuint8\u00feb', type: 'uint8' }]);

        expect(hOne).not.toBe(hTwo);
        expect(c.decode(c.encode({ a: 1, b: 2 }, { schema: hTwo }))).toEqual({ a: 1, b: 2 });
        expect(c.decode(c.encode({ 'a\u00ffuint8\u00feb': 9 }, { schema: hOne }))).toEqual({ 'a\u00ffuint8\u00feb': 9 });
    });

    it('re-defining the same fields returns the same hash (no false collision)', () => {
        let c = codec(),
            a = c.defineSchema([{ name: 'x', type: 'uint8' }]),
            b = c.defineSchema([{ name: 'x', type: 'uint8' }]);

        expect(b).toBe(a);
    });
});


describe('B1 — one canonical object-ref layout, independent of registration order', () => {
    it('child-before-parent and parent-before-child emit byte-identical buffers for the same parent hash', () => {
        let childHash = codec().defineSchema([{ name: 'x', type: 'uint8' }]),
            parentFields = [{ name: 'child', type: `object(${childHash})` }];

        let a = codec();

        a.defineSchema([{ name: 'x', type: 'uint8' }]);

        let parentHashA = a.defineSchema(parentFields);

        let b = codec();

        let parentHashB = b.defineSchema(parentFields);

        b.defineSchema([{ name: 'x', type: 'uint8' }]);

        expect(parentHashB).toBe(parentHashA);

        let value = { child: { x: 42 } },
            bufA = a.encode(value, { schema: parentHashA }),
            bufB = b.encode(value, { schema: parentHashB });

        expect(Array.from(bufA)).toEqual(Array.from(bufB));
    });

    it('cross-decoding both orders succeeds (no wrong value, no truncation throw)', () => {
        let childHash = codec().defineSchema([{ name: 'x', type: 'uint8' }]),
            parentFields = [{ name: 'child', type: `object(${childHash})` }];

        let a = codec();

        a.defineSchema([{ name: 'x', type: 'uint8' }]);

        let parentHashA = a.defineSchema(parentFields);

        let b = codec();

        let parentHashB = b.defineSchema(parentFields);

        b.defineSchema([{ name: 'x', type: 'uint8' }]);

        let value = { child: { x: 42 } };

        expect(a.decode(b.encode(value, { schema: parentHashB }))).toEqual(value);
        expect(b.decode(a.encode(value, { schema: parentHashA }))).toEqual(value);
    });

    it('a fresh codec resolves the parent from the shared cache and decodes nested explicit schemas', () => {
        let childHash = codec().defineSchema([{ name: 'x', type: 'uint8' }]),
            parentFields = [{ name: 'child', type: `object(${childHash})` }];

        let a = codec();

        a.defineSchema([{ name: 'x', type: 'uint8' }]);

        let parentHash = a.defineSchema(parentFields),
            buf = a.encode({ child: { x: 42 } }, { schema: parentHash });

        let fresh = codec();

        expect(() => fresh.decode(buf)).not.toThrow('SBC: truncated');
        expect(fresh.decode(buf)).toEqual({ child: { x: 42 } });
    });
});


describe('H1 — payload-end bounds and depth budget', () => {
    it('a zero-length object frame throws instead of reading adjacent payload bytes', () => {
        let c = codec(),
            encoded = c.encode({ a: 43981 });

        expect(c.decode(encoded)).toEqual({ a: 43981 });

        let zeroed = encoded.slice();

        writeU32(zeroed, 5, 0);

        expect(() => c.decode(zeroed)).toThrow();
        expect(() => c.decode(zeroed, 9)).toThrow();
    });

    it('a physically truncated buffer throws at decodeAt instead of fabricating 0', () => {
        let c = codec(),
            encoded = c.encode({ a: 43981 }),
            headerOnly = encoded.subarray(0, 9);

        expect(() => c.decodeAt(headerOnly, 0)).toThrow();

        let zeroedHeaderOnly = new Uint8Array(9);

        zeroedHeaderOnly.set(encoded.subarray(0, 9));
        writeU32(zeroedHeaderOnly, 5, 0);

        expect(() => c.decode(zeroedHeaderOnly)).toThrow();
    });

    it('enforces the depth>64 budget on the compiled object(hash) recursion path', () => {
        let c = codec(),
            DEPTH = 100;

        let hash = c.defineSchema([{ name: 'v', type: 'uint8' }]);

        for (let i = 0; i < DEPTH; i++) {
            hash = c.defineSchema([{ name: 'child', type: 'object(' + hash + ')' }]);
        }

        let value: unknown = { v: 7 };

        for (let i = 0; i < DEPTH; i++) {
            value = { child: value };
        }

        let buf = c.encode(value, { schema: hash });

        expect(() => c.decode(buf)).toThrow('max decode depth exceeded');
    });
});


describe('H2 — referenced child schemas are validated before encoding', () => {
    it('explicit-hint encode of an out-of-range nested field is rejected', () => {
        let c = codec(),
            childHash = c.defineSchema([{ name: 'x', type: 'uint8' }]),
            parentHash = c.defineSchema([{ name: 'child', type: `object(${childHash})` }]);

        expect(() => c.encode({ child: { x: 300 } }, { schema: parentHash })).toThrow(/out of uint8 range/);
    });

    it('plain encode of an out-of-range nested field re-infers instead of truncating to 44', () => {
        let c = codec(),
            childHash = c.defineSchema([{ name: 'x', type: 'uint8' }]);

        c.defineSchema([{ name: 'child', type: `object(${childHash})` }]);

        let encoded = c.encode({ child: { x: 300 } }),
            decoded = c.decode(encoded) as { child: { x: number } };

        expect(decoded).toEqual({ child: { x: 300 } });
    });

    it('array<object(hash)> validates each element on the explicit and plain paths', () => {
        let c = codec(),
            childHash = c.defineSchema([{ name: 'x', type: 'uint8' }]),
            parentHash = c.defineSchema([{ name: 'items', type: `array<object(${childHash})>` }]);

        expect(() => c.encode({ items: [{ x: 300 }] }, { schema: parentHash })).toThrow(/out of uint8 range/);

        let decoded = c.decode(c.encode({ items: [{ x: 300 }] })) as { items: { x: number }[] };

        expect(decoded).toEqual({ items: [{ x: 300 }] });
    });
});


describe('M1a — compressed float64 preserves negative zero', () => {
    it('Object.is(decoded, -0) holds through codec({ compress: true })', () => {
        let c = codec({ compress: true }),
            buf = c.encode({ x: -0 }),
            decoded = c.decode(buf) as { x: number };

        expect(buf[0]).toBe(18);
        expect(Object.is(decoded.x, -0)).toBe(true);
        expect(c.computeSize({ x: -0 })).toBe(buf.length);
    });
});


describe('M1b — browser UTF-8 sizing matches Node/TextEncoder for surrogates', () => {
    it('lone high surrogate + é sizes as 5 bytes (3-byte replacement + 2-byte é)', () => {
        let s = '\ud800é';

        expect(Buffer.byteLength(s, 'utf8')).toBe(5);
        expect(new TextEncoder().encode(s).length).toBe(5);
        expect(browser.byteLen(s)).toBe(5);
    });

    it('a valid surrogate pair sizes as 4 bytes', () => {
        let s = '😀';

        expect(browser.byteLen(s)).toBe(Buffer.byteLength(s, 'utf8'));
        expect(browser.byteLen(s)).toBe(4);
    });

    it('a lone low surrogate sizes as 3 bytes', () => {
        expect(browser.byteLen('\udc00')).toBe(Buffer.byteLength('\udc00', 'utf8'));
    });
});


describe('M2 — junk types rejected and object hashes range-checked', () => {
    it('rejects an inherited Object.prototype type name', () => {
        expect(() => parseFieldType('toString')).toThrow('unknown field type');
    });

    it('rejects an object hash above uint32 instead of wrapping to 0', () => {
        expect(() => parseFieldType('object(4294967296)')).toThrow('invalid object hash');
    });

    it('accepts the uint32 maximum object hash', () => {
        expect(parseFieldType('object(4294967295)').hash).toBe(4294967295);
    });
});


describe('M3 — encode/serialize enforce the decoder limits', () => {
    it('encode rejects an array count above MAX_ARRAY_COUNT', () => {
        let c = codec(),
            arr = new Array<number>(MAX_ARRAY_COUNT + 1).fill(7);

        expect(() => c.encode(arr)).toThrow('array count ' + (MAX_ARRAY_COUNT + 1) + ' exceeds limit');
    });

    it('a count of exactly MAX_ARRAY_COUNT still encodes', () => {
        let c = codec(),
            arr = new Array<number>(128).fill(7);

        expect(() => c.encode(arr)).not.toThrow();
    });

    it('serializeRegistry rejects a schema count above MAX_SCHEMA_COUNT', () => {
        let c = codec();

        for (let i = 0; i < MAX_SCHEMA_COUNT + 1; i++) {
            c.defineSchema([{ name: 'f' + i, type: 'uint8' }]);
        }

        expect(() => c.serializeRegistry()).toThrow('schema count ' + (MAX_SCHEMA_COUNT + 1) + ' exceeds limit');
    });
});


describe('M7b / M7c — type-level contracts', () => {
    it('M7b: the runtime still rejects DataView (the type no longer admits it)', () => {
        let c = codec(),
            dv = new DataView(new ArrayBuffer(8));

        expect(() => c.encode(dv)).toThrow('unrepresentable value of type DataView');
    });

    it('M7c: decode<T> is an unchecked assertion, so a mismatched T is not validated', () => {
        let c = codec(),
            buf = c.encode({ a: 5 });

        // Documents the JSDoc caveat: T is erased and never validated against the wire.
        expect(c.decode<{ a: string }>(buf)).toEqual({ a: 5 });
    });
});
