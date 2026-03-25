// Schema Binary Codec (SBC) — Zero-overhead value encoding
// Tag 246: hash-referenced objects stored with central schema DB
// Primitives: tags 248-254 (self-describing, no schema needed)

function getTypedArrayType(_value: unknown): number { return -1; }
function encodeTypedArray(_value: unknown): Uint8Array { return new Uint8Array(0); }


interface SchemaStoreInterface {
    get(hash: number): Schema | null;
    has(hash: number): boolean;
    register(hash: number, schema: Schema): void;
}


type ArrayFieldType = { element: FieldType; kind: 'array' };

type FieldType =
    | 'bigint'
    | 'boolean'
    | 'bytes'
    | 'date'
    | 'float64'
    | 'int8'
    | 'int16'
    | 'int32'
    | 'mixed'
    | 'string'
    | 'uint8'
    | 'uint16'
    | 'uint32'
    | ArrayFieldType
    | NullableFieldType
    | ObjectFieldType;

interface FieldDef {
    _nullIndex?: number;
    fixedSize: number;
    name: string;
    offset: number;
    type: FieldType;
}

type NullableFieldType = { inner: FieldType; kind: 'nullable' };

type ObjectFieldType = { kind: 'object'; schemaId: number };

interface Schema {
    compressedDecodeFn: ((buf: Buffer, pos: number) => unknown) | null;
    compressedEncodeFn: ((obj: unknown, buf: Buffer, pos: number) => number) | null;
    compressible: boolean;
    decodeFn: ((buf: Buffer, pos: number) => unknown) | null;
    encodeFn: ((obj: unknown, buf: Buffer, pos: number) => number) | null;
    fields: FieldDef[];
    fixedSize: number;
    hash: number;
    id: number;
    nullableCount: number;
}

interface SchemaRegistry {
    nextId: number;
    schemas: Map<number, Schema>;
    schemasByHash: Map<number, Schema>;
}


let FIELD_SIZES: Record<string, number> = {
    bigint: 8,
    boolean: 1,
    date: 8,
    float64: 8,
    int8: 1,
    int16: 2,
    int32: 4,
    uint8: 1,
    uint16: 2,
    uint32: 4,
};


let varintResult = { pos: 0, value: 0 };


function buildSchemaFromDef(def: { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number }): Schema {
    let fields: FieldDef[] = def.fields.map((f) => ({
        fixedSize: f.fixedSize,
        name: f.name,
        offset: 0,
        type: parseFieldType(f.type),
    }));
    let fixedSize = computeFieldOffsets(fields);

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        hash: def.hash,
        id: def.id,
        nullableCount: def.nullableCount,
    };
}

function isCompressible(fields: FieldDef[]): boolean {
    let boolCount = 0,
        hasCompressible = false;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.type === 'boolean') {
            boolCount++;
            continue;
        }

        if (field.type === 'float64' || isIntegerType(field.type)) {
            hasCompressible = true;
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && (isDeltaArrayType(field.type.element) || field.type.element === 'float64')) {
            hasCompressible = true;
        }
    }

    if (boolCount > 16) {
        return false;
    }

    return hasCompressible || boolCount > 0;
}

function isDeltaArrayType(type: FieldType): boolean {
    return type === 'int16' || type === 'int32' || type === 'uint16' || type === 'uint32';
}

function isIntegerType(type: FieldType): boolean {
    return type === 'int16' || type === 'int32' || type === 'uint16' || type === 'uint32';
}

function isSignedIntType(type: string): boolean {
    return type === 'int16' || type === 'int32';
}

function readVarint(buf: Buffer, pos: number): void {
    let byte = buf[pos]!,
        result = byte & 0x7F,
        shift = 7;

    while (byte & 0x80) {
        byte = buf[++pos]!;
        result |= (byte & 0x7F) << shift;
        shift += 7;
    }

    varintResult.pos = pos + 1;
    varintResult.value = result;
}

function readZigzag(buf: Buffer, pos: number): void {
    readVarint(buf, pos);
    let v = varintResult.value;

    varintResult.value = (v >>> 1) ^ -(v & 1);
}

function writeVarint(buf: Buffer, pos: number, value: number): number {
    value = value >>> 0;

    while (value > 0x7F) {
        buf[pos++] = (value & 0x7F) | 0x80;
        value >>>= 7;
    }

    buf[pos++] = value;

    return pos;
}

function writeZigzag(buf: Buffer, pos: number, value: number): number {
    return writeVarint(buf, pos, (value << 1) ^ (value >> 31));
}

function compileCompressedDecoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Buffer, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Buffer, pos: number) => string): (buf: Buffer, pos: number) => unknown {
    let boolFields: FieldDef[] = [],
        float64Fields: FieldDef[] = [],
        intFields: FieldDef[] = [],
        lines: string[] = [],
        otherFixed: FieldDef[] = [],
        vp = 'vp';

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.type === 'boolean') {
            boolFields.push(field);
        }
        else if (field.type === 'float64') {
            float64Fields.push(field);
        }
        else if (isIntegerType(field.type)) {
            intFields.push(field);
        }
        else if (field.fixedSize > 0) {
            otherFixed.push(field);
        }
    }

    let hasNullable = schema.nullableCount > 0,
        nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=buf[pos]');

        if (bitmapBytes > 1) {
            lines.push('_bm|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + bitmapBytes);
    }

    let boolBitmapBytes = Math.ceil(boolFields.length / 8);

    if (boolFields.length > 0) {
        lines.push('let _bb=buf[pos]');

        if (boolBitmapBytes > 1) {
            lines.push('_bb|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + boolBitmapBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('let ' + boolFields[i]!.name + '=!!(_bb&' + (1 << i) + ')');
        }
    }

    let compFixedOffset = 0;

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        lines.push('let ' + field.name + '=' + emitDecoderFixedExpr(field, 'pos+' + compFixedOffset));
        compFixedOffset += field.fixedSize;
    }

    lines.push('let ' + vp + '=pos+' + compFixedOffset);

    for (let i = 0, n = intFields.length; i < n; i++) {
        let field = intFields[i]!;

        if (isSignedIntType(field.type as string)) {
            lines.push('$rz(buf,' + vp + ')');
        }
        else {
            lines.push('$rv(buf,' + vp + ')');
        }

        lines.push('let ' + field.name + '=$vr.value');
        lines.push(vp + '=$vr.pos');
    }

    for (let i = 0, n = float64Fields.length; i < n; i++) {
        let f = float64Fields[i]!.name;

        lines.push('let ' + f + 'F=buf[' + vp + '++]');
        lines.push('let ' + f);
        lines.push('if(' + f + 'F===0){$rz(buf,' + vp + ');' + f + '=$vr.value;' + vp + '=$vr.pos}else{' + f + '=buf.readDoubleLE(' + vp + ');' + vp + '+=8}');
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0 || field.type === 'boolean') {
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && isDeltaArrayType(field.type.element)) {
            emitDeltaArrayDecoder(lines, field, vp);
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && field.type.element === 'float64') {
            emitFloat64ArrayCompressedDecoder(lines, field, vp);
            continue;
        }

        if (!isIntegerType(field.type) && field.type !== 'float64') {
            emitDecoderVar(lines, field, vp, internFields);
        }
    }

    let allFields = schema.fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let body = lines.join(';');
    let $d = helpers?.decodeSbc ?? ((_buf: Buffer, _offset: number, _len: number) => null);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$rv', '$rz', '$vr', '$sd', 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult, internDecode) as (buf: Buffer, pos: number) => unknown;
    }

    return new Function('$d', '$rv', '$rz', '$vr', 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult) as (buf: Buffer, pos: number) => unknown;
}

function compileCompressedEncoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Buffer, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Buffer, pos: number) => number): (obj: unknown, buf: Buffer, pos: number) => number {
    let boolFields: FieldDef[] = [],
        float64Fields: FieldDef[] = [],
        intFields: FieldDef[] = [],
        lines: string[] = [],
        otherFixed: FieldDef[] = [],
        vp = 'vp';

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.type === 'boolean') {
            boolFields.push(field);
        }
        else if (field.type === 'float64') {
            float64Fields.push(field);
        }
        else if (isIntegerType(field.type)) {
            intFields.push(field);
        }
        else if (field.fixedSize > 0) {
            otherFixed.push(field);
        }
    }

    let hasNullable = schema.nullableCount > 0,
        nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=0');
        lines.push('let _bmPos=pos');
        lines.push('pos+=' + bitmapBytes);
    }

    let boolBitmapBytes = Math.ceil(boolFields.length / 8);

    if (boolFields.length > 0) {
        lines.push('let _bb=0');
        lines.push('let _bbPos=pos');
        lines.push('pos+=' + boolBitmapBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('if(obj.' + boolFields[i]!.name + '){_bb|=' + (1 << i) + '}');
        }
    }

    let compFixedOffset = 0;

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        emitEncoderFixedAtOffset(lines, field, 'pos+' + compFixedOffset);
        compFixedOffset += field.fixedSize;
    }

    lines.push('let ' + vp + '=pos+' + compFixedOffset);

    for (let i = 0, n = intFields.length; i < n; i++) {
        let field = intFields[i]!;

        if (isSignedIntType(field.type as string)) {
            lines.push(vp + '=$wz(buf,' + vp + ',obj.' + field.name + ')');
        }
        else {
            lines.push(vp + '=$wv(buf,' + vp + ',obj.' + field.name + ')');
        }
    }

    for (let i = 0, n = float64Fields.length; i < n; i++) {
        let f = float64Fields[i]!.name;

        lines.push('let ' + f + 'I=obj.' + f + '===(obj.' + f + '|0)');
        lines.push('if(' + f + 'I){buf[' + vp + ']=0;' + vp + '++;' + vp + '=$wz(buf,' + vp + ',obj.' + f + ')}else{buf[' + vp + ']=1;' + vp + '++;buf.writeDoubleLE(obj.' + f + ',' + vp + ');' + vp + '+=8}');
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0 || field.type === 'boolean') {
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && isDeltaArrayType(field.type.element)) {
            emitDeltaArrayEncoder(lines, field, vp);
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && field.type.element === 'float64') {
            emitFloat64ArrayCompressedEncoder(lines, field, vp);
            continue;
        }

        if (!isIntegerType(field.type) && field.type !== 'float64') {
            emitEncoderVar(lines, field, vp, internFields);
        }
    }

    if (boolFields.length > 0) {
        lines.push('buf[_bbPos]=_bb&0xFF');

        if (boolBitmapBytes > 1) {
            lines.push('buf[_bbPos+1]=(_bb>>8)&0xFF');
        }
    }

    if (hasNullable) {
        lines.push('buf[_bmPos]=_bm&0xFF');

        if (bitmapBytes > 1) {
            lines.push('buf[_bmPos+1]=(_bm>>8)&0xFF');
        }
    }

    lines.push('return ' + vp);

    let body = lines.join(';');
    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Buffer, pos: number) => { buf[pos] = 0; return pos + 1; });

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$wv', '$wz', '$si', 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag, internEncode) as (obj: unknown, buf: Buffer, pos: number) => number;
    }

    return new Function('$e', '$wv', '$wz', 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag) as (obj: unknown, buf: Buffer, pos: number) => number;
}

function emitDecoderFixedExpr(field: FieldDef, off: string): string {
    switch (field.type) {
        case 'bigint': return 'buf.readBigInt64LE(' + off + ')';
        case 'date': return 'new Date(buf.readDoubleLE(' + off + '))';
        case 'float64': return 'buf.readDoubleLE(' + off + ')';
        case 'int8': return '(buf[' + off + ']<<24>>24)';
        case 'int16': return 'buf.readInt16LE(' + off + ')';
        case 'int32': return 'buf.readInt32LE(' + off + ')';
        case 'uint8': return 'buf[' + off + ']';
        case 'uint16': return 'buf.readUInt16LE(' + off + ')';
        case 'uint32': return 'buf.readUInt32LE(' + off + ')';
        default: return '0';
    }
}

function emitDeltaArrayDecoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name;

    lines.push('let ' + n + 'C=buf.readUInt16LE(' + vp + ')');
    lines.push(vp + '+=2');
    lines.push('let ' + n + '=new Array(' + n + 'C)');
    lines.push('if(' + n + 'C>0){$rv(buf,' + vp + ')');
    lines.push('let _base=$vr.value');
    lines.push(vp + '=$vr.pos');
    lines.push(n + '[0]=_base');
    lines.push('for(let j=1;j<' + n + 'C;j++){$rz(buf,' + vp + ');_base+=$vr.value;' + vp + '=$vr.pos;' + n + '[j]=_base}}');
}

function emitDeltaArrayEncoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name,
        val = 'obj.' + n;

    lines.push('let ' + n + 'A=' + val);
    lines.push('let ' + n + 'C=' + n + 'A.length');
    lines.push('buf.writeUInt16LE(' + n + 'C,' + vp + ')');
    lines.push(vp + '+=2');
    lines.push('if(' + n + 'C>0){' + vp + '=$wv(buf,' + vp + ',' + n + 'A[0])');
    lines.push('for(let j=1;j<' + n + 'C;j++){' + vp + '=$wz(buf,' + vp + ',' + n + 'A[j]-' + n + 'A[j-1])}}');
}

function emitEncoderFixedAtOffset(lines: string[], field: FieldDef, off: string): void {
    let val = 'obj.' + field.name;

    switch (field.type) {
        case 'bigint':
            lines.push('buf.writeBigInt64LE(' + val + ',' + off + ')');
            break;
        case 'date':
            lines.push('buf.writeDoubleLE(' + val + '.getTime(),' + off + ')');
            break;
        case 'float64':
            lines.push('buf.writeDoubleLE(' + val + ',' + off + ')');
            break;
        case 'int8':
            lines.push('buf[' + off + ']=(' + val + ')&0xFF');
            break;
        case 'int16':
            lines.push('buf.writeInt16LE(' + val + ',' + off + ')');
            break;
        case 'int32':
            lines.push('buf.writeInt32LE(' + val + ',' + off + ')');
            break;
        case 'uint8':
            lines.push('buf[' + off + ']=' + val);
            break;
        case 'uint16':
            lines.push('buf.writeUInt16LE(' + val + ',' + off + ')');
            break;
        case 'uint32':
            lines.push('buf.writeUInt32LE(' + val + ',' + off + ')');
            break;
    }
}

