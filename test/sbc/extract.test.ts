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

        // Generic array field: [flag=1 (packed uint8)][u32 count > 2^20] — the cap must fire before pos math.
        let buf = objBuf(hash, new Uint8Array([1, 0x80, 0x84, 0x1E, 0x00]));

        expect(() => c.extractField(buf, 'z')).toThrow('Codec2: array count ' + HOSTILE_COUNT + ' exceeds limit');
    });

    it('extracts a field that follows a normal array without throwing', () => {
        let c = codec(),
            encoded = c.encode({ a: [1, 2, 3], z: 9 });

        expect(c.extractField(encoded, 'z')).toBe(9);
    });
});
