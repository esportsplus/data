import type { AnalyzedProperty } from '~/transformer/type-analyzer';


type ProtobufType = 'bool' | 'bytes' | 'double' | 'float' | 'int32' | 'int64' | 'message' | 'string';

type WireType = 0 | 1 | 2 | 5;

interface ProtoFieldInfo {
    packed: boolean;
    protoType: ProtobufType;
    wireType: WireType;
}


// Wire types:
// 0 = Varint (int32, int64, bool, enum)
// 1 = 64-bit (fixed64, double)
// 2 = Length-delimited (string, bytes, embedded messages, packed repeated)
// 5 = 32-bit (fixed32, float)

const WIRE_TYPE_32BIT: WireType = 5;

const WIRE_TYPE_64BIT: WireType = 1;

const WIRE_TYPE_LENGTH_DELIMITED: WireType = 2;

const WIRE_TYPE_VARINT: WireType = 0;


function getProtoFieldInfo(prop: AnalyzedProperty): ProtoFieldInfo {
    if (prop.type === 'array' && prop.itemType) {
        let itemInfo = getProtoFieldInfo(prop.itemType);

        // Packed encoding for primitive types
        let packed = itemInfo.wireType === WIRE_TYPE_VARINT ||
                     itemInfo.wireType === WIRE_TYPE_32BIT ||
                     itemInfo.wireType === WIRE_TYPE_64BIT;

        return {
            packed,
            protoType: itemInfo.protoType,
            wireType: WIRE_TYPE_LENGTH_DELIMITED
        };
    }

    switch (prop.type) {
        case 'boolean':
            return {
                packed: false,
                protoType: 'bool',
                wireType: WIRE_TYPE_VARINT
            };

        case 'number':
            if (prop.brand === 'integer') {
                return {
                    packed: false,
                    protoType: 'int32',
                    wireType: WIRE_TYPE_VARINT
                };
            }

            if (prop.brand === 'float') {
                return {
                    packed: false,
                    protoType: 'float',
                    wireType: WIRE_TYPE_32BIT
                };
            }

            // Unbranded number defaults to double
            return {
                packed: false,
                protoType: 'double',
                wireType: WIRE_TYPE_64BIT
            };

        case 'bigint':
            return {
                packed: false,
                protoType: 'int64',
                wireType: WIRE_TYPE_VARINT
            };

        case 'string':
            return {
                packed: false,
                protoType: 'string',
                wireType: WIRE_TYPE_LENGTH_DELIMITED
            };

        case 'object':
            return {
                packed: false,
                protoType: 'message',
                wireType: WIRE_TYPE_LENGTH_DELIMITED
            };

        default:
            return {
                packed: false,
                protoType: 'bytes',
                wireType: WIRE_TYPE_LENGTH_DELIMITED
            };
    }
}

const getFieldTag = (fieldNumber: number, wireType: WireType): number => {
    return (fieldNumber << 3) | wireType;
};


export { getFieldTag, getProtoFieldInfo, WIRE_TYPE_32BIT, WIRE_TYPE_64BIT, WIRE_TYPE_LENGTH_DELIMITED, WIRE_TYPE_VARINT };
export type { ProtoFieldInfo, ProtobufType, WireType };
