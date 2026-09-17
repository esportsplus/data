// Codec2 Codegen — Compile type-specific encode/decode functions via new Function()
// Zero per-field branching: all type checks happen at compile time

import { MAX_ARRAY_COUNT } from './constants';
import { SchemaMissError } from './errors';
import { _vr, classifyPackedArray, codegenDriver, readVarint, readZigzag, TYPED_ARRAY_BPE, writeVarint, writeZigzag } from './platform';
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
    rawType: string;
    refHash?: number;
    type: string;
}

// Compiled decoders take an explicit payload-end bound (`end`) in addition to `pos` and the
// recursion `depth`. `end` is optional so direct unit-level callers keep working; generated code
// defaults it to `buf.length` and then enforces it on EVERY read, so a frame whose declared
// payload is zero/short throws instead of reading adjacent bytes or fabricating 0.
interface Schema {
    bitmapBytes: number;
    boolFields: number[];
    compressedDecodeFn: ((buf: Uint8Array, pos: number, depth: number, end?: number) => unknown) | null;
    compressedEncodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    compressible: boolean;
    decodeFn: ((buf: Uint8Array, pos: number, depth: number, end?: number) => unknown) | null;
    encodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    fields: FieldDef[];
    hash: number;
    nullableCount: number;
}

interface SbcHelpers {
    decodeSbc: (buf: Uint8Array, offset: number, end: number, depth: number) => unknown;
    decodeTagEnd: (buf: Uint8Array, offset: number, end: number, depth: number) => number;
    encodeObj: (obj: Record<string, unknown>, buf: Uint8Array, pos: number) => number;
    encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number;
    lookupSchema: (hash: number) => Schema | null;
    registry: Map<number, Schema>;
}


// Shared frozen null-proto prototype — Object.prototype excluded from chain
let _safeProto = Object.freeze(Object.create(null));


// Eval-free replacement for the old empty-code constructor (previously minted via the Function
// constructor with an empty body). Each call returns a fresh constructor whose instances share a
// single V8 hidden class (monomorphic map) and inherit from the shared frozen null-proto
// `_safeProto`. A fresh constructor per schema keeps each decoded shape's transition chain
// isolated, exactly as the previous generated constructor did.
function createEmptyConstructor(): new () => Record<string, unknown> {
    let ctor = function (): void {} as unknown as { new (): Record<string, unknown>; prototype: unknown };

    ctor.prototype = _safeProto;

    return ctor as unknown as new () => Record<string, unknown>;
}


function collectRefHashes(
    fields: FieldDef[],
    registry: Map<number, Schema>,
    fnKey: 'decodeFn' | 'encodeFn',
    prefix: string
): Map<number, string> {
    let refHashes: Map<number, string> = new Map(),
        refIdx = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        let f = fields[i]!;

        if (f.refHash !== undefined && !refHashes.has(f.refHash)) {
            let rs = registry.get(f.refHash);

            if (rs && rs[fnKey]) {
                refHashes.set(f.refHash, `${prefix}${refIdx++}`);
            }
        }

        if (f.elementType?.hash !== undefined && !refHashes.has(f.elementType.hash)) {
            let rs = registry.get(f.elementType.hash);

            if (rs && rs[fnKey]) {
                refHashes.set(f.elementType.hash, `${prefix}${refIdx++}`);
            }
        }
    }

    return refHashes;
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


// Generic-array packed emission — one shared classifier (_cpa) picks the narrowest lossless
// width, flag = typeId+1 with 0 reserved for "generic tagged elements". Width writes mirror the
// tagged path (src/sbc/tagged.ts) byte-for-byte so compiled and tagged payloads are identical.
function packedArrayEncodeSrc(val: string, d: CodegenDriver): string {
    return `{let a=${val},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');let _t=_cpa(a);`
        + `if(_t<0){b[p]=0;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}`
        + `else{let _pl=l*_bpe[_t];b[p]=_t+1;b[p+1]=l&0xFF;b[p+2]=(l>>>8)&0xFF;b[p+3]=(l>>>16)&0xFF;b[p+4]=(l>>>24)&0xFF;p+=5;`
        + `if(p+_pl<=b.length){switch(_t){`
        + `case 1:for(let i=0;i<l;i++){${d.writeF64('p', 'a[i]')};p+=8;}break;`
        + `case 2:case 5:case 6:for(let i=0;i<l;i++){b[p]=a[i]&0xFF;p+=1;}break;`
        + `case 3:case 7:for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}break;`
        + `case 4:case 8:for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}break;}}else{p+=_pl;}}}\n`;
}


