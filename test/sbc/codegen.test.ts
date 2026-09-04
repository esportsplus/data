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
            expect(() => c.decode(objBuf(hash, HOSTILE_VARINT))).toThrow('@esportsplus/data: codec array count ' + HOSTILE_COUNT + ' exceeds limit');
        }
    });

    it('the tagged decoder throws the identical error on the same declared count', () => {
        let c = codec();

        expect(() => c.decode(taggedArrayBuf(HOSTILE_COUNT))).toThrow('@esportsplus/data: codec array count ' + HOSTILE_COUNT + ' exceeds limit');
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

    it('rejects a hostile fixed-width count before allocating its result array', () => {
        let payload = new Uint8Array([0x80, 0x80, 0x40]),
            types = ['float64', 'date', 'int64'];

        for (let type of types) {
            let plain = buildSchema([{ name: 'f', type: 'array<' + type + '>' }]),
                compressed = buildSchema([{ name: 'f', type: 'array<' + type + '>' }], true);

            expect(() => plain.decodeFn!(payload, 0, 0)).toThrow('@esportsplus/data: codec truncated array');
            expect(() => compressed.compressedDecodeFn!(payload, 0, 0)).toThrow('@esportsplus/data: codec truncated array');
        }
    });
});


// Unit-level harness for the encoder/decoder arms — bypasses the codec() registry so the
// generated function source is directly inspectable via encodeFn.toString().
const STUB_HELPERS: SbcHelpers = {
    decodeSbc: () => { throw new Error('@esportsplus/data: codec unexpected decodeSbc call in unit test'); },
    decodeTagEnd: () => { throw new Error('@esportsplus/data: codec unexpected decodeTagEnd call in unit test'); },
    encodeObj: () => { throw new Error('@esportsplus/data: codec unexpected encodeObj call in unit test'); },
    encodeSbc: () => { throw new Error('@esportsplus/data: codec unexpected encodeSbc call in unit test'); },
    lookupSchema: () => null,
    registry: new Map(),
};

