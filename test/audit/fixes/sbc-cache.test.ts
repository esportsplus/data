// Proof-of-fix spec — corrected SBC cache/async behavior.
//
// These tests assert the CORRECTED behaviour for the findings reported in
// test/audit/sbc-limits-types.test.ts (H8) and
// test/audit/sbc-lossless-ingestion.test.ts (M4a, M4b). The original audit
// files intentionally still assert the old buggy behaviour and are expected
// to fail; this file is the green counterpart.
//
// Findings covered:
//   H8  — createCache(0)/negative capacity must be rejected instead of looping.
//   M4a — set() on an existing key must overwrite its value (and refresh recency).
//   M4b — async batch must return every fetched result, regardless of cache capacity.

import { describe, expect, it } from 'vitest';

import { createAsyncCache } from '../../../src/sbc/async';
import { createCache } from '../../../src/sbc/cache';

import type { StoredSchema } from '../../../src/sbc/cache';


function makeSchema(hash: number, fields: string[] = ['a']): StoredSchema {
    return { fields: fields.map(name => ({ name, type: 'string' })), hash };
}


// ---------------------------------------------------------------------------
// H8 — capacity validation (no unbounded synchronous loop)
// ---------------------------------------------------------------------------
//
// SAFETY: `createCache(n)` now validates synchronously and throws before any
// `set()` loop can run, so `createCache(0).set(...)` can never spin. All of the
// assertions below are therefore safe to run in-process.
describe('H8 fix — invalid capacity is rejected up front', () => {
    it('createCache(0) throws synchronously instead of looping', () => {
        expect(() => createCache(0)).toThrow('@esportsplus/data: cache maxSize must be >= 1');
    });

    it('createCache(0).set(...) is unreachable because construction throws', () => {
        // Model the exact dangerous call from the audit: it must not enter a loop.
        expect(() => {
            let c = createCache<number, StoredSchema>(0);

            c.set('a' as unknown as number, makeSchema(1));
        }).toThrow();
    });

    it('negative and non-finite capacities are rejected', () => {
        expect(() => createCache(-1)).toThrow('@esportsplus/data: cache maxSize must be >= 1');
        expect(() => createCache(-Infinity)).toThrow('@esportsplus/data: cache maxSize must be >= 1');
        expect(() => createCache(Number.NaN)).toThrow('@esportsplus/data: cache maxSize must be >= 1');
    });

    it('Infinity remains valid and never evicts', () => {
        let c = createCache<number, StoredSchema>(Infinity);

        for (let i = 0; i < 10; i++) {
            c.set(i, makeSchema(i));
        }

        for (let i = 0; i < 10; i++) {
            expect(c.get(i)).not.toBe(null);
        }
    });

    it('a valid positive capacity still evicts and stays bounded', () => {
        let c = createCache<number, StoredSchema>(2);

        c.set(1, makeSchema(1));
        c.set(2, makeSchema(2));
        c.set(3, makeSchema(3));

        expect(c.get(3)).not.toBe(null);
        expect(c.get(2)).not.toBe(null);
        expect(c.get(1)).toBe(null);
    });
});


