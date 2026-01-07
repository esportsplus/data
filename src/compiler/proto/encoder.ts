import { WIRE_TYPE_32BIT, WIRE_TYPE_64BIT, WIRE_TYPE_LENGTH_DELIMITED, WIRE_TYPE_VARINT, getProtoFieldInfo } from './type-mapper';
import type { AnalyzedProperty, AnalyzedType } from '~/compiler/type-analyzer';
import type { MappedField } from './field-mapper';
import { mapFields } from './field-mapper';


let encoderCount = 0,
    nestedEncoders: string[] = [];


function generateArraySizeCalc(field: MappedField, accessor: string): string {
    let itemType = field.property.itemType!;

    if (getProtoFieldInfo(field.property).packed) {
        // Packed encoding
        switch (getProtoFieldInfo(itemType).wireType) {
            case WIRE_TYPE_VARINT:
                if (itemType.type === 'bigint') {
                    return `
                        // field ${field.fieldNumber}: packed ${itemType.type}[]
                        if (${accessor}.length > 0) {
                            let _ps${field.fieldNumber} = 0;

                            for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                                _ps${field.fieldNumber} += _bigIntVarintSize(${accessor}[_i]);
                            }

                            _size += 1 + _varintSize(_ps${field.fieldNumber}) + _ps${field.fieldNumber};
                        }
                    `;
                }

                return `
                    // field ${field.fieldNumber}: packed ${itemType.type}[]
                    if (${accessor}.length > 0) {
                        let _ps${field.fieldNumber} = 0;

                        for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                            _ps${field.fieldNumber} += _varintSize(${accessor}[_i]${itemType.type === 'boolean' ? ' ? 1 : 0' : ''});
                        }

                        _size += 1 + _varintSize(_ps${field.fieldNumber}) + _ps${field.fieldNumber};
                    }
                `;

            case WIRE_TYPE_32BIT:
                return `
                    // field ${field.fieldNumber}: packed float[]
                    if (${accessor}.length > 0) {
                        let _ps${field.fieldNumber} = ${accessor}.length * 4;

                        _size += 1 + _varintSize(_ps${field.fieldNumber}) + _ps${field.fieldNumber};
                    }
                `;

            case WIRE_TYPE_64BIT:
                return `
                    // field ${field.fieldNumber}: packed double[]
                    if (${accessor}.length > 0) {
                        let _ps${field.fieldNumber} = ${accessor}.length * 8;

                        _size += 1 + _varintSize(_ps${field.fieldNumber}) + _ps${field.fieldNumber};
                    }
                `;
        }
    }

    // Non-packed repeated field
    switch (itemType.type) {
        // Cache encoded strings for reuse in write phase
        case 'string':
            return `
                // field ${field.fieldNumber}: repeated string
                let _sa${field.fieldNumber} = new Array(${accessor}.length);

                for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                    let _s = _textEncoder.encode(${accessor}[_i]);

                    _sa${field.fieldNumber}[_i] = _s;
                    _size += 1 + _varintSize(_s.length) + _s.length;
                }
            `;

        case 'object':
            if (itemType.properties && itemType.properties.length > 0) {
                let encoderName = generateNestedEncoder(itemType.properties);

                return `
                    // field ${field.fieldNumber}: repeated message
                    for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                        let _ms = ${encoderName}_size(${accessor}[_i]);

                        _size += 1 + _varintSize(_ms) + _ms;
                    }
                `;
            }

            return '';

        default:
            return '';
    }
}