// Generic-array packed decode — flag=0 restores tagged elements; else typeId=flag-1 reads at the
// _bpe width, per-typeId switch OUTSIDE the loop (no per-element width branch, no per-element alloc).
function packedArrayDecodeSrc(assign: string, d: CodegenDriver): string {
    return `{if(p+5>_e)throw new Error('@esportsplus/data: codec truncated array');let _f=b[p],l=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0;`
        + `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');let a=new Array(l);p+=5;`
        + `if(_f===0){for(let i=0;i<l;i++){let e=_dte(b,p,_e,_d+1);a[i]=_dec(b,p,e,_d+1);p=e;}}`
        + `else{let _t=_f-1,_bp=_bpe[_t];if(_bp===undefined)throw new Error('@esportsplus/data: codec unknown packed array flag '+_f);`
        + `if(p+l*_bp>_e)throw new Error('@esportsplus/data: codec truncated array');switch(_t){`
        + `case 1:for(let i=0;i<l;i++){a[i]=${d.readF64('p')};p+=8;}break;`
        + `case 2:for(let i=0;i<l;i++){a[i]=(b[p]<<24)>>24;p+=1;}break;`
        + `case 3:for(let i=0;i<l;i++){a[i]=((b[p]|(b[p+1]<<8))<<16)>>16;p+=2;}break;`
        + `case 4:for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;}break;`
        + `case 5:case 6:for(let i=0;i<l;i++){a[i]=b[p];p+=1;}break;`
        + `case 7:for(let i=0;i<l;i++){a[i]=b[p]|(b[p+1]<<8);p+=2;}break;`
        + `case 8:for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0;p+=4;}break;`
        + `default:throw new Error('@esportsplus/data: codec unsupported packed array flag '+_f);}}`
        + `${assign}=a;}`;
}


function emitArrayEncode(field: FieldDef, index: number, driver: CodegenDriver, refHashes: Map<number, string>): string {
    void index;
    void driver;
    void refHashes;
    let source = '',
        value = `o[${JSON.stringify(field.name)}]`;
                if (field.elementType) {
                    let et = field.elementType;

                    if (et.base === 'boolean' || et.base === 'uint8' || et.base === 'int8' ||
                        et.base === 'uint16' || et.base === 'int16' ||
                        et.base === 'uint32' || et.base === 'int32' ||
                        et.base === 'float64' || et.base === 'date' || et.base === 'int64') {
                        // Typed array: varint count + raw fixed-size elements
                        source += `{let a=${value},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');p=_wv(b,p,l);`;

                        switch (et.base) {
                            case 'boolean':
                                source += `for(let i=0;i<l;i++){b[p]=a[i]?1:0;p+=1;}`;
                                break;
                            case 'uint8':
                                source += `for(let i=0;i<l;i++){b[p+i]=a[i];}p+=l;`;
                                break;
                            case 'int8':
                                source += `for(let i=0;i<l;i++){b[p]=a[i]&0xFF;p+=1;}`;
                                break;
                            case 'uint16':
                                source += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}`;
                                break;
                            case 'int16':
                                source += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}`;
                                break;
                            case 'uint32':
                                source += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}`;
                                break;
                            case 'int32':
                                source += `for(let i=0;i<l;i++){let v=a[i];b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;b[p+2]=(v>>>16)&0xFF;b[p+3]=(v>>>24)&0xFF;p+=4;}`;
                                break;
                            case 'float64':
                                source += `if(p+l*8<=b.length){for(let i=0;i<l;i++){${driver.writeF64('p', 'a[i]')};p+=8;}}else{p+=l*8;}`;
                                break;
                            case 'date':
                                source += `if(p+l*8<=b.length){for(let i=0;i<l;i++){${driver.writeF64('p', 'a[i].getTime()')};p+=8;}}else{p+=l*8;}`;
                                break;
                            case 'int64':
                                source += `if(p+l*8<=b.length){for(let i=0;i<l;i++){let _bi=a[i];if(_bi<-9223372036854775808n||_bi>=9223372036854775808n)throw new Error('@esportsplus/data: codec bigint out of int64 range');_wBI64.call(b,_bi,p);p+=8;}}else{p+=l*8;}`;
                                break;
                        }

                        source += `}\n`;
                    }
                    else if (et.base === 'string') {
                        // Typed array<string>: varint count + per-element [varint len][utf8 data]
                        source += `{let a=${value},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');p=_wv(b,p,l);for(let i=0;i<l;i++){let s=a[i],sl=s.length;`;
                        source += `if(sl<17){b[p]=sl;p+=1;let _ok=1;for(let _k=0;_k<sl;_k++){let _c=s.charCodeAt(_k);if(_c>127){_ok=0;break;}b[p+_k]=_c;}if(_ok){p+=sl;}else{p-=1;let l=_bl(s);p=_wv(b,p,l);if(p+l<=b.length){${driver.writeStr('s', 'p', 'l')};}p+=l;}}`;
                        source += `else{let l=_bl(s);p=_wv(b,p,l);if(p+l<=b.length){${driver.writeStr('s', 'p', 'l')};}p+=l;}}}\n`;
                    }
                    else if (et.base === 'bytes') {
                        // Typed array<bytes>: varint count + per-element [varint len][raw bytes]
                        source += `{let a=${value},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');p=_wv(b,p,l);for(let i=0;i<l;i++){let v=a[i],vl=v.length;p=_wv(b,p,vl);if(p+vl<=b.length){b.set(v,p);}p+=vl;}}\n`;
                    }
                    else if (et.base === 'object' && et.hash !== undefined) {
                        // Typed array<object(hash)>: ONE canonical layout — varint count followed by
                        // per-element [varint payloadLen][uncompressed child fields]. The child is
                        // bound directly when compiled locally, otherwise resolved by refHash at
                        // runtime, so registration order never changes the bytes.
                        let refParam = refHashes.get(et.hash),
                            resolve = refParam
                                ? ''
                                : `let _cs=_reg.get(${et.hash})||_lk(${et.hash});if(!_cs||!_cs.encodeFn)throw new _miss(${et.hash});`,
                            call = refParam ? `${refParam}(a[i],b,p)` : `_cs.encodeFn(a[i],b,p)`;

                        source += `{let a=${value},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');${resolve}p=_wv(b,p,l);for(let i=0;i<l;i++){`;
                        source += `let _lp=p;p+=1;let _end=${call};let _dl=_end-p;`;
                        source += `if(_dl<128){b[_lp]=_dl;p=_end;}`;
                        source += `else{let _vl=_dl<16384?2:_dl<2097152?3:_dl<268435456?4:5;b.copyWithin(_lp+_vl,_lp+1,_end);_wv(b,_lp,_dl);p=_end+_vl-1;}}}\n`;
                    }
                    else {
                        // Container element types: varint count + tagged elements
                        source += `{let a=${value},l=a.length;if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');p=_wv(b,p,l);for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}\n`;
                    }
                }
                else {
                    // Generic path — one shared classifier picks the narrowest lossless width;
                    // flag = typeId+1 (0 stays "generic tagged elements"), count u32, raw LE elements.
                    source += packedArrayEncodeSrc(value, driver);
                }

    return source;
}

