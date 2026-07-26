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
