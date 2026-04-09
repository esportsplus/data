// Codec2 Codegen — Compile type-specific encode/decode functions via new Function()
// Zero per-field branching: all type checks happen at compile time

import { codegenDriver, readVarint, readZigzag, writeVarint, writeZigzag } from './platform';
import type { CodegenDriver } from './platform';


interface ParsedType {
    base: string;
    elementType?: ParsedType;
    hash?: number;
}

interface FieldDef {
    elementType?: ParsedType;
    fixedSize: number;
    name: string;
    nullable: boolean;
    nullIndex: number;
    offset: number;
    rawType: string;
    refHash?: number;
    type: string;
}

interface Schema {
    bitmapBytes: number;
    boolFields: number[];
    compFixedSize: number;
    compressedDecodeFn: ((buf: Uint8Array, pos: number, depth: number) => unknown) | null;
    compressedEncodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    compressible: boolean;
    decodeFn: ((buf: Uint8Array, pos: number, depth: number) => unknown) | null;
    encodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    fields: FieldDef[];
    fixedSize: number;
    float64Fields: number[];
    hash: number;
    id: number;
    intFields: number[];
    nullableCount: number;
}

interface SbcHelpers {
    decodeSbc: (buf: Uint8Array, offset: number, len: number, depth: number) => unknown;
    decodeTagEnd: (buf: Uint8Array, offset: number, depth: number) => number;
    encodeObj: (obj: Record<string, unknown>, buf: Uint8Array, pos: number) => number;
    encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number;
    registry: Map<number, Schema>;
}


function compileSchema(schema: Schema, helpers: SbcHelpers): void {
    let d = codegenDriver;

    schema.encodeFn = compileEncoder(schema, d, helpers);
    schema.decodeFn = compileDecoder(schema, d, helpers);

    if (schema.compressible) {
        schema.compressedEncodeFn = compileCompressedEncoder(schema, d, helpers);
        schema.compressedDecodeFn = compileCompressedDecoder(schema, d, helpers);
    }
}


function compileEncoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    // Collect unique ref hashes for direct-call encode
    let refHashes: Map<number, string> = new Map(),
        refIdx = 0;

    for (let i = 0; i < n; i++) {
        let f = fields[i]!;

        if (f.refHash !== undefined && !refHashes.has(f.refHash)) {
            let rs = helpers.registry.get(f.refHash);

            if (rs && rs.encodeFn) {
                refHashes.set(f.refHash, `_re${refIdx++}`);
            }
        }

        if (f.elementType?.hash !== undefined && !refHashes.has(f.elementType.hash)) {
            let rs = helpers.registry.get(f.elementType.hash);

            if (rs && rs.encodeFn) {
                refHashes.set(f.elementType.hash, `_re${refIdx++}`);
            }
        }
    }

    body += d.preamble('b');
    body += `let p=pos;\n`;

    if (schema.nullableCount > 0) {
        body += `let _bm=0,_bp=p;p+=${schema.bitmapBytes};\n`;
    }

    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            name = f.name,
            safeKey = JSON.stringify(name),
            val = `o[${safeKey}]`;

        if (f.nullable) {
            body += `if(${val}!=null){_bm|=${1 << f.nullIndex};`;
        }

        switch (f.type) {
            case 'boolean':
                body += `b[p]=${val}?1:0;p+=1;\n`;
                break;

            case 'uint8':
                body += `b[p]=${val};p+=1;\n`;
                break;

            case 'int8':
                body += `b[p]=${val}&0xFF;p+=1;\n`;
                break;

            case 'uint16':
                body += `b[p]=${val}&0xFF;b[p+1]=(${val}>>>8)&0xFF;p+=2;\n`;
                break;

            case 'int16':
                body += `{let v=${val};b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}\n`;
                break;

            case 'uint32':
                body += `{let v=${val};b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}\n`;
                break;

            case 'int32':
                body += `{let v=${val};b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}\n`;
                break;

            case 'float64':
                body += `${d.writeF64('p', val)};p+=8;\n`;
                break;

            case 'bigint':
                body += `_wBI64.call(b,${val},p);p+=8;\n`;
                break;

            case 'date':
                body += `${d.writeF64('p', `${val}.getTime()`)};p+=8;\n`;
                break;

            case 'string':

                // ASCII fast path — single-pass check+write for short strings (varint length)
                body += `{let s=${val},sl=s.length;`;
                body += `if(sl<17){`;
                body += `b[p]=sl;p+=1;`;
                body += `let _ok=1;for(let _k=0;_k<sl;_k++){let _c=s.charCodeAt(_k);if(_c>127){_ok=0;break;}b[p+_k]=_c;}`;
                body += `if(_ok){p+=sl;}`;
                body += `else{p-=1;let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}`;
                body += `else{let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}\n`;
                break;

            case 'bytes':

                body += `{let v=${val},l=v.length;`;
                body += `p=_wv(b,p,l);`;
                body += `b.set(v,p);p+=l;}\n`;
                break;

            case 'array':
                if (f.elementType) {
                    let et = f.elementType;

                    if (et.base === 'boolean' || et.base === 'uint8' || et.base === 'int8' ||
                        et.base === 'uint16' || et.base === 'int16' ||
                        et.base === 'uint32' || et.base === 'int32' ||
                        et.base === 'float64' || et.base === 'date' || et.base === 'bigint') {
                        // Typed array: varint count + raw fixed-size elements
                        body += `{let a=${val},l=a.length;p=_wv(b,p,l);`;

                        switch (et.base) {
                            case 'boolean':
                                body += `for(let i=0;i<l;i++){b[p]=a[i]?1:0;p+=1;}`;
                                break;
                            case 'uint8':
                                body += `for(let i=0;i<l;i++){b[p+i]=a[i];}p+=l;`;
                                break;
                            case 'int8':
                                body += `for(let i=0;i<l;i++){b[p]=a[i]&0xFF;p+=1;}`;
                                break;
                            case 'uint16':
                                body += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}`;
                                break;
                            case 'int16':
                                body += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}`;
                                break;
                            case 'uint32':
                                body += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}`;
                                break;
                            case 'int32':
                                body += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}`;
                                break;
                            case 'float64':
                                body += `for(let i=0;i<l;i++){${d.writeF64('p', 'a[i]')};p+=8;}`;
                                break;
                            case 'date':
                                body += `for(let i=0;i<l;i++){${d.writeF64('p', 'a[i].getTime()')};p+=8;}`;
                                break;
                            case 'bigint':
                                body += `for(let i=0;i<l;i++){_wBI64.call(b,a[i],p);p+=8;}`;
                                break;
                        }

                        body += `}\n`;
                    }
                    else if (et.base === 'string') {
                        // Typed array<string>: varint count + per-element [varint len][utf8 data]
                        body += `{let a=${val},l=a.length;p=_wv(b,p,l);for(let i=0;i<l;i++){let s=a[i],sl=s.length;`;
                        body += `if(sl<17){b[p]=sl;p+=1;let _ok=1;for(let _k=0;_k<sl;_k++){let _c=s.charCodeAt(_k);if(_c>127){_ok=0;break;}b[p+_k]=_c;}if(_ok){p+=sl;}else{p-=1;let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}`;
                        body += `else{let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}}\n`;
                    }
                    else if (et.base === 'bytes') {
                        // Typed array<bytes>: varint count + per-element [varint len][raw bytes]
                        body += `{let a=${val},l=a.length;p=_wv(b,p,l);for(let i=0;i<l;i++){let v=a[i],vl=v.length;p=_wv(b,p,vl);b.set(v,p);p+=vl;}}\n`;
                    }
                    else if (et.base === 'object' && et.hash !== undefined) {
                        // Typed array<object(hash)>: varint count + per-element [varint payloadLen][fields]
                        let refParam = refHashes.get(et.hash);

                        if (refParam) {
                            body += `{let a=${val},l=a.length;p=_wv(b,p,l);for(let i=0;i<l;i++){`;
                            body += `let _lp=p;p+=1;let _end=${refParam}(a[i],b,p);let _dl=_end-p;`;
                            body += `if(_dl<128){b[_lp]=_dl;p=_end;}`;
                            body += `else{p=_encObj(a[i],b,_lp);}}}\n`;
                        }
                        else {
                            // Referenced schema not compiled — tagged fallback
                            body += `{let a=${val},l=a.length;p=_wv(b,p,l);for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}\n`;
                        }
                    }
                    else {
                        // Container element types: varint count + tagged elements
                        body += `{let a=${val},l=a.length;p=_wv(b,p,l);for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}\n`;
                    }
                }
                else {
                    // Existing generic path — inline packed numeric detection
                    body += `{let a=${val},l=a.length,_pk=0;`;
                    body += `if(l>0&&typeof a[0]==='number'){`;
                    body += `let _u8=1,_i32=1,_an=1;`;
                    body += `for(let i=0;i<l;i++){let v=a[i];if(typeof v!=='number'){_an=0;break;}`;
                    body += `if(v!==((v&0xFF)>>>0)){_u8=0;}`;
                    body += `if(v!==(v|0)){_i32=0;}}`;
                    // packed uint8: flag=1, u32 count, raw bytes
                    body += `if(_an&&_u8){_pk=1;b[p]=1;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){b[p+i]=a[i];}p+=l;}`;
                    // packed int32: flag=2, u32 count, 4 bytes each
                    body += `else if(_an&&_i32){_pk=1;b[p]=2;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}}`;
                    // packed float64: flag=3, u32 count, 8 bytes each
                    body += `else if(_an){_pk=1;b[p]=3;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){${d.writeF64('p', 'a[i]')};p+=8;}}}`;
                    // generic: flag=0, u32 count, tagged elements
                    body += `if(!_pk){b[p]=0;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}}\n`;
                }

                break;

            case 'object':
                if (f.refHash !== undefined) {
                    let rp = refHashes.get(f.refHash);

                    if (rp) {
                        // Direct encode: reserve 1 byte for varint len, call ref encoder
                        body += `{let _lp=p;p+=1;let _end=${rp}(${val},b,p);let _dl=_end-p;`;
                        body += `if(_dl<128){b[_lp]=_dl;p=_end;}`;
                        body += `else{p=_encObj(${val},b,_lp);}}\n`;
                    }
                    else {
                        body += `p=_encObj(${val},b,p);\n`;
                    }
                }
                else {
                    body += `p=_encObj(${val},b,p);\n`;
                }

                break;

            case 'map':
            case 'set':
            case 'typedarray':

                body += `p=_enc(${val},b,p);\n`;
                break;

            case 'mixed':

                body += `p=_enc(${val},b,p);\n`;
                break;
        }

        if (f.nullable) {
            body += `}\n`;
        }
    }

    if (schema.nullableCount > 0) {
        body += `b[_bp]=_bm&0xFF;\n`;

        if (schema.bitmapBytes > 1) {
            body += `b[_bp+1]=(_bm>>>8)&0xFF;\n`;
        }
    }

    body += `return p;\n`;

    let bindArgs = d.encoderBindArgs(),
        params = d.encoderParams(),
        refEncParamNames = [...refHashes.values()],
        refEncBindValues = [...refHashes.keys()].map(h => helpers.registry.get(h)!.encodeFn!);

    try {
        return (
            new Function(params, '_enc', '_encObj', '_wv', ...refEncParamNames, `return function encode(o,b,pos){${body}}`)
        )(...bindArgs, helpers.encodeSbc, helpers.encodeObj, writeVarint, ...refEncBindValues);
    }
    catch (e) {
        throw new Error('Codec2: encoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


function compileDecoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (buf: Uint8Array, pos: number) => unknown {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    // Collect unique ref hashes for direct-call decode
    let refHashes: Map<number, string> = new Map(),
        refIdx = 0;

    for (let i = 0; i < n; i++) {
        let f = fields[i]!;

        if (f.refHash !== undefined && !refHashes.has(f.refHash)) {
            let rs = helpers.registry.get(f.refHash);

            if (rs && rs.decodeFn) {
                refHashes.set(f.refHash, `_rd${refIdx++}`);
            }
        }

        if (f.elementType?.hash !== undefined && !refHashes.has(f.elementType.hash)) {
            let rs = helpers.registry.get(f.elementType.hash);

            if (rs && rs.decodeFn) {
                refHashes.set(f.elementType.hash, `_rd${refIdx++}`);
            }
        }
    }

    body += d.preamble('b');
    body += `let p=pos;\n`;

    if (schema.nullableCount > 0) {
        if (schema.bitmapBytes === 1) {
            body += `let _bm=b[p];p+=1;\n`;
        }
        else {
            body += `let _bm=b[p]|(b[p+1]<<8);p+=2;\n`;
        }
    }

    // Declare all field variables — nullable fields default to null
    for (let i = 0; i < n; i++) {
        if (fields[i]!.nullable) {
            body += `let f${i}=null;\n`;
        }
        else {
            body += `let f${i};\n`;
        }
    }

    for (let i = 0; i < n; i++) {
        let f = fields[i]!;

        if (f.nullable) {
            body += `if(_bm&${1 << f.nullIndex}){`;
        }

        switch (f.type) {
            case 'boolean':
                body += `f${i}=!!b[p];p+=1;\n`;
                break;

            case 'uint8':
                body += `f${i}=b[p];p+=1;\n`;
                break;

            case 'int8':
                body += `f${i}=(b[p]<<24)>>24;p+=1;\n`;
                break;

            case 'uint16':
                body += `f${i}=b[p]|(b[p+1]<<8);p+=2;\n`;
                break;

            case 'int16':
                body += `f${i}=((b[p]|(b[p+1]<<8))<<16)>>16;p+=2;\n`;
                break;

            case 'uint32':
                body += `f${i}=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0;p+=4;\n`;
                break;

            case 'int32':
                body += `f${i}=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;\n`;
                break;

            case 'float64':
                body += `f${i}=${d.readF64('p')};p+=8;\n`;
                break;

            case 'bigint':
                body += `f${i}=_rBI64.call(b,p);p+=8;\n`;
                break;

            case 'date':
                body += `f${i}=new Date(${d.readF64('p')});p+=8;\n`;
                break;

            case 'string':
                // Inline varint read — single byte for lengths < 128 (common case)
                body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}if(p+l>b.length)throw new Error('Codec2: truncated string');f${i}=${d.readStr('p', 'l')};p+=l;}\n`;
                break;

            case 'bytes':
                body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}if(p+l>b.length)throw new Error('Codec2: truncated bytes');f${i}=b.slice(p,p+l);p+=l;}\n`;
                break;

            case 'array':
                if (f.elementType) {
                    let et = f.elementType;

                    if (et.base === 'boolean' || et.base === 'uint8' || et.base === 'int8' ||
                        et.base === 'uint16' || et.base === 'int16' ||
                        et.base === 'uint32' || et.base === 'int32' ||
                        et.base === 'float64' || et.base === 'date' || et.base === 'bigint') {
                        // Typed array: varint count + raw fixed-size elements
                        body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                        body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                        body += `let a=new Array(l);`;

                        switch (et.base) {
                            case 'boolean':
                                body += `for(let i=0;i<l;i++){a[i]=!!b[p];p+=1;}`;
                                break;
                            case 'uint8':
                                body += `for(let i=0;i<l;i++){a[i]=b[p+i];}p+=l;`;
                                break;
                            case 'int8':
                                body += `for(let i=0;i<l;i++){a[i]=(b[p]<<24)>>24;p+=1;}`;
                                break;
                            case 'uint16':
                                body += `for(let i=0;i<l;i++){a[i]=b[p]|(b[p+1]<<8);p+=2;}`;
                                break;
                            case 'int16':
                                body += `for(let i=0;i<l;i++){a[i]=((b[p]|(b[p+1]<<8))<<16)>>16;p+=2;}`;
                                break;
                            case 'uint32':
                                body += `for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0;p+=4;}`;
                                break;
                            case 'int32':
                                body += `for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;}`;
                                break;
                            case 'float64':
                                body += `for(let i=0;i<l;i++){a[i]=${d.readF64('p')};p+=8;}`;
                                break;
                            case 'date':
                                body += `for(let i=0;i<l;i++){a[i]=new Date(${d.readF64('p')});p+=8;}`;
                                break;
                            case 'bigint':
                                body += `for(let i=0;i<l;i++){a[i]=_rBI64.call(b,p);p+=8;}`;
                                break;
                        }

                        body += `f${i}=a;}\n`;
                    }
                    else if (et.base === 'string') {
                        // Typed array<string>: varint count + per-element [varint len][utf8 data]
                        body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                        body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                        body += `let a=new Array(l);`;
                        body += `for(let i=0;i<l;i++){let sl=b[p];if(sl<128){p+=1;}else{let _vr=_rv(b,p);sl=_vr[0];p=_vr[1];}a[i]=${d.readStr('p', 'sl')};p+=sl;}`;
                        body += `f${i}=a;}\n`;
                    }
                    else if (et.base === 'bytes') {
                        // Typed array<bytes>: varint count + per-element [varint len][raw bytes]
                        body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                        body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                        body += `let a=new Array(l);`;
                        body += `for(let i=0;i<l;i++){let bl=b[p];if(bl<128){p+=1;}else{let _vr=_rv(b,p);bl=_vr[0];p=_vr[1];}a[i]=b.slice(p,p+bl);p+=bl;}`;
                        body += `f${i}=a;}\n`;
                    }
                    else if (et.base === 'object' && et.hash !== undefined) {
                        // Typed array<object(hash)>: varint count + per-element [varint payloadLen][fields]
                        let refParam = refHashes.get(et.hash);

                        if (refParam) {
                            body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                            body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                            body += `let a=new Array(l);`;
                            body += `for(let i=0;i<l;i++){let _dl=b[p];`;
                            body += `if(_dl<128){p+=1;a[i]=${refParam}(b,p,_d+1);p+=_dl;}`;
                            body += `else{if(b[p]===8||b[p]===18){`;
                            body += `let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,`;
                            body += `_dl2=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0,`;
                            body += `_s=_reg.get(_h);`;
                            body += `if(_s&&_s.decodeFn){a[i]=_s.decodeFn(b,p+9,_d+1);}else{a[i]=null;}`;
                            body += `p+=9+_dl2;}`;
                            body += `else{let e=_dte(b,p,_d+1);a[i]=_dec(b,p,e-p,_d+1);p=e;}}}`;
                            body += `f${i}=a;}\n`;
                        }
                        else {
                            // Referenced schema not compiled — tagged fallback
                            body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                            body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                            body += `let a=new Array(l);`;
                            body += `for(let i=0;i<l;i++){let e=_dte(b,p,_d+1);a[i]=_dec(b,p,e-p,_d+1);p=e;}`;
                            body += `f${i}=a;}\n`;
                        }
                    }
                    else {
                        // Container element types: varint count + tagged elements
                        body += `{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}`;
                        body += `if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');`;
                        body += `let a=new Array(l);`;
                        body += `for(let i=0;i<l;i++){let e=_dte(b,p,_d+1);a[i]=_dec(b,p,e-p,_d+1);p=e;}`;
                        body += `f${i}=a;}\n`;
                    }
                }
                else {
                    // Existing generic path — flag byte + u32 count
                    body += `{let _f=b[p],l=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0;if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');let a=new Array(l);p+=5;`;
                    // flag=0: generic tagged elements
                    body += `if(_f===0){for(let i=0;i<l;i++){let e=_dte(b,p,_d+1);a[i]=_dec(b,p,e-p,_d+1);p=e;}}`;
                    // flag=1: packed uint8
                    body += `else if(_f===1){for(let i=0;i<l;i++){a[i]=b[p+i];}p+=l;}`;
                    // flag=2: packed int32
                    body += `else if(_f===2){for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;}}`;
                    // flag=3: packed float64
                    body += `else{for(let i=0;i<l;i++){a[i]=${d.readF64('p')};p+=8;}}`;
                    body += `f${i}=a;}\n`;
                }

                break;

            case 'object':
                if (f.refHash !== undefined) {
                    let rp = refHashes.get(f.refHash);

                    if (rp) {
                        // Direct decode: 1-byte varint len fast path, fallback to tag-8 header
                        body += `{let _dl=b[p];`;
                        body += `if(_dl<128){p+=1;f${i}=${rp}(b,p,_d+1);p+=_dl;}`;
                        body += `else if(b[p]===8||b[p]===18){`;
                        body += `let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,`;
                        body += `_dl2=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0,`;
                        body += `_s=_reg.get(_h);`;
                        body += `if(_s&&_s.decodeFn){f${i}=_s.decodeFn(b,p+9,_d+1);}else{f${i}=null;}`;
                        body += `p+=9+_dl2;}`;
                        body += `else{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}}\n`;
                    }
                    else {
                        // Ref schema not compiled — generic path
                        body += `{if(b[p]===8){`;
                        body += `let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,`;
                        body += `_dl=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0,`;
                        body += `_s=_reg.get(_h);`;
                        body += `if(_s&&_s.decodeFn){f${i}=_s.decodeFn(b,p+9,_d+1);}else{f${i}=null;}`;
                        body += `p+=9+_dl;}`;
                        body += `else{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}}\n`;
                    }
                }
                else {
                    // Inline tag-8 fast path: skip decodeTagEnd + decodeSbc switch overhead
                    body += `{if(b[p]===8){`;
                    body += `let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,`;
                    body += `_dl=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0,`;
                    body += `_s=_reg.get(_h);`;
                    body += `if(_s&&_s.decodeFn){f${i}=_s.decodeFn(b,p+9,_d+1);}else{f${i}=null;}`;
                    body += `p+=9+_dl;}`;
                    body += `else{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}}\n`;
                }

                break;

            case 'map':
            case 'set':
            case 'typedarray':
                body += `{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}\n`;

                break;

            case 'mixed':
                body += `{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}\n`;

                break;
        }

        if (f.nullable) {
            body += `}\n`;
        }
    }

    // Build return object — use computed properties to prevent __proto__ pollution
    body += `let _r=Object.create(null);`;

    for (let i = 0; i < n; i++) {
        body += `_r[${JSON.stringify(fields[i]!.name)}]=f${i};`;
    }

    body += `return _r;\n`;

    let bindArgs = d.decoderBindArgs(),
        refDecParamNames = [...refHashes.values()],
        refDecBindValues = [...refHashes.keys()].map(h => helpers.registry.get(h)!.decodeFn!);

    try {
        let factory = new Function(d.decoderParams(), '_dec', '_dte', '_reg', '_rv', ...refDecParamNames, `return function decode(b,pos,_d){${body}}`);

        return factory(...bindArgs, helpers.decodeSbc, helpers.decodeTagEnd, helpers.registry, readVarint, ...refDecBindValues);
    }
    catch (e) {
        throw new Error('Codec2: decoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


function compileCompressedDecoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (buf: Uint8Array, pos: number, depth: number) => unknown {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    body += d.preamble('b');
    body += `let p=pos;\n`;

    // Declare field variables
    for (let i = 0; i < n; i++) {
        body += `let f${i}${fields[i]!.nullable ? '=null' : ''};\n`;
    }

    // Read null bitmap
    if (schema.nullableCount > 0) {
        body += schema.bitmapBytes === 1 ? `let _bm=b[p];p+=1;\n` : `let _bm=b[p]|(b[p+1]<<8);p+=2;\n`;
    }

    // Read bool bitmap
    let boolCount = schema.boolFields.length,
        boolBitmapBytes = boolCount > 0 ? Math.ceil(boolCount / 8) : 0;

    if (boolCount > 0) {
        body += boolBitmapBytes === 1 ? `let _bb=b[p];p+=1;\n` : `let _bb=b[p]|(b[p+1]<<8);p+=2;\n`;
    }

    // Pass 1: Booleans, bigint, date, uint8, int8
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        switch (f.type) {
            case 'boolean': {
                let bi = schema.boolFields.indexOf(i);

                body += `${no}f${i}=!!(_bb&${1 << bi});${nc}\n`;
                break;
            }
            case 'bigint':
                body += `${no}f${i}=_rBI64.call(b,p);p+=8;${nc}\n`;
                break;
            case 'date':
                body += `${no}f${i}=new Date(${d.readF64('p')});p+=8;${nc}\n`;
                break;
            case 'uint8':
                body += `${no}f${i}=b[p];p+=1;${nc}\n`;
                break;
            case 'int8':
                body += `${no}f${i}=(b[p]<<24)>>24;p+=1;${nc}\n`;
                break;
        }
    }

    // Pass 2: Varint integers
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        if (f.type === 'int16' || f.type === 'int32') {
            body += `${no}{let _r=_rz(b,p);f${i}=_r[0];p=_r[1];}${nc}\n`;
        }
        else if (f.type === 'uint16' || f.type === 'uint32') {
            body += `${no}{let _r=_rv(b,p);f${i}=_r[0];p=_r[1];}${nc}\n`;
        }
    }

    // Pass 3: Adaptive float64
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        if (f.type === 'float64') {
            body += `${no}{let _fl=b[p++];if(_fl===0){let _r=_rz(b,p);f${i}=_r[0];p=_r[1];}else{f${i}=${d.readF64('p')};p+=8;}}${nc}\n`;
        }
    }

    // Pass 4: Variable fields
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        switch (f.type) {
            case 'string':
                body += `${no}{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}f${i}=${d.readStr('p', 'l')};p+=l;}${nc}\n`;
                break;
            case 'bytes':
                body += `${no}{let l=b[p];if(l<128){p+=1;}else{let _vr=_rv(b,p);l=_vr[0];p=_vr[1];}f${i}=b.slice(p,p+l);p+=l;}${nc}\n`;
                break;
            case 'array':
                body += `${no}{let _f=b[p],l=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0;if(l>1048576)throw new Error('Codec2: array count '+l+' exceeds limit');let a=new Array(l);p+=5;`;
                body += `if(_f===0){for(let i=0;i<l;i++){let e=_dte(b,p,_d+1);a[i]=_dec(b,p,e-p,_d+1);p=e;}}`;
                body += `else if(_f===1){for(let i=0;i<l;i++){a[i]=b[p+i];}p+=l;}`;
                body += `else if(_f===2){for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;}}`;
                body += `else{for(let i=0;i<l;i++){a[i]=${d.readF64('p')};p+=8;}}`;
                body += `f${i}=a;}${nc}\n`;
                break;
            case 'object':
                body += `${no}{if(b[p]===8||b[p]===18){let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,_dl=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0,_s=_reg.get(_h);`;
                body += `if(_s){if(b[p]===18&&_s.compressedDecodeFn){f${i}=_s.compressedDecodeFn(b,p+9,_d+1);}else if(_s.decodeFn){f${i}=_s.decodeFn(b,p+9,_d+1);}else{f${i}=null;}}else{f${i}=null;}`;
                body += `p+=9+_dl;}`;
                body += `else{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}}${nc}\n`;
                break;
            case 'map': case 'set': case 'typedarray': case 'mixed':
                body += `${no}{let e=_dte(b,p,_d+1);f${i}=_dec(b,p,e-p,_d+1);p=e;}${nc}\n`;
                break;
        }
    }

    // Build return object
    body += `let _r=Object.create(null);`;

    for (let i = 0; i < n; i++) {
        body += `_r[${JSON.stringify(fields[i]!.name)}]=f${i};`;
    }

    body += `return _r;\n`;

    let bindArgs = d.decoderBindArgs();

    try {
        return (new Function(d.decoderParams(), '_dec', '_dte', '_reg', '_rv', '_rz', `return function decodeC(b,pos,_d){${body}}`)
        )(...bindArgs, helpers.decodeSbc, helpers.decodeTagEnd, helpers.registry, readVarint, readZigzag);
    }
    catch (e) {
        throw new Error('Codec2: compressed decoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


function compileCompressedEncoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    body += d.preamble('b');
    body += `let p=pos;\n`;

    // Null bitmap
    if (schema.nullableCount > 0) {
        body += `let _bm=0,_bp=p;p+=${schema.bitmapBytes};\n`;
    }

    // Bool bitmap
    let boolCount = schema.boolFields.length,
        boolBitmapBytes = boolCount > 0 ? Math.ceil(boolCount / 8) : 0;

    if (boolCount > 0) {
        body += `let _bb=0,_bbp=p;p+=${boolBitmapBytes};\n`;
    }

    // Pass 1: Booleans (into bitmap), bigint, date, uint8, int8
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            sk = JSON.stringify(f.name),
            v = `o[${sk}]`;

        switch (f.type) {
            case 'boolean': {
                let bi = schema.boolFields.indexOf(i);

                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};if(${v}){_bb|=${1 << bi};}}\n`;
                }
                else {
                    body += `if(${v}){_bb|=${1 << bi};}\n`;
                }

                break;
            }
            case 'bigint':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `_wBI64.call(b,${v},p);p+=8;\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'date':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `${d.writeF64('p', `${v}.getTime()`)};p+=8;\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'uint8':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `b[p]=${v};p+=1;\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'int8':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `b[p]=${v}&0xFF;p+=1;\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
        }
    }

    // Pass 2: Varint integers
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            sk = JSON.stringify(f.name),
            v = `o[${sk}]`;

        if (f.type === 'int16' || f.type === 'int32') {
            if (f.nullable) {
                body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
            }

            body += `p=_wz(b,p,${v});\n`;

            if (f.nullable) {
                body += `}\n`;
            }
        }
        else if (f.type === 'uint16' || f.type === 'uint32') {
            if (f.nullable) {
                body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
            }

            body += `p=_wv(b,p,${v});\n`;

            if (f.nullable) {
                body += `}\n`;
            }
        }
    }

    // Pass 3: Adaptive float64
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            sk = JSON.stringify(f.name),
            v = `o[${sk}]`;

        if (f.type === 'float64') {
            if (f.nullable) {
                body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
            }

            body += `{let _v=${v};if(Number.isInteger(_v)&&_v>=-2147483648&&_v<=2147483647){b[p++]=0;p=_wz(b,p,_v);}else{b[p++]=1;${d.writeF64('p', '_v')};p+=8;}}\n`;

            if (f.nullable) {
                body += `}\n`;
            }
        }
    }

    // Pass 4: Variable fields (string, bytes, array, object, mixed, map, set, typedarray)
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            sk = JSON.stringify(f.name),
            v = `o[${sk}]`;

        switch (f.type) {
            case 'string':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `{let s=${v},sl=s.length;`;
                body += `if(sl<17){b[p]=sl;p+=1;let _ok=1;for(let _k=0;_k<sl;_k++){let _c=s.charCodeAt(_k);if(_c>127){_ok=0;break;}b[p+_k]=_c;}if(_ok){p+=sl;}else{p-=1;let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}`;
                body += `else{let l=_bl(s);p=_wv(b,p,l);${d.writeStr('s', 'p', 'l')};p+=l;}}\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'bytes':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `{let _v=${v},l=_v.length;p=_wv(b,p,l);b.set(_v,p);p+=l;}\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'array':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `{let a=${v},l=a.length,_pk=0;`;
                body += `if(l>0&&typeof a[0]==='number'){let _u8=1,_i32=1,_an=1;for(let i=0;i<l;i++){let v=a[i];if(typeof v!=='number'){_an=0;break;}if(v!==((v&0xFF)>>>0)){_u8=0;}if(v!==(v|0)){_i32=0;}}`;
                body += `if(_an&&_u8){_pk=1;b[p]=1;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){b[p+i]=a[i];}p+=l;}`;
                body += `else if(_an&&_i32){_pk=1;b[p]=2;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}}`;
                body += `else if(_an){_pk=1;b[p]=3;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){${d.writeF64('p', 'a[i]')};p+=8;}}}`;
                body += `if(!_pk){b[p]=0;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}}\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'object':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `p=_encObj(${v},b,p);\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'map': case 'set': case 'typedarray': case 'mixed':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `p=_enc(${v},b,p);\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
        }
    }

    // Write bitmaps
    if (schema.nullableCount > 0) {
        body += `b[_bp]=_bm&0xFF;\n`;

        if (schema.bitmapBytes > 1) {
            body += `b[_bp+1]=(_bm>>>8)&0xFF;\n`;
        }
    }

    if (boolCount > 0) {
        body += `b[_bbp]=_bb&0xFF;\n`;

        if (boolBitmapBytes > 1) {
            body += `b[_bbp+1]=(_bb>>>8)&0xFF;\n`;
        }
    }

    body += `return p;\n`;

    let bindArgs = d.encoderBindArgs(),
        params = d.encoderParams();

    try {
        return (
            new Function(params, '_enc', '_encObj', '_wv', '_wz', `return function encodeC(o,b,pos){${body}}`)
        )(...bindArgs, helpers.encodeSbc, helpers.encodeObj, writeVarint, writeZigzag);
    }
    catch (e) {
        throw new Error('Codec2: compressed encoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


export { compileSchema };
export type { FieldDef, ParsedType, Schema, SbcHelpers };
