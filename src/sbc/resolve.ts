// Resolvable decode — retries a sync decode across schema misses, fetching the
// missing shape through an AsyncCache between attempts. The `attempted` guard
// turns "fetched, cached, still unknown" (a stored entry whose fields hash to a
// different key) into a hard error instead of an infinite loop.

import { SchemaMissError } from './errors';

import type { AsyncCache } from './async';
import type { StoredSchema } from './cache';


type Decoder = { decode<T = unknown>(buffer: Uint8Array): T };


const resolvable = (codec: Decoder, schemas: AsyncCache<number, StoredSchema>) =>
    async <T = unknown>(buffer: Uint8Array): Promise<T> => {
        let attempted: Set<number> | null = null;

        for (;;) {
            try {
                return codec.decode<T>(buffer);
            }
            catch (error) {
                if (!(error instanceof SchemaMissError) || attempted?.has(error.hash)) {
                    throw error;
                }

                (attempted ??= new Set()).add(error.hash);

                if (!(await schemas.all([error.hash])).has(error.hash)) {
                    throw error;
                }
            }
        }
    };


export { resolvable };
export type { Decoder };
