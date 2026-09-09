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
    let inflight = new Map<K, Promise<void>>();

    return {
        async all(keys) {
            let hits = new Map<K, V>(),
                misses: K[] = [],
                waits: Promise<void>[] = [];

            for (let i = 0, n = keys.length; i < n; i++) {
                let key = keys[i]!;

                if (hits.has(key)) {
                    continue;
                }

                let value = cache.get(key);

                if (value !== null) {
                    hits.set(key, value);

                    continue;
                }

                let pending = inflight.get(key);

                if (pending) {
                    waits.push(pending);
                }
                else {
                    misses.push(key);
                }
            }

            if (misses.length) {
                let request = fetch(misses)
                    .then((fetched) => {
                        for (let [key, value] of fetched) {
                            cache.set(key, value);
                        }
                    })
                    .finally(() => {
                        for (let i = 0, n = misses.length; i < n; i++) {
                            if (inflight.get(misses[i]!) === request) {
                                inflight.delete(misses[i]!);
                            }
                        }
                    });

                for (let i = 0, n = misses.length; i < n; i++) {
                    inflight.set(misses[i]!, request);
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
                        await waits[i];
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

                for (let i = 0, n = keys.length; i < n; i++) {
                    let key = keys[i]!;

                    if (!hits.has(key)) {
                        let value = cache.get(key);

                        if (value !== null) {
                            hits.set(key, value);
                        }
                    }
                }
            }

            return hits;
        },
    };
}


export { createAsyncCache };
export type { AsyncCache, Fetch };
