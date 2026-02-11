import { describe, expect, it } from 'vitest';


// --- Inline runtime helpers for direct unit testing ---

function _varintSize(value: number): number {
    if (value < 0) {
        return 10;
    }

    if (value < 128) {
        return 1;
    }

    if (value < 16384) {
        return 2;
    }

    if (value < 2097152) {
        return 3;
    }

    if (value < 268435456) {
        return 4;
    }

    return 5;
}

function _writeVarint(buffer: Uint8Array, offset: number, value: number): number {
    if (value < 0) {
        for (let i = 0; i < 9; i++) {
            buffer[offset++] = (value & 0x7f) | 0x80;
            value = Math.floor(value / 128);
        }

        buffer[offset++] = 1;

        return offset;
    }

    while (value >= 128) {
        buffer[offset++] = (value & 0x7f) | 0x80;
        value >>>= 7;
    }

    buffer[offset++] = value;

    return offset;
}

function _readVarint(buffer: Uint8Array, offset: number): [number, number] {
    let result = 0,
        shift = 0;

    while (offset < buffer.length) {
        let byte = buffer[offset++];

        result |= (byte & 0x7f) << shift;

        if ((byte & 0x80) === 0) {
            break;
        }

        shift += 7;
    }

    return [result, offset];
}


// Float helpers

const _f32Buffer = new ArrayBuffer(4);
const _f32View = new DataView(_f32Buffer);
const _f32Bytes = new Uint8Array(_f32Buffer);

function _writeFloat(buffer: Uint8Array, offset: number, value: number): number {
    _f32View.setFloat32(0, value, true);

    buffer[offset] = _f32Bytes[0];
    buffer[offset + 1] = _f32Bytes[1];
    buffer[offset + 2] = _f32Bytes[2];
    buffer[offset + 3] = _f32Bytes[3];

    return offset + 4;
}

function _readFloat(buffer: Uint8Array, offset: number): [number, number] {
    _f32Bytes[0] = buffer[offset];
    _f32Bytes[1] = buffer[offset + 1];
    _f32Bytes[2] = buffer[offset + 2];
    _f32Bytes[3] = buffer[offset + 3];

    return [_f32View.getFloat32(0, true), offset + 4];
}


// Double helpers

const _f64Buffer = new ArrayBuffer(8);
const _f64View = new DataView(_f64Buffer);
const _f64Bytes = new Uint8Array(_f64Buffer);

function _writeDouble(buffer: Uint8Array, offset: number, value: number): number {
    _f64View.setFloat64(0, value, true);

    buffer[offset] = _f64Bytes[0];
    buffer[offset + 1] = _f64Bytes[1];
    buffer[offset + 2] = _f64Bytes[2];
    buffer[offset + 3] = _f64Bytes[3];
    buffer[offset + 4] = _f64Bytes[4];
    buffer[offset + 5] = _f64Bytes[5];
    buffer[offset + 6] = _f64Bytes[6];
    buffer[offset + 7] = _f64Bytes[7];

    return offset + 8;
}

function _readDouble(buffer: Uint8Array, offset: number): [number, number] {
    _f64Bytes[0] = buffer[offset];
    _f64Bytes[1] = buffer[offset + 1];
    _f64Bytes[2] = buffer[offset + 2];
    _f64Bytes[3] = buffer[offset + 3];
    _f64Bytes[4] = buffer[offset + 4];
    _f64Bytes[5] = buffer[offset + 5];
    _f64Bytes[6] = buffer[offset + 6];
    _f64Bytes[7] = buffer[offset + 7];

    return [_f64View.getFloat64(0, true), offset + 8];
}


// BigInt helpers

function _writeBigInt(buffer: Uint8Array, offset: number, value: bigint): number {
    let v = value;

    if (v < 0n) {
        for (let i = 0; i < 9; i++) {
            buffer[offset++] = Number(v & 0x7fn) | 0x80;
            v = v >> 7n;
        }

        buffer[offset++] = 1;

        return offset;
    }

    while (v >= 128n) {
        buffer[offset++] = Number(v & 0x7fn) | 0x80;
        v = v >> 7n;
    }

    buffer[offset++] = Number(v);

    return offset;
}

function _readBigInt(buffer: Uint8Array, offset: number): [bigint, number] {
    let result = 0n,
        shift = 0n;

    while (offset < buffer.length) {
        let byte = buffer[offset++];

        result |= BigInt(byte & 0x7f) << shift;

        if ((byte & 0x80) === 0) {
            break;
        }

        shift += 7n;
    }

    return [result, offset];
}

