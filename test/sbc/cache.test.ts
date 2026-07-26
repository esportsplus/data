import { describe, expect, it } from 'vitest';

import type { StoredSchema } from '../../src/sbc/cache';

import cache from '../../src/sbc/cache';


const MAX_SIZE = 1024; // maxSize per src/sbc/cache.ts


function makeSchema(hash: number, fields: string[]): StoredSchema {
    return {
        fields: fields.map(name => ({ name, type: 'string' })),
        hash,
    };
}


describe('sbc cache clear() (sbc-cache-isolation)', () => {
    it('clear() empties the cache', () => {
        let hash = 950001,
            schema = makeSchema(hash, ['only']);

        cache.set(hash, schema);

        expect(cache.get(hash)).not.toBe(null);

        cache.clear();

        expect(cache.get(hash)).toBe(null);
    });
});


describe('sbc cache first-writer-wins (sbc-cache-isolation)', () => {
    it('keeps the first-written schema on a duplicate set (collision guard)', () => {
        let hash = 950002,
            schemaA = makeSchema(hash, ['x', 'y']),
            schemaB = makeSchema(hash, ['p', 'q', 'r']);

        cache.set(hash, schemaA);
        cache.set(hash, schemaB);

        let result = cache.get(hash);

        expect(result).not.toBe(null);
        expect(result!.fields.length).toBe(2);
        expect(result!.fields.map(f => f.name)).toEqual(['x', 'y']);
    });
});


describe('sbc cache SIEVE eviction (sbc-cache-isolation)', () => {
    it('keeps recent entries retrievable across maxSize + 1 distinct inserts', () => {
        let base = 951000;

        for (let i = 0, n = MAX_SIZE + 1; i < n; i++) {
            cache.set(base + i, makeSchema(base + i, ['f' + i]));
        }

        expect(cache.get(base + MAX_SIZE)).not.toBe(null);
        expect(cache.get(base + MAX_SIZE)!.hash).toBe(base + MAX_SIZE);
        expect(cache.get(base + MAX_SIZE - 1)).not.toBe(null);
    });

    it('a visited entry survives one eviction pass while an unvisited neighbor is evicted', () => {
        let base = 960000;

        cache.clear();

        for (let i = 0, n = MAX_SIZE; i < n; i++) {
            cache.set(base + i, makeSchema(base + i, ['s' + i]));
        }

        cache.get(base);

        cache.set(base + MAX_SIZE, makeSchema(base + MAX_SIZE, ['overflow']));

        expect(cache.get(base)).not.toBe(null);
        expect(cache.get(base + 1)).toBe(null);
    });
});
