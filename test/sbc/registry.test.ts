import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';

import type { PersistentStore } from '../../src/sbc';

import * as pkgRoot from '../../src/index';
import * as sbcIndex from '../../src/sbc/index';


type CountingStore = PersistentStore & {
    readonly sets: number;
};

type Stored = Parameters<PersistentStore['set']>[1];


function makeCountingStore(): CountingStore {
    let map = new Map<number, Stored>(),
        sets = 0;

    return {
        get: (hash: number) => map.get(hash) ?? null,
        set(hash: number, schema: Stored) {
            sets++;
            map.set(hash, schema);
        },
        get sets() {
            return sets;
        },
    };
}

function readU32(buf: Uint8Array, off: number): number {
    return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

function buildRegistryBlob(): { blob: Uint8Array; hashA: number; hashB: number } {
    let c = codec(),
        hashA = c.defineSchema([{ name: 'a', type: 'string' }, { name: 'b', type: 'uint8' }]),
        hashB = c.defineSchema([{ name: 'x', type: 'string' }, { name: 'y', type: 'string' }, { name: 'z', type: 'string' }]);

    return { blob: c.serializeRegistry(), hashA, hashB };
}


describe('deserializeRegistry wire-hash verification', () => {
    it('throws naming both values when the declared hash does not match its fields', () => {
        let { blob } = buildRegistryBlob(),
            corrupted = blob.slice();

        // schemaCount occupies bytes 0-1; the first schema's u32 hash is at bytes 2-5.
        let declaredOriginal = readU32(corrupted, 2);

        corrupted[2] = corrupted[2]! ^ 0xFF;

        let declared = readU32(corrupted, 2),
            c2 = codec();

        expect(declared).not.toBe(declaredOriginal);
        expect(() => c2.deserializeRegistry(corrupted)).toThrow(
            new RegExp('@esportsplus/data: codec registry hash mismatch — declared ' + declared + ', computed ' + declaredOriginal),
        );
    });

    it('leaves the receiving registry unchanged when the blob is corrupted', () => {
        let c = codec(),
            hashA = c.defineSchema([{ name: 'a', type: 'string' }, { name: 'b', type: 'uint8' }]),
            corrupted = c.serializeRegistry().slice();

        corrupted[2] = corrupted[2]! ^ 0xFF;

        let store = makeCountingStore(),
            c2 = codec({ store });

        expect(() => c2.deserializeRegistry(corrupted)).toThrow('@esportsplus/data: codec registry hash mismatch');
        expect(store.sets).toBe(0);

        // A single-schema blob throws at index 0 before any registration, so serializing
        // the receiver's registry back out reports zero schemas.
        let reserialized = c2.serializeRegistry();

        expect(reserialized[0]! | (reserialized[1]! << 8)).toBe(0);

        // The schema the producer held never reached the receiver.
        void hashA;
    });

    it('round-trips a genuine multi-schema registry under the producer hashes', () => {
        let { blob, hashA, hashB } = buildRegistryBlob(),
            producer = codec(),
            c2 = codec();

        c2.deserializeRegistry(blob);

        // Re-define the same schemas on the producer to obtain wire buffers keyed by hash.
        producer.deserializeRegistry(blob);

        let bufA = producer.encode({ a: 'hi', b: 7 }, { schema: hashA }),
            bufB = producer.encode({ x: 'p', y: 'q', z: 'r' }, { schema: hashB });

        expect(readU32(bufA, 1)).toBe(hashA);
        expect(readU32(bufB, 1)).toBe(hashB);

        expect(c2.decode(bufA)).toEqual({ a: 'hi', b: 7 });
        expect(c2.decode(bufB)).toEqual({ x: 'p', y: 'q', z: 'r' });
    });

    it('deduplicates: deserializing the same valid blob twice registers each schema once', () => {
        let { blob } = buildRegistryBlob(),
            store = makeCountingStore(),
            c2 = codec({ store });

        expect(() => {
            c2.deserializeRegistry(blob);
            c2.deserializeRegistry(blob);
        }).not.toThrow();

        expect(store.sets).toBe(2);
    });

    it('does not re-export computeShapeHash from the codec surface or the package root', () => {
        expect('computeShapeHash' in sbcIndex).toBe(false);
        expect('computeShapeHash' in pkgRoot).toBe(false);
    });
});
