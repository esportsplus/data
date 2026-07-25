import { decodeTypedArray } from '@esportsplus/data/runtime';

const _schema = { properties: { name: { type: 'string' } }, type: 'object' };
const _build = {
    toJsonSchema: () => _schema,
    validate: (value, errors) => {
        if (typeof value.name !== 'string') {
            errors.push('name must be string');
        }
    }
};

export const decode = (bytes) => decodeTypedArray(bytes);
export const validate = (input) => _build.validate(input, []);
