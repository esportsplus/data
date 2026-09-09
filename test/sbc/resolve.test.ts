import { describe, expect, it } from 'vitest';

import type { StoredSchema } from '../../src/sbc/cache';

import { codec } from '../../src/sbc';
import { createAsyncCache } from '../../src/sbc/async';
import { createCache } from '../../src/sbc/cache';
import { SchemaMissError } from '../../src/sbc/errors';
import { resolvable } from '../../src/sbc/resolve';


// A producer codec on its own cache, and an isolated consumer codec whose cache
// starts empty — the same realm boundary a separate process (or browser) has.
function realms() {
    let producerCache = createCache<number, StoredSchema>(Infinity),
        consumerCache = createCache<number, StoredSchema>(Infinity),
        producer = codec({ cache: producerCache }),
        consumer = codec({ cache: consumerCache });

    // Serves the consumer's misses out of the producer's cache, one batched call.
    let fetches: number[][] = [],
        fetch = async (keys: number[]) => {
            fetches.push([...keys]);

            let out = new Map<number, StoredSchema>();

            for (let key of keys) {
                let schema = producerCache.get(key);

                if (schema) {
                    out.set(key, schema);
                }
            }

            return out;
        };

    return { consumer, decode: resolvable(consumer, createAsyncCache(consumerCache, fetch)), fetches, producer };
}


describe('SchemaMissError', () => {
    it('is thrown by decode on an unknown hash and carries that hash', () => {
        let { consumer, producer } = realms(),
            buf = producer.encode({ id: 7, name: 'x' });

        let error: unknown;

        try {
            consumer.decode(buf);
        }
        catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(SchemaMissError);
        expect(typeof (error as SchemaMissError).hash).toBe('number');
    });
});


describe('resolvable', () => {
    it('decodes a foreign frame after fetching the missing shape', async () => {
        let { decode, fetches, producer } = realms(),
            buf = producer.encode({ id: 7, name: 'x' });

        let result = await decode<{ id: number; name: string }>(buf);

        expect(result).toEqual({ id: 7, name: 'x' });
        expect(fetches.length).toBe(1);
    });

    it('resolves a two-level nested miss in two fetches', async () => {
        let { decode, fetches, producer } = realms(),
            buf = producer.encode({ data: { deep: 1 }, id: 5 });

        let result = await decode<{ data: { deep: number }; id: number }>(buf);

        expect(result).toEqual({ data: { deep: 1 }, id: 5 });
        // One fetch for the envelope, one for the nested child.
        expect(fetches.length).toBe(2);
    });

    it('throws instead of looping when a fetched entry does not resolve its key', async () => {
        let consumerCache = createCache<number, StoredSchema>(Infinity),
            consumer = codec({ cache: consumerCache });

        // The fetch returns a schema whose fields hash to a DIFFERENT key than asked,
        // so defineSchema registers it elsewhere and the requested hash stays unknown.
        let fetch = async (keys: number[]) =>
            new Map<number, StoredSchema>(keys.map(k => [k, { fields: [{ name: 'z', type: 'string' }], hash: k }]));

        let producer = codec({ cache: createCache<number, StoredSchema>(Infinity) }),
            buf = producer.encode({ id: 7, name: 'x' }),
            decode = resolvable(consumer, createAsyncCache(consumerCache, fetch));

        await expect(decode(buf)).rejects.toBeInstanceOf(SchemaMissError);
    });
});
