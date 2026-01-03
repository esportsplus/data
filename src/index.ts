import type { Validator } from './types';


const validator: Validator = {
    build: () => {
        throw new Error(
            '@esportsplus/data: validator.build<T>() must be transformed at compile-time. ' +
            'Ensure the validation plugin is configured in your build tool.'
        );
    },
    set: () => {
        throw new Error(
            '@esportsplus/data: validator.set() must be transformed at compile-time. ' +
            'Ensure the validation plugin is configured in your build tool.'
        );
    }
};


export { codec, type Codec } from './codec';
export { validator };
export * from './types';
export * from './validators';
