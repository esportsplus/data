import { beforeEach, describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';

import type { PersistentStore } from '../../src/sbc/types';
import type { StoredSchema } from '../../src/sbc/cache';

import cache from '../../src/sbc/cache';


type CountingStore = PersistentStore & {
    getCount: number;
    resetCounts(): void;
    setCount: number;
};


function countingStore(): CountingStore {
    let storage = new Map<number, StoredSchema>();

    return {
        getCount: 0,
        get(hash: number): StoredSchema | null {
            this.getCount++;

            return storage.get(hash) ?? null;
        },
        resetCounts(): void {
            this.getCount = 0;
            this.setCount = 0;
        },
        set(hash: number, schema: StoredSchema): void {
            this.setCount++;
            storage.set(hash, schema);
        },
        setCount: 0,
    };
}


// Every case runs COLD: cache.clear() drops the module singleton so a decode cannot be
// satisfied by a warm shared entry before the store is consulted, and each codec() is a
// fresh closure-local registry. This is what makes the store round trip observable — the
// prior suite measured store.get() invocations of 0 because the singleton always hit first.
describe('PersistentStore lazy resolution (cold)', () => {
    beforeEach(() => {
        cache.clear();
    });

    it('resolves a cross-codec schema from the store, measuring get() >= 1', () => {
        let store = countingStore();

        let encoder = codec({ store }),
            buf = encoder.encode({ alpha: 'hello', beta: 42 });

        // Drop the warm singleton so the reader cannot short-circuit the store lookup.
        cache.clear();
        store.resetCounts();

        let reader = codec({ store }),
            decoded = reader.decode(buf) as Record<string, unknown>;

        expect(decoded.alpha).toBe('hello');
        expect(decoded.beta).toBe(42);
        expect(store.getCount).toBeGreaterThanOrEqual(1);
    });

    it('fails decode with the named error when the store has no schema (cold + null store)', () => {
        let encoder = codec(),
            buf = encoder.encode({ gamma: 1, delta: 2 });

        cache.clear();

        let nullStore: PersistentStore = {
            get() { return null; },
            set() {},
        };

        let reader = codec({ store: nullStore });

        expect(() => reader.decode(buf)).toThrow(/@esportsplus\/data: codec unknown schema hash \d+/);
    });

    it('memoizes a store hit: a second decode of the same hash adds no further get()', () => {
        let store = countingStore();

        let encoder = codec({ store }),
            buf = encoder.encode({ one: 1, two: 2 });

        cache.clear();
        store.resetCounts();

        let reader = codec({ store });

        expect((reader.decode(buf) as Record<string, unknown>).one).toBe(1);

        let afterFirst = store.getCount;

        expect(afterFirst).toBeGreaterThanOrEqual(1);

        expect((reader.decode(buf) as Record<string, unknown>).one).toBe(1);

        // The first decode populated cache + local registry; the second consults neither the store.
        expect(store.getCount).toBe(afterFirst);
    });

    it('persists nested parent and child schemas to the store', () => {
        let store = countingStore();

        let encoder = codec({ store });

        encoder.encode({ active: true, user: { age: 30, name: 'Alice' } });

        expect(store.setCount).toBeGreaterThanOrEqual(2);
    });
});
