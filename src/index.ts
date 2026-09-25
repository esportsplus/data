import { PACKAGE_NAME, UNCOMPILED } from './constants';
import type { Validator } from './types';


const validator: Validator = {
    build: () => {
        throw new Error(`${PACKAGE_NAME}: validator.build<T>() ${UNCOMPILED}`);
    },
    set: () => {
        throw new Error(`${PACKAGE_NAME}: validator.set() ${UNCOMPILED}`);
    },
    toJsonSchema: () => {
        throw new Error(`${PACKAGE_NAME}: validator.toJsonSchema<T>() ${UNCOMPILED}`);
    }
};


export { codec, createAsyncCache, createCache, resolvable, SchemaMissError } from './sbc/index';
export { validator };
export * from './types';

export type {
    AsyncCache,
    Cache,
    CodecOptions,
    DecodeOptions,
    EncodeOptions,
    FieldSpec,
    PersistentStore,
    Schema,
    SchemaCache,
    SchemaRegistry,
    StoredSchema,
} from './sbc/index';