function buildSchema(fields: Array<{ name: string; type: string }>, compressible = false): Schema {
    let fieldDefs: FieldDef[] = fields.map(f => {
        let parsed = parseFieldType(f.type);

        return {
            elementType: parsed.elementType,
            fixedSize: FIELD_SIZES[parsed.base] ?? 0,
            name: f.name,
            nullable: false,
            nullIndex: -1,
            rawType: f.type,
            refHash: parsed.hash,
            type: parsed.base,
        };
    });

    let schema: Schema = {
        bitmapBytes: 0,
        boolFields: [],
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible,
        decodeFn: null,
        encodeFn: null,
        fields: fieldDefs,
        hash: 0,
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


// Generic-array (untyped `array`) compiled path — the classifier-driven typeId+1 flag replacing
// the retired 1/2/3 width enumeration. bpe/flag pairs are the narrowest lossless width per input.
const PACKED_CASES: Array<{ bpe: number; flag: number; input: number[]; name: string }> = [
    { bpe: 1, flag: 6, input: [0, 1, 255], name: 'uint8' },
    { bpe: 1, flag: 3, input: [-5, 5, -128, 127], name: 'int8' },
    { bpe: 2, flag: 8, input: [0, 300, 65535], name: 'uint16' },
    { bpe: 2, flag: 4, input: [256, 1000, -1], name: 'int16' },
    { bpe: 4, flag: 9, input: [0, 70000, 4294967295], name: 'uint32' },
    { bpe: 4, flag: 5, input: [-2000000000, 2000000000], name: 'int32' },
    { bpe: 8, flag: 2, input: [1.5, 2.25, -0.5], name: 'float64' },
];


describe('Codec2 compiled generic-array packed path — typeId+1 flag', () => {
    for (let { flag, input, name } of PACKED_CASES) {
        it(`round-trips a ${name} number[] through the compiled encoder/decoder at flag ${flag}`, () => {
            let schema = buildSchema([{ name: 'f', type: 'array' }]),
                buf = new Uint8Array(1024);

            let end = schema.encodeFn!({ f: input }, buf, 0),
                decoded = schema.decodeFn!(buf.subarray(0, end), 0, 0) as { f: number[] };

            expect(buf[0]).toBe(flag);
            expect(Array.isArray(decoded.f)).toBe(true);
            expect(decoded.f).toEqual(input);
        });

        it(`round-trips a ${name} number[] through the compressed encoder/decoder at flag ${flag}`, () => {
            let schema = buildSchema([{ name: 'f', type: 'array' }], true),
                buf = new Uint8Array(1024);

            let end = schema.compressedEncodeFn!({ f: input }, buf, 0),
                decoded = schema.compressedDecodeFn!(buf.subarray(0, end), 0, 0) as { f: number[] };

            expect(buf[0]).toBe(flag);
            expect(decoded.f).toEqual(input);
        });

        it(`compiled ${name} element payload bytes equal the tagged path's for the same data`, () => {
            let schema = buildSchema([{ name: 'f', type: 'array' }]),
                buf = new Uint8Array(1024);

            let end = schema.encodeFn!({ f: input }, buf, 0),
                tagged = codec().encode(input),
                payloadLen = input.length * PACKED_CASES.find(c => c.name === name)!.bpe;

            // Compiled field header is [flag u8][count u32] (5 bytes); tag 12 header is
            // [12][typeId u8][byteLen u32] (6 bytes). Element payloads must be byte-identical.
            expect(tagged[0]).toBe(12);
            expect(tagged[1]).toBe(flag - 1);
            expect(buf[0]! - 1).toBe(tagged[1]);
            expect(Array.from(buf.subarray(5, 5 + payloadLen))).toEqual(Array.from(tagged.subarray(6, 6 + payloadLen)));
            expect(end).toBe(5 + payloadLen);
        });
    }

    it('emits no retired 1/2/3 flag width literals in any compiled or compressed array function', () => {
        let plain = buildSchema([{ name: 'f', type: 'array' }]),
            compressed = buildSchema([{ name: 'f', type: 'array' }], true);

        let encoders = [plain.encodeFn!.toString(), compressed.compressedEncodeFn!.toString()],
            decoders = [plain.decodeFn!.toString(), compressed.compressedDecodeFn!.toString()];

        for (let src of encoders) {
            expect(src).not.toMatch(/b\[p\]=[123];/);
            expect(src).toContain('_cpa(');
        }

        for (let src of decoders) {
            expect(src).not.toMatch(/_f===[123]/);
            expect(src).toContain('_f-1');
        }
    });

    it('routes an empty untyped array to the generic flag 0, never a spurious numeric width', () => {
        let schema = buildSchema([{ name: 'f', type: 'array' }]),
            buf = new Uint8Array(1024);

        let end = schema.encodeFn!({ f: [] }, buf, 0),
            decoded = schema.decodeFn!(buf.subarray(0, end), 0, 0) as { f: number[] };

        // classifyPackedArray([]) is not-packable (-1), so the compiled path takes the generic
        // branch (flag 0) — matching the tagged path's len>0 packing guard, one shared authority.
        expect(buf[0]).toBe(0);
        expect(Array.isArray(decoded.f)).toBe(true);
        expect(decoded.f).toEqual([]);
    });

    it('decodes a plain array as a plain number[], never a TypedArray — the tag-17 fidelity split', () => {
        let schema = buildSchema([{ name: 'f', type: 'array' }]),
            buf = new Uint8Array(1024);

        let end = schema.encodeFn!({ f: [0, 1, 255] }, buf, 0),
            decoded = schema.decodeFn!(buf.subarray(0, end), 0, 0) as { f: unknown };

        expect(Array.isArray(decoded.f)).toBe(true);
        expect(ArrayBuffer.isView(decoded.f)).toBe(false);
    });
});