function _bigIntVarintSize(value: bigint): number {
    if (value < 0n) {
        return 10;
    }

    if (value < 128n) {
        return 1;
    }

    if (value < 16384n) {
        return 2;
    }

    if (value < 2097152n) {
        return 3;
    }

    if (value < 268435456n) {
        return 4;
    }

    if (value < 34359738368n) {
        return 5;
    }

    if (value < 4398046511104n) {
        return 6;
    }

    if (value < 562949953421312n) {
        return 7;
    }

    if (value < 72057594037927936n) {
        return 8;
    }

    if (value < 9223372036854775808n) {
        return 9;
    }

    return 10;
}


// String helpers

const _textEncoder = new TextEncoder();
const _textDecoder = new TextDecoder();

function _writeString(buffer: Uint8Array, offset: number, value: string): number {
    let encoded = _textEncoder.encode(value);

    offset = _writeVarint(buffer, offset, encoded.length);
    buffer.set(encoded, offset);

    return offset + encoded.length;
}

function _readString(buffer: Uint8Array, offset: number): [string, number] {
    let [length, newOffset] = _readVarint(buffer, offset),
        str = _textDecoder.decode(buffer.subarray(newOffset, newOffset + length));

    return [str, newOffset + length];
}


// --- Tests ---


describe('Runtime: Varint', () => {
    describe('_varintSize', () => {
        it('returns 1 for values 0-127', () => {
            expect(_varintSize(0)).toBe(1);
            expect(_varintSize(1)).toBe(1);
            expect(_varintSize(127)).toBe(1);
        });

        it('returns 2 for values 128-16383', () => {
            expect(_varintSize(128)).toBe(2);
            expect(_varintSize(16383)).toBe(2);
        });

        it('returns 3 for values 16384-2097151', () => {
            expect(_varintSize(16384)).toBe(3);
            expect(_varintSize(2097151)).toBe(3);
        });

        it('returns 4 for values 2097152-268435455', () => {
            expect(_varintSize(2097152)).toBe(4);
            expect(_varintSize(268435455)).toBe(4);
        });

        it('returns 5 for values >= 268435456', () => {
            expect(_varintSize(268435456)).toBe(5);
        });

        it('returns 10 for negative values', () => {
            expect(_varintSize(-1)).toBe(10);
            expect(_varintSize(-100)).toBe(10);
        });
    });

    describe('roundtrip', () => {
        it('roundtrips zero', () => {
            let buf = new Uint8Array(10),
                end = _writeVarint(buf, 0, 0),
                [val, off] = _readVarint(buf, 0);

            expect(val).toBe(0);
            expect(off).toBe(end);
        });

        it('roundtrips small values', () => {
            for (let v = 0; v < 128; v++) {
                let buf = new Uint8Array(10),
                    end = _writeVarint(buf, 0, v),
                    [val, off] = _readVarint(buf, 0);

                expect(val).toBe(v);
                expect(off).toBe(end);
                expect(end).toBe(1);
            }
        });

        it('roundtrips medium values', () => {
            let values = [128, 255, 300, 16383, 16384, 65535, 100000];

            for (let i = 0, n = values.length; i < n; i++) {
                let buf = new Uint8Array(10),
                    end = _writeVarint(buf, 0, values[i]),
                    [val, off] = _readVarint(buf, 0);

                expect(val).toBe(values[i]);
                expect(off).toBe(end);
            }
        });

        it('roundtrips large values', () => {
            let values = [2097152, 268435455, 268435456, 2147483647];

            for (let i = 0, n = values.length; i < n; i++) {
                let buf = new Uint8Array(10),
                    end = _writeVarint(buf, 0, values[i]),
                    [val, off] = _readVarint(buf, 0);

                expect(val).toBe(values[i]);
                expect(off).toBe(end);
            }
        });

        it('roundtrips with offset', () => {
            let buf = new Uint8Array(20);

            // Write at offset 5
            buf[0] = 0xFF;
            let end = _writeVarint(buf, 5, 300),
                [val, off] = _readVarint(buf, 5);

            expect(val).toBe(300);
            expect(off).toBe(end);
            expect(buf[0]).toBe(0xFF);
        });
    });
});


