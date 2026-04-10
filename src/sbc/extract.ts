// Field extraction — extract a single field from an encoded buffer without full decode
// Extracted from codec() closure; state threaded via ExtractContext

import { FIELD_SIZES } from './constants';
import { _vr, readStr, readVarint } from './platform';
import { readFixedField } from './schema';
import { decodeTagEnd } from './tagged';

import type { Schema } from './codegen';


type ExtractContext = {
    decode(buffer: Uint8Array): unknown;
    decodeSbc(buf: Uint8Array, offset: number, len: number, depth: number): unknown;
    schemas: Map<number, Schema>;
};


function extractField(ctx: ExtractContext, buffer: Uint8Array, fieldName: string): unknown {
    if (buffer[0] !== 8 && buffer[0] !== 18) {
        return undefined;
    }

    let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
        schema = ctx.schemas.get(hash);

    if (!schema) {
        return undefined;
    }

    // Compressed format — offset math assumes uncompressed layout; fall back to full decode
    if (buffer[0] === 18) {
        let decoded = ctx.decode(buffer) as Record<string, unknown> | null;

        return decoded ? decoded[fieldName] : undefined;
    }

    let fields = schema.fields,
        n = fields.length,
        targetIdx = -1;

    for (let i = 0; i < n; i++) {
        if (fields[i]!.name === fieldName) {
            targetIdx = i;
            break;
        }
    }

    if (targetIdx === -1) {
        return undefined;
    }

    let bm = schema.bitmapBytes,
        target = fields[targetIdx]!;

    // Check nullable bitmap for target field
    if (target.nullable) {
        let bitmap = bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8));

        if (!(bitmap & (1 << target.nullIndex))) {
            return null;
        }
    }

    let dataStart = 9 + bm;

    // O(1) path: target is fixed-size and all preceding fields are also fixed-size
    if (target.fixedSize > 0) {
        let allPrecedingFixed = true;

        for (let i = 0; i < targetIdx; i++) {
            if (fields[i]!.fixedSize === 0) {
                allPrecedingFixed = false;
                break;
            }
        }

        if (allPrecedingFixed) {
            let bitmap = bm > 0 ? (bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8))) : 0,
                pos = dataStart;

            for (let i = 0; i < targetIdx; i++) {
                let f = fields[i]!;

                if (f.nullable && !(bitmap & (1 << f.nullIndex))) {
                    continue;
                }

                pos += f.fixedSize;
            }

            if (pos + target.fixedSize > buffer.length) {
                throw new Error('Codec2: buffer too short for field at offset ' + pos);
            }

            return readFixedField(buffer, pos, target.type);
        }
    }

    // Variable-size scan
    let bitmap = bm > 0 ? (bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8))) : 0,
        pos = dataStart;

    for (let i = 0; i < targetIdx; i++) {
        let f = fields[i]!;

        if (f.nullable && !(bitmap & (1 << f.nullIndex))) {
            continue;
        }

        if (f.fixedSize > 0) {
            pos += f.fixedSize;
            continue;
        }

        switch (f.type) {
            case 'bytes':
            case 'string': {
                readVarint(buffer, pos);
                pos = _vr.p + _vr.v;
                break;
            }
            case 'array': {
                if (f.elementType) {
                    // Typed array: varint count + element-specific data
                    readVarint(buffer, pos);

                    let count = _vr.v;

                    pos = _vr.p;

                    let elemSize = f.elementType.base ? FIELD_SIZES[f.elementType.base] : 0;

                    if (elemSize > 0) {
                        pos += count * elemSize;
                    }
                    else if (f.elementType.base === 'string' || f.elementType.base === 'bytes') {
                        for (let j = 0; j < count; j++) {
                            readVarint(buffer, pos);
                            pos = _vr.p + _vr.v;
                        }
                    }
                    else if (f.elementType.base === 'object' && f.elementType.hash !== undefined) {
                        for (let j = 0; j < count; j++) {
                            let fb = buffer[pos]!;

                            if (fb < 128) {
                                pos += 1 + fb;
                            }
                            else if (fb === 8 || fb === 18) {
                                if (pos + 9 > buffer.length) {
                                    return undefined;
                                }

                                let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                                pos += 9 + dLen;
                            }
                            else {
                                pos = decodeTagEnd(buffer, pos, 0);
                            }
                        }
                    }
                    else {
                        for (let j = 0; j < count; j++) {
                            pos = decodeTagEnd(buffer, pos, 0);
                        }
                    }
                }
                else {
                    // Generic array: flag + u32 count
                    let flag = buffer[pos]!,
                        count = (buffer[pos + 1]! | (buffer[pos + 2]! << 8) | (buffer[pos + 3]! << 16) | (buffer[pos + 4]! << 24)) >>> 0;

                    pos += 5;

                    if (flag === 1) {
                        pos += count;
                    }
                    else if (flag === 2) {
                        pos += count * 4;
                    }
                    else if (flag === 3) {
                        pos += count * 8;
                    }
                    else {
                        for (let j = 0; j < count; j++) {
                            pos = decodeTagEnd(buffer, pos, 0);
                        }
                    }
                }

                break;
            }
            case 'mixed':
            case 'object': {
                if (f.refHash !== undefined) {
                    // Typed object: varint dataLen or full tag-8 header
                    let fb = buffer[pos]!;

                    if (fb < 128) {
                        pos += 1 + fb;
                    }
                    else if (fb === 8 || fb === 18) {
                        if (pos + 9 > buffer.length) {
                            return undefined;
                        }

                        let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                        pos += 9 + dLen;
                    }
                    else {
                        pos = decodeTagEnd(buffer, pos, 0);
                    }
                }
                else if (buffer[pos] === 8 || buffer[pos] === 18) {
                    if (pos + 9 > buffer.length) {
                        return undefined;
                    }

                    let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                    pos += 9 + dLen;
                }
                else {
                    pos = decodeTagEnd(buffer, pos, 0);
                }

                break;
            }
            case 'map':
            case 'set':
            case 'typedarray': {
                pos = decodeTagEnd(buffer, pos, 0);
                break;
            }
            default:
                return undefined;
        }
    }

    // pos now points to target field data
    if (target.fixedSize > 0) {
        if (pos + target.fixedSize > buffer.length) {
            throw new Error('Codec2: buffer too short for field at offset ' + pos);
        }

        return readFixedField(buffer, pos, target.type);
    }

    switch (target.type) {
        case 'string': {
            readVarint(buffer, pos);
            return readStr(buffer, _vr.p, _vr.v);
        }
        case 'bytes': {
            readVarint(buffer, pos);
            return buffer.slice(_vr.p, _vr.p + _vr.v);
        }
        case 'array': {
            // Both typed and generic arrays use schema-specific encoding;
            // fall back to full object decode to read the field correctly
            let s = ctx.schemas.get(hash);

            if (s && s.decodeFn) {
                let obj = s.decodeFn(buffer, dataStart, 0) as Record<string, unknown>;

                return obj[fieldName];
            }

            return undefined;
        }
        case 'map':
        case 'mixed':
        case 'set':
        case 'typedarray':
            return ctx.decodeSbc(buffer, pos, decodeTagEnd(buffer, pos, 0) - pos, 0);
        case 'object': {
            if (target.refHash !== undefined) {
                // Typed object — use full object decode
                let s = ctx.schemas.get(hash);

                if (s && s.decodeFn) {
                    let obj = s.decodeFn(buffer, dataStart, 0) as Record<string, unknown>;

                    return obj[fieldName];
                }

                return undefined;
            }

            if (pos + 9 > buffer.length) {
                return undefined;
            }

            let end = (buffer[pos] === 8 || buffer[pos] === 18)
                ? pos + 9 + ((buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0)
                : decodeTagEnd(buffer, pos, 0);

            return ctx.decodeSbc(buffer, pos, end - pos, 0);
        }
        default:
            return undefined;
    }
}


export { extractField };
export type { ExtractContext };