function emitObjectEncode(field: FieldDef, index: number, driver: CodegenDriver, refHashes: Map<number, string>): string {
    void index;
    void driver;
    void refHashes;
    let source = '',
        value = `o[${JSON.stringify(field.name)}]`;
                if (field.refHash !== undefined) {
                    // ONE canonical layout regardless of whether the child is already compiled:
                    // a varint payload-length prefix followed by the uncompressed child fields.
                    // When the child is local we bind its encoder directly; otherwise we resolve
                    // it by refHash at runtime so a parent-first registration still emits identical
                    // bytes to a child-first one.
                    let rp = refHashes.get(field.refHash),
                        resolve = rp
                            ? ''
                            : `let _cs=_reg.get(${field.refHash})||_lk(${field.refHash});if(!_cs||!_cs.encodeFn)throw new _miss(${field.refHash});`,
                        call = rp ? `${rp}(${value},b,p)` : `_cs.encodeFn(${value},b,p)`;

                    // Reserve 1 byte for the varint payload-length prefix; for payloads
                    // >=128 the varint needs extra bytes, so shift the payload right first.
                    source += `{${resolve}let _lp=p;p+=1;let _end=${call};let _dl=_end-p;`;
                    source += `if(_dl<128){b[_lp]=_dl;p=_end;}`;
                    source += `else{let _vl=_dl<16384?2:_dl<2097152?3:_dl<268435456?4:5;b.copyWithin(_lp+_vl,_lp+1,_end);_wv(b,_lp,_dl);p=_end+_vl-1;}}\n`;
                }
                else {
                    source += `p=_encObj(${value},b,p);\n`;
                }

    return source;
}