function emitFloat64ArrayCompressedDecoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name;

    lines.push('let ' + n + 'C=buf.readUInt16LE(' + vp + ')');
    lines.push(vp + '+=2');
    lines.push('let ' + n + '=new Array(' + n + 'C)');
    lines.push('if(' + n + 'C>0){let _flg=buf[' + vp + '++]');
    lines.push('if(_flg===0){$rv(buf,' + vp + ')');
    lines.push('let _base=$vr.value');
    lines.push(vp + '=$vr.pos');
    lines.push(n + '[0]=_base');
    lines.push('for(let j=1;j<' + n + 'C;j++){$rz(buf,' + vp + ');_base+=$vr.value;' + vp + '=$vr.pos;' + n + '[j]=_base}');
    lines.push('}else{for(let j=0;j<' + n + 'C;j++){' + n + '[j]=buf.readDoubleLE(' + vp + ');' + vp + '+=8}}}');
}

function emitFloat64ArrayCompressedEncoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name,
        val = 'obj.' + n;

    lines.push('let ' + n + 'A=' + val);
    lines.push('let ' + n + 'C=' + n + 'A.length');
    lines.push('buf.writeUInt16LE(' + n + 'C,' + vp + ')');
    lines.push(vp + '+=2');
    lines.push('if(' + n + 'C>0){let _allInt=true');
    lines.push('for(let j=0;j<' + n + 'C;j++){if(' + n + 'A[j]!==(' + n + 'A[j]|0)){_allInt=false;break}}');
    lines.push('if(_allInt){buf[' + vp + '++]=0');
    lines.push(vp + '=$wv(buf,' + vp + ',' + n + 'A[0])');
    lines.push('for(let j=1;j<' + n + 'C;j++){' + vp + '=$wz(buf,' + vp + ',' + n + 'A[j]-' + n + 'A[j-1])}');
    lines.push('}else{buf[' + vp + '++]=1');
    lines.push('for(let j=0;j<' + n + 'C;j++){buf.writeDoubleLE(' + n + 'A[j],' + vp + ');' + vp + '+=8}}}');
}

function emitDecoderFixed(lines: string[], field: FieldDef): void {
    let off = 'pos+' + field.offset;

    switch (field.type) {
        case 'bigint':
            lines.push('let ' + field.name + '=buf.readBigInt64LE(' + off + ')');
            break;
        case 'boolean':
            lines.push('let ' + field.name + '=!!buf[' + off + ']');
            break;
        case 'date':
            lines.push('let ' + field.name + '=new Date(buf.readDoubleLE(' + off + '))');
            break;
        case 'float64':
            lines.push('let ' + field.name + '=buf.readDoubleLE(' + off + ')');
            break;
        case 'int8':
            lines.push('let ' + field.name + '=(buf[' + off + ']<<24>>24)');
            break;
        case 'int16':
            lines.push('let ' + field.name + '=buf.readInt16LE(' + off + ')');
            break;
        case 'int32':
            lines.push('let ' + field.name + '=buf.readInt32LE(' + off + ')');
            break;
        case 'uint8':
            lines.push('let ' + field.name + '=buf[' + off + ']');
            break;
        case 'uint16':
            lines.push('let ' + field.name + '=buf.readUInt16LE(' + off + ')');
            break;
        case 'uint32':
            lines.push('let ' + field.name + '=buf.readUInt32LE(' + off + ')');
            break;
    }
}

function emitDecoderVar(lines: string[], field: FieldDef, vp: string, internFields?: Set<string>): void {
    let type = field.type;

    if (typeof type === 'string') {
        switch (type) {
            case 'bytes':
                lines.push('let ' + field.name + 'L=buf.readUInt32LE(' + vp + ')');
                lines.push(vp + '+=4');
                lines.push('let ' + field.name + '=buf.subarray(' + vp + ',' + vp + '+' + field.name + 'L)');
                lines.push(vp + '+=' + field.name + 'L');
                break;
            case 'string':
                if (internFields && internFields.has(field.name)) {
                    lines.push('let ' + field.name + 'L=buf.readUInt32LE(' + vp + ')');
                    lines.push(vp + '+=4');
                    lines.push('let ' + field.name);
                    lines.push('if(' + field.name + 'L===0xFFFFFFFF){' + field.name + '=$sd(buf,' + vp + ');' + vp + '+=4}else{' + field.name + '=buf.utf8Slice(' + vp + ',' + vp + '+' + field.name + 'L);' + vp + '+=' + field.name + 'L}');
                }
                else {
                    lines.push('let ' + field.name + 'L=buf.readUInt32LE(' + vp + ')');
                    lines.push(vp + '+=4');
                    lines.push('let ' + field.name + '=buf.utf8Slice(' + vp + ',' + vp + '+' + field.name + 'L)');
                    lines.push(vp + '+=' + field.name + 'L');
                }
                break;
        }

        return;
    }

    if (type.kind === 'nullable') {
        // Presence bit is in bitmap — handled separately; decode inner type or null
        lines.push('let ' + field.name + '=null');
        lines.push('if(_bm&' + (1 << field._nullIndex!) + '){');
        emitDecoderVarInner(lines, field.name, type.inner, vp);
        lines.push('}');

        return;
    }

    if (type.kind === 'object') {
        // Nested object: read u16 length prefix, decode via decodeSbc
        lines.push('let ' + field.name + 'L=buf.readUInt16LE(' + vp + ')');
        lines.push(vp + '+=2');
        lines.push('let ' + field.name + '=$d(buf,' + vp + ',' + field.name + 'L)');
        lines.push(vp + '+=' + field.name + 'L');

        return;
    }

    if (type.kind === 'array') {
        let elem = type.element;

        lines.push('let ' + field.name + 'C=buf.readUInt16LE(' + vp + ')');
        lines.push(vp + '+=2');
        lines.push('let ' + field.name + '=new Array(' + field.name + 'C)');

        if (typeof elem === 'string' && elem === 'mixed') {
            // Mixed-type array: each element has u32 length + SBC-tagged data
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let el=buf.readUInt32LE(' + vp + ');' + vp + '+=4;' + field.name + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else if (typeof elem === 'object' && elem.kind === 'object') {
            // Array of objects: each element has u16 length + schema_id + fields
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let el=buf.readUInt16LE(' + vp + ');' + vp + '+=2;' + field.name + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else if (typeof elem === 'string') {
            switch (elem) {
                case 'float64':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf.readDoubleLE(' + vp + ');' + vp + '+=8}');
                    break;
                case 'int32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf.readInt32LE(' + vp + ');' + vp + '+=4}');
                    break;
                case 'string':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){let l=buf.readUInt32LE(' + vp + ');' + vp + '+=4;' + field.name + '[j]=buf.utf8Slice(' + vp + ',' + vp + '+l);' + vp + '+=l}');
                    break;
                case 'uint16':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf.readUInt16LE(' + vp + ');' + vp + '+=2}');
                    break;
                case 'uint32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf.readUInt32LE(' + vp + ');' + vp + '+=4}');
                    break;
                case 'uint8':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf[' + vp + '++]}');
                    break;
            }
        }

        return;
    }
}

