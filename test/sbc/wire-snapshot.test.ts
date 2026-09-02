import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


const fields = (childHash: number) => [
    { name: 'array', type: 'array' },
    { name: 'bool', type: 'boolean' },
    { name: 'bytes', type: 'bytes' },
    { name: 'date', type: 'date' },
    { name: 'float', type: 'float64' },
    { name: 'i16', type: 'int16' },
    { name: 'i32', type: 'int32' },
    { name: 'i64', type: 'int64' },
    { name: 'i8', type: 'int8' },
    { name: 'mixed', type: 'mixed' },
    { name: 'nested', type: `object(${childHash})` },
    { name: 'nullableBytes', nullable: true, type: 'bytes' },
    { name: 'nullableString', nullable: true, type: 'string' },
    { name: 'object', type: 'object' },
    { name: 'packed', type: 'array' },
    { name: 'string', type: 'string' },
    { name: 'strings', type: 'array<string>' },
    { name: 'typed', type: 'typedarray' },
    { name: 'u16', type: 'uint16' },
    { name: 'u32', type: 'uint32' },
    { name: 'u8', type: 'uint8' },
];

const value = {
    array: [1, 'two', false],
    bool: true,
    bytes: new Uint8Array([0, 1, 254, 255]),
    date: new Date('2024-01-02T03:04:05.678Z'),
    float: Math.PI,
    i16: -1234,
    i32: -123456789,
    i64: -1234567890123456789n,
    i8: -12,
    mixed: { k: 'v', n: 3 },
    nested: { child: 'nested', count: 42 },
    nullableBytes: null,
    nullableString: 'optional',
    object: { dynamic: ['value', 2] },
    packed: [1, 255, 65535, 4294967295],
    string: 'héllo snapshot',
    strings: ['a', 'ß', 'longer string'],
    typed: new Int16Array([-2, 0, 300]),
    u16: 54321,
    u32: 4000000000,
    u8: 250,
};

function wireHex(compress: boolean): string {
    let c = codec({ compress }),
        childHash = c.defineSchema([
            { name: 'child', type: 'string' },
            { name: 'count', type: 'uint8' },
        ]),
        hash = c.defineSchema(fields(childHash));

    return Buffer.from(c.encode(value, { schema: hash })).toString('hex');
}


describe('Codec2 wire snapshots', () => {
    it('preserves the uncompressed fixed corpus', () => {
        expect(wireHex(false)).toBe('0860525bf4ba0000000200030000000301050300000074776f0101040001feff00e0b20d82cc7842182d4454fb2109402efbeb32a4f8eb7e16820befddeef4089da82ef50300000001760308066e65737465642a086f7074696f6e616c08728110b5110000000002000000050500000076616c75650302090400000001000000ff000000ffff0000ffffffff0f68c3a96c6c6f20736e617073686f7403016102c39f0d6c6f6e67657220737472696e67110306000000feff00002c0131d400286beefa');
    });

    it('preserves the compressed fixed corpus', () => {
        expect(wireHex(true)).toBe('1260525bf4bd000000020100e0b20d82cc7842eb7e16820befddeef4faa313a9b4de75b1a80380d0acf30e01182d4454fb21094000030000000301050300000074776f01040001feff089da82ef50300000001760308066e65737465642a086f7074696f6e616c08728110b5110000000002000000050500000076616c75650302090400000001000000ff000000ffff0000ffffffff0f68c3a96c6c6f20736e617073686f7403016102c39f0d6c6f6e67657220737472696e67110306000000feff00002c01');
    });
});
