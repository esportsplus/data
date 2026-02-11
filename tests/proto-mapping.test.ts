import { describe, expect, it } from 'vitest';
import { getFieldTag, getProtoFieldInfo, WIRE_TYPE_32BIT, WIRE_TYPE_64BIT, WIRE_TYPE_LENGTH_DELIMITED, WIRE_TYPE_VARINT } from '../src/compiler/proto/type-mapper';
import { mapFields } from '../src/compiler/proto/field-mapper';
import type { AnalyzedProperty } from '../src/compiler/type-analyzer';


// --- Helper to create AnalyzedProperty ---

function prop(name: string, type: string, overrides: Partial<AnalyzedProperty> = {}): AnalyzedProperty {
    return {
        brand: undefined,
        itemType: undefined,
        name,
        optional: false,
        properties: undefined,
        type: type as AnalyzedProperty['type'],
        ...overrides
    };
}


// --- Wire Type Constants ---

describe('Proto: Wire Type Constants', () => {
    it('WIRE_TYPE_VARINT is 0', () => {
        expect(WIRE_TYPE_VARINT).toBe(0);
    });

    it('WIRE_TYPE_64BIT is 1', () => {
        expect(WIRE_TYPE_64BIT).toBe(1);
    });

    it('WIRE_TYPE_LENGTH_DELIMITED is 2', () => {
        expect(WIRE_TYPE_LENGTH_DELIMITED).toBe(2);
    });

    it('WIRE_TYPE_32BIT is 5', () => {
        expect(WIRE_TYPE_32BIT).toBe(5);
    });
});


// --- getFieldTag ---

describe('Proto: getFieldTag', () => {
    it('encodes field number and wire type into tag', () => {
        // tag = (fieldNumber << 3) | wireType
        expect(getFieldTag(1, WIRE_TYPE_VARINT)).toBe((1 << 3) | 0);
        expect(getFieldTag(1, WIRE_TYPE_64BIT)).toBe((1 << 3) | 1);
        expect(getFieldTag(1, WIRE_TYPE_LENGTH_DELIMITED)).toBe((1 << 3) | 2);
        expect(getFieldTag(1, WIRE_TYPE_32BIT)).toBe((1 << 3) | 5);
    });

    it('encodes higher field numbers correctly', () => {
        expect(getFieldTag(2, WIRE_TYPE_VARINT)).toBe((2 << 3) | 0);
        expect(getFieldTag(5, WIRE_TYPE_LENGTH_DELIMITED)).toBe((5 << 3) | 2);
        expect(getFieldTag(10, WIRE_TYPE_64BIT)).toBe((10 << 3) | 1);
    });

    it('field 1 varint tag is 8', () => {
        expect(getFieldTag(1, WIRE_TYPE_VARINT)).toBe(8);
    });

    it('field 1 string tag is 10', () => {
        expect(getFieldTag(1, WIRE_TYPE_LENGTH_DELIMITED)).toBe(10);
    });

    it('field 2 varint tag is 16', () => {
        expect(getFieldTag(2, WIRE_TYPE_VARINT)).toBe(16);
    });
});


// --- getProtoFieldInfo ---

