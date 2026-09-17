// Field extraction — extract a single field from an encoded buffer without full decode
// Extracted from codec() closure; state threaded via ExtractContext

import { FIELD_SIZES, MAX_ARRAY_COUNT } from './constants';
import { _vr, readStr, readVarint, TYPED_ARRAY_BPE } from './platform';
import { readFixedField } from './schema';
import { decodeTagEnd } from './tagged';

import type { Schema } from './codegen';


type ExtractContext = {
    decode(buffer: Uint8Array): unknown;
    decodeSbc(buf: Uint8Array, offset: number, end: number, depth: number): unknown;
    resolveSchema(hash: number): Schema | null;
    schemas: Map<number, Schema>;
};


function extractField(ctx: ExtractContext, buffer: Uint8Array, fieldName: string): unknown {
    if (buffer[0] !== 8 && buffer[0] !== 18) {
        return undefined;
    }

    if (buffer.length < 9) {
        return undefined;
    }

    let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
        schema = ctx.schemas.get(hash) ?? ctx.resolveSchema(hash);

    if (!schema) {
        return undefined;
    }

    // Compressed format — offset math assumes uncompressed layout; fall back to full decode
    // (which now enforces its own payload boundary).
    if (buffer[0] === 18) {
        let decoded = ctx.decode(buffer) as Record<string, unknown> | null;

        return decoded ? decoded[fieldName] : undefined;
    }

    // Payload-end bound: the declared frame, clipped to the physical buffer. Every read below
    // is checked against `end` so extraction can never spill into trailing bytes when the
    // declared payload is zero/small, while a physically truncated frame keeps the documented
    // "return undefined" for an object header that does not fit.
    let frameEnd = 9 + ((buffer[5]! | (buffer[6]! << 8) | (buffer[7]! << 16) | (buffer[8]! << 24)) >>> 0),
        end = frameEnd > buffer.length ? buffer.length : frameEnd;

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
        bitmap = 0,
        target = fields[targetIdx]!;

    if (bm > 0) {
        if (9 + bm > end) {
            throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + (9 + bm));
        }

        bitmap = bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8));
    }

    // Check nullable bitmap for target field
    if (target.nullable) {
        if (!(bitmap & (1 << target.nullIndex))) {
            return null;
        }
    }

    let pos = 9 + bm;

    for (let i = 0; i < targetIdx; i++) {
        let f = fields[i]!;

        if (f.nullable && !(bitmap & (1 << f.nullIndex))) {
            continue;
        }

        if (f.fixedSize > 0) {
            pos += f.fixedSize;

            if (pos > end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            continue;
        }

        switch (f.type) {
            case 'bytes':
            case 'string': {
                if (pos >= end) {
                    throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                }

                readVarint(buffer, pos);
                pos = _vr.p + _vr.v;

                if (pos > end) {
                    throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                }

                break;
            }
            case 'array': {
                if (f.elementType) {
                    // Typed array: varint count + element-specific data
                    if (pos >= end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }

                    readVarint(buffer, pos);

                    let count = _vr.v;

                    pos = _vr.p;

                    if (pos > end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }

                    if (count > MAX_ARRAY_COUNT) {
                        throw new Error('@esportsplus/data: codec array count ' + count + ' exceeds limit');
                    }

                    let elemSize = f.elementType.base ? FIELD_SIZES[f.elementType.base] : 0;

                    if (elemSize > 0) {
                        pos += count * elemSize;

                        if (pos > end) {
                            throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                        }
                    }
                    else if (f.elementType.base === 'string' || f.elementType.base === 'bytes') {
                        for (let j = 0; j < count; j++) {
                            if (pos >= end) {
                                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                            }

                            readVarint(buffer, pos);
                            pos = _vr.p + _vr.v;

                            if (pos > end) {
                                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                            }
                        }
                    }
                    else if (f.elementType.base === 'object' && f.elementType.hash !== undefined) {
                        for (let j = 0; j < count; j++) {
                            if (pos >= end) {
                                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                            }

                            let fb = buffer[pos]!;

                            if (fb < 128) {
                                pos += 1 + fb;
                            }
                            else {
                                readVarint(buffer, pos);
                                pos = _vr.p + _vr.v;
                            }

                            if (pos > end) {
                                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                            }
                        }
                    }
                    else {
                        for (let j = 0; j < count; j++) {
                            pos = decodeTagEnd(buffer, pos, end, 0);
                        }
                    }
                }
                else {
                    // Generic array: flag + u32 count
                    if (pos + 5 > end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }

                    let flag = buffer[pos]!,
                        count = (buffer[pos + 1]! | (buffer[pos + 2]! << 8) | (buffer[pos + 3]! << 16) | (buffer[pos + 4]! << 24)) >>> 0;

                    pos += 5;

                    if (count > MAX_ARRAY_COUNT) {
                        throw new Error('@esportsplus/data: codec array count ' + count + ' exceeds limit');
                    }

                    if (flag > 0) {
                        pos += count * TYPED_ARRAY_BPE[flag - 1]!;

                        if (pos > end) {
                            throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                        }
                    }
                    else {
                        for (let j = 0; j < count; j++) {
                            pos = decodeTagEnd(buffer, pos, end, 0);
                        }
                    }
                }

                break;
            }
            case 'mixed':
            case 'object': {
                if (f.refHash !== undefined) {
                    // Typed object: varint payload-length prefix
                    if (pos >= end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }

                    let fb = buffer[pos]!;

                    if (fb < 128) {
                        pos += 1 + fb;
                    }
                    else {
                        readVarint(buffer, pos);
                        pos = _vr.p + _vr.v;
                    }

                    if (pos > end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }
                }
                else if (buffer[pos] === 8 || buffer[pos] === 18) {
                    if (pos + 9 > end) {
                        return undefined;
                    }

                    let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                    pos += 9 + dLen;

                    if (pos > end) {
                        throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
                    }
                }
                else {
                    pos = decodeTagEnd(buffer, pos, end, 0);
                }

                break;
            }
            case 'typedarray': {
                pos = decodeTagEnd(buffer, pos, end, 0);
                break;
            }
            default:
                return undefined;
        }
    }

    // pos now points to target field data
    if (target.fixedSize > 0) {
        if (pos + target.fixedSize > end) {
            throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
        }

        return readFixedField(buffer, pos, target.type);
    }

    switch (target.type) {
        case 'string': {
            if (pos >= end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            readVarint(buffer, pos);

            if (_vr.p + _vr.v > end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            return readStr(buffer, _vr.p, _vr.v);
        }
        case 'bytes': {
            if (pos >= end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            readVarint(buffer, pos);

            if (_vr.p + _vr.v > end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            return new Uint8Array(buffer.subarray(_vr.p, _vr.p + _vr.v));
        }
        case 'array': {
            // Both typed and generic arrays use schema-specific encoding;
            // fall back to full object decode to read the field correctly
            if (schema.decodeFn) {
                let obj = schema.decodeFn(buffer, 9, 0, end) as Record<string, unknown>;

                return obj[fieldName];
            }

            return undefined;
        }
        case 'mixed':
        case 'typedarray':
            return ctx.decodeSbc(buffer, pos, decodeTagEnd(buffer, pos, end, 0), 0);
        case 'object': {
            if (target.refHash !== undefined) {
                // Typed object — use full object decode
                if (schema.decodeFn) {
                    let obj = schema.decodeFn(buffer, 9, 0, end) as Record<string, unknown>;

                    return obj[fieldName];
                }

                return undefined;
            }

            if (pos + 9 > end) {
                return undefined;
            }

            let fieldEnd = (buffer[pos] === 8 || buffer[pos] === 18)
                ? pos + 9 + ((buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0)
                : decodeTagEnd(buffer, pos, end, 0);

            if (fieldEnd > end) {
                throw new Error('@esportsplus/data: codec buffer too short for field at offset ' + pos);
            }

            return ctx.decodeSbc(buffer, pos, fieldEnd, 0);
        }
        default:
            return undefined;
    }
}


export { extractField };
export type { ExtractContext };