function emitDecoderVarInner(lines: string[], name: string, type: FieldType, vp: string): void {
    if (typeof type === 'string') {
        switch (type) {
            case 'string':
                lines.push('let ' + name + 'L=buf.readUInt32LE(' + vp + ')');
                lines.push(vp + '+=4');
                lines.push(name + '=buf.utf8Slice(' + vp + ',' + vp + '+' + name + 'L)');
                lines.push(vp + '+=' + name + 'L');
                break;
            case 'uint8':
                lines.push(name + '=buf[' + vp + '++]');
                break;
            case 'uint32':
                lines.push(name + '=buf.readUInt32LE(' + vp + ')');
                lines.push(vp + '+=4');
                break;
            case 'float64':
                lines.push(name + '=buf.readDoubleLE(' + vp + ')');
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push(name + '=!!buf[' + vp + '++]');
                break;
        }
    }
}

function emitEncoderFixed(lines: string[], field: FieldDef): void {
    let off = 'pos+' + field.offset;
    let val = 'obj.' + field.name;

    switch (field.type) {
        case 'bigint':
            lines.push('buf.writeBigInt64LE(' + val + ',' + off + ')');
            break;
        case 'boolean':
            lines.push('buf[' + off + ']=' + val + '?1:0');
            break;
        case 'date':
            lines.push('buf.writeDoubleLE(' + val + '.getTime(),' + off + ')');
            break;
        case 'float64':
            lines.push('buf.writeDoubleLE(' + val + ',' + off + ')');
            break;
        case 'int8':
            lines.push('buf[' + off + ']=(' + val + ')&0xFF');
            break;
        case 'int16':
            lines.push('buf.writeInt16LE(' + val + ',' + off + ')');
            break;
        case 'int32':
            lines.push('buf.writeInt32LE(' + val + ',' + off + ')');
            break;
        case 'uint8':
            lines.push('buf[' + off + ']=' + val);
            break;
        case 'uint16':
            lines.push('buf.writeUInt16LE(' + val + ',' + off + ')');
            break;
        case 'uint32':
            lines.push('buf.writeUInt32LE(' + val + ',' + off + ')');
            break;
    }
}

function emitEncoderVar(lines: string[], field: FieldDef, vp: string, internFields?: Set<string>): void {
    let type = field.type;
    let val = 'obj.' + field.name;

    if (typeof type === 'string') {
        switch (type) {
            case 'bytes':
                lines.push('let ' + field.name + 'L=' + val + '.length');
                lines.push('buf.writeUInt32LE(' + field.name + 'L,' + vp + ')');
                lines.push(vp + '+=4');
                lines.push('buf.set(' + val + ',' + vp + ')');
                lines.push(vp + '+=' + field.name + 'L');
                break;
            case 'string':
                if (internFields && internFields.has(field.name)) {
                    lines.push(vp + '=$si(\'' + field.name + '\',' + val + ',buf,' + vp + ')');
                }
                else {
                    lines.push('let ' + field.name + 'L=Buffer.byteLength(' + val + ')');
                    lines.push('buf.writeUInt32LE(' + field.name + 'L,' + vp + ')');
                    lines.push(vp + '+=4');
                    lines.push(vp + '+=buf.utf8Write(' + val + ',' + vp + ',' + field.name + 'L)');
                }
                break;
        }

        return;
    }

    if (type.kind === 'nullable') {
        // Write presence bit + inner value if non-null
        lines.push('if(' + val + '!=null){_bm|=' + (1 << field._nullIndex!) + ';');
        emitEncoderVarInner(lines, val, type.inner, vp);
        lines.push('}');

        return;
    }

    if (type.kind === 'object') {
        // Nested object: encode with $e, write u16 length prefix
        lines.push('let ' + field.name + 'S=' + vp);
        lines.push(vp + '+=2');
        lines.push(vp + '=$e(' + val + ',buf,' + vp + ')');
        lines.push('buf.writeUInt16LE(' + vp + '-' + field.name + 'S-2,' + field.name + 'S)');

        return;
    }

    if (type.kind === 'array') {
        let elem = type.element;

        lines.push('let ' + field.name + 'A=' + val);
        lines.push('let ' + field.name + 'C=' + field.name + 'A.length');
        lines.push('buf.writeUInt16LE(' + field.name + 'C,' + vp + ')');
        lines.push(vp + '+=2');

        if (typeof elem === 'string' && elem === 'mixed') {
            // Mixed-type array: each element gets u32 length + SBC-tagged data
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let es=' + vp + ';' + vp + '+=4;' + vp + '=$e(' + field.name + 'A[j],buf,' + vp + ');buf.writeUInt32LE(' + vp + '-es-4,es)}');
        }
        else if (typeof elem === 'object' && elem.kind === 'object') {
            // Array of objects: each element gets u16 length + $e(element)
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let es=' + vp + ';' + vp + '+=2;' + vp + '=$e(' + field.name + 'A[j],buf,' + vp + ');buf.writeUInt16LE(' + vp + '-es-2,es)}');
        }
        else if (typeof elem === 'string') {
            switch (elem) {
                case 'float64':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf.writeDoubleLE(' + field.name + 'A[j],' + vp + ');' + vp + '+=8}');
                    break;
                case 'int32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf.writeInt32LE(' + field.name + 'A[j],' + vp + ');' + vp + '+=4}');
                    break;
                case 'string':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){let l=Buffer.byteLength(' + field.name + 'A[j]);buf.writeUInt32LE(l,' + vp + ');' + vp + '+=4;' + vp + '+=buf.utf8Write(' + field.name + 'A[j],' + vp + ',l)}');
                    break;
                case 'uint16':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf.writeUInt16LE(' + field.name + 'A[j],' + vp + ');' + vp + '+=2}');
                    break;
                case 'uint32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf.writeUInt32LE(' + field.name + 'A[j],' + vp + ');' + vp + '+=4}');
                    break;
                case 'uint8':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf[' + vp + '++]=' + field.name + 'A[j]}');
                    break;
            }
        }

        return;
    }
}

function emitEncoderVarInner(lines: string[], val: string, type: FieldType, vp: string): void {
    if (typeof type === 'string') {
        switch (type) {
            case 'string':
                lines.push('let _nl=Buffer.byteLength(' + val + ')');
                lines.push('buf.writeUInt32LE(_nl,' + vp + ')');
                lines.push(vp + '+=4');
                lines.push(vp + '+=buf.utf8Write(' + val + ',' + vp + ',_nl)');
                break;
            case 'uint8':
                lines.push('buf[' + vp + '++]=' + val);
                break;
            case 'uint32':
                lines.push('buf.writeUInt32LE(' + val + ',' + vp + ')');
                lines.push(vp + '+=4');
                break;
            case 'float64':
                lines.push('buf.writeDoubleLE(' + val + ',' + vp + ')');
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push('buf[' + vp + '++]=' + val + '?1:0');
                break;
        }
    }
}

function compileDecoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Buffer, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Buffer, pos: number) => string): (buf: Buffer, pos: number) => unknown {
    let lines: string[] = [];
    let vp = 'vp';
    let hasNullable = schema.nullableCount > 0;

    let nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=buf[pos]');

        if (bitmapBytes > 1) {
            lines.push('_bm|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + bitmapBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitDecoderFixed(lines, field);
        }
    }

    let hasVar = false;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            continue;
        }

        if (!hasVar) {
            lines.push('let ' + vp + '=pos+' + schema.fixedSize);
            hasVar = true;
        }

        emitDecoderVar(lines, field, vp, internFields);
    }

    let allFields = schema.fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let body = lines.join(';');
    let $d = helpers?.decodeSbc ?? ((_buf: Buffer, _offset: number, _len: number) => null);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$sd', 'buf', 'pos', body).bind(null, $d, internDecode) as (buf: Buffer, pos: number) => unknown;
    }

    return new Function('$d', 'buf', 'pos', body).bind(null, $d) as (buf: Buffer, pos: number) => unknown;
}

function compileEncoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Buffer, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Buffer, pos: number) => number): (obj: unknown, buf: Buffer, pos: number) => number {
    let lines: string[] = [];
    let vp = 'vp';
    let hasNullable = schema.nullableCount > 0;
    let nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=0');
        lines.push('let _bmPos=pos');
        lines.push('pos+=' + bitmapBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitEncoderFixed(lines, field);
        }
    }

    let hasVar = false;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            continue;
        }

        if (!hasVar) {
            lines.push('let ' + vp + '=pos+' + schema.fixedSize);
            hasVar = true;
        }

        emitEncoderVar(lines, field, vp, internFields);
    }

    if (hasNullable) {
        lines.push('buf[_bmPos]=_bm&0xFF');

        if (bitmapBytes > 1) {
            lines.push('buf[_bmPos+1]=(_bm>>8)&0xFF');
        }
    }

    lines.push('return ' + (hasVar ? vp : 'pos+' + schema.fixedSize));

    let body = lines.join(';');
    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Buffer, pos: number) => { buf[pos] = 0; return pos + 1; });

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$si', 'obj', 'buf', 'pos', body).bind(null, $e, internEncode) as (obj: unknown, buf: Buffer, pos: number) => number;
    }

    return new Function('$e', 'obj', 'buf', 'pos', body).bind(null, $e) as (obj: unknown, buf: Buffer, pos: number) => number;
}

function compileSchema(schema: Schema, registry?: SchemaRegistry, helpers?: { decodeSbc?: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Buffer, pos: number) => number }, compression?: boolean, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Buffer, pos: number) => number, internDecode?: (buf: Buffer, pos: number) => string): void {
    let reg = registry || createRegistry();

    schema.decodeFn = compileDecoder(schema, reg, helpers, internFields, internDecode);
    schema.encodeFn = compileEncoder(schema, reg, helpers, internFields, internEncode);

    if (compression && schema.compressible) {
        schema.compressedDecodeFn = compileCompressedDecoder(schema, reg, helpers, internFields, internDecode);
        schema.compressedEncodeFn = compileCompressedEncoder(schema, reg, helpers, internFields, internEncode);
    }
}

function computeFieldOffsets(fields: FieldDef[]): number {
    let offset = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            field.offset = offset;
            offset += field.fixedSize;
        }
    }

    let fixedSize = offset;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize === 0) {
            field.offset = -1;
        }
    }

    return fixedSize;
}

function createRegistry(): SchemaRegistry {
    return {
        nextId: 1,
        schemas: new Map(),
        schemasByHash: new Map(),
    };
}

function fieldTypeSize(type: FieldType): number {
    if (typeof type === 'string') {
        return FIELD_SIZES[type] ?? 0;
    }

    return 0;
}

function fnv1a(str: string): number {
    let hash = 0x811c9dc5;

    for (let i = 0, n = str.length; i < n; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }

    return hash;
}

function deserializeRegistry(data: unknown[]): SchemaRegistry {
    let registry = createRegistry();
    let maxId = 0;

    for (let i = 0, n = data.length; i < n; i++) {
        let def = data[i] as { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number };
        let schema = buildSchemaFromDef(def);

        registry.schemas.set(schema.id, schema);
        registry.schemasByHash.set(schema.hash, schema);

        if (schema.id > maxId) {
            maxId = schema.id;
        }
    }

    registry.nextId = maxId + 1;

    return registry;
}

function inferFieldType(value: unknown): FieldType {
    if (value === null || value === undefined) {
        return { inner: 'uint8', kind: 'nullable' };
    }

    switch (typeof value) {
        case 'bigint':
            return 'bigint';
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'float64';
        case 'object': {
            if (value instanceof Date) {
                return 'date';
            }

            if (value instanceof Uint8Array) {
                return 'bytes';
            }

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    return { element: 'float64', kind: 'array' };
                }

                let elementType = inferFieldType(value[0]);
                let elementSerialized = serializeFieldType(elementType);

                // Check up to 10 elements for type consistency
                for (let i = 1, n = Math.min(value.length, 10); i < n; i++) {
                    if (serializeFieldType(inferFieldType(value[i])) !== elementSerialized) {
                        return { element: 'mixed' as FieldType, kind: 'array' };
                    }
                }

                return { element: elementType, kind: 'array' };
            }

            return { kind: 'object', schemaId: 0 };
        }
        case 'string':
            return 'string';
        default:
            return 'string';
    }
}

function inferSchema(obj: Record<string, unknown>, registry: SchemaRegistry): Schema {
    let keys = Object.keys(obj).sort();
    let hashParts: string[] = [];
    let fields: FieldDef[] = [];
    let nullableCount = 0;

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;
        let value = obj[key];

        // Skip undefined fields — treat as absent, not as a distinct schema shape
        if (value === undefined) {
            continue;
        }

        let type = inferFieldType(value);
        let size = fieldTypeSize(type);

        if (typeof type === 'object' && type.kind === 'nullable') {
            nullableCount++;
        }

        hashParts.push(key + ':' + serializeFieldType(type));
        fields.push({
            fixedSize: size,
            name: key,
            offset: 0,
            type,
        });
    }

    // Sort: fixed-size fields first (by name), then variable-size (by name)
    fields.sort((a, b) => {
        if (a.fixedSize > 0 && b.fixedSize === 0) {
            return -1;
        }

        if (a.fixedSize === 0 && b.fixedSize > 0) {
            return 1;
        }

        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    let fixedSize = computeFieldOffsets(fields);
    let hash = fnv1a(hashParts.join(','));

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        hash,
        id: registry.nextId,
        nullableCount,
    };
}

function parseFieldType(str: string): FieldType {
    if (str.startsWith('array<') && str.endsWith('>')) {
        return { element: parseFieldType(str.slice(6, -1)), kind: 'array' };
    }

    if (str.startsWith('nullable<') && str.endsWith('>')) {
        return { inner: parseFieldType(str.slice(9, -1)), kind: 'nullable' };
    }

    if (str.startsWith('object(') && str.endsWith(')')) {
        return { kind: 'object', schemaId: parseInt(str.slice(7, -1), 10) };
    }

    return str as FieldType;
}

function registerSchema(schema: Schema, registry: SchemaRegistry): void {
    schema.id = registry.nextId++;
    registry.schemas.set(schema.id, schema);
    registry.schemasByHash.set(schema.hash, schema);
}

