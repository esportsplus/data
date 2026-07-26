import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


const HOSTILE_COUNT = 2_000_000; // > 2^20; encodes to the LEB128 varint below

const HOSTILE_VARINT = new Uint8Array([0x80, 0x89, 0x7A]); // LEB128 for 2_000_000

const MAX_ARRAY_COUNT = 1_048_576; // 2^20 — mirrors src/sbc/constants.ts for the boundary assertions


// Minimal tag-8 object header wrapping a raw field payload; dataLen is the payload length so the
// decode()/decodeSbc() truncation gates pass and control reaches the compiled field decoder.
function objBuf(hash: number, payload: Uint8Array): Uint8Array {
    let buf = new Uint8Array(9 + payload.length),
        dataLen = payload.length;

    buf[0] = 8;
    buf[1] = hash & 0xFF;
    buf[2] = (hash >>> 8) & 0xFF;
    buf[3] = (hash >>> 16) & 0xFF;
    buf[4] = (hash >>> 24) & 0xFF;
    buf[5] = dataLen & 0xFF;
    buf[6] = (dataLen >>> 8) & 0xFF;
    buf[7] = (dataLen >>> 16) & 0xFF;
    buf[8] = (dataLen >>> 24) & 0xFF;
    buf.set(payload, 9);

    return buf;
}

function taggedArrayBuf(count: number): Uint8Array {
    return new Uint8Array([7, count & 0xFF, (count >>> 8) & 0xFF, (count >>> 16) & 0xFF, (count >>> 24) & 0xFF]);
}


describe('Codec2 compiled-decoder count limits', () => {
    it('rejects a count above 2^20 in every array field shape — same verdict as the tagged path', () => {
        let c = codec(),
            elemHash = c.defineSchema([{ name: 'v', type: 'uint32' }]);

        let shapes = [
            c.defineSchema([{ name: 'f', type: 'array<uint32>' }]),
            c.defineSchema([{ name: 'f', type: 'array<string>' }]),
            c.defineSchema([{ name: 'f', type: 'array<bytes>' }]),
            c.defineSchema([{ name: 'f', type: 'array<object(' + elemHash + ')>' }]),
        ];

        for (let hash of shapes) {
            expect(() => c.decode(objBuf(hash, HOSTILE_VARINT))).toThrow('Codec2: array count ' + HOSTILE_COUNT + ' exceeds limit');
        }
    });

    it('the tagged decoder throws the identical error on the same declared count', () => {
        let c = codec();

        expect(() => c.decode(taggedArrayBuf(HOSTILE_COUNT))).toThrow('Codec2: array count ' + HOSTILE_COUNT + ' exceeds limit');
    });

    it('accepts a count of exactly 2^20 — compiled path', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'f', type: 'array<uint8>' }]);

        let value = { f: new Array<number>(MAX_ARRAY_COUNT).fill(7) };

        let decoded = c.decode<{ f: number[] }>(c.encode(value, { schema: hash }));

        expect(decoded.f.length).toBe(MAX_ARRAY_COUNT);
        expect(decoded.f[0]).toBe(7);
        expect(decoded.f[MAX_ARRAY_COUNT - 1]).toBe(7);
    });

    it('accepts a count of exactly 2^20 — tagged path', () => {
        let c = codec(),
            buf = new Uint8Array(5 + MAX_ARRAY_COUNT);

        buf[0] = 7;
        buf[1] = MAX_ARRAY_COUNT & 0xFF;
        buf[2] = (MAX_ARRAY_COUNT >>> 8) & 0xFF;
        buf[3] = (MAX_ARRAY_COUNT >>> 16) & 0xFF;
        buf[4] = (MAX_ARRAY_COUNT >>> 24) & 0xFF;
        // Remaining bytes default to 0 → tag-0 (null) elements.

        let decoded = c.decode<unknown[]>(buf);

        expect(decoded.length).toBe(MAX_ARRAY_COUNT);
        expect(decoded[0]).toBe(null);
    });

    it('normal payloads round-trip unchanged across every affected field shape', () => {
        let c = codec(),
            elemHash = c.defineSchema([{ name: 'v', type: 'uint32' }]);

        let byts = c.defineSchema([{ name: 'f', type: 'array<bytes>' }]),
            generic = c.defineSchema([{ name: 'f', type: 'array' }]),
            objs = c.defineSchema([{ name: 'f', type: 'array<object(' + elemHash + ')>' }]),
            strs = c.defineSchema([{ name: 'f', type: 'array<string>' }]),
            typed = c.defineSchema([{ name: 'f', type: 'array<uint32>' }]);

        expect(c.decode(c.encode({ f: [1, 2, 3] }, { schema: typed }))).toEqual({ f: [1, 2, 3] });
        expect(c.decode(c.encode({ f: ['a', 'bb'] }, { schema: strs }))).toEqual({ f: ['a', 'bb'] });
        expect(c.decode(c.encode({ f: [{ v: 5 }] }, { schema: objs }))).toEqual({ f: [{ v: 5 }] });
        expect(c.decode(c.encode({ f: [1, 'x', true] }, { schema: generic }))).toEqual({ f: [1, 'x', true] });

        let rb = c.decode<{ f: Uint8Array[] }>(c.encode({ f: [new Uint8Array([1, 2])] }, { schema: byts }));

        expect(Array.from(rb.f[0]!)).toEqual([1, 2]);
    });

    it('the literal 1048576 appears only in src/sbc/constants.ts', () => {
        let dir = join(import.meta.dirname, '../../src/sbc'),
            offenders: string[] = [];

        for (let name of readdirSync(dir)) {
            if (!name.endsWith('.ts')) {
                continue;
            }

            if (readFileSync(join(dir, name), 'utf8').includes('1048576')) {
                offenders.push(name);
            }
        }

        expect(offenders).toEqual(['constants.ts']);
    });
});
