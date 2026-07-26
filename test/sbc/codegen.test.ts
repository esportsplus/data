import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


function readSource(rel: string): string {
    return readFileSync(new URL('../../src/sbc/' + rel, import.meta.url), 'utf8');
}

function u32le(n: number): number[] {
    return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
}


// === decoder-count-limits ===
// MAX_ARRAY_COUNT (2^20) must gate the COMPILED decoder the same way it gates the
// tagged decoder, and it must come from the imported constant — never an inlined
// 1048576 literal. The compiled decoder already carries the cap; the item's red is
// the literal-hygiene source check plus the extract.ts gap (see extract.test.ts).
describe('decoder-count-limits — MAX_ARRAY_COUNT carried into the compiled decoder', () => {
    let c = codec();

    let AT = 1048576,   // 2^20 — inclusive boundary
        OVER = 1048577; // 2^20 + 1 — over the cap

    it('inlines no 1048576 literal in codegen.ts — the cap comes from the constant', () => {
        // Root-cause pin: constants.ts owns the value; codegen.ts must reference the
        // imported MAX_ARRAY_COUNT, never a fourth copy of the magic number.
        expect(readSource('constants.ts')).toContain('1048576');
        expect(readSource('codegen.ts')).not.toContain('1048576');
    });

    it('rejects an array count above 2^20 on the tagged decoder', () => {
        // tag 7 (generic array) + u32 count = 2^20 + 1, no elements
        let hostile = new Uint8Array([7, ...u32le(OVER)]);

        expect(() => c.decode(hostile)).toThrow(/array count \d+ exceeds limit/);
    });

    it('rejects an array count above 2^20 on the compiled decoder (parity with the tagged path)', () => {
        // Register a schema whose only field is a compiled (generic) array.
        let good = c.encode({ v: ['a'] }),
            // Generic-array field payload: [flag][u32 count]. Reuse the schema hash and
            // drive a hostile count past the cap so the compiled decoder rejects it.
            field = [0, ...u32le(OVER)],
            hostile = new Uint8Array([8, good[1]!, good[2]!, good[3]!, good[4]!, ...u32le(field.length), ...field]);

        expect(() => c.decode(hostile)).toThrow(/array count \d+ exceeds limit/);
    });

    it('accepts a count of exactly 2^20 — the cap is inclusive', () => {
        // A count OF exactly 2^20 passes the cap and only fails later on truncation,
        // proving the boundary is inclusive; 2^20 + 1 trips the cap itself.
        let atCap = new Uint8Array([12, ...u32le(AT)]),
            overCap = new Uint8Array([12, ...u32le(OVER)]);

        expect(() => c.decode(atCap)).toThrow(/truncated packed uint8 array/);
        expect(() => c.decode(atCap)).not.toThrow(/exceeds limit/);
        expect(() => c.decode(overCap)).toThrow(/array count \d+ exceeds limit/);
    });

    it('round-trips a normal array field through the compiled decoder', () => {
        let decoded = c.decode(c.encode({ v: ['x', 'y', 'z'] })) as { v: string[] };

        expect(decoded.v).toEqual(['x', 'y', 'z']);
    });
});


