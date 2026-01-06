import type { AnalyzedProperty, AnalyzedType } from '~/transformer/type-analyzer';


type RuntimeNeeds = {
    bigint: boolean;
    double: boolean;
    float: boolean;
    string: boolean;
    varint: boolean;
};


const HELPER_BIGINT = `
    function _writeBigInt(buffer, offset, value) {
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

    function _readBigInt(buffer, offset) {
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

    function _bigIntVarintSize(value) {
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
`;

const HELPER_DOUBLE = `
    const _f64Buffer = new ArrayBuffer(8);
    const _f64View = new DataView(_f64Buffer);
    const _f64Bytes = new Uint8Array(_f64Buffer);

    function _writeDouble(buffer, offset, value) {
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

    function _readDouble(buffer, offset) {
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
`;

const HELPER_FLOAT = `
    const _f32Buffer = new ArrayBuffer(4);
    const _f32View = new DataView(_f32Buffer);
    const _f32Bytes = new Uint8Array(_f32Buffer);

    function _writeFloat(buffer, offset, value) {
        _f32View.setFloat32(0, value, true);

        buffer[offset] = _f32Bytes[0];
        buffer[offset + 1] = _f32Bytes[1];
        buffer[offset + 2] = _f32Bytes[2];
        buffer[offset + 3] = _f32Bytes[3];

        return offset + 4;
    }

    function _readFloat(buffer, offset) {
        _f32Bytes[0] = buffer[offset];
        _f32Bytes[1] = buffer[offset + 1];
        _f32Bytes[2] = buffer[offset + 2];
        _f32Bytes[3] = buffer[offset + 3];

        return [_f32View.getFloat32(0, true), offset + 4];
    }
`;

const HELPER_STRING = `
    const _textEncoder = new TextEncoder();
    const _textDecoder = new TextDecoder();
    const _encode = TextEncoder.prototype.encode;
    const _decode = TextDecoder.prototype.decode;
    const _set = Uint8Array.prototype.set;
    const _subarray = Uint8Array.prototype.subarray;

    function _writeString(buffer, offset, value) {
        let encoded = _encode.call(_textEncoder, value);

        offset = _writeVarint(buffer, offset, encoded.length);
        _set.call(buffer, encoded, offset);

        return offset + encoded.length;
    }

    function _readString(buffer, offset) {
        let [length, newOffset] = _readVarint(buffer, offset);
        let str = _decode.call(_textDecoder, _subarray.call(buffer, newOffset, newOffset + length));

        return [str, newOffset + length];
    }
`;

const HELPER_VARINT = `
    function _varintSize(value) {
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

    function _writeVarint(buffer, offset, value) {
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

    function _readVarint(buffer, offset) {
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
`;


function scanProperty(prop: AnalyzedProperty, needs: RuntimeNeeds): void {
    switch (prop.type) {
        case 'array':
            if (prop.itemType) {
                scanProperty(prop.itemType, needs);
            }

            break;

        case 'bigint':
            needs.bigint = true;
            needs.varint = true;
            break;

        case 'boolean':
            needs.varint = true;
            break;

        case 'number':
            needs.varint = true;

            if (prop.brand === 'float') {
                needs.float = true;
            }
            else if (prop.brand !== 'integer') {
                // Unbranded number defaults to double
                needs.double = true;
            }

            break;

        case 'object':
            if (prop.properties) {
                for (let i = 0, n = prop.properties.length; i < n; i++) {
                    scanProperty(prop.properties[i], needs);
                }
            }

            needs.varint = true;
            break;

        case 'string':
            needs.string = true;
            needs.varint = true;
            break;
    }
}


const analyzeRuntimeNeeds = (type: AnalyzedType): RuntimeNeeds => {
    let needs: RuntimeNeeds = {
        bigint: false,
        double: false,
        float: false,
        string: false,
        varint: false
    };

    for (let i = 0, n = type.properties.length; i < n; i++) {
        scanProperty(type.properties[i], needs);
    }

    return needs;
};

const buildRuntimeHelpers = (needs: RuntimeNeeds): string => {
    let parts: string[] = [];

    if (needs.varint) {
        parts.push(HELPER_VARINT);
    }

    if (needs.string) {
        parts.push(HELPER_STRING);
    }

    if (needs.float) {
        parts.push(HELPER_FLOAT);
    }

    if (needs.double) {
        parts.push(HELPER_DOUBLE);
    }

    if (needs.bigint) {
        parts.push(HELPER_BIGINT);
    }

    return parts.join('\n');
};


export { analyzeRuntimeNeeds, buildRuntimeHelpers };