// ---------------------------------------------------------------------------
// M4a — set() on an existing key overwrites the value
// ---------------------------------------------------------------------------
describe('M4a fix — set() overwrites an existing key', () => {
    it('set(k, second) replaces the first-written value', () => {
        let cache = createCache<number, StoredSchema>(2),
            first = makeSchema(1, ['first']),
            second = makeSchema(1, ['second']);

        cache.set(1, first);
        cache.set(1, second);

        let retained = cache.get(1);

        expect(retained).not.toBe(null);
        expect(retained!.fields[0]!.name).toBe('second');
        expect(retained!.fields).toEqual(second.fields);
    });

    it('overwriting does not grow the cache beyond its capacity', () => {
        let cache = createCache<number, StoredSchema>(1);

        cache.set(1, makeSchema(1, ['a']));
        cache.set(1, makeSchema(1, ['b']));
        cache.set(1, makeSchema(1, ['c']));

        expect(cache.get(1)!.fields[0]!.name).toBe('c');

        // Still bounded: a new key evicts the single existing entry.
        cache.set(2, makeSchema(2, ['d']));

        expect(cache.get(2)!.fields[0]!.name).toBe('d');
        expect(cache.get(1)).toBe(null);
    });

    it('overwriting refreshes recency so the entry survives an eviction pass', () => {
        let cache = createCache<number, StoredSchema>(2);

        cache.set(1, makeSchema(1, ['old']));
        cache.set(2, makeSchema(2, ['b']));

        // Re-set the oldest entry: value is replaced and the SIEVE visited bit is set.
        cache.set(1, makeSchema(1, ['new']));

        // This insert forces an eviction pass; the refreshed entry must survive.
        cache.set(3, makeSchema(3, ['c']));

        expect(cache.get(1)).not.toBe(null);
        expect(cache.get(1)!.fields[0]!.name).toBe('new');
        expect(cache.get(2)).toBe(null);
        expect(cache.get(3)).not.toBe(null);
    });
});


// ---------------------------------------------------------------------------
// M4b — async batch returns every fetched result
// ---------------------------------------------------------------------------
describe('M4b fix — async batch is lossless under a bounded cache', () => {
    it('capacity 1, all([1, 2]) returns both fetched keys', async () => {
        let cache = createCache<number, StoredSchema>(1),
            async = createAsyncCache(cache, async (keys) => new Map(keys.map(k => [k, makeSchema(k)])));

        let result = await async.all([1, 2]);

        // The result is built from the fetch directly, not rebuilt from the cache.
        expect(result.has(1)).toBe(true);
        expect(result.has(2)).toBe(true);
        expect(result.get(1)!.hash).toBe(1);
        expect(result.get(2)!.hash).toBe(2);

        // The bounded cache still only retains what fits.
        expect(cache.get(1)).toBe(null);
        expect(cache.get(2)).not.toBe(null);
    });

    it('dedupes repeated misses within a single all() call', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            seen: number[][] = [];

        let async = createAsyncCache(cache, async (keys) => {
            seen.push([...keys]);

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        let result = await async.all([1, 1, 2, 2, 1]);

        expect(seen.length).toBe(1);
        expect(seen[0]!.slice().sort()).toEqual([1, 2]);
        expect(result.get(1)!.hash).toBe(1);
        expect(result.get(2)!.hash).toBe(2);
    });

    it('returns requested keys even when the fetch superset is evicted by capacity', async () => {
        let cache = createCache<number, StoredSchema>(1);

        let async = createAsyncCache(cache, async () =>
            new Map([1, 2, 3].map(k => [k, makeSchema(k)] as [number, StoredSchema])));

        let result = await async.all([1, 2]);

        expect(result.has(1)).toBe(true);
        expect(result.has(2)).toBe(true);
    });

    it('coalesces concurrent same-key misses and returns the value to every caller', async () => {
        let cache = createCache<number, StoredSchema>(1),
            calls = 0,
            release!: () => void,
            gate = new Promise<void>(resolve => { release = resolve; });

        let async = createAsyncCache(cache, async (keys) => {
            calls++;

            await gate;

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        let a = async.all([5, 6]),
            b = async.all([5, 6]);

        release();

        let [ra, rb] = await Promise.all([a, b]);

        expect(calls).toBe(1);
        expect(ra.get(5)!.hash).toBe(5);
        expect(ra.get(6)!.hash).toBe(6);
        expect(rb.get(5)!.hash).toBe(5);
        expect(rb.get(6)!.hash).toBe(6);
    });

    it('omits a key the fetch did not return', async () => {
        let cache = createCache<number, StoredSchema>(1);

        let async = createAsyncCache(cache, async () => new Map<number, StoredSchema>());

        let result = await async.all([9]);

        expect(result.has(9)).toBe(false);
    });
});
