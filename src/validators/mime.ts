import type { ValidatorFunction } from '~/types';


let RE = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;


const mime = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid MIME type';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default mime;
