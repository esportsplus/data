import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


function readShapeHash(buf: Uint8Array): number {
    return (buf[1]! | (buf[2]! << 8) | (buf[3]! << 16) | (buf[4]! << 24)) >>> 0;
}


describe('SBC schema — nullable inference (infer-nullable-not-mixed)', () => {
    it('clause 1 — sample-order independence: null and number samples unify to one shape hash', () => {
        let a = codec();

        a.encode({ count: null });
        a.encode({ count: 7 });

        let aNull = readShapeHash(a.encode({ count: null })),
            aNumber = readShapeHash(a.encode({ count: 7 }));

        let b = codec();

        b.encode({ count: 7 });
        b.encode({ count: null });

        let bNull = readShapeHash(b.encode({ count: null })),
            bNumber = readShapeHash(b.encode({ count: 7 }));

        // Repro: one nullable field's null sample and number sample must collapse to a
        // SINGLE shape hash. Pre-fix null→'mixed' and 7→'uint8' split it into two hashes.
        expect(aNull).toBe(aNumber);
        expect(bNull).toBe(bNumber);
        expect(aNumber).toBe(bNumber);
        expect(aNull).toBe(bNull);
    });

    it('clause 2 — a null-first field stores a later number in its fixed-width nullable slot, not tag-encoded', () => {
        let ref = codec(),
            hMixed = ref.defineSchema([{ name: 'count', nullable: false, type: 'mixed' }]),
            hNullable = ref.defineSchema([{ name: 'count', nullable: true, type: 'uint16' }]);

        let mixedLen = ref.encode({ count: 1000 }, { schema: hMixed }).length,
            nullableLen = ref.encode({ count: 1000 }, { schema: hNullable }).length;

        let c = codec();

        c.encode({ count: null });

        let observedLen = c.encode({ count: 1000 }).length;

        expect(observedLen).toBe(nullableLen);
        expect(observedLen).toBeLessThan(mixedLen);
    });

    it('clause 3 — nullable and non-nullable number fields hash differently and each hashes stably', () => {
        let nonNullable = codec(),
            hNonNullable = readShapeHash(nonNullable.encode({ count: 7 }));

        let nullable = codec();

        nullable.encode({ count: 7 });
        nullable.encode({ count: null });

        let hNullable = readShapeHash(nullable.encode({ count: 7 }));

        expect(hNullable).not.toBe(hNonNullable);
        expect(readShapeHash(nonNullable.encode({ count: 7 }))).toBe(hNonNullable);
        expect(readShapeHash(nullable.encode({ count: 7 }))).toBe(hNullable);
    });

    it('clause 4 — a genuinely heterogeneous field survives as the mixed escape hatch and round-trips', () => {
        let c = codec();

        c.encode({ v: 1 });

        expect(c.decode(c.encode({ v: 'x' }))).toEqual({ v: 'x' });
        expect(c.decode(c.encode({ v: 1 }))).toEqual({ v: 1 });
    });

    it('clause 5 — {a: undefined} round-trips to {a: null} (undefined-collapse follow-up)', () => {
        let c = codec();

        expect(c.decode(c.encode({ a: undefined }))).toEqual({ a: null });
    });
});
