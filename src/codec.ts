// Codec runtime stub - compile-time only
// This function is replaced at build time by the transformer


interface Codec<T> {
    decode: (buffer: Uint8Array) => T;
    encode: (data: T) => Uint8Array;
}


function codec<T>(_defaults?: Partial<T>): Codec<T> {
    throw new Error(
        '@esportsplus/data: codec<T>() must be transformed at compile-time. ' +
        'Ensure the validation plugin is configured in your build tool.'
    );
}


export { codec };
export type { Codec };
