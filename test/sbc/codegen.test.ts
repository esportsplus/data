import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';
import { compileSchema } from '../../src/sbc/codegen';
import { FIELD_SIZES } from '../../src/sbc/constants';
import { parseFieldType } from '../../src/sbc/schema';

import type { FieldDef, Schema, SbcHelpers } from '../../src/sbc/codegen';


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


// Unit-level harness for the encoder/decoder arms — bypasses the codec() registry so the
// generated function source is directly inspectable via encodeFn.toString().
const STUB_HELPERS: SbcHelpers = {
    decodeSbc: () => { throw new Error('Codec2: unexpected decodeSbc call in unit test'); },
    decodeTagEnd: () => { throw new Error('Codec2: unexpected decodeTagEnd call in unit test'); },
    encodeObj: () => { throw new Error('Codec2: unexpected encodeObj call in unit test'); },
    encodeSbc: () => { throw new Error('Codec2: unexpected encodeSbc call in unit test'); },
    lookupSchema: () => null,
    registry: new Map(),
};

function buildSchema(fields: Array<{ name: string; type: string }>): Schema {
    let fieldDefs: FieldDef[] = fields.map(f => {
        let parsed = parseFieldType(f.type);

        return {
            elementType: parsed.elementType,
            fixedSize: FIELD_SIZES[parsed.base] ?? 0,
            name: f.name,
            nullable: false,
            nullIndex: -1,
            offset: 0,
            rawType: f.type,
            refHash: parsed.hash,
            type: parsed.base,
        };
    });

    let schema: Schema = {
        bitmapBytes: 0,
        boolFields: [],
        compFixedSize: 0,
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: false,
        decodeFn: null,
        encodeFn: null,
        fields: fieldDefs,
        fixedSize: 0,
        float64Fields: [],
        hash: 0,
        id: 0,
        intFields: [],
        nullableCount: 0,
    };

    compileSchema(schema, STUB_HELPERS);

    return schema;
}


describe('Codec2 uint16 encoder arm — property-read hoist', () => {
    it('encodes a uint16 field to byte-identical output, matching the pre-hoist arm exactly', () => {
        let schema = buildSchema([{ name: 'v', type: 'uint16' }]),
            buf = new Uint8Array(2);

        schema.encodeFn!({ v: 300 }, buf, 0);

        expect(Array.from(buf)).toEqual([44, 1]);
    });

    it('round-trips boundary values 0 and 65535 exactly, and truncates 65536 to 0 unchanged', () => {
        let schema = buildSchema([{ name: 'v', type: 'uint16' }]),
            cases: Array<[number, number]> = [[0, 0], [65535, 65535], [65536, 0]];

        for (let [input, expected] of cases) {
            let buf = new Uint8Array(2);

            schema.encodeFn!({ v: input }, buf, 0);

            let decoded = schema.decodeFn!(buf, 0, 0) as { v: number };

            expect(decoded.v).toBe(expected);
        }
    });

    it('composes with sibling int16, uint32 and int32 arms in one schema', () => {
        let schema = buildSchema([
            { name: 'a', type: 'uint16' },
            { name: 'b', type: 'int16' },
            { name: 'c', type: 'uint32' },
            { name: 'd', type: 'int32' },
        ]);

        let buf = new Uint8Array(2 + 2 + 4 + 4),
            value = { a: 65000, b: -12345, c: 4000000000, d: -2000000000 };

        schema.encodeFn!(value, buf, 0);

        let decoded = schema.decodeFn!(buf, 0, 0) as typeof value;

        expect(decoded).toEqual(value);
    });

    it('emits the field property expression exactly once in the generated encoder body', () => {
        let schema = buildSchema([{ name: 'v', type: 'uint16' }]),
            src = schema.encodeFn!.toString(),
            matches = src.match(/o\["v"\]/g);

        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
    });

    it('leaves the array<uint16> element-loop arm unchanged — still round-trips', () => {
        let schema = buildSchema([{ name: 'v', type: 'array<uint16>' }]),
            value = { v: [0, 1, 300, 65535, 0] },
            buf = new Uint8Array(64);

        let end = schema.encodeFn!(value, buf, 0);

        let decoded = schema.decodeFn!(buf.subarray(0, end), 0, 0) as { v: number[] };

        expect(decoded.v).toEqual(value.v);
    });
});