function serializeFieldType(type: FieldType): string {
    if (typeof type === 'string') {
        return type;
    }

    if (type.kind === 'array') {
        return 'array<' + serializeFieldType(type.element) + '>';
    }

    if (type.kind === 'nullable') {
        return 'nullable<' + serializeFieldType(type.inner) + '>';
    }

    return 'object(' + type.schemaId + ')';
}

function serializeRegistry(registry: SchemaRegistry): unknown[] {
    let result: unknown[] = [];

    registry.schemas.forEach((schema) => {
        result.push({
            fields: schema.fields.map((f) => ({
                fixedSize: f.fixedSize,
                name: f.name,
                type: serializeFieldType(f.type),
            })),
            hash: schema.hash,
            id: schema.id,
            nullableCount: schema.nullableCount,
        });
    });

    return result;
}


const lookupSchema = (obj: Record<string, unknown>, registry: SchemaRegistry): Schema | null => {
    let keys = Object.keys(obj).sort();
    let hashParts: string[] = [];

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;

        if (obj[key] === undefined) {
            continue;
        }

        let type = inferFieldType(obj[key]);

        hashParts.push(key + ':' + serializeFieldType(type));
    }

    let hash = fnv1a(hashParts.join(','));

    return registry.schemasByHash.get(hash) ?? null;
};

const resolveSchema = (obj: Record<string, unknown>, registry: SchemaRegistry): Schema => {
    let existing = lookupSchema(obj, registry);

    if (existing) {
        return existing;
    }

    let schema = inferSchema(obj, registry);

    registerSchema(schema, registry);

    return schema;
};


// Binary format for persisting schema field definitions:
// [fieldCount: uint16] then per field: [nameLen: uint16][name: utf8][typeLen: uint16][type: utf8]
function decodeFieldDefs(bytes: Uint8Array): { name: string; type: string }[] {
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        count = view.getUint16(0, true),
        offset = 2,
        result: { name: string; type: string }[] = [];

    for (let i = 0; i < count; i++) {
        let nameLen = view.getUint16(offset, true);

        offset += 2;

        let name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLen));

        offset += nameLen;

        let typeLen = view.getUint16(offset, true);

        offset += 2;

        let type = new TextDecoder().decode(bytes.subarray(offset, offset + typeLen));

        offset += typeLen;
        result.push({ name, type });
    }

    return result;
}

function encodeFieldDefs(defs: { name: string; type: string }[]): Uint8Array {
    let encoder = new TextEncoder(),
        parts: Uint8Array[] = [],
        totalSize = 2; // fieldCount header

    for (let i = 0, n = defs.length; i < n; i++) {
        let def = defs[i]!,
            nameBytes = encoder.encode(def.name),
            typeBytes = encoder.encode(def.type);

        parts.push(nameBytes, typeBytes);
        totalSize += 4 + nameBytes.length + typeBytes.length; // 2 x uint16 + data
    }

    let result = new Uint8Array(totalSize),
        view = new DataView(result.buffer),
        offset = 0;

    view.setUint16(offset, defs.length, true);
    offset += 2;

    for (let i = 0, n = parts.length; i < n; i += 2) {
        let nameBytes = parts[i]!,
            typeBytes = parts[i + 1]!;

        view.setUint16(offset, nameBytes.length, true);
        offset += 2;
        result.set(nameBytes, offset);
        offset += nameBytes.length;

        view.setUint16(offset, typeBytes.length, true);
        offset += 2;
        result.set(typeBytes, offset);
        offset += typeBytes.length;
    }

    return result;
}


const createSchemaStore = (db: { getBinary(key: unknown): Uint8Array | undefined; putSync(key: unknown, value: unknown): boolean; transactionSync<T>(fn: () => T): T }, prefix?: string): SchemaStoreInterface => {
    let cache = new Map<number, Schema>(),
        helpers = {
            decodeSbc: null as unknown as (buf: Buffer, offset: number, len: number) => unknown,
            encodeSbc: null as unknown as (value: unknown, buf: Buffer, pos: number) => number,
        },
        internDecode = undefined as ((buf: Buffer, pos: number) => string) | undefined,
        internEncode = undefined as ((field: string, value: string, buf: Buffer, pos: number) => number) | undefined,
        internFields = undefined as Set<string> | undefined,
        keyPrefix = prefix ? prefix + ':' : '',
        reg = createRegistry();

    return {
        has(hash: number): boolean {
            return cache.has(hash);
        },

        get(hash: number): Schema | null {
            let cached = cache.get(hash);

            if (cached) {
                return cached;
            }

            // Fetch from schema DB — uses getBinary (copies buffer, no clobbering)
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + hash) as unknown as never);
            }
            catch {
                return null;
            }

            if (!bytes) {
                return null;
            }

            let defs: { name: string; type: string }[];

            try {
                defs = decodeFieldDefs(bytes);
            }
            catch {
                return null;
            }

            // Build schema from persisted field definitions
            let fields: FieldDef[] = defs.map((d) => {
                let type = parseFieldType(d.type);

                return { fixedSize: fieldTypeSize(type), name: d.name, offset: 0, type };
            });

            fields.sort((a, b) => {
                if (a.fixedSize > 0 && b.fixedSize === 0) {
                    return -1;
                }

                if (a.fixedSize === 0 && b.fixedSize > 0) {
                    return 1;
                }

                return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
            });

            let fixedSize = computeFieldOffsets(fields);

            let schema: Schema = {
                compressedDecodeFn: null,
                compressedEncodeFn: null,
                compressible: isCompressible(fields),
                decodeFn: null,
                encodeFn: null,
                fields,
                fixedSize,
                hash,
                id: reg.nextId,
                nullableCount: fields.filter((f) => typeof f.type === 'object' && f.type.kind === 'nullable').length,
            };

            registerSchema(schema, reg);
            compileSchema(schema, reg, helpers, false, internFields, internEncode, internDecode);
            cache.set(hash, schema);

            return schema;
        },

        register(hash: number, schema: Schema): void {
            cache.set(hash, schema);

            let encoded = encodeFieldDefs(schema.fields.map((f) => ({
                name: f.name,
                type: serializeFieldType(f.type),
            })));

            // Persist to schema DB. Use try/catch — may fail if called during
            // nested transactionSync (encode within user's transactionSync).
            // Schema DB is a separate DBI so transactionSync is safe from the
            // main thread outside write transactions.
            try {
                db.transactionSync(() => {
                    db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                });
            }
            catch {
                // If sync fails (nested txn), defer via microtask
                queueMicrotask(() => {
                    try {
                        db.transactionSync(() => {
                            db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                        });
                    }
                    catch {
                        // Ignore — DB may be closing
                    }
                });
            }
        },

        // Called by createCodec to wire up the decode/encode helpers after creation
        _setHelpers(h: typeof helpers) {
            helpers.decodeSbc = h.decodeSbc;
            helpers.encodeSbc = h.encodeSbc;
        },

        _setIntern(pool: InternPool) {
            internDecode = pool.decode;
            internEncode = pool.encode;
            internFields = pool.fields;
        },
    } as SchemaStoreInterface & { _setHelpers(h: { decodeSbc: (buf: Buffer, offset: number, len: number) => unknown; encodeSbc: (value: unknown, buf: Buffer, pos: number) => number }): void; _setIntern(pool: InternPool): void };
};


