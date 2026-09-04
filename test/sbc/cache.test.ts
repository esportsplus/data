import { beforeEach, describe, expect, it } from 'vitest';

import type { StoredSchema } from '../../src/sbc/cache';

import cache, { createCache } from '../../src/sbc/cache';
import { codec } from '../../src/sbc';


function makeSchema(hash: number, fields?: string[]): StoredSchema {
    return {
        fields: (fields ?? ['a', 'b']).map(name => ({ name, type: 'string' })),
        hash,
    };
}

function makeCountingStore() {
    let entries = new Map<number, StoredSchema>(),
        gets = 0;

    return {
        get gets() {
            return gets;
        },
        get(hash: number): StoredSchema | null {
            gets++;

            return entries.get(hash) ?? null;
        },
        set(hash: number, schema: StoredSchema): void {
            entries.set(hash, schema);
        },
    };
}


describe('SIEVE cache', () => {
    beforeEach(() => {
        cache.clear();
    });

    it('clear() empties the cache', () => {
        cache.set(900001, makeSchema(900001));

        expect(cache.get(900001)).not.toBe(null);

        cache.clear();

        expect(cache.get(900001)).toBe(null);
    });

    it('stores and retrieves schemas', () => {
        cache.set(900002, makeSchema(900002));

        let result = cache.get(900002);

        expect(result).not.toBe(null);
        expect(result!.hash).toBe(900002);
    });

    it('returns null for unknown hash', () => {
        expect(cache.get(99999)).toBe(null);
    });

    it('set on an existing hash keeps the first-written schema (collision guard)', () => {
        let first = makeSchema(900003, ['x', 'y']),
            second = makeSchema(900003, ['p', 'q', 'r']);

        cache.set(900003, first);
        cache.set(900003, second);

        let result = cache.get(900003);

        expect(result).not.toBe(null);
        expect(result!.fields.length).toBe(2);
        expect(result!.fields[0]!.name).toBe('x');
        expect(result!.fields[1]!.name).toBe('y');
    });
});


describe('SIEVE cache eviction', () => {
    beforeEach(() => {
        cache.clear();
    });

    it('stays bounded at capacity across maxSize + 1 distinct hashes', () => {
        let base = 800000;

        for (let i = 0, n = 1025; i < n; i++) {
            cache.set(base + i, makeSchema(base + i, ['f' + i]));
        }

        // The most-recent insert is present; the oldest (unvisited) was evicted to stay bounded.
        expect(cache.get(base + 1024)).not.toBe(null);
        expect(cache.get(base + 1024)!.hash).toBe(base + 1024);
        expect(cache.get(base)).toBe(null);
    });

    it('a set-refreshed (visited) entry survives one eviction pass', () => {
        let base = 700000;

        // Fill to exactly capacity; every entry is unvisited.
        for (let i = 0, n = 1024; i < n; i++) {
            cache.set(base + i, makeSchema(base + i, ['g' + i]));
        }

        // Re-set the oldest entry (the tail): first-writer-wins keeps its schema but marks it visited.
        cache.set(base, makeSchema(base, ['ignored']));

        // The 1025th distinct insert triggers one eviction pass starting at the tail.
        cache.set(base + 1024, makeSchema(base + 1024, ['fresh']));

        // The visited tail survived (fields unchanged); the adjacent unvisited entry was evicted.
        let survived = cache.get(base);

        expect(survived).not.toBe(null);
        expect(survived!.fields[0]!.name).toBe('g0');
        expect(cache.get(base + 1)).toBe(null);
    });
});


describe('createCache instances', () => {
    it('two instances do not share entries', () => {
        let a = createCache(),
            b = createCache();

        a.set(600001, makeSchema(600001));

        expect(a.get(600001)).not.toBe(null);
        expect(b.get(600001)).toBe(null);
    });

    it('an instance does not share entries with the module default', () => {
        let isolated = createCache();

        cache.clear();
        cache.set(600002, makeSchema(600002));

        expect(isolated.get(600002)).toBe(null);

        isolated.set(600003, makeSchema(600003));

        expect(cache.get(600003)).toBe(null);
    });

    it('honors a caller-supplied maxSize', () => {
        let small = createCache(2);

        small.set(600004, makeSchema(600004));
        small.set(600005, makeSchema(600005));
        small.set(600006, makeSchema(600006));

        expect(small.get(600006)).not.toBe(null);
        expect(small.get(600004)).toBe(null);
    });
});


describe('CodecOptions.cache isolation', () => {
    beforeEach(() => {
        cache.clear();
    });

    it('codecs on the default cache share resolved shapes without a store', () => {
        let a = codec(),
            b = codec();

        let buf = a.encode({ id: 7, name: 'x' });

        // b never saw this shape itself — it resolves through the shared module singleton.
        expect(b.decode(buf)).toEqual({ id: 7, name: 'x' });
    });

    it('a dedicated cache stops one codec resolving another codec shape', () => {
        let a = codec(),
            b = codec({ cache: createCache() });

        let buf = a.encode({ id: 7, name: 'x' });

        // a's shape landed in the module singleton; b owns a separate cache and has
        // no store to fall back on, so the shape is genuinely unresolvable to it.
        expect(() => b.decode(buf)).toThrow('@esportsplus/data: codec');
    });

    it('an isolated codec does not publish inferred shapes to the default cache', () => {
        let a = codec({ cache: createCache() }),
            b = codec();

        let buf = a.encode({ id: 7, name: 'x' });

        expect(() => b.decode(buf)).toThrow('@esportsplus/data: codec');
    });

    it('an isolated codec consults its own store instead of the shared cache', () => {
        let store = makeCountingStore(),
            a = codec(),
            b = codec({ cache: createCache(), store });

        let buf = a.encode({ id: 7, name: 'x' });

        expect(() => b.decode(buf)).toThrow('@esportsplus/data: codec');

        // The store lookup a singleton hit would have skipped actually happened.
        expect(store.gets).toBeGreaterThanOrEqual(1);
    });
});
