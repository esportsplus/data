import { describe, expect, it } from 'vitest';

import type { StoredSchema } from '../../src/sbc/cache';

import { createAsyncCache } from '../../src/sbc/async';
import { createCache } from '../../src/sbc/cache';


function makeSchema(hash: number): StoredSchema {
    return { fields: [{ name: 'a', type: 'string' }], hash };
}


describe('createAsyncCache', () => {
    it('returns sync-cache hits without fetching', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            calls = 0;

        cache.set(1, makeSchema(1));

        let async = createAsyncCache(cache, async (keys) => {
            calls++;

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        let result = await async.all([1]);

        expect(calls).toBe(0);
        expect(result.get(1)!.hash).toBe(1);
    });

    it('batches all misses into a single fetch and writes them back', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            seen: number[][] = [];

        let async = createAsyncCache(cache, async (keys) => {
            seen.push([...keys]);

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        let result = await async.all([1, 2, 3]);

        expect(seen.length).toBe(1);
        expect(seen[0]!.sort()).toEqual([1, 2, 3]);
        expect(result.get(2)!.hash).toBe(2);
        // Written into the sync cache, so a second call needs no fetch.
        expect(cache.get(3)!.hash).toBe(3);

        await async.all([1, 2, 3]);

        expect(seen.length).toBe(1);
    });

    it('coalesces the same missing key across concurrent all() calls into one fetch', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            calls = 0,
            release!: () => void,
            gate = new Promise<void>(resolve => { release = resolve; });

        let async = createAsyncCache(cache, async (keys) => {
            calls++;

            await gate;

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        let a = async.all([5]),
            b = async.all([5]);

        release();

        let [ra, rb] = await Promise.all([a, b]);

        expect(calls).toBe(1);
        expect(ra.get(5)!.hash).toBe(5);
        expect(rb.get(5)!.hash).toBe(5);
    });

    it('caches a fetched superset so later keys need no fetch', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            calls = 0;

        let async = createAsyncCache(cache, async () => {
            calls++;

            // Superset: returns more than was asked for (a snapshot).
            return new Map([1, 2, 3].map(k => [k, makeSchema(k)] as [number, StoredSchema]));
        });

        await async.all([1]);
        await async.all([2]);
        await async.all([3]);

        expect(calls).toBe(1);
    });

    it('omits a key the fetch did not return', async () => {
        let cache = createCache<number, StoredSchema>(Infinity);

        let async = createAsyncCache(cache, async () => new Map<number, StoredSchema>());

        let result = await async.all([9]);

        expect(result.has(9)).toBe(false);
    });

    it('rejects the all() and clears in-flight so a later call retries', async () => {
        let cache = createCache<number, StoredSchema>(Infinity),
            calls = 0;

        let async = createAsyncCache(cache, async (keys) => {
            calls++;

            if (calls === 1) {
                throw new Error('boom');
            }

            return new Map(keys.map(k => [k, makeSchema(k)]));
        });

        await expect(async.all([7])).rejects.toThrow('boom');

        let result = await async.all([7]);

        expect(calls).toBe(2);
        expect(result.get(7)!.hash).toBe(7);
    });
});
