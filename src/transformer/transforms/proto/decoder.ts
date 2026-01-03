import type { AnalyzedProperty, AnalyzedType } from '~/transformer/type-analyzer';
import { mapFields, type MappedField } from './field-mapper';
import {
    getProtoFieldInfo,
    WIRE_TYPE_32BIT,
    WIRE_TYPE_64BIT,
    WIRE_TYPE_LENGTH_DELIMITED,
    WIRE_TYPE_VARINT
} from './type-mapper';


let decoderCount = 0,
    nestedDecoders: string[] = [];


function generateArrayDecode(
    field: MappedField,
    resultVar: string
): string {
    let itemType = field.property.itemType!,
        fieldInfo = getProtoFieldInfo(field.property);

    if (fieldInfo.packed) {
        let itemInfo = getProtoFieldInfo(itemType);

        switch (itemInfo.wireType) {
            case WIRE_TYPE_VARINT:
                if (itemType.type === 'bigint') {
                    return `
                        let [_len, _newOff] = _readVarint(_buffer, _offset);

                        _offset = _newOff;

                        let _end = _offset + _len;

                        while (_offset < _end) {
                            let [_v, _o] = _readBigInt(_buffer, _offset);

                            ${resultVar}.push(_v);
                            _offset = _o;
                        }
                    `;
                }

                if (itemType.type === 'boolean') {
                    return `
                        let [_len, _newOff] = _readVarint(_buffer, _offset);

                        _offset = _newOff;

                        let _end = _offset + _len;

                        while (_offset < _end) {
                            let [_v, _o] = _readVarint(_buffer, _offset);

                            ${resultVar}.push(_v !== 0);
                            _offset = _o;
                        }
                    `;
                }

                return `
                    let [_len, _newOff] = _readVarint(_buffer, _offset);

                    _offset = _newOff;

                    let _end = _offset + _len;

                    while (_offset < _end) {
                        let [_v, _o] = _readVarint(_buffer, _offset);

                        ${resultVar}.push(_v);
                        _offset = _o;
                    }
                `;

            case WIRE_TYPE_32BIT:
                // Pre-allocate exact count (4 bytes per float)
                return `
                    let [_len, _newOff] = _readVarint(_buffer, _offset);

                    _offset = _newOff;

                    let _count = _len >>> 2,
                        _arr = new Array(_count);

                    for (let _i = 0; _i < _count; _i++) {
                        let [_v, _o] = _readFloat(_buffer, _offset);

                        _arr[_i] = _v;
                        _offset = _o;
                    }

                    ${resultVar} = _arr;
                `;

            case WIRE_TYPE_64BIT:
                // Pre-allocate exact count (8 bytes per double)
                return `
                    let [_len, _newOff] = _readVarint(_buffer, _offset);

                    _offset = _newOff;

                    let _count = _len >>> 3,
                        _arr = new Array(_count);

                    for (let _i = 0; _i < _count; _i++) {
                        let [_v, _o] = _readDouble(_buffer, _offset);

                        _arr[_i] = _v;
                        _offset = _o;
                    }

                    ${resultVar} = _arr;
                `;
        }
    }

    // Non-packed repeated fields - single item at a time
    switch (itemType.type) {
        case 'string':
            return `
                let [_v, _o] = _readString(_buffer, _offset);

                ${resultVar}.push(_v);
                _offset = _o;
            `;

        case 'object':
            if (itemType.properties && itemType.properties.length > 0) {
                let decoderName = generateNestedDecoder(itemType.properties);

                return `
                    let [_len, _newOff] = _readVarint(_buffer, _offset);

                    _offset = _newOff;

                    let [_v, _o] = ${decoderName}(_buffer, _offset, _offset + _len);

                    ${resultVar}.push(_v);
                    _offset = _o;
                `;
            }

            return '';

        default:
            return '';
    }
}

