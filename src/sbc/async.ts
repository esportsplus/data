// Async batch-fetch cache — wraps a sync Cache with a user-supplied fetch so a
// decode miss can resolve the missing shapes over I/O and retry. Exposes only
// `all`; the sync cache stays the source of truth every hit reads from.

import type { Cache } from './cache';


type AsyncCache<K, V> = {
    /** Resolved entries only; a key the fetch did not return is absent from the result. */
    all(keys: readonly K[]): Promise<Map<K, V>>;
};

// May return a superset of `keys` (e.g. a snapshot on the first call); every
// returned entry is written into the sync cache.
type Fetch<K, V> = (keys: K[]) => Promise<Map<K, V>>;


const createAsyncCache = <K, V>(cache: Cache<K, V>, fetch: Fetch<K, V>): AsyncCache<K, V> => {
    // In-flight entries carry the fetched Map itself, not just completion, so every
    // waiter can return the values that were actually fetched — even the ones the
    // bounded sync cache evicted immediately after insertion.
    let inflight = new Map<K, Promise<Map<K, V>>>();

    return {
        async all(keys) {
            let hits = new Map<K, V>(),
                misses: K[] = [],
                missSet = new Set<K>(),
                waits: Promise<Map<K, V>>[] = [];

            // Resolve cache hits and collect each distinct missing key exactly once.
            for (let i = 0, n = keys.length; i < n; i++) {
                let key = keys[i]!;

                if (hits.has(key) || missSet.has(key)) {
                    continue;
                }

                let value = cache.get(key);

                if (value !== null) {
                    hits.set(key, value);

                    continue;
                }

                missSet.add(key);
                misses.push(key);
            }

            // Split misses into ones already in flight and ones this call must fetch.
            let request: Promise<Map<K, V>> | null = null,
                requested: K[] | null = null;

            for (let i = 0, n = misses.length; i < n; i++) {
                let key = misses[i]!,
                    pending = inflight.get(key);

                if (pending) {
                    waits.push(pending);
                }
                else {
                    (requested ??= []).push(key);
                }
            }

            if (requested) {
                request = fetch(requested)
                    .then((fetched) => {
                        for (let [key, value] of fetched) {
                            cache.set(key, value);
                        }

                        return fetched;
                    })
                    .finally(() => {
                        for (let i = 0, n = requested!.length; i < n; i++) {
                            if (inflight.get(requested![i]!) === request) {
                                inflight.delete(requested![i]!);
                            }
                        }
                    });

                for (let i = 0, n = requested.length; i < n; i++) {
                    inflight.set(requested[i]!, request);
                }

                waits.push(request);
            }

            if (waits.length) {
                // Already in flight — a sequential join waits for all without serializing
                // real work, and awaiting every one (no early throw) keeps a losing fetch
                // from surfacing as an unhandled rejection.
                let failed = false,
                    failure: unknown;

                for (let i = 0, n = waits.length; i < n; i++) {
                    try {
                        let fetched = await waits[i];

                        // Return the fetched values directly rather than re-reading the
                        // bounded cache, which may already have evicted some of them.
                        for (let j = 0, m = keys.length; j < m; j++) {
                            let key = keys[j]!;

                            if (!hits.has(key) && fetched.has(key)) {
                                hits.set(key, fetched.get(key)!);
                            }
                        }
                    }
                    catch (error) {
                        if (!failed) {
                            failed = true;
                            failure = error;
                        }
                    }
                }

                if (failed) {
                    throw failure;
                }
            }

            return hits;
        },
    };
}


export { createAsyncCache };
export type { AsyncCache, Fetch };