function emitStringEncode(field: FieldDef, index: number, driver: CodegenDriver, refHashes: Map<number, string>): string {
    void index;
    void driver;
    void refHashes;
    let source = '',
        value = `o[${JSON.stringify(field.name)}]`;

                // ASCII fast path — single-pass check+write for short strings (varint length)
                source += `{let s=${value},sl=s.length;`;
                source += `if(sl<17){`;
                source += `b[p]=sl;p+=1;`;
                source += `let _ok=1;for(let _k=0;_k<sl;_k++){let _c=s.charCodeAt(_k);if(_c>127){_ok=0;break;}b[p+_k]=_c;}`;
                source += `if(_ok){p+=sl;}`;
                source += `else{p-=1;let l=_bl(s);p=_wv(b,p,l);if(p+l<=b.length){${driver.writeStr('s', 'p', 'l')};}p+=l;}}`;
                source += `else{let l=_bl(s);p=_wv(b,p,l);if(p+l<=b.length){${driver.writeStr('s', 'p', 'l')};}p+=l;}}\n`;
    return source;
}

function emitArrayDecode(field: FieldDef, index: number, driver: CodegenDriver, refHashes: Map<number, string>): string {
    void index;
    void driver;
    void refHashes;
    let source = '';
                if (field.elementType) {
                    let et = field.elementType;

                    if (et.base === 'boolean' || et.base === 'uint8' || et.base === 'int8' ||
                        et.base === 'uint16' || et.base === 'int16' ||
                        et.base === 'uint32' || et.base === 'int32' ||
                        et.base === 'float64' || et.base === 'date' || et.base === 'int64') {
                        // Typed array: varint count + raw fixed-size elements
                        source += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated array');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}`;
                        source += `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');`;

                        if (et.base === 'boolean' || et.base === 'uint8' || et.base === 'int8') {
                            source += `if(p+l>_e)throw new Error('@esportsplus/data: codec truncated array');`;
                        }
                        else if (et.base === 'uint16' || et.base === 'int16') {
                            source += `if(p+l*2>_e)throw new Error('@esportsplus/data: codec truncated array');`;
                        }
                        else if (et.base === 'uint32' || et.base === 'int32') {
                            source += `if(p+l*4>_e)throw new Error('@esportsplus/data: codec truncated array');`;
                        }
                        else {
                            source += `if(p+l*8>_e)throw new Error('@esportsplus/data: codec truncated array');`;
                        }

                        source += `let a=new Array(l);`;

                        switch (et.base) {
                            case 'boolean':
                                source += `for(let i=0;i<l;i++){a[i]=!!b[p];p+=1;}`;
                                break;
                            case 'uint8':
                                source += `for(let i=0;i<l;i++){a[i]=b[p+i];}p+=l;`;
                                break;
                            case 'int8':
                                source += `for(let i=0;i<l;i++){a[i]=(b[p]<<24)>>24;p+=1;}`;
                                break;
                            case 'uint16':
                                source += `for(let i=0;i<l;i++){a[i]=b[p]|(b[p+1]<<8);p+=2;}`;
                                break;
                            case 'int16':
                                source += `for(let i=0;i<l;i++){a[i]=((b[p]|(b[p+1]<<8))<<16)>>16;p+=2;}`;
                                break;
                            case 'uint32':
                                source += `for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0;p+=4;}`;
                                break;
                            case 'int32':
                                source += `for(let i=0;i<l;i++){a[i]=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))|0;p+=4;}`;
                                break;
                            case 'float64':
                                source += `for(let i=0;i<l;i++){a[i]=${driver.readF64('p')};p+=8;}`;
                                break;
                            case 'date':
                                source += `for(let i=0;i<l;i++){a[i]=new Date(${driver.readF64('p')});p+=8;}`;
                                break;
                            case 'int64':
                                source += `for(let i=0;i<l;i++){a[i]=_rBI64.call(b,p);p+=8;}`;
                                break;
                        }

                        source += `f${index}=a;}\n`;
                    }
                    else if (et.base === 'string') {
                        // Typed array<string>: varint count + per-element [varint len][utf8 data]
                        source += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated array');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}`;
                        source += `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');`;
                        source += `let a=new Array(l);`;
                        source += `for(let i=0;i<l;i++){let sl=b[p];if(sl<128){p+=1;}else{_rv(b,p);sl=_vrs.v;p=_vrs.p;}if(p+sl>_e)throw new Error('SBC: truncated');a[i]=${driver.readStr('p', 'sl')};p+=sl;}`;
                        source += `f${index}=a;}\n`;
                    }
                    else if (et.base === 'bytes') {
                        // Typed array<bytes>: varint count + per-element [varint len][raw bytes]
                        source += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated array');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}`;
                        source += `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');`;
                        source += `let a=new Array(l);`;
                        source += `for(let i=0;i<l;i++){let bl=b[p];if(bl<128){p+=1;}else{_rv(b,p);bl=_vrs.v;p=_vrs.p;}if(p+bl>_e)throw new Error('SBC: truncated');a[i]=new Uint8Array(b.subarray(p,p+bl));p+=bl;}`;
                        source += `f${index}=a;}\n`;
                    }
                    else if (et.base === 'object' && et.hash !== undefined) {
                        // Typed array<object(hash)>: ONE canonical layout — varint count followed by
                        // per-element [varint payloadLen][uncompressed child fields]. Bound directly
                        // when compiled locally, else resolved by refHash at runtime.
                        let refParam = refHashes.get(et.hash),
                            resolve = refParam
                                ? ''
                                : `let _cs=_reg.get(${et.hash})||_lk(${et.hash});if(!_cs||!_cs.decodeFn)throw new _miss(${et.hash});`,
                            call = refParam ? `${refParam}` : `_cs.decodeFn`;

                        source += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated array');${resolve}let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}`;
                        source += `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');`;
                        source += `let a=new Array(l);`;
                        source += `for(let i=0;i<l;i++){if(p>=_e)throw new Error('SBC: truncated');let _dl=b[p];if(_dl<128){p+=1;}else{_rv(b,p);_dl=_vrs.v;p=_vrs.p;}`;
                        source += `let _ce=p+_dl;if(_ce>_e)throw new Error('SBC: truncated');a[i]=${call}(b,p,_d+1,_ce);p=_ce;}`;
                        source += `f${index}=a;}\n`;
                    }
                    else {
                        // Container element types: varint count + tagged elements
                        source += `{let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}`;
                        source += `if(l>${MAX_ARRAY_COUNT})throw new Error('@esportsplus/data: codec array count '+l+' exceeds limit');`;
                        source += `let a=new Array(l);`;
                        source += `for(let i=0;i<l;i++){let e=_dte(b,p,_e,_d+1);a[i]=_dec(b,p,e,_d+1);p=e;}`;
                        source += `f${index}=a;}\n`;
                    }
                }
                else {
                    source += packedArrayDecodeSrc(`f${index}`, driver) + `\n`;
                }

    return source;
}

