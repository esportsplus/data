// Audit spec — SBC decode-safety: STANDING (deferred) finding.
//
// H1 (payload-boundary / depth enforcement) and M3 (encode/decode limit asymmetry) were
// fixed; their regression guards now live in test/audit/fixes/sbc-core.test.ts. What remains
// here is B2, a behavioural characteristic (not a correctness bug) that documents where the
// runtime JIT is reachable — it is the target of the compile-time-only refactor, so this test
// asserts the CURRENT behaviour and is expected to change when that refactor lands.
//
// Buffer shape for an uncompressed object: [8][u32 shapeHash][u32 payloadLen][payload...]

import { describe, expect, it } from 'vitest';
import { codec, createCache } from '../../src/sbc';

import type { PersistentStore } from '../../src/sbc';


type Stored = Parameters<PersistentStore['set']>[1];


function readU32(buf: Uint8Array, off: number): number {
    return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

// Each codec gets a private SIEVE cache so tests cannot satisfy a lookup from the module
// singleton and accidentally mask the behavior under test. Any `store` passed in is shared.
function freshCodec(store?: PersistentStore) {
    return codec({ cache: createCache(), ...(store ? { store } : {}) });
}


describe('audit: SBC decode safety', () => {
    describe('B2 — JIT reachable mid-decode (standing / refactor target)', () => {
        // A compiled decoder for an inferred `object` field (no refHash) resolves an embedded
        // child schema via _lk === resolveSchemaFromCacheOrStore -> defineSchema() -> compileSchema().
        // If the outer schema is already local but the embedded child schema is not, the child is
        // compiled in the middle of decode(), not at decode entry.
        it('B2: decode of an embedded unknown object schema compiles it mid-decode via _lk', () => {
            let storeMap = new Map<number, Stored>(),
                storeSetHashes: number[] = [],
                storeGetCount = 0,
                store: PersistentStore = {
                    get(hash: number) {
                        storeGetCount++;
                        return storeMap.get(hash) ?? null;
                    },
                    set(hash: number, schema: Stored) {
                        storeSetHashes.push(hash);
                        storeMap.set(hash, schema);
                    },
                };

            // Writer registers outer + inner in the shared store; its own cache is private.
            let writer = freshCodec(store),
                buf = writer.encode({ outer: { x: 5 } }),
                outerHash = readU32(buf, 1);

            // Inferred nested objects are written inline as a full tag-8 object at payload start.
            expect(buf[9]).toBe(8);

            let innerHash = readU32(buf, 10);

            expect(innerHash).not.toBe(outerHash);

            // Reader has a private cache and its own (empty) registry, sharing only the store.
            // Pre-register ONLY the outer schema locally so resolveSchemaFromCacheOrStore is not
            // reached at decode entry; it must be reached from inside the compiled outer decoder.
            let reader = freshCodec(store),
                definedOuter = reader.defineSchema([{ name: 'outer', type: 'object' }]);

            expect(definedOuter).toBe(outerHash);

            let getsBefore = storeGetCount,
                setsBefore = storeSetHashes.length;

            let decoded = reader.decode<{ outer: { x: number } }>(buf);

            expect(decoded).toEqual({ outer: { x: 5 } });

            // The child schema was resolved from the store during decode and defineSchema() ran,
            // observable as a store.set() for the child hash (defineSchema persists every schema).
            expect(storeGetCount).toBeGreaterThan(getsBefore);
            expect(storeSetHashes.length).toBe(setsBefore + 1);
            expect(storeSetHashes[storeSetHashes.length - 1]).toBe(innerHash);
        });
    });
});