describe('Runtime: Float (32-bit)', () => {
    it('roundtrips positive float', () => {
        let buf = new Uint8Array(4);

        _writeFloat(buf, 0, 3.14);

        let [val] = _readFloat(buf, 0);

        expect(val).toBeCloseTo(3.14, 5);
    });

    it('roundtrips negative float', () => {
        let buf = new Uint8Array(4);

        _writeFloat(buf, 0, -1.5);

        let [val] = _readFloat(buf, 0);

        expect(val).toBeCloseTo(-1.5, 5);
    });

    it('roundtrips zero', () => {
        let buf = new Uint8Array(4);

        _writeFloat(buf, 0, 0);

        let [val] = _readFloat(buf, 0);

        expect(val).toBe(0);
    });

    it('returns correct offset', () => {
        let buf = new Uint8Array(8),
            end = _writeFloat(buf, 0, 1.0),
            [, off] = _readFloat(buf, 0);

        expect(end).toBe(4);
        expect(off).toBe(4);
    });

    it('works with non-zero start offset', () => {
        let buf = new Uint8Array(12);

        _writeFloat(buf, 4, 42.5);

        let [val, off] = _readFloat(buf, 4);

        expect(val).toBeCloseTo(42.5, 5);
        expect(off).toBe(8);
    });
});


describe('Runtime: Double (64-bit)', () => {
    it('roundtrips positive double', () => {
        let buf = new Uint8Array(8);

        _writeDouble(buf, 0, 3.141592653589793);

        let [val] = _readDouble(buf, 0);

        expect(val).toBe(3.141592653589793);
    });

    it('roundtrips negative double', () => {
        let buf = new Uint8Array(8);

        _writeDouble(buf, 0, -999.999);

        let [val] = _readDouble(buf, 0);

        expect(val).toBe(-999.999);
    });

    it('roundtrips zero', () => {
        let buf = new Uint8Array(8);

        _writeDouble(buf, 0, 0);

        let [val] = _readDouble(buf, 0);

        expect(val).toBe(0);
    });

    it('preserves full double precision', () => {
        let buf = new Uint8Array(8),
            value = 1.7976931348623157e+308;

        _writeDouble(buf, 0, value);

        let [val] = _readDouble(buf, 0);

        expect(val).toBe(value);
    });

    it('handles Number.MIN_VALUE', () => {
        let buf = new Uint8Array(8);

        _writeDouble(buf, 0, Number.MIN_VALUE);

        let [val] = _readDouble(buf, 0);

        expect(val).toBe(Number.MIN_VALUE);
    });

    it('returns correct offset', () => {
        let buf = new Uint8Array(16),
            end = _writeDouble(buf, 0, 1.0),
            [, off] = _readDouble(buf, 0);

        expect(end).toBe(8);
        expect(off).toBe(8);
    });
});


describe('Runtime: BigInt', () => {
    describe('_bigIntVarintSize', () => {
        it('returns correct sizes for boundary values', () => {
            expect(_bigIntVarintSize(0n)).toBe(1);
            expect(_bigIntVarintSize(127n)).toBe(1);
            expect(_bigIntVarintSize(128n)).toBe(2);
            expect(_bigIntVarintSize(16383n)).toBe(2);
            expect(_bigIntVarintSize(16384n)).toBe(3);
            expect(_bigIntVarintSize(2097151n)).toBe(3);
            expect(_bigIntVarintSize(2097152n)).toBe(4);
            expect(_bigIntVarintSize(268435455n)).toBe(4);
            expect(_bigIntVarintSize(268435456n)).toBe(5);
        });

        it('returns 10 for negative values', () => {
            expect(_bigIntVarintSize(-1n)).toBe(10);
            expect(_bigIntVarintSize(-100n)).toBe(10);
        });
    });

    describe('roundtrip', () => {
        it('roundtrips zero', () => {
            let buf = new Uint8Array(10),
                end = _writeBigInt(buf, 0, 0n),
                [val, off] = _readBigInt(buf, 0);

            expect(val).toBe(0n);
            expect(off).toBe(end);
        });

        it('roundtrips small values', () => {
            let values = [1n, 42n, 127n];

            for (let i = 0, n = values.length; i < n; i++) {
                let buf = new Uint8Array(10),
                    end = _writeBigInt(buf, 0, values[i]),
                    [val, off] = _readBigInt(buf, 0);

                expect(val).toBe(values[i]);
                expect(off).toBe(end);
            }
        });

        it('roundtrips large values', () => {
            let values = [
                BigInt(Number.MAX_SAFE_INTEGER),
                999999999999n,
                72057594037927935n
            ];

            for (let i = 0, n = values.length; i < n; i++) {
                let buf = new Uint8Array(10),
                    end = _writeBigInt(buf, 0, values[i]),
                    [val, off] = _readBigInt(buf, 0);

                expect(val).toBe(values[i]);
                expect(off).toBe(end);
            }
        });

        it('written size matches _bigIntVarintSize', () => {
            let values = [0n, 1n, 127n, 128n, 16384n, 2097152n, 268435456n, 999999999n];

            for (let i = 0, n = values.length; i < n; i++) {
                let buf = new Uint8Array(10),
                    end = _writeBigInt(buf, 0, values[i]);

                expect(end).toBe(_bigIntVarintSize(values[i]));
            }
        });
    });
});