function generateArrayWrite(field: MappedField, accessor: string): string {
    let itemType = field.property.itemType!;

    if (getProtoFieldInfo(field.property).packed) {
        switch (getProtoFieldInfo(itemType).wireType) {
            case WIRE_TYPE_VARINT:
                if (itemType.type === 'bigint') {
                    return `
                        // field ${field.fieldNumber}: packed bigint[]
                        if (${accessor}.length > 0) {
                            _buffer[_offset++] = ${field.tag};

                            let _ps${field.fieldNumber} = 0;

                            for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                                _ps${field.fieldNumber} += _bigIntVarintSize(${accessor}[_i]);
                            }

                            _offset = _writeVarint(_buffer, _offset, _ps${field.fieldNumber});

                            for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                                _offset = _writeBigInt(_buffer, _offset, ${accessor}[_i]);
                            }
                        }
                    `;
                }

                return `
                    // field ${field.fieldNumber}: packed ${itemType.type}[]
                    if (${accessor}.length > 0) {
                        _buffer[_offset++] = ${field.tag};

                        let _ps${field.fieldNumber} = 0;

                        for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                            _ps${field.fieldNumber} += _varintSize(${accessor}[_i]${itemType.type === 'boolean' ? ' ? 1 : 0' : ''});
                        }

                        _offset = _writeVarint(_buffer, _offset, _ps${field.fieldNumber});

                        for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                            _offset = _writeVarint(_buffer, _offset, ${accessor}[_i]${itemType.type === 'boolean' ? ' ? 1 : 0' : ''});
                        }
                    }
                `;

            case WIRE_TYPE_32BIT:
                return `
                    // field ${field.fieldNumber}: packed float[]
                    if (${accessor}.length > 0) {
                        _buffer[_offset++] = ${field.tag};

                        let _ps${field.fieldNumber} = ${accessor}.length * 4;

                        _offset = _writeVarint(_buffer, _offset, _ps${field.fieldNumber});

                        for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                            _offset = _writeFloat(_buffer, _offset, ${accessor}[_i]);
                        }
                    }
                `;

            case WIRE_TYPE_64BIT:
                return `
                    // field ${field.fieldNumber}: packed double[]
                    if (${accessor}.length > 0) {
                        _buffer[_offset++] = ${field.tag};

                        let _ps${field.fieldNumber} = ${accessor}.length * 8;

                        _offset = _writeVarint(_buffer, _offset, _ps${field.fieldNumber});

                        for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                            _offset = _writeDouble(_buffer, _offset, ${accessor}[_i]);
                        }
                    }
                `;
        }
    }

    // Non-packed repeated field
    switch (itemType.type) {
        // Reuse cached encoded strings from size calculation phase
        case 'string':
            return `
                // field ${field.fieldNumber}: repeated string
                for (let _i = 0, _n = _sa${field.fieldNumber}.length; _i < _n; _i++) {
                    let _s = _sa${field.fieldNumber}[_i];

                    _buffer[_offset++] = ${field.tag};
                    _offset = _writeVarint(_buffer, _offset, _s.length);
                    _buffer.set(_s, _offset);
                    _offset += _s.length;
                }
            `;

        case 'object':
            if (itemType.properties && itemType.properties.length > 0) {
                let encoderName = generateNestedEncoder(itemType.properties);

                return `
                    // field ${field.fieldNumber}: repeated message
                    for (let _i = 0, _n = ${accessor}.length; _i < _n; _i++) {
                        _buffer[_offset++] = ${field.tag};

                        let _ms = ${encoderName}_size(${accessor}[_i]);

                        _offset = _writeVarint(_buffer, _offset, _ms);
                        _offset = ${encoderName}_write(_buffer, _offset, ${accessor}[_i]);
                    }
                `;
            }

            return '';

        default:
            return '';
    }
}

function generateFieldSizeCalc(field: MappedField, accessor: string): string {
    let prop = field.property;

    if (prop.type === 'array') {
        return generateArraySizeCalc(field, accessor);
    }

    switch (field.wireType) {
        case WIRE_TYPE_VARINT:
            if (prop.type === 'bigint') {
                return `
                    // field ${field.fieldNumber}: int64
                    _size += 1 + _bigIntVarintSize(${accessor});
                `;
            }

            if (prop.type === 'boolean') {
                return `
                    // field ${field.fieldNumber}: bool
                    _size += 2;
                `;
            }

            return `
                // field ${field.fieldNumber}: int32
                _size += 1 + _varintSize(${accessor});
            `;

        case WIRE_TYPE_64BIT:
            return `
                // field ${field.fieldNumber}: double
                _size += 9;
            `;

        case WIRE_TYPE_32BIT:
            return `
                // field ${field.fieldNumber}: float
                _size += 5;
            `;

        case WIRE_TYPE_LENGTH_DELIMITED:
            if (prop.type === 'string') {
                return `
                    // field ${field.fieldNumber}: string
                    let _s${field.fieldNumber} = _textEncoder.encode(${accessor});

                    _size += 1 + _varintSize(_s${field.fieldNumber}.length) + _s${field.fieldNumber}.length;
                `;
            }

            if (prop.type === 'object' && prop.properties && prop.properties.length > 0) {
                return `
                    // field ${field.fieldNumber}: message
                    let _ms${field.fieldNumber} = ${generateNestedEncoder(prop.properties)}_size(${accessor});

                    _size += 1 + _varintSize(_ms${field.fieldNumber}) + _ms${field.fieldNumber};
                `;
            }

            return '';

        default:
            return '';
    }
}