interface InternPool {
    decode: (buf: Buffer, pos: number) => string;
    encode: (field: string, value: string, buf: Buffer, pos: number) => number;
    fields: Set<string>;
    load: () => void;
}

interface InternDb {
    getBinary(key: unknown): Uint8Array | undefined;
    getRange(options?: { start?: unknown }): Iterable<{ key: unknown; value: unknown }>;
    putSync(key: unknown, value: unknown): boolean;
    transactionSync<T>(fn: () => T): T;
}

const createInternPool = (db: InternDb, fieldNames: string[], prefix?: string): InternPool => {
    let fields = new Set(fieldNames),
        idToString = new Map<number, string>(),
        keyPrefix = prefix ? prefix + ':' : '',
        nextId = 1,
        stringToId = new Map<string, number>();

    function internString(value: string): number {
        let id = stringToId.get(value);

        if (id !== undefined) {
            return id;
        }

        id = nextId++;
        idToString.set(id, value);
        stringToId.set(value, id);

        let encoded = Buffer.from(value, 'utf8');

        try {
            db.transactionSync(() => {
                db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
            });
        }
        catch {
            queueMicrotask(() => {
                try {
                    db.transactionSync(() => {
                        db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
                    });
                }
                catch {
                    // Ignore — DB may be closing
                }
            });
        }

        return id;
    }

    return {
        fields,

        encode(_field: string, value: string, buf: Buffer, pos: number): number {
            let byteLen = Buffer.byteLength(value);

            if (byteLen < 5) {
                buf.writeUInt32LE(byteLen, pos);
                pos += 4;
                pos += (buf as unknown as { utf8Write(str: string, offset: number, length: number): number }).utf8Write(value, pos, byteLen);

                return pos;
            }

            let id = internString(value);

            buf.writeUInt32LE(0xFFFFFFFF, pos);
            buf.writeUInt32LE(id, pos + 4);

            return pos + 8;
        },

        decode(buf: Buffer, pos: number): string {
            let id = buf.readUInt32LE(pos);
            let cached = idToString.get(id);

            if (cached !== undefined) {
                return cached;
            }

            // Fallback: read from DB
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + id) as unknown as never);
            }
            catch {
                return '';
            }

            if (!bytes) {
                return '';
            }

            let str = Buffer.from(bytes).toString('utf8');

            idToString.set(id, str);
            stringToId.set(str, id);

            return str;
        },

        load(): void {
            let maxId = 0;

            try {
                for (let entry of db.getRange({ start: keyPrefix as unknown as never })) {
                    let k = String(entry.key);

                    if (!k.startsWith(keyPrefix)) {
                        break;
                    }

                    let idStr = k.slice(keyPrefix.length);
                    let id = parseInt(idStr, 10);

                    if (isNaN(id)) {
                        continue;
                    }

                    let str = Buffer.from(entry.value as Uint8Array).toString('utf8');

                    idToString.set(id, str);
                    stringToId.set(str, id);

                    if (id > maxId) {
                        maxId = id;
                    }
                }
            }
            catch {
                // DB may not have entries yet
            }

            nextId = maxId + 1;
        },
    };
};


