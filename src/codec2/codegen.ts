// Codec2 Codegen — Compile type-specific encode/decode functions via new Function()
// Zero per-field branching: all type checks happen at compile time

import { codegenDriver } from './platform';

import type { CodegenDriver } from './platform';


interface FieldDef {
    fixedSize: number;
    name: string;
    offset: number;
    type: string;
}

interface Schema {
    computeSize: ((obj: unknown) => number) | null;
    decodeFn: ((buf: Uint8Array, pos: number) => unknown) | null;
    encodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    fields: FieldDef[];
    fixedSize: number;
    hash: number;
    id: number;
}

interface SbcHelpers {
    decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown;
    decodeTagEnd: (buf: Uint8Array, offset: number) => number;
    encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number;
}


function compileSchema(schema: Schema, helpers: SbcHelpers): void {
    let d = codegenDriver,
        fields = schema.fields;

    schema.encodeFn = compileEncoder(fields, d, helpers);
    schema.decodeFn = compileDecoder(fields, d, helpers);
    schema.computeSize = compileComputeSize(fields);
}


function compileEncoder(fields: FieldDef[], d: CodegenDriver, helpers: SbcHelpers): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let body = `'use strict';\n`,
        hasVariable = false,
        n = fields.length;

    body += d.preamble('b');
    body += `let p=pos;\n`;

    for (let i = 0; i < n; i++) {
        let f = fields[i]!,
            name = f.name,
            safeKey = JSON.stringify(name),
            val = `o[${safeKey}]`;

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
                hasVariable = true;
                body += `{let s=${val},l=_bl(s);`;
                body += `b[p]=l&0xFF;b[p+1]=(l>>>8)&0xFF;p+=2;`;
                body += `${d.writeStr('s', 'p', 'l')};p+=l;}\n`;
                break;

            case 'bytes':
                hasVariable = true;
                body += `{let v=${val},l=v.length;`;
                body += `b[p]=l&0xFF;b[p+1]=(l>>>8)&0xFF;b[p+2]=(l>>>16)&0xFF;b[p+3]=(l>>>24)&0xFF;p+=4;`;
                body += `b.set(v,p);p+=l;}\n`;
                break;

            case 'array':
                hasVariable = true;
                body += `{let a=${val},l=a.length;`;
                body += `b[p]=l&0xFF;b[p+1]=(l>>>8)&0xFF;p+=2;`;
                body += `for(let i=0;i<l;i++){p=_enc(a[i],b,p);}}\n`;
                break;

            case 'object':
                hasVariable = true;
                body += `p=_enc(${val},b,p);\n`;
                break;

            case 'mixed':
                hasVariable = true;
                body += `p=_enc(${val},b,p);\n`;
                break;
        }
    }

    body += `return p;\n`;

    let bindArgs = d.encoderBindArgs(),
        params = d.encoderParams();

    try {
        let factory = new Function(params, '_enc', `return function encode(o,b,pos){${body}}`);

        return factory(...bindArgs, helpers.encodeSbc);
    }
    catch (e) {
        throw new Error('Codec2: encoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


function compileDecoder(fields: FieldDef[], d: CodegenDriver, helpers: SbcHelpers): (buf: Uint8Array, pos: number) => unknown {
    let body = `'use strict';\n`,
        n = fields.length,
        needsTagEnd = false;

    body += d.preamble('b');
    body += `let p=pos;\n`;

    // Declare all field variables
    for (let i = 0; i < n; i++) {
        let f = fields[i]!;

        body += `let f${i};\n`;
    }

    for (let i = 0; i < n; i++) {
        let f = fields[i]!;

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
                body += `{let l=b[p]|(b[p+1]<<8);p+=2;f${i}=${d.readStr('p', 'l')};p+=l;}\n`;
                break;

            case 'bytes':
                body += `{let l=(b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24))>>>0;p+=4;f${i}=b.slice(p,p+l);p+=l;}\n`;
                break;

            case 'array':
                body += `{let l=b[p]|(b[p+1]<<8),a=new Array(l);p+=2;`;
                body += `for(let i=0;i<l;i++){let e=_dte(b,p);a[i]=_dec(b,p,e-p);p=e;}f${i}=a;}\n`;
                needsTagEnd = true;
                break;

            case 'object':
                body += `{let e=_dte(b,p);f${i}=_dec(b,p,e-p);p=e;}\n`;
                needsTagEnd = true;
                break;

            case 'mixed':
                body += `{let e=_dte(b,p);f${i}=_dec(b,p,e-p);p=e;}\n`;
                needsTagEnd = true;
                break;
        }
    }

    // Build return object
    body += `return {`;

    for (let i = 0; i < n; i++) {
        if (i > 0) {
            body += ',';
        }

        body += `${JSON.stringify(fields[i]!.name)}:f${i}`;
    }

    body += `};\n`;

    let bindArgs = d.decoderBindArgs();

    try {
        let factory = new Function(d.decoderParams(), '_dec', '_dte', `return function decode(b,pos){${body}}`);

        return factory(...bindArgs, helpers.decodeSbc, helpers.decodeTagEnd);
    }
    catch (e) {
        throw new Error('Codec2: decoder compilation failed: ' + (e instanceof Error ? e.message : e));
    }
}


function compileComputeSize(fields: FieldDef[]): ((obj: unknown) => number) | null {
    let allFixed = true,
        fixedTotal = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        if (fields[i]!.fixedSize > 0) {
            fixedTotal += fields[i]!.fixedSize;
        }
        else {
            allFixed = false;
        }
    }

    if (allFixed) {
        return () => fixedTotal;
    }

    return null;
}


export { compileSchema };
export type { FieldDef, Schema, SbcHelpers };