function generateFieldWrite(field: MappedField, accessor: string): string {
    let prop = field.property;

    if (prop.type === 'array') {
        return generateArrayWrite(field, accessor);
    }

    switch (field.wireType) {
        case WIRE_TYPE_VARINT:
            if (prop.type === 'bigint') {
                return `
                    // field ${field.fieldNumber}: int64
                    _buffer[_offset++] = ${field.tag};
                    _offset = _writeBigInt(_buffer, _offset, ${accessor});
                `;
            }

            if (prop.type === 'boolean') {
                return `
                    // field ${field.fieldNumber}: bool
                    _buffer[_offset++] = ${field.tag};
                    _buffer[_offset++] = ${accessor} ? 1 : 0;
                `;
            }

            return `
                // field ${field.fieldNumber}: int32
                _buffer[_offset++] = ${field.tag};
                _offset = _writeVarint(_buffer, _offset, ${accessor});
            `;

        case WIRE_TYPE_64BIT:
            return `
                // field ${field.fieldNumber}: double
                _buffer[_offset++] = ${field.tag};
                _offset = _writeDouble(_buffer, _offset, ${accessor});
            `;

        case WIRE_TYPE_32BIT:
            return `
                // field ${field.fieldNumber}: float
                _buffer[_offset++] = ${field.tag};
                _offset = _writeFloat(_buffer, _offset, ${accessor});
            `;

        case WIRE_TYPE_LENGTH_DELIMITED:
            // Reuse cached encoded bytes from size calculation phase
            if (prop.type === 'string') {
                return `
                    // field ${field.fieldNumber}: string
                    _buffer[_offset++] = ${field.tag};
                    _offset = _writeVarint(_buffer, _offset, _s${field.fieldNumber}.length);
                    _buffer.set(_s${field.fieldNumber}, _offset);
                    _offset += _s${field.fieldNumber}.length;
                `;
            }

            if (prop.type === 'object' && prop.properties && prop.properties.length > 0) {
                let encoderName = generateNestedEncoder(prop.properties);

                return `
                    // field ${field.fieldNumber}: message
                    _buffer[_offset++] = ${field.tag};

                    let _ms${field.fieldNumber} = ${encoderName}_size(${accessor});

                    _offset = _writeVarint(_buffer, _offset, _ms${field.fieldNumber});
                    _offset = ${encoderName}_write(_buffer, _offset, ${accessor});
                `;
            }

            return '';

        default:
            return '';
    }
}

function processFields(
    fields: MappedField[],
    accessor: (name: string) => string
): { sizeCalcParts: string[]; writeParts: string[] } {
    let sizeCalcParts: string[] = [],
        writeParts: string[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i],
            fieldAccessor = accessor(field.name),
            sizeCode = generateFieldSizeCalc(field, fieldAccessor),
            writeCode = generateFieldWrite(field, fieldAccessor);

        if (field.optional) {
            if (sizeCode) {
                sizeCalcParts.push(`
                    if (${fieldAccessor} !== undefined) {
                        ${sizeCode}
                    }
                `);
            }

            if (writeCode) {
                writeParts.push(`
                    if (${fieldAccessor} !== undefined) {
                        ${writeCode}
                    }
                `);
            }
        }
        else {
            if (sizeCode) {
                sizeCalcParts.push(sizeCode);
            }

            if (writeCode) {
                writeParts.push(writeCode);
            }
        }
    }

    return { sizeCalcParts, writeParts };
}

function generateNestedEncoder(properties: AnalyzedProperty[]): string {
    let { sizeCalcParts, writeParts } = processFields(mapFields(properties), (n) => `_d['${n}']`),
        name = `_enc${encoderCount++}`;

    nestedEncoders.push(`
        function ${name}_size(_d) {
            let _size = 0;

            ${sizeCalcParts.join('\n')}

            return _size;
        }

        function ${name}_write(_buffer, _offset, _d) {
            ${writeParts.join('\n')}

            return _offset;
        }
    `);

    return name;
}


const generateEncoder = (type: AnalyzedType): string => {
    nestedEncoders = [];
    encoderCount = 0;

    let { sizeCalcParts, writeParts } = processFields(mapFields(type.properties), (n) => `_data['${n}']`);

    return `
        ((_data) => {
            ${nestedEncoders.join('\n')}

            let _size = 0;

            ${sizeCalcParts.join('\n')}

            let _buffer = new Uint8Array(_size),
                _offset = 0;

            ${writeParts.join('\n')}

            return _buffer;
        })
    `;
};


export { generateEncoder };
