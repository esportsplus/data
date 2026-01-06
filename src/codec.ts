import { PACKAGE } from './constants';


interface Codec<T> {
    decode: (buffer: Uint8Array) => T;
    encode: (data: T) => Uint8Array;
}


function codec<T>(_defaults?: Partial<T>): Codec<T> {
    throw new Error(
        `${PACKAGE}: codec<T>() must be transformed at compile-time. ` +
        'Ensure the validation plugin is configured in your build tool.'
    );
}


export { codec };
export type { Codec };
