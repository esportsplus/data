import { beforeEach, describe, expect, it } from 'vitest';

import type { StoredSchema } from '../../src/sbc/cache';

import cache from '../../src/sbc/cache';


function makeSchema(hash: number, fields?: string[]): StoredSchema {
    return {
        fields: (fields ?? ['a', 'b']).map(name => ({ name, type: 'string' })),
        hash,
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
