// Codec2 — SIEVE-evicted bounded cache

import type { FieldSpec } from './types';

type Cache<K, V> = {
    clear(): void;
    get(key: K): V | null;
    set(key: K, value: V): void;
};

type CacheEntry<K, V> = {
    key: K;
    next: CacheEntry<K, V> | null;
    prev: CacheEntry<K, V> | null;
    value: V;
    visited: boolean;
};

type SchemaCache = Cache<number, StoredSchema>;

type StoredSchema = {
    fields: FieldSpec[];
    hash: number;
};


const DEFAULT_MAX_SIZE = 1024;


// Each instance owns its entry graph, so two codecs given separate caches cannot
// resolve each other's shapes — the isolation `CodecOptions.store` alone cannot give,
// because a global cache hit short-circuits the per-codec store lookup entirely.
// `maxSize: Infinity` never evicts — use it when the cache is the authority others read from.
const createCache = <K = number, V = StoredSchema>(maxSize: number = DEFAULT_MAX_SIZE): Cache<K, V> => {
    // A bounded cache must be able to hold at least one entry: `set()` loops
    // `while (map.size >= maxSize)` and an empty graph cannot make progress, so
    // `maxSize <= 0` (or NaN) would spin forever. `Infinity` stays valid and
    // simply never evicts.
    if (!(maxSize >= 1)) {
        throw new Error(`@esportsplus/data: cache maxSize must be >= 1, received ${String(maxSize)}`);
    }

    let hand: CacheEntry<K, V> | null = null,
        head: CacheEntry<K, V> | null = null,
        map = new Map<K, CacheEntry<K, V>>(),
        tail: CacheEntry<K, V> | null = null;

    function evictOne(): void {
        let o = hand ?? tail;

        if (!o) {
            return;
        }

        for (let i = 0, n = 64; i < n && o.visited; i++) {
            o.visited = false;
            o = o.prev ?? tail!;
        }

        hand = o.prev;
        unlinkEntry(o);
        map.delete(o.key);
    }

    function unlinkEntry(entry: CacheEntry<K, V>): void {
        if (entry.prev) {
            entry.prev.next = entry.next;
        }
        else {
            head = entry.next;
        }

        if (entry.next) {
            entry.next.prev = entry.prev;
        }
        else {
            tail = entry.prev;
        }

        if (hand === entry) {
            hand = entry.prev;
        }

        entry.prev = entry.next = null;
    }

    return {
        clear(): void {
            hand = head = tail = null;
            map = new Map<K, CacheEntry<K, V>>();
        },

        get(key: K): V | null {
            let entry = map.get(key);

            if (!entry) {
                return null;
            }

            entry.visited = true;

            return entry.value;
        },

        set(key: K, value: V): void {
            let entry = map.get(key);

            if (entry) {
                // Overwrite the stored value and refresh its recency (SIEVE visited
                // bit), matching the bounded-cache contract rather than first-write-wins.
                entry.value = value;
                entry.visited = true;

                return;
            }

            while (map.size >= maxSize) {
                evictOne();
            }

            entry = { key, next: null, prev: null, value, visited: false };

            if (head) {
                entry.next = head;
                head.prev = entry;
            }
            else {
                tail = entry;
            }

            head = entry;
            map.set(key, entry);
        },
    };
}


export default createCache<number, StoredSchema>();
export { createCache };
export type { Cache, SchemaCache, StoredSchema };
