import { describe, expect, it } from 'vitest';
import { codec } from '../src/sbc';


// Regression: decode()'s cross-call fast-path dispatches dctx.lastDecodeFn whenever
// hash === dctx.lastDecodeHash. decodeSbc() case 8 (used by decodeAt) updated lastDecodeHash
// + lastDecodeSchema but left lastDecodeFn stale, so a decode() after a decodeAt() of a
// different shape ran the prior shape's decodeFn on this shape's bytes ("truncated string" /
// silent corruption). One shared codec instance decoding via both entry points reproduces it.
describe('Codec2 decode/decodeAt interleave', () => {
    it('decode() after decodeAt() of a different shape decodes correctly', () => {
        let c = codec();

        let a = { x: 'alpha', y: 1 },
            b = { p: true, q: [10, 20, 30], r: 'zeta' };

        let ea = c.encode(a),
            eb = c.encode(b);

        // Prime the cache with shape A's decodeFn (lastDecodeFn = fnA, lastDecodeHash = hashA).
        expect(c.decode(ea)).toEqual(a);

        // decodeAt shape B: moves lastDecodeHash/lastDecodeSchema to B, must also move lastDecodeFn.
        expect(c.decodeAt(eb, 0)).toEqual(b);

        // Without the fix this dispatches fnA on B's bytes → wrong value or a decode throw.
        expect(c.decode(eb)).toEqual(b);
    });

    it('survives repeated interleaving of two shapes through both entry points', () => {
        let c = codec();

        let a = { name: 'a', tags: ['t1', 't2'] },
            b = { active: false, count: 7, label: 'b' };

        let ea = c.encode(a),
            eb = c.encode(b);

        for (let i = 0; i < 8; i++) {
            expect(c.decodeAt(ea, 0)).toEqual(a);
            expect(c.decode(eb)).toEqual(b);
            expect(c.decode(ea)).toEqual(a);
            expect(c.decodeAt(eb, 0)).toEqual(b);
        }
    });
});
