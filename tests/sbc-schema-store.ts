import { describe, expect, it } from 'vitest';
import { createCodec } from '../src/sbc';

import type { StoredSchema } from '../src/sbc/cache';

import cache from '../src/sbc/cache';


function makeSchema(hash: number, fields?: string[]): StoredSchema {
    return {
        fields: (fields ?? ['a', 'b']).map(name => ({ name, type: 'string' })),
        hash,
    };
}


describe('SIEVE cache', () => {
    it('stores and retrieves schemas', () => {
        let schema = makeSchema(900001);

        cache.set(900001, schema);

        let result = cache.get(900001);

        expect(result).not.toBe(null);
        expect(result!.hash).toBe(900001);
    });

    it('returns null for unknown hash', () => {
        expect(cache.get(99999)).toBe(null);
    });

    it('overwrites existing entry on duplicate set', () => {
        let schemaA = makeSchema(900002, ['x', 'y']),
            schemaB = makeSchema(900002, ['p', 'q', 'r']);

        cache.set(900002, schemaA);
        cache.set(900002, schemaB);

        let result = cache.get(900002);

        expect(result).not.toBe(null);
        expect(result!.fields.length).toBe(3);
        expect(result!.fields[0]!.name).toBe('p');
    });
});


describe('Codec schema sharing', () => {
    it('cross-instance encode/decode via shared SIEVE cache (no store)', () => {
        let codecA = createCodec(),
            codecB = createCodec();

        let encoded = codecA.encode({ age: 30, name: 'Alice' }),
            decoded = codecB.decode(encoded) as Record<string, unknown>;

        expect(decoded.name).toBe('Alice');
        expect(decoded.age).toBe(30);
    });

    it('cross-instance encode/decode via mock persistent store', () => {
        let storage = new Map<number, StoredSchema>(),
            store = {
                get(h: number) { return storage.get(h) ?? null; },
                set(h: number, s: StoredSchema) { storage.set(h, s); },
            };

        let codecA = createCodec({ store }),
            codecB = createCodec({ store });

        let buf = codecA.encode({ x: 1, y: 2 }),
            decoded = codecB.decode(buf) as Record<string, unknown>;

        expect(decoded.x).toBe(1);
        expect(decoded.y).toBe(2);
        expect(storage.size).toBeGreaterThan(0);
    });

    it('local registry hit on repeated decode', () => {
        let codec = createCodec();

        let buf = codec.encode({ a: 1 }),
            first = codec.decode(buf) as Record<string, unknown>,
            second = codec.decode(buf) as Record<string, unknown>;

        expect(first.a).toBe(1);
        expect(second.a).toBe(1);
    });

    it('nested objects store both parent and child schemas', () => {
        let storage = new Map<number, StoredSchema>(),
            store = {
                get(h: number) { return storage.get(h) ?? null; },
                set(h: number, s: StoredSchema) { storage.set(h, s); },
            };

        let codec = createCodec({ store });

        codec.encode({ active: true, user: { age: 30, name: 'Alice' } });

        expect(storage.size).toBeGreaterThanOrEqual(2);

        let childFound = false;

        for (let [, schema] of storage) {
            let names = schema.fields.map(f => f.name).sort();

            if (names.length === 2 && names[0] === 'age' && names[1] === 'name') {
                childFound = true;
                break;
            }
        }

        expect(childFound).toBe(true);
    });

    it('compressed codec cross-instance via shared cache', () => {
        let codecA = createCodec({ compress: true }),
            codecB = createCodec({ compress: true });

        let data = { active: true, age: 30, score: 99.5 },
            encoded = codecA.encode(data),
            decoded = codecB.decode(encoded) as Record<string, unknown>;

        expect(decoded.active).toBe(true);
        expect(decoded.age).toBe(30);
        expect(decoded.score).toBe(99.5);
    });
});
