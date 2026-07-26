import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';

import type { StoredSchema } from '../../src/sbc';


function readShapeHash(buf: Uint8Array): number {
    return (buf[1]! | (buf[2]! << 8) | (buf[3]! << 16) | (buf[4]! << 24)) >>> 0;
}


describe('SBC schema — nullable inference defers base type instead of collapsing to mixed', () => {
    it('case 1 — sample-order independence: [null, 7] and [7, null] converge on one final shape hash', () => {
        let a = codec(),
            bufA1 = a.encode({ count: null }),
            bufA2 = a.encode({ count: 7 });

        let b = codec();

        b.encode({ count: 7 });

        let bufB2 = b.encode({ count: null });

        expect(readShapeHash(bufA2)).toBe(readShapeHash(bufB2));
        expect(readShapeHash(bufA1)).not.toBe(readShapeHash(bufA2));
    });

    it('case 2 — a null-first field takes the fixed-width nullable slot once resolved, not the tag-encoded slot', () => {
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

    it('case 3 — nullable and non-nullable same-base fields hash differently, on both the inference and declared paths', () => {
        let plain = codec(),
            hPlain = readShapeHash(plain.encode({ count: 7 }));

        expect(readShapeHash(plain.encode({ count: 8 }))).toBe(hPlain);

        let nullableA = codec();

        nullableA.encode({ count: 7 });

        let hNullableA = readShapeHash(nullableA.encode({ count: null }));

        // Re-derive independently — same [7, null] order, a fresh codec — to confirm the
        // resolved hash is reproducible rather than an artifact of one codec's internal state.
        let nullableB = codec();

        nullableB.encode({ count: 7 });

        let hNullableB = readShapeHash(nullableB.encode({ count: null }));

        expect(hNullableA).toBe(hNullableB);
        expect(hNullableA).not.toBe(hPlain);

        let declared = codec(),
            hDeclaredPlain = declared.defineSchema([{ name: 'count', nullable: false, type: 'uint8' }]),
            hDeclaredNullable = declared.defineSchema([{ name: 'count', nullable: true, type: 'uint8' }]);

        expect(hDeclaredNullable).not.toBe(hDeclaredPlain);
    });

    it('case 4 — a buffer encoded under the provisional schema still decodes after the field resolves', () => {
        let c = codec(),
            bufProvisional = c.encode({ count: null }),
            bufResolved = c.encode({ count: 7 }),
            bufProvisionalAgain = c.encode({ count: null });

        expect(c.decode(bufProvisional)).toEqual({ count: null });
        expect(c.decode(bufResolved)).toEqual({ count: 7 });
        expect(c.decode(bufProvisionalAgain)).toEqual({ count: null });
    });

    it('case 5 — a genuinely heterogeneous field survives as the mixed escape hatch and round-trips', () => {
        let c = codec();

        c.encode({ v: 1 });

        expect(c.decode(c.encode({ v: 'x' }))).toEqual({ v: 'x' });
        expect(c.decode(c.encode({ v: 1 }))).toEqual({ v: 1 });
    });

    it('case 6 — {a: undefined} round-trips to {a: null} (documented undefined-collapse, unaffected by this fix)', () => {
        let c = codec();

        expect(c.decode(c.encode({ a: undefined }))).toEqual({ a: null });
    });

    it('case 7 — the provisional schema never reaches the PersistentStore; the resolved schema does', () => {
        let backing = new Map<number, StoredSchema>(),
            c = codec({
                store: {
                    get: (hash) => backing.get(hash) ?? null,
                    set: (hash, schema) => backing.set(hash, schema),
                },
            });

        let bufProvisional = c.encode({ count: null }),
            provisionalHash = readShapeHash(bufProvisional);

        expect(backing.has(provisionalHash)).toBe(false);

        let bufResolved = c.encode({ count: 7 }),
            resolvedHash = readShapeHash(bufResolved);

        expect(backing.has(resolvedHash)).toBe(true);
    });
});