function emitObjectDecode(field: FieldDef, index: number, driver: CodegenDriver, refHashes: Map<number, string>): string {
    void index;
    void driver;
    void refHashes;
    let source = '';
                if (field.refHash !== undefined) {
                    // ONE canonical layout regardless of compile order: [varint payloadLen][child
                    // uncompressed fields]. Child bound directly when compiled locally, else
                    // resolved by refHash at runtime.
                    let rp = refHashes.get(field.refHash),
                        resolve = rp
                            ? ''
                            : `let _cs=_reg.get(${field.refHash})||_lk(${field.refHash});if(!_cs||!_cs.decodeFn)throw new _miss(${field.refHash});`,
                        call = rp ? `${rp}` : `_cs.decodeFn`;

                    source += `{${resolve}if(p>=_e)throw new Error('SBC: truncated');let _dl=b[p];`;
                    source += `if(_dl<128){p+=1;}else{_rv(b,p);_dl=_vrs.v;p=_vrs.p;}`;
                    source += `let _ce=p+_dl;if(_ce>_e)throw new Error('SBC: truncated');f${index}=${call}(b,p,_d+1,_ce);p=_ce;}\n`;
                }
                else {
                    // Inline tag-8/18 fast path: skip decodeTagEnd + decodeSbc switch overhead
                    source += `{if(p+9>_e)throw new Error('SBC: truncated');if(b[p]===8||b[p]===18){`;
                    source += `let _h=(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0,`;
                    source += `_dl=(b[p+5]|(b[p+6]<<8)|(b[p+7]<<16)|(b[p+8]<<24))>>>0;`;
                    source += `if(p+9+_dl>_e)throw new Error('SBC: truncated');`;
                    source += `let _s=_reg.get(_h)||_lk(_h);`;
                    source += `if(_s){if(b[p]===18&&_s.compressedDecodeFn){f${index}=_s.compressedDecodeFn(b,p+9,_d+1,p+9+_dl);}else if(_s.decodeFn){f${index}=_s.decodeFn(b,p+9,_d+1,p+9+_dl);}else{f${index}=null;}}else{throw new _miss(_h);}`;
                    source += `p+=9+_dl;}`;
                    source += `else{let e=_dte(b,p,_e,_d+1);f${index}=_dec(b,p,e,_d+1);p=e;}}\n`;
                }

    return source;
}

function compileEncoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    let refHashes = collectRefHashes(fields, helpers.registry, 'encodeFn', '_re');

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
                body += `{let v=${val};b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}\n`;
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
                body += `if(p+8<=b.length){${d.writeF64('p', val)};}p+=8;\n`;
                break;

            case 'int64':
                body += `if(${val}<-9223372036854775808n||${val}>=9223372036854775808n)throw new Error('@esportsplus/data: codec bigint out of int64 range');if(p+8<=b.length){_wBI64.call(b,${val},p);}p+=8;\n`;
                break;

            case 'date':
                body += `if(p+8<=b.length){${d.writeF64('p', `${val}.getTime()`)};}p+=8;\n`;
                break;

            case 'string':
                body += emitStringEncode(f, i, d, refHashes);
                break;

            case 'bytes':

                body += `{let v=${val},l=v.length;`;
                body += `p=_wv(b,p,l);`;
                body += `if(p+l<=b.length){b.set(v,p);}p+=l;}\n`;
                break;

            case 'array':
                body += emitArrayEncode(f, i, d, refHashes);
                break;

            case 'object':
                body += emitObjectEncode(f, i, d, refHashes);
                break;

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
            new Function(params, '_enc', '_encObj', '_wv', '_cpa', '_bpe', '_reg', '_lk', '_miss', ...refEncParamNames, `return function encode(o,b,pos){${body}}`)
        )(...bindArgs, helpers.encodeSbc, helpers.encodeObj, writeVarint, classifyPackedArray, TYPED_ARRAY_BPE, helpers.registry, helpers.lookupSchema, SchemaMissError, ...refEncBindValues);
    }
    catch (e) {
        throw new Error('@esportsplus/data: codec encoder compilation failed: ' + (e instanceof Error ? e.message : e), { cause: e });
    }
}


function compileDecoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (buf: Uint8Array, pos: number, depth: number, end?: number) => unknown {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    let refHashes = collectRefHashes(fields, helpers.registry, 'decodeFn', '_rd');

    // `_e` is the payload-end bound threaded from the frame header; default to the buffer
    // length for direct unit-level calls. The depth guard fires here so the compiled
    // object(hash) recursion path (which calls a sibling decoder directly) is budgeted too.
    body += `if(_d===undefined)_d=0;if(_e===undefined)_e=b.length;if(_d>64)throw new Error('@esportsplus/data: codec max decode depth exceeded');\nlet p=pos;\n`;

    if (schema.nullableCount > 0) {
        if (schema.bitmapBytes === 1) {
            body += `if(p+1>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bm=b[p];p+=1;\n`;
        }
        else {
            body += `if(p+2>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bm=b[p]|(b[p+1]<<8);p+=2;\n`;
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

        // Enforce the payload boundary before every fixed-width read.
        if (f.fixedSize > 0) {
            body += `if(p+${f.fixedSize}>_e)throw new Error('@esportsplus/data: codec truncated object payload');`;
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

            case 'int64':
                body += `f${i}=_rBI64.call(b,p);p+=8;\n`;
                break;

            case 'date':
                body += `f${i}=new Date(${d.readF64('p')});p+=8;\n`;
                break;

            case 'string':
                // Inline varint read — single byte for lengths < 128 (common case)
                body += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated string');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}if(p+l>_e)throw new Error('@esportsplus/data: codec truncated string');f${i}=${d.readStr('p', 'l')};p+=l;}\n`;
                break;

            case 'bytes':
                body += `{if(p>=_e)throw new Error('@esportsplus/data: codec truncated bytes');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}if(p+l>_e)throw new Error('@esportsplus/data: codec truncated bytes');f${i}=new Uint8Array(b.subarray(p,p+l));p+=l;}\n`;
                break;

            case 'array':
                body += emitArrayDecode(f, i, d, refHashes);
                break;

            case 'object':
                body += emitObjectDecode(f, i, d, refHashes);
                break;

            case 'typedarray':
                body += `{let e=_dte(b,p,_e,_d+1);f${i}=_dec(b,p,e,_d+1);p=e;}\n`;

                break;

            case 'mixed':
                body += `{let e=_dte(b,p,_e,_d+1);f${i}=_dec(b,p,e,_d+1);p=e;}\n`;

                break;
        }

        if (f.nullable) {
            body += `}\n`;
        }
    }

    // Build return object — constructor with frozen null-proto prototype for V8 hidden class + safety
    body += `let _r=new _Ctor();`;

    for (let i = 0; i < n; i++) {
        body += `_r[${JSON.stringify(fields[i]!.name)}]=f${i};`;
    }

    body += `return _r;\n`;

    // Create per-schema constructor — V8 creates stable hidden class for instances
    let Ctor = createEmptyConstructor();

    let bindArgs = d.decoderBindArgs(),
        refDecParamNames = [...refHashes.values()],
        refDecBindValues = [...refHashes.keys()].map(h => helpers.registry.get(h)!.decodeFn!);

    try {
        let factory = new Function(d.decoderParams(), '_dec', '_dte', '_reg', '_lk', '_miss', '_rv', '_vrs', '_Ctor', '_bpe', ...refDecParamNames, `return function decode(b,pos,_d,_e){${body}}`);

        return factory(...bindArgs, helpers.decodeSbc, helpers.decodeTagEnd, helpers.registry, helpers.lookupSchema, SchemaMissError, readVarint, _vr, Ctor, TYPED_ARRAY_BPE, ...refDecBindValues);
    }
    catch (e) {
        throw new Error('@esportsplus/data: codec decoder compilation failed: ' + (e instanceof Error ? e.message : e), { cause: e });
    }
}


function compileCompressedDecoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (buf: Uint8Array, pos: number, depth: number, end?: number) => unknown {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    let refHashes = collectRefHashes(fields, helpers.registry, 'decodeFn', '_rd');

    body += `if(_d===undefined)_d=0;if(_e===undefined)_e=b.length;if(_d>64)throw new Error('@esportsplus/data: codec max decode depth exceeded');\nlet p=pos;\n`;

    // Declare field variables
    for (let i = 0; i < n; i++) {
        body += `let f${i}${fields[i]!.nullable ? '=null' : ''};\n`;
    }

    // Read null bitmap
    if (schema.nullableCount > 0) {
        body += schema.bitmapBytes === 1
            ? `if(p+1>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bm=b[p];p+=1;\n`
            : `if(p+2>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bm=b[p]|(b[p+1]<<8);p+=2;\n`;
    }

    // Read bool bitmap
    let boolCount = schema.boolFields.length,
        boolBitmapBytes = boolCount > 0 ? Math.ceil(boolCount / 8) : 0;

    if (boolCount > 0) {
        body += boolBitmapBytes === 1
            ? `if(p+1>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bb=b[p];p+=1;\n`
            : `if(p+2>_e)throw new Error('@esportsplus/data: codec truncated object payload');let _bb=b[p]|(b[p+1]<<8);p+=2;\n`;
    }

    // Pass 1: Booleans, int64, date, uint8, int8
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
            case 'int64':
                body += `${no}if(p+8>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=_rBI64.call(b,p);p+=8;${nc}\n`;
                break;
            case 'date':
                body += `${no}if(p+8>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=new Date(${d.readF64('p')});p+=8;${nc}\n`;
                break;
            case 'uint8':
                body += `${no}if(p+1>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=b[p];p+=1;${nc}\n`;
                break;
            case 'int8':
                body += `${no}if(p+1>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=(b[p]<<24)>>24;p+=1;${nc}\n`;
                break;
        }
    }

    // Pass 2: Varint integers
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        if (f.type === 'int16' || f.type === 'int32') {
            body += `${no}if(p>=_e)throw new Error('@esportsplus/data: codec truncated object payload');{_rz(b,p);if(_vrs.p>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=_vrs.v;p=_vrs.p;}${nc}\n`;
        }
        else if (f.type === 'uint16' || f.type === 'uint32') {
            body += `${no}if(p>=_e)throw new Error('@esportsplus/data: codec truncated object payload');{_rv(b,p);if(_vrs.p>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=_vrs.v;p=_vrs.p;}${nc}\n`;
        }
    }

    // Pass 3: Adaptive float64
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        if (f.type === 'float64') {
            body += `${no}if(p>=_e)throw new Error('@esportsplus/data: codec truncated object payload');{let _fl=b[p++];if(_fl===0){_rz(b,p);if(_vrs.p>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=_vrs.v;p=_vrs.p;}else{if(p+8>_e)throw new Error('@esportsplus/data: codec truncated object payload');f${i}=${d.readF64('p')};p+=8;}}${nc}\n`;
        }
    }

    // Pass 4: Variable fields
    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            no = f.nullable ? `if(_bm&${1 << f.nullIndex}){` : '',
            nc = f.nullable ? `}` : '';

        switch (f.type) {
            case 'string':
                body += `${no}{if(p>=_e)throw new Error('SBC: truncated');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}if(p+l>_e)throw new Error('SBC: truncated');f${i}=${d.readStr('p', 'l')};p+=l;}${nc}\n`;
                break;
            case 'bytes':
                body += `${no}{if(p>=_e)throw new Error('SBC: truncated');let l=b[p];if(l<128){p+=1;}else{_rv(b,p);l=_vrs.v;p=_vrs.p;}if(p+l>_e)throw new Error('SBC: truncated');f${i}=new Uint8Array(b.subarray(p,p+l));p+=l;}${nc}\n`;
                break;
            case 'array':
                body += `${no}${emitArrayDecode(f, i, d, refHashes)}${nc}\n`;
                break;
            case 'object':
                body += `${no}${emitObjectDecode(f, i, d, refHashes)}${nc}\n`;
                break;
            case 'typedarray': case 'mixed':
                body += `${no}{let e=_dte(b,p,_e,_d+1);f${i}=_dec(b,p,e,_d+1);p=e;}${nc}\n`;
                break;
        }
    }

    // Build return object — constructor with frozen null-proto prototype for V8 hidden class + safety
    body += `let _r=new _Ctor();`;

    for (let i = 0; i < n; i++) {
        body += `_r[${JSON.stringify(fields[i]!.name)}]=f${i};`;
    }

    body += `return _r;\n`;

    let Ctor = createEmptyConstructor();

    let bindArgs = d.decoderBindArgs(),
        refDecParamNames = [...refHashes.values()],
        refDecBindValues = [...refHashes.keys()].map(h => helpers.registry.get(h)!.decodeFn!);

    try {
        return (new Function(d.decoderParams(), '_dec', '_dte', '_reg', '_lk', '_miss', '_rv', '_rz', '_vrs', '_Ctor', '_bpe', ...refDecParamNames, `return function decodeC(b,pos,_d,_e){${body}}`)
        )(...bindArgs, helpers.decodeSbc, helpers.decodeTagEnd, helpers.registry, helpers.lookupSchema, SchemaMissError, readVarint, readZigzag, _vr, Ctor, TYPED_ARRAY_BPE, ...refDecBindValues);
    }
    catch (e) {
        throw new Error('@esportsplus/data: codec compressed decoder compilation failed: ' + (e instanceof Error ? e.message : e), { cause: e });
    }
}