const createCodec = (schemaStore?: SchemaStoreInterface, options?: { compression?: boolean }, internPool?: InternPool): { decode(buffer: Uint8Array, length?: number): unknown; decodeAt(buffer: Buffer, offset: number): unknown; encode(value: unknown): Uint8Array } => {
    let compression = options?.compression ?? false,
        encodeBuf = Buffer.alloc(65536),
        registry = createRegistry(),
        sbcHelpers = {
            decodeSbc: (buf: Buffer, offset: number, len: number): unknown => decodeSbc(buf, offset, len),
            encodeSbc: (value: unknown, buf: Buffer, pos: number): number => encodeSbc(value, buf, pos),
        };

    let internDecode = internPool?.decode,
        internEncode = internPool?.encode,
        internFieldSet = internPool?.fields;

    // Wire helpers into schema store so compiled decoders can call decodeSbc/encodeSbc
    if (schemaStore && (schemaStore as unknown as { _setHelpers?: unknown })._setHelpers) {
        (schemaStore as unknown as { _setHelpers(h: typeof sbcHelpers): void })._setHelpers(sbcHelpers);
    }

    // Wire intern pool into schema store so schemas loaded from DB get intern-aware compile
    if (schemaStore && internPool && (schemaStore as unknown as { _setIntern?: unknown })._setIntern) {
        (schemaStore as unknown as { _setIntern(pool: InternPool): void })._setIntern(internPool);
    }

    // Tag table:
    // 0 = null, 246 = hash-referenced object, 248 = bigint,
    // 249 = array, 250 = date, 251 = boolean, 252 = number,
    // 253 = string, 254 = bytes (Uint8Array)

    function decodeSbc(buf: Buffer, offset: number, len: number): unknown {
        if (len === 0) {
            return undefined;
        }

        let tag = buf[offset]!;

        switch (tag) {
            case 0:
                return null;

            case 248:
                return buf.readBigInt64LE(offset + 1);

            case 249: {
                let count = buf.readUInt16LE(offset + 1);
                let arr = new Array(count);
                let p = offset + 3;

                for (let i = 0; i < count; i++) {
                    let elemTag = buf[p]!;
                    let elemEnd = decodeTagEnd(buf, p, elemTag);

                    arr[i] = decodeSbc(buf, p, elemEnd - p);
                    p = elemEnd;
                }

                return arr;
            }

            case 250:
                return new Date(buf.readDoubleLE(offset + 1));

            case 251:
                return !!buf[offset + 1];

            case 252:
                return buf.readDoubleLE(offset + 1);

            case 253: {
                let sLen = buf.readUInt32LE(offset + 1);

                return (buf as unknown as { utf8Slice(start: number, end: number): string }).utf8Slice(offset + 5, offset + 5 + sLen);
            }

            case 254: {
                let bLen = buf.readUInt32LE(offset + 1);

                return Buffer.from(buf.subarray(offset + 5, offset + 5 + bLen));
            }

            case 245: {
                // Compressed hash-referenced object: [245][u32 hash][u32 len][compressed_field_values...]
                let hash = buf.readUInt32LE(offset + 1);
                let schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema) {
                    return null;
                }

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                // Compressed data but no compressed decoder compiled — compile on demand
                if (schema.compressible && !schema.compressedDecodeFn) {
                    schema.compressedDecodeFn = compileCompressedDecoder(schema, registry, sbcHelpers, internFieldSet, internDecode);
                    schema.compressedEncodeFn = compileCompressedEncoder(schema, registry, sbcHelpers, internFieldSet, internEncode);

                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                return null;
            }

            case 246: {
                // Hash-referenced object: [246][u32 hash][u32 len][field_values...]
                let hash = buf.readUInt32LE(offset + 1);
                let schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                return schema.decodeFn(buf, offset + 9);
            }

            default:
                return null;
        }
    }

    function decodeTagEnd(buf: Buffer, offset: number, tag: number): number {
        switch (tag) {
            case 0: return offset + 1;
            case 245: return offset + 9 + buf.readUInt32LE(offset + 5);
            case 248: return offset + 9;
            case 250: return offset + 9;
            case 251: return offset + 2;
            case 252: return offset + 9;
            case 253: return offset + 5 + buf.readUInt32LE(offset + 1);
            case 254: return offset + 5 + buf.readUInt32LE(offset + 1);
            case 246: return offset + 9 + buf.readUInt32LE(offset + 5);
            case 249: {
                let count = buf.readUInt16LE(offset + 1);
                let p = offset + 3;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(buf, p, buf[p]!);
                }

                return p;
            }
            default: {
                // Schema object with u32 length prefix: [tag(1)][u32 len(4)][fields...]
                return offset + 5 + buf.readUInt32LE(offset + 1);
            }
        }
    }

    function encodeSbc(value: unknown, buf: Buffer, pos: number): number {
        if (value === null || value === undefined) {
            buf[pos] = 0;

            return pos + 1;
        }

        switch (typeof value) {
            case 'bigint':
                buf[pos] = 248;
                buf.writeBigInt64LE(value, pos + 1);

                return pos + 9;

            case 'boolean':
                buf[pos] = 251;
                buf[pos + 1] = value ? 1 : 0;

                return pos + 2;

            case 'number':
                buf[pos] = 252;
                buf.writeDoubleLE(value, pos + 1);

                return pos + 9;

            case 'string': {
                buf[pos] = 253;

                let sLen = Buffer.byteLength(value);

                buf.writeUInt32LE(sLen, pos + 1);
                (buf as unknown as { utf8Write(str: string, offset: number, length: number): number }).utf8Write(value, pos + 5, sLen);

                return pos + 5 + sLen;
            }

            case 'object': {
                if (value instanceof Date) {
                    buf[pos] = 250;
                    buf.writeDoubleLE(value.getTime(), pos + 1);

                    return pos + 9;
                }

                // Typed arrays (Float32Array, Int16Array, etc.) — encode with typed-array-codec header
                // The get() path checks for TYPED_ARRAY_MAGIC before calling SBC decode
                if (ArrayBuffer.isView(value) && !(value instanceof DataView) && getTypedArrayType(value as Parameters<typeof getTypedArrayType>[0]) !== -1) {
                    let encoded = encodeTypedArray(value as Parameters<typeof encodeTypedArray>[0]);

                    buf.set(encoded, pos);

                    return pos + encoded.length;
                }

                if (value instanceof Uint8Array) {
                    buf[pos] = 254;
                    buf.writeUInt32LE(value.length, pos + 1);
                    buf.set(value, pos + 5);

                    return pos + 5 + value.length;
                }

                if (Array.isArray(value)) {
                    buf[pos] = 249;
                    buf.writeUInt16LE(value.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = value.length; i < n; i++) {
                        p = encodeSbc(value[i], buf, p);
                    }

                    return p;
                }

                // Map → encode as array of [key, value] pairs (preserves all key types)
                if (value instanceof Map) {
                    let entries = Array.from(value as Map<unknown, unknown>);

                    buf[pos] = 249;
                    buf.writeUInt16LE(entries.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = entries.length; i < n; i++) {
                        // Each entry as a 2-element array [key, value]
                        buf[p] = 249;
                        buf.writeUInt16LE(2, p + 1);
                        p += 3;
                        p = encodeSbc(entries[i]![0], buf, p);
                        p = encodeSbc(entries[i]![1], buf, p);
                    }

                    return p;
                }

                // Set → encode as array
                if (value instanceof Set) {
                    let arr = Array.from(value as Set<unknown>);

                    buf[pos] = 249;
                    buf.writeUInt16LE(arr.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = arr.length; i < n; i++) {
                        p = encodeSbc(arr[i], buf, p);
                    }

                    return p;
                }

                // Plain object — hash-referenced (tag 246)
                // Wire: [246][u32 hash][u32 len][field_values...]
                let obj = value as Record<string, unknown>;
                let schema = lookupSchema(obj, registry);

                if (!schema) {
                    schema = inferSchema(obj, registry);
                    registerSchema(schema, registry);
                    compileSchema(schema, registry, sbcHelpers, compression, internFieldSet, internEncode, internDecode);

                    if (schemaStore) {
                        schemaStore.register(schema.hash, schema);
                    }
                }

                // Use compressed path if available
                if (compression && schema.compressedEncodeFn) {
                    buf[pos] = 245;
                    buf.writeUInt32LE(schema.hash, pos + 1);

                    let end = schema.compressedEncodeFn(obj, buf, pos + 9);

                    buf.writeUInt32LE(end - pos - 9, pos + 5);

                    return end;
                }

                buf[pos] = 246;
                buf.writeUInt32LE(schema.hash, pos + 1);

                let end = schema.encodeFn!(obj, buf, pos + 9);

                buf.writeUInt32LE(end - pos - 9, pos + 5);

                return end;
            }

            default:
                buf[pos] = 0;

                return pos + 1;
        }
    }

    return {
        decode(buffer: Uint8Array, length?: number): unknown {
            let len = length ?? buffer.length;

            // Fast path: if root tag is a hash-referenced object (246) and the
            // schema is already cached, decode directly without copying. The copy
            // is only needed when schemaStore.get() triggers getBinary (cache miss),
            // which clobbers the shared getValueBytes buffer.
            if (len >= 9 && (buffer[0] === 245 || buffer[0] === 246) && schemaStore) {
                let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0;

                if (schemaStore.has(hash)) {
                    return decodeSbc(buffer as Buffer, 0, len);
                }
            }
            else if (len > 0 && buffer[0] !== 245 && buffer[0] !== 246) {
                // Non-object primitives (string, number, etc.) never trigger schema lookup
                return decodeSbc(buffer as Buffer, 0, len);
            }

            // Slow path: copy buffer to protect against clobbering during schema lookup
            let buf = Buffer.allocUnsafe(len);

            (buffer instanceof Buffer ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, len)).copy(buf, 0, 0, len);

            return decodeSbc(buf, 0, len);
        },

        decodeAt(buffer: Buffer, offset: number): unknown {
            return decodeSbc(buffer, offset, buffer.length - offset);
        },

        encode(value: unknown): Uint8Array {
            let end: number;

            try {
                end = encodeSbc(value, encodeBuf, 0);
            }
            catch {
                // Buffer overflow — grow to at least 4x or 1MB, whichever is larger
                let newSize = Math.max(encodeBuf.length * 4, 1048576);

                encodeBuf = Buffer.alloc(newSize);
                end = encodeSbc(value, encodeBuf, 0);
            }

            let result = Buffer.allocUnsafe(end);

            encodeBuf.copy(result as Buffer, 0, 0, end);

            return result;
        },
    };
};


export { compileSchema, createCodec, createRegistry, deserializeRegistry, inferFieldType, inferSchema, lookupSchema, parseFieldType, registerSchema, resolveSchema, serializeFieldType, serializeRegistry };
export type { ArrayFieldType, FieldDef, FieldType, NullableFieldType, ObjectFieldType, Schema, SchemaRegistry };
