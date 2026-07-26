import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


const HOSTILE_COUNT = 2_000_000; // > 2^20

const HOSTILE_VARINT = new Uint8Array([0x80, 0x89, 0x7A]); // LEB128 for 2_000_000


// Minimal tag-8 object header wrapping a raw field payload; dataLen is the payload length.
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


describe('Codec2 extractField count limits', () => {
    it('throws when a preceding typed-array field declares a count above 2^20', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'a', type: 'array<uint32>' }, { name: 'z', type: 'uint32' }]);

        let buf = objBuf(hash, HOSTILE_VARINT);

        expect(() => c.extractField(buf, 'z')).toThrow('Codec2: array count ' + HOSTILE_COUNT + ' exceeds limit');
    });

    it('throws when a preceding generic-array field declares a count above 2^20', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'a', type: 'array' }, { name: 'z', type: 'uint32' }]);

        // Generic array field: [flag=6 (uint8, typeId+1)][u32 count > 2^20] — the count cap must
        // fire before the flag-driven skip math (pos += count * TYPED_ARRAY_BPE[flag - 1]).
        let buf = objBuf(hash, new Uint8Array([6, 0x80, 0x84, 0x1E, 0x00]));

        expect(() => c.extractField(buf, 'z')).toThrow('Codec2: array count ' + HOSTILE_COUNT + ' exceeds limit');
    });

    it('extracts a field that follows a normal array without throwing', () => {
        let c = codec(),
            encoded = c.encode({ a: [1, 2, 3], z: 9 });

        expect(c.extractField(encoded, 'z')).toBe(9);
    });
});


describe('Codec2 extractField packed-array skip widths', () => {
    // flag = typeId + 1; extraction skips count * TYPED_ARRAY_BPE[flag - 1] bytes to reach the
    // following field, so the classifier's narrowest lossless width must be honoured per case.
    let cases: { a: number[], name: string }[] = [
        { a: [0, 128, 255], name: 'uint8 (1 B/element)' },
        { a: [-5, 5], name: 'int8 (1 B/element)' },
        { a: [0, 65535], name: 'uint16 (2 B/element)' },
        { a: [256, 1000, -1], name: 'int16 (2 B/element)' },
        { a: [70000, 4294967295], name: 'uint32 (4 B/element)' },
        { a: [-2147483648, 2147483647], name: 'int32 (4 B/element)' },
        { a: [1.5, -0.25], name: 'float64 (8 B/element)' },
    ];

    for (let { a, name } of cases) {
        it('skips a packed ' + name + ' array to reach the following field', () => {
            let c = codec(),
                encoded = c.encode({ a, z: 9 });

            expect(c.extractField(encoded, 'z')).toBe(9);
        });
    }
});
