// Typed array codec — stores typed arrays with a 4-byte header
// for zero-copy retrieval without serialization overhead.
//
// Header format:
//   Byte 0: 0xTA (magic marker — 0x54)
//   Byte 1: element type enum
//   Byte 2-3: reserved (zero)
//
// Followed by raw typed array bytes (native endianness).


// Enum values are serialized to disk — do NOT reorder (wire format)
const enum TypedArrayType {
    Float32 = 0,
    Float64 = 1,
    Int8 = 2,
    Int16 = 3,
    Int32 = 4,
    Uint8 = 5,
    Uint8Clamped = 6,
    Uint16 = 7,
    Uint32 = 8,
    BigInt64 = 9,
    BigUint64 = 10,
}

type TypedArrayInstance =
    | BigInt64Array
    | BigUint64Array
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint8ClampedArray
    | Uint16Array
    | Uint32Array;

interface TypedArrayConstructor {
    new (buffer: ArrayBuffer, byteOffset: number, length: number): TypedArrayInstance;
    BYTES_PER_ELEMENT: number;
}


const TYPED_ARRAY_MARKER = 0x54;

// Each typed array constructor's (buffer, offset, length) overload satisfies this interface.
// The union avoids 11 `as unknown as` casts while preserving the shared BYTES_PER_ELEMENT + new() shape.
// Array index must match TypedArrayType enum values — do NOT reorder (wire format)
let constructors: readonly TypedArrayConstructor[] = Object.freeze([
        Float32Array as TypedArrayConstructor,
        Float64Array as TypedArrayConstructor,
        Int8Array as TypedArrayConstructor,
        Int16Array as TypedArrayConstructor,
        Int32Array as TypedArrayConstructor,
        Uint8Array as TypedArrayConstructor,
        Uint8ClampedArray as TypedArrayConstructor,
        Uint16Array as TypedArrayConstructor,
        Uint32Array as TypedArrayConstructor,
        BigInt64Array as TypedArrayConstructor,
        BigUint64Array as TypedArrayConstructor,
    ]),
    typedArrayTypeMap = new Map<TypedArrayConstructor, TypedArrayType>([
        [BigInt64Array, TypedArrayType.BigInt64],
        [BigUint64Array, TypedArrayType.BigUint64],
        [Float32Array, TypedArrayType.Float32],
        [Float64Array, TypedArrayType.Float64],
        [Int8Array, TypedArrayType.Int8],
        [Int16Array, TypedArrayType.Int16],
        [Int32Array, TypedArrayType.Int32],
        [Uint8Array, TypedArrayType.Uint8],
        [Uint8ClampedArray, TypedArrayType.Uint8Clamped],
        [Uint16Array, TypedArrayType.Uint16],
        [Uint32Array, TypedArrayType.Uint32],
    ]);


const decodeTypedArray = (bytes: Uint8Array): TypedArrayInstance | null => {
    if (bytes.length < 4 || bytes[0] !== TYPED_ARRAY_MARKER) {
        return null;
    }

    let type = bytes[1] as TypedArrayType;

    if (type < 0 || type >= constructors.length) {
        return null;
    }

    let Ctor = constructors[type]!,
        dataLen = bytes.length - 4;

    if (dataLen % Ctor.BYTES_PER_ELEMENT !== 0) {
        return null;
    }

    // Always copy to isolate decoded typed arrays from reusable read buffers.
    // This preserves value stability across subsequent reads.
    let aligned = new Uint8Array(dataLen);

    aligned.set(new Uint8Array(bytes.buffer, bytes.byteOffset + 4, dataLen));

    return new Ctor(aligned.buffer, 0, dataLen / Ctor.BYTES_PER_ELEMENT);
};

const encodeTypedArrayInto = (value: ArrayBufferView, buf: Uint8Array, pos: number): number => {
    let typeId = getTypedArrayType(value);

    if (typeId === -1) {
        return -1;
    }

    let byteLen = value.byteLength;

    buf[pos] = TYPED_ARRAY_MARKER;
    buf[pos + 1] = typeId;
    buf[pos + 2] = 0;
    buf[pos + 3] = 0;

    if (value instanceof Uint8Array) {
        buf.set(value, pos + 4);
    }
    else {
        buf.set(new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, byteLen), pos + 4);
    }

    return pos + 4 + byteLen;
};

const getTypedArrayType = (value: unknown): TypedArrayType | -1 => {
    if (value && typeof value === 'object') {
        return typedArrayTypeMap.get((value as { constructor: TypedArrayConstructor }).constructor) ?? -1;
    }

    return -1;
};


export { TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType };
