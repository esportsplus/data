import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { codec } from '../../src/sbc';

import type { FieldSpec } from '../../src/sbc';


// Wire format (see src/sbc/registry.ts serializeRegistry):
//   [0..1]  u16 schemaCount (LE)
//   per schema:
//     [+0..3] u32 shape hash (LE)   <-- the value verified against the fields
//     [+4..5] u16 fieldCount (LE)
//     per field: u16 nameLen, name bytes, u16 typeLen, type bytes, u8 flags
// For a single-schema blob the first schema's u32 hash sits at byte offset 2.
const HASH_OFFSET = 2;

const EXPORT_BLOCK_RE = /export\s+(?:type\s+)?\{[^}]*\bcomputeShapeHash\b/;

const SCHEMA_A: FieldSpec[] = [{ name: 'x', type: 'uint8' }, { name: 'y', type: 'string' }];

const SCHEMA_MULTI: FieldSpec[][] = [
    [{ name: 'a', type: 'uint8' }],
    [{ name: 'b', type: 'uint16' }, { name: 'c', type: 'int32' }],
    [{ name: 'd', type: 'boolean' }, { name: 'e', type: 'float64' }, { name: 'f', type: 'string' }],
];


function readU32LE(buf: Uint8Array, off: number): number {
    return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}


function parseSchemaHashes(blob: Uint8Array): number[] {
    let count = blob[0]! | (blob[1]! << 8),
        hashes: number[] = [],
        pos = 2;

    for (let i = 0; i < count; i++) {
        hashes.push(readU32LE(blob, pos));
        pos += 4;

        let fieldCount = blob[pos]! | (blob[pos + 1]! << 8);

        pos += 2;

        for (let j = 0; j < fieldCount; j++) {
            let nameLen = blob[pos]! | (blob[pos + 1]! << 8);

            pos += 2 + nameLen;

            let typeLen = blob[pos]! | (blob[pos + 1]! << 8);

            pos += 2 + typeLen + 1;
        }
    }

    return hashes;
}


describe('sbc registry hash validation', () => {
    it('throws registry hash mismatch naming both declared and computed hashes when the wire hash does not match its fields', () => {
        let producer = codec();

        producer.defineSchema(SCHEMA_A);

        let pristine = producer.serializeRegistry(),
            corrupt = Uint8Array.from(pristine);

        // Flip the low byte of the single schema's u32 hash — declared no longer
        // equals the shape hash the fields compute to.
        corrupt[HASH_OFFSET] = corrupt[HASH_OFFSET]! ^ 0xFF;

        let computed = readU32LE(pristine, HASH_OFFSET),
            declared = readU32LE(corrupt, HASH_OFFSET);

        expect(declared).not.toBe(computed);

        let receiver = codec();

        expect(() => receiver.deserializeRegistry(corrupt)).toThrow(/registry hash mismatch/);
        expect(() => receiver.deserializeRegistry(corrupt)).toThrow(String(declared));
        expect(() => receiver.deserializeRegistry(corrupt)).toThrow(String(computed));
    });

    it('leaves the receiving registry unchanged when a corrupted blob is rejected', () => {
        let producer = codec();

        producer.defineSchema(SCHEMA_A);

        let corrupt = Uint8Array.from(producer.serializeRegistry());

        corrupt[HASH_OFFSET] = corrupt[HASH_OFFSET]! ^ 0xFF;

        let receiver = codec(),
            threw = false;

        try {
            receiver.deserializeRegistry(corrupt);
        }
        catch {
            threw = true;
        }

        let out = receiver.serializeRegistry(),
            registeredCount = out[0]! | (out[1]! << 8);

        expect(threw).toBe(true);
        expect(registeredCount).toBe(0);
        expect(parseSchemaHashes(out)).toHaveLength(0);
    });

    it('round-trips every schema under the producer hashes and dedups a repeated import without throwing', () => {
        let producer = codec(),
            producerHashes = SCHEMA_MULTI.map((fields) => producer.defineSchema(fields));

        let blob = producer.serializeRegistry(),
            receiver = codec();

        expect(() => receiver.deserializeRegistry(blob)).not.toThrow();

        let afterFirst = receiver.serializeRegistry();

        expect(Array.from(afterFirst)).toEqual(Array.from(blob));
        expect(parseSchemaHashes(afterFirst).sort()).toEqual([...producerHashes].sort());

        // Second import of the same valid blob — dedup must skip every schema,
        // register nothing new, and never throw.
        expect(() => receiver.deserializeRegistry(blob)).not.toThrow();

        let afterSecond = receiver.serializeRegistry();

        expect(Array.from(afterSecond)).toEqual(Array.from(blob));
        expect(parseSchemaHashes(afterSecond)).toHaveLength(producerHashes.length);
    });

    it('does not re-export computeShapeHash from src/sbc/index.ts or src/index.ts', () => {
        let rootIndex = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8'),
            sbcIndex = readFileSync(new URL('../../src/sbc/index.ts', import.meta.url), 'utf8');

        expect(sbcIndex).not.toMatch(EXPORT_BLOCK_RE);
        expect(rootIndex).not.toMatch(EXPORT_BLOCK_RE);
    });
});
