import type { AnalyzedProperty } from '~/compiler/type-analyzer';


type ProtoFieldInfo = {
    packed: boolean;
    protoType: ProtobufType;
    wireType: WireType;
};

type ProtobufType = 'bool' | 'bytes' | 'double' | 'float' | 'int32' | 'int64' | 'message' | 'string';

type WireType = 0 | 1 | 2 | 5;


// Wire types:
// 0 = Varint (int32, int64, bool, enum)
// 1 = 64-bit (fixed64, double)
// 2 = Length-delimited (string, bytes, embedded messages, packed repeated)
// 5 = 32-bit (fixed32, float)

const WIRE_TYPE_32BIT: WireType = 5;

const WIRE_TYPE_64BIT: WireType = 1;

const WIRE_TYPE_LENGTH_DELIMITED: WireType = 2;

const WIRE_TYPE_VARINT: WireType = 0;


const PROTO_BOOL: ProtoFieldInfo = { packed: false, protoType: 'bool', wireType: WIRE_TYPE_VARINT };

const PROTO_BYTES: ProtoFieldInfo = { packed: false, protoType: 'bytes', wireType: WIRE_TYPE_LENGTH_DELIMITED };

const PROTO_DOUBLE: ProtoFieldInfo = { packed: false, protoType: 'double', wireType: WIRE_TYPE_64BIT };

const PROTO_FLOAT: ProtoFieldInfo = { packed: false, protoType: 'float', wireType: WIRE_TYPE_32BIT };

const PROTO_INT32: ProtoFieldInfo = { packed: false, protoType: 'int32', wireType: WIRE_TYPE_VARINT };

const PROTO_INT64: ProtoFieldInfo = { packed: false, protoType: 'int64', wireType: WIRE_TYPE_VARINT };

const PROTO_MESSAGE: ProtoFieldInfo = { packed: false, protoType: 'message', wireType: WIRE_TYPE_LENGTH_DELIMITED };

const PROTO_STRING: ProtoFieldInfo = { packed: false, protoType: 'string', wireType: WIRE_TYPE_LENGTH_DELIMITED };


const getFieldTag = (fieldNumber: number, wireType: WireType): number => {
    return (fieldNumber << 3) | wireType;
};

const getProtoFieldInfo = (prop: AnalyzedProperty): ProtoFieldInfo => {
    if (prop.type === 'array' && prop.itemType) {
        let itemInfo = getProtoFieldInfo(prop.itemType),
            packed = itemInfo.wireType === WIRE_TYPE_VARINT ||
                     itemInfo.wireType === WIRE_TYPE_32BIT ||
                     itemInfo.wireType === WIRE_TYPE_64BIT;

        return {
            packed,
            protoType: itemInfo.protoType,
            wireType: WIRE_TYPE_LENGTH_DELIMITED
        };
    }

    switch (prop.type) {
        case 'bigint':
            return PROTO_INT64;

        case 'boolean':
            return PROTO_BOOL;

        case 'number':
            if (prop.brand === 'integer') {
                return PROTO_INT32;
            }

            if (prop.brand === 'float') {
                return PROTO_FLOAT;
            }

            return PROTO_DOUBLE;

        case 'object':
            return PROTO_MESSAGE;

        case 'string':
            return PROTO_STRING;

        default:
            return PROTO_BYTES;
    }
};


export { WIRE_TYPE_32BIT, WIRE_TYPE_64BIT, WIRE_TYPE_LENGTH_DELIMITED, WIRE_TYPE_VARINT, getFieldTag, getProtoFieldInfo };
export type { WireType };