function compileCompressedEncoder(schema: Schema, d: CodegenDriver, helpers: SbcHelpers): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let body = `'use strict';\n`,
        fields = schema.fields,
        n = fields.length;

    let refHashes = collectRefHashes(fields, helpers.registry, 'encodeFn', '_re');

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

    // Pass 1: Booleans (into bitmap), int64, date, uint8, int8
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
            case 'int64':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `if(${v}<-9223372036854775808n||${v}>=9223372036854775808n)throw new Error('@esportsplus/data: codec bigint out of int64 range');if(p+8<=b.length){_wBI64.call(b,${v},p);}p+=8;\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'date':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `if(p+8<=b.length){${d.writeF64('p', `${v}.getTime()`)};}p+=8;\n`;

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

            // `-0` is an integer to Number.isInteger but its sign only survives the float64 arm;
            // excluding it here preserves Object.is(decoded, -0) through the compressed path.
            body += `{let _v=${v};if(Number.isInteger(_v)&&!_oiz(_v,-0)&&_v>=-2147483648&&_v<=2147483647){b[p++]=0;p=_wz(b,p,_v);}else{b[p++]=1;if(p+8<=b.length){${d.writeF64('p', '_v')};}p+=8;}}\n`;

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

                body += emitStringEncode(f, i, d, refHashes);

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'bytes':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += `{let _v=${v},l=_v.length;p=_wv(b,p,l);if(p+l<=b.length){b.set(_v,p);}p+=l;}\n`;

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'array':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += emitArrayEncode(f, i, d, refHashes);

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'object':
                if (f.nullable) {
                    body += `if(${v}!=null){_bm|=${1 << f.nullIndex};`;
                }

                body += emitObjectEncode(f, i, d, refHashes);

                if (f.nullable) {
                    body += `}\n`;
                }

                break;
            case 'typedarray': case 'mixed':
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
        params = d.encoderParams(),
        refEncParamNames = [...refHashes.values()],
        refEncBindValues = [...refHashes.keys()].map(h => helpers.registry.get(h)!.encodeFn!);

    try {
        return (
            new Function(params, '_enc', '_encObj', '_wv', '_wz', '_cpa', '_bpe', '_reg', '_lk', '_miss', '_oiz', ...refEncParamNames, `return function encodeC(o,b,pos){${body}}`)
        )(...bindArgs, helpers.encodeSbc, helpers.encodeObj, writeVarint, writeZigzag, classifyPackedArray, TYPED_ARRAY_BPE, helpers.registry, helpers.lookupSchema, SchemaMissError, Object.is, ...refEncBindValues);
    }
    catch (e) {
        throw new Error('@esportsplus/data: codec compressed encoder compilation failed: ' + (e instanceof Error ? e.message : e), { cause: e });
    }
}


export { compileSchema };
export type { FieldDef, ParsedType, Schema, SbcHelpers };
