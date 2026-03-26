import type { ValidatorFunction } from '~/types';


let RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;


const semver = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid semantic version';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default semver;
