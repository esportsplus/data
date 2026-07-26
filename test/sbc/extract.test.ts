import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { codec } from '../../src/sbc';


describe('Codec2 extractField — decoder-count-limits (fix)', () => {
    describe('hostile array count (clause A)', () => {
        it('throws a Codec2 error when a preceding array count walks pos past the buffer end', () => {
            let c = codec(),
                // sorted keys → field order: arr (0, generic packed-uint8 array), child (1, untyped object)
                valid = c.encode({ arr: [1, 2, 3], child: { x: 1 } }),
                hostile = Uint8Array.from(valid);

            // Field data starts at offset 9 (9-byte header, 0 bitmap bytes for non-nullable fields).
            // arr encodes as: [9]=flag(1=packed uint8), [10..13]=u32 count (LE), [14..16]=raw bytes.
            expect(hostile[9]).toBe(1);
            expect(hostile[10]).toBe(3);

            // Overwrite the u32 count with 0x7FFFFFFF (> 2^20 MAX_ARRAY_COUNT) so the unchecked
            // `pos += count` skip walks past the buffer before the target field is read.
            hostile[10] = 0xFF;
            hostile[11] = 0xFF;
            hostile[12] = 0xFF;
            hostile[13] = 0x7F;

            expect(() => c.extractField(hostile, 'child')).toThrow('Codec2:');
        });
    });

    describe('happy path (clause B)', () => {
        it('extracts fields from a valid buffer, round-tripping to the encoded values', () => {
            let c = codec(),
                buf = c.encode({ arr: [1, 2, 3], child: { x: 1 }, name: 'test' });

            expect(c.extractField(buf, 'arr')).toEqual([1, 2, 3]);
            expect(c.extractField(buf, 'child')).toEqual({ x: 1 });
            expect(c.extractField(buf, 'name')).toBe('test');
        });
    });

    describe('source guard', () => {
        it('extract.ts imports MAX_ARRAY_COUNT and uses no bare 1048576 literal', () => {
            let src = readFileSync(new URL('../../src/sbc/extract.ts', import.meta.url), 'utf8');

            expect(src).toContain('MAX_ARRAY_COUNT');
            expect(src).not.toContain('1048576');
        });
    });
});