// === unify-packed-numeric-tags ===
// Tag 12 becomes the single typeId-carrying packed-numeric tag (tag-17 payload layout);
// tags 13/14 retire; the classifier widens to the narrowest lossless width; codegen's
// duplicate flag=1/2/3 enumeration is replaced by the shared TYPED_ARRAY_IDS table.
describe('unify-packed-numeric-tags — packed numeric arrays onto one typeId tag', () => {
    // Per-element cost measured as a length DELTA so the header/tag overhead cancels
    // and the assertion survives the header growing 5 -> 6 bytes.
    function bytesPerElement(input2: number[], input4: number[]): number {
        let c = codec();

        return (c.encode(input4).length - c.encode(input2).length) / (input4.length - input2.length);
    }

    it('packs a number[] at the narrowest lossless width', () => {
        // uint16 range: 2 bytes/element (today int32 packs it at 4 -> red)
        expect(bytesPerElement([0, 65535], [0, 65535, 0, 65535])).toBe(2);
        // int8 range: 1 byte/element (today int32 packs it at 4 -> red)
        expect(bytesPerElement([-5, 5], [-5, 5, -5, 5])).toBe(1);
        // float64: 8 bytes/element (unchanged)
        expect(bytesPerElement([1.5, 2.5], [1.5, 2.5, 3.5, 4.5])).toBe(8);
    });

    it('round-trips each narrowed width back to a plain number[]', () => {
        let c = codec();

        for (let input of [[0, 65535], [-5, 5], [1.5, 2.5]]) {
            let decoded = c.decode(c.encode(input));

            expect(Array.isArray(decoded)).toBe(true);
            expect(decoded).toEqual(input);
        }
    });

    it('retires tags 13 and 14 — decoding either throws unknown tag', () => {
        let c = codec();

        expect(() => c.decode(new Uint8Array([13, 0, 0, 0, 0]))).toThrow(/unknown tag/);
        expect(() => c.decode(new Uint8Array([14, 0, 0, 0, 0]))).toThrow(/unknown tag/);
    });

    it('keeps tag 17 typed arrays returning a TypedArray', () => {
        let c = codec(),
            decoded = c.decode(c.encode(new Int16Array([1, 2, 3])));

        expect(decoded).toBeInstanceOf(Int16Array);
        expect(Array.from(decoded as Int16Array)).toEqual([1, 2, 3]);
    });

    it('drives packed widths from the shared TYPED_ARRAY_IDS table in codegen.ts', () => {
        // The duplicate flag=1/2/3 enumeration is replaced by the one width authority.
        expect(readSource('codegen.ts')).toMatch(/TYPED_ARRAY_IDS/);
    });

    it('computeSize equals the encoded length for each narrowed width', () => {
        let c = codec();

        for (let input of [[0, 65535], [-5, 5], [1.5]]) {
            expect(c.computeSize(input)).toBe(c.encode(input).length);
        }
    });
});


// === codegen-uint16-hoist ===
// The scalar uint16 encoder arm must hoist its property read into a local like its
// int16/uint32/int32 siblings, emitting the value expression ONCE. Wire format is
// unchanged; the regression is pinned at the codegen source, behavior is invariant.
describe('codegen-uint16-hoist — uint16 arm hoists its property read', () => {
    let c = codec();

    it('interpolates the value expression exactly once in the scalar uint16 arm', () => {
        let src = readSource('codegen.ts'),
            start = src.indexOf("case 'uint16':"),
            arm = src.slice(start, src.indexOf('break;', start));

        // Pre-fix the arm reads `${val}` twice; the hoist folds it into one `let v=...`.
        expect(arm.split('${val}').length - 1).toBe(1);
    });

    it('writes a uint16 field little-endian (explicit byte payload)', () => {
        // 40000 = 0x9C40 -> field bytes [0x40, 0x9C] after the 9-byte tag-8 header.
        let buf = c.encode({ k: 40000 });

        expect(buf[0]).toBe(8);
        expect(buf.length).toBe(11);
        expect(buf[9]).toBe(0x40);
        expect(buf[10]).toBe(0x9C);
    });

    it('round-trips uint16 boundaries and truncates 65536 to 0', () => {
        let hash = c.defineSchema([{ name: 'k', type: 'uint16' }]);

        expect((c.decode(c.encode({ k: 0 }, { schema: hash })) as { k: number }).k).toBe(0);
        expect((c.decode(c.encode({ k: 65535 }, { schema: hash })) as { k: number }).k).toBe(65535);
        // 65536 is out of uint16 range; the fixed-width slot truncates it to 0.
        expect((c.decode(c.encode({ k: 65536 }, { schema: hash })) as { k: number }).k).toBe(0);
    });

    it('round-trips a schema mixing uint16 with its sibling integer widths', () => {
        let value = { a: 40000, b: -20000, c: 4000000000, d: -2000000000 },
            decoded = c.decode(c.encode(value)) as typeof value;

        expect(decoded).toEqual(value);
    });

    it('round-trips an array-of-uint16 field unchanged', () => {
        let decoded = c.decode(c.encode({ v: [0, 40000, 65535] })) as { v: number[] };

        expect(decoded.v).toEqual([0, 40000, 65535]);
    });
});