describe('Runtime: String', () => {
    it('roundtrips empty string', () => {
        let buf = new Uint8Array(10),
            end = _writeString(buf, 0, ''),
            [val, off] = _readString(buf, 0);

        expect(val).toBe('');
        expect(off).toBe(end);
    });

    it('roundtrips ASCII string', () => {
        let str = 'hello world',
            buf = new Uint8Array(100),
            end = _writeString(buf, 0, str),
            [val, off] = _readString(buf, 0);

        expect(val).toBe(str);
        expect(off).toBe(end);
    });

    it('roundtrips unicode string', () => {
        let str = 'こんにちは世界🌍',
            buf = new Uint8Array(100),
            end = _writeString(buf, 0, str),
            [val, off] = _readString(buf, 0);

        expect(val).toBe(str);
        expect(off).toBe(end);
    });

    it('roundtrips string with special characters', () => {
        let str = 'line1\nline2\ttab\0null',
            buf = new Uint8Array(100),
            end = _writeString(buf, 0, str),
            [val, off] = _readString(buf, 0);

        expect(val).toBe(str);
        expect(off).toBe(end);
    });

    it('roundtrips long string', () => {
        let str = 'a'.repeat(1000),
            buf = new Uint8Array(1100),
            end = _writeString(buf, 0, str),
            [val, off] = _readString(buf, 0);

        expect(val).toBe(str);
        expect(off).toBe(end);
    });

    it('writes length prefix as varint', () => {
        let buf = new Uint8Array(20);

        _writeString(buf, 0, 'hi');

        // Length 2 should be a single varint byte
        let [len, off] = _readVarint(buf, 0);

        expect(len).toBe(2);
        expect(off).toBe(1);
    });

    it('works with non-zero offset', () => {
        let buf = new Uint8Array(100);

        buf[0] = 0xFF;

        let end = _writeString(buf, 5, 'test'),
            [val, off] = _readString(buf, 5);

        expect(val).toBe('test');
        expect(off).toBe(end);
        expect(buf[0]).toBe(0xFF);
    });
});


describe('Runtime: Multiple sequential writes/reads', () => {
    it('writes and reads multiple varints sequentially', () => {
        let buf = new Uint8Array(30),
            off = 0,
            values = [0, 1, 127, 128, 300, 100000];

        for (let i = 0, n = values.length; i < n; i++) {
            off = _writeVarint(buf, off, values[i]);
        }

        let readOff = 0;

        for (let i = 0, n = values.length; i < n; i++) {
            let [val, newOff] = _readVarint(buf, readOff);

            expect(val).toBe(values[i]);
            readOff = newOff;
        }

        expect(readOff).toBe(off);
    });

    it('writes and reads multiple strings sequentially', () => {
        let buf = new Uint8Array(500),
            off = 0,
            strings = ['hello', '', 'world', 'こんにちは', 'test123'];

        for (let i = 0, n = strings.length; i < n; i++) {
            off = _writeString(buf, off, strings[i]);
        }

        let readOff = 0;

        for (let i = 0, n = strings.length; i < n; i++) {
            let [val, newOff] = _readString(buf, readOff);

            expect(val).toBe(strings[i]);
            readOff = newOff;
        }

        expect(readOff).toBe(off);
    });

    it('writes and reads mixed types sequentially', () => {
        let buf = new Uint8Array(100),
            off = 0;

        // Write: varint, string, double, float
        off = _writeVarint(buf, off, 42);
        off = _writeString(buf, off, 'test');
        off = _writeDouble(buf, off, 3.14);
        off = _writeFloat(buf, off, 1.5);

        // Read back
        let readOff = 0;

        let [v1, o1] = _readVarint(buf, readOff);

        expect(v1).toBe(42);
        readOff = o1;

        let [v2, o2] = _readString(buf, readOff);

        expect(v2).toBe('test');
        readOff = o2;

        let [v3, o3] = _readDouble(buf, readOff);

        expect(v3).toBe(3.14);
        readOff = o3;

        let [v4, o4] = _readFloat(buf, readOff);

        expect(v4).toBeCloseTo(1.5, 5);
        readOff = o4;

        expect(readOff).toBe(off);
    });
});