function generateFieldDecode(
    field: MappedField,
    resultVar: string
): string {
    let prop = field.property;

    if (prop.type === 'array') {
        return generateArrayDecode(field, `${resultVar}['${field.name}']`);
    }

    switch (field.wireType) {
        case WIRE_TYPE_VARINT:
            if (prop.type === 'bigint') {
                return `
                    let [_v, _o] = _readBigInt(_buffer, _offset);

                    ${resultVar}['${field.name}'] = _v;
                    _offset = _o;
                `;
            }

            if (prop.type === 'boolean') {
                return `
                    let [_v, _o] = _readVarint(_buffer, _offset);

                    ${resultVar}['${field.name}'] = _v !== 0;
                    _offset = _o;
                `;
            }

            return `
                let [_v, _o] = _readVarint(_buffer, _offset);

                ${resultVar}['${field.name}'] = _v;
                _offset = _o;
            `;

        case WIRE_TYPE_64BIT:
            return `
                let [_v, _o] = _readDouble(_buffer, _offset);

                ${resultVar}['${field.name}'] = _v;
                _offset = _o;
            `;

        case WIRE_TYPE_32BIT:
            return `
                let [_v, _o] = _readFloat(_buffer, _offset);

                ${resultVar}['${field.name}'] = _v;
                _offset = _o;
            `;

        case WIRE_TYPE_LENGTH_DELIMITED:
            if (prop.type === 'string') {
                return `
                    let [_v, _o] = _readString(_buffer, _offset);

                    ${resultVar}['${field.name}'] = _v;
                    _offset = _o;
                `;
            }

            if (prop.type === 'object' && prop.properties && prop.properties.length > 0) {
                let decoderName = generateNestedDecoder(prop.properties);

                return `
                    let [_len, _newOff] = _readVarint(_buffer, _offset);

                    _offset = _newOff;

                    let [_v, _o] = ${decoderName}(_buffer, _offset, _offset + _len);

                    ${resultVar}['${field.name}'] = _v;
                    _offset = _o;
                `;
            }

            return '';

        default:
            return '';
    }
}

function generateNestedDecoder(properties: AnalyzedProperty[]): string {
    let name = `_dec${decoderCount++}`,
        fields = mapFields(properties),
        caseParts: string[] = [],
        initParts: string[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i];

        // Initialize arrays
        if (field.property.type === 'array') {
            initParts.push(`'${field.name}': []`);
        }

        caseParts.push(`
            case ${field.tag}: {
                ${generateFieldDecode(field, '_result')}
                break;
            }
        `);
    }

    nestedDecoders.push(`
        function ${name}(_buffer, _offset, _end) {
            let _result = { ${initParts.join(', ')} };

            while (_offset < _end) {
                let _tag = _buffer[_offset++];

                switch (_tag) {
                    ${caseParts.join('\n')}

                    default:
                        let _wireType = _tag & 0x7;

                        if (_wireType === 0) {
                            while (_buffer[_offset++] & 0x80) {}
                        }
                        else if (_wireType === 1) {
                            _offset += 8;
                        }
                        else if (_wireType === 2) {
                            let [_len, _o] = _readVarint(_buffer, _offset);

                            _offset = _o + _len;
                        }
                        else if (_wireType === 5) {
                            _offset += 4;
                        }

                        break;
                }
            }

            return [_result, _offset];
        }
    `);

    return name;
}


const generateDecoder = (type: AnalyzedType): string => {
    nestedDecoders = [];
    decoderCount = 0;

    let fields = mapFields(type.properties),
        caseParts: string[] = [],
        initParts: string[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i];

        // Initialize arrays
        if (field.property.type === 'array') {
            initParts.push(`'${field.name}': []`);
        }

        caseParts.push(`
            case ${field.tag}: {
                ${generateFieldDecode(field, '_result')}
                break;
            }
        `);
    }

    return `
        ((_buffer) => {
            ${nestedDecoders.join('\n')}

            let _result = { ${initParts.join(', ')} },
                _offset = 0,
                _end = _buffer.length;

            while (_offset < _end) {
                let _tag = _buffer[_offset++];

                switch (_tag) {
                    ${caseParts.join('\n')}

                    default:
                        let _wireType = _tag & 0x7;

                        if (_wireType === 0) {
                            while (_buffer[_offset++] & 0x80) {}
                        }
                        else if (_wireType === 1) {
                            _offset += 8;
                        }
                        else if (_wireType === 2) {
                            let [_len, _o] = _readVarint(_buffer, _offset);

                            _offset = _o + _len;
                        }
                        else if (_wireType === 5) {
                            _offset += 4;
                        }

                        break;
                }
            }

            return _result;
        })
    `;
};


export { generateDecoder };