describe('Proto: getProtoFieldInfo', () => {
    describe('scalar types', () => {
        it('maps bigint to int64 (varint)', () => {
            let info = getProtoFieldInfo(prop('x', 'bigint'));

            expect(info.protoType).toBe('int64');
            expect(info.wireType).toBe(WIRE_TYPE_VARINT);
            expect(info.packed).toBe(false);
        });

        it('maps boolean to bool (varint)', () => {
            let info = getProtoFieldInfo(prop('x', 'boolean'));

            expect(info.protoType).toBe('bool');
            expect(info.wireType).toBe(WIRE_TYPE_VARINT);
            expect(info.packed).toBe(false);
        });

        it('maps number to double (64-bit)', () => {
            let info = getProtoFieldInfo(prop('x', 'number'));

            expect(info.protoType).toBe('double');
            expect(info.wireType).toBe(WIRE_TYPE_64BIT);
            expect(info.packed).toBe(false);
        });

        it('maps integer branded number to int32 (varint)', () => {
            let info = getProtoFieldInfo(prop('x', 'number', { brand: 'integer' }));

            expect(info.protoType).toBe('int32');
            expect(info.wireType).toBe(WIRE_TYPE_VARINT);
            expect(info.packed).toBe(false);
        });

        it('maps float branded number to float (32-bit)', () => {
            let info = getProtoFieldInfo(prop('x', 'number', { brand: 'float' }));

            expect(info.protoType).toBe('float');
            expect(info.wireType).toBe(WIRE_TYPE_32BIT);
            expect(info.packed).toBe(false);
        });

        it('maps string to string (length-delimited)', () => {
            let info = getProtoFieldInfo(prop('x', 'string'));

            expect(info.protoType).toBe('string');
            expect(info.wireType).toBe(WIRE_TYPE_LENGTH_DELIMITED);
            expect(info.packed).toBe(false);
        });

        it('maps object to message (length-delimited)', () => {
            let info = getProtoFieldInfo(prop('x', 'object'));

            expect(info.protoType).toBe('message');
            expect(info.wireType).toBe(WIRE_TYPE_LENGTH_DELIMITED);
            expect(info.packed).toBe(false);
        });
    });

    describe('array types', () => {
        it('marks varint arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'number', { brand: 'integer' })
            }));

            expect(info.packed).toBe(true);
            expect(info.wireType).toBe(WIRE_TYPE_LENGTH_DELIMITED);
        });

        it('marks boolean arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'boolean')
            }));

            expect(info.packed).toBe(true);
        });

        it('marks bigint arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'bigint')
            }));

            expect(info.packed).toBe(true);
        });

        it('marks float arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'number', { brand: 'float' })
            }));

            expect(info.packed).toBe(true);
        });

        it('marks double arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'number')
            }));

            expect(info.packed).toBe(true);
        });

        it('does NOT mark string arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'string')
            }));

            expect(info.packed).toBe(false);
        });

        it('does NOT mark object arrays as packed', () => {
            let info = getProtoFieldInfo(prop('x', 'array', {
                itemType: prop('', 'object')
            }));

            expect(info.packed).toBe(false);
        });
    });

    describe('fallback type', () => {
        it('maps unknown type to bytes (length-delimited)', () => {
            let info = getProtoFieldInfo(prop('x', 'unknown'));

            expect(info.protoType).toBe('bytes');
            expect(info.wireType).toBe(WIRE_TYPE_LENGTH_DELIMITED);
        });
    });
});


// --- mapFields ---

describe('Proto: mapFields', () => {
    it('assigns sequential field numbers starting at 1', () => {
        let fields = mapFields([
            prop('alpha', 'string'),
            prop('beta', 'number'),
            prop('gamma', 'boolean')
        ]);

        expect(fields[0].fieldNumber).toBe(1);
        expect(fields[1].fieldNumber).toBe(2);
        expect(fields[2].fieldNumber).toBe(3);
    });

    it('preserves property names', () => {
        let fields = mapFields([
            prop('email', 'string'),
            prop('name', 'string')
        ]);

        expect(fields[0].name).toBe('email');
        expect(fields[1].name).toBe('name');
    });

    it('preserves optional flag', () => {
        let fields = mapFields([
            prop('required', 'string', { optional: false }),
            prop('optional', 'string', { optional: true })
        ]);

        expect(fields[0].optional).toBe(false);
        expect(fields[1].optional).toBe(true);
    });

    it('computes correct tags', () => {
        let fields = mapFields([
            prop('count', 'number', { brand: 'integer' }),
            prop('name', 'string')
        ]);

        // field 1: integer → varint → tag = (1 << 3) | 0 = 8
        expect(fields[0].tag).toBe(8);
        expect(fields[0].wireType).toBe(WIRE_TYPE_VARINT);

        // field 2: string → length-delimited → tag = (2 << 3) | 2 = 18
        expect(fields[1].tag).toBe(18);
        expect(fields[1].wireType).toBe(WIRE_TYPE_LENGTH_DELIMITED);
    });

    it('handles empty properties array', () => {
        let fields = mapFields([]);

        expect(fields).toEqual([]);
    });

    it('handles single property', () => {
        let fields = mapFields([prop('only', 'string')]);

        expect(fields.length).toBe(1);
        expect(fields[0].fieldNumber).toBe(1);
        expect(fields[0].name).toBe('only');
    });

    it('preserves property reference', () => {
        let original = prop('test', 'string'),
            fields = mapFields([original]);

        expect(fields[0].property).toBe(original);
    });
});
