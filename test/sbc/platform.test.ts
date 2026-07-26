import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


function readSource(rel: string): string {
    return readFileSync(new URL('../../src/sbc/' + rel, import.meta.url), 'utf8');
}


// === bigint-int64-parity ===
// int64 writes must have ONE range behavior across Node and browser: a named throw
// at the encode call site, never Node's silent ERR_OUT_OF_RANGE-into-grow-loop nor
// the browser's silent modulo-2^64 wrap. The schema vocabulary renames bigint -> int64.
describe('bigint-int64-parity — one int64 range behavior; int64 vocabulary', () => {
    it('rejects an out-of-int64 bigint with a named error instead of hanging', () => {
        // Pre-fix these HANG: writeBigInt64LE throws RangeError, which the encode
        // grow-loop mistakes for buffer-too-small and doubles until OOM. The call-site
        // range check stops the value at source with a named Codec2 error.
        let c = codec();

        expect(() => c.encode(2n ** 63n)).toThrow(/Codec2: bigint out of int64 range/);
        expect(() => c.encode(-(2n ** 63n) - 1n)).toThrow(/Codec2: bigint out of int64 range/);
    });

    it('round-trips the int64 boundary values exactly', () => {
        let c = codec();

        expect(c.decode(c.encode(2n ** 63n - 1n))).toBe(2n ** 63n - 1n);
        expect(c.decode(c.encode(-(2n ** 63n)))).toBe(-(2n ** 63n));
    });

    it('renames the schema vocabulary from bigint to int64', () => {
        // FIELD_SIZES + KNOWN_TYPES must carry int64, not the misnamed bigint.
        let src = readSource('constants.ts');

        expect(src).toMatch(/int64/);
        expect(src).not.toMatch(/\bbigint\b/);
    });

    it('refuses a field typed bigint and accepts one typed int64', () => {
        let c = codec();

        expect(() => c.defineSchema([{ name: 'x', type: 'bigint' }])).toThrow(/unknown field type/);
        expect(() => c.defineSchema([{ name: 'x', type: 'int64' }])).not.toThrow();
    });

    it('round-trips an int64 field through the compiled path with exact size', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'x', type: 'int64' }]),
            value = { x: 123456789012345n },
            buf = c.encode(value, { schema: hash });

        expect((c.decode(buf) as { x: bigint }).x).toBe(123456789012345n);
        expect(c.computeSize(value)).toBe(buf.length);
    });
});
