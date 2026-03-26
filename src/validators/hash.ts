import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let MD5_REGEX = /^[0-9a-fA-F]{32}$/,
    SHA1_REGEX = /^[0-9a-fA-F]{40}$/,
    SHA256_REGEX = /^[0-9a-fA-F]{64}$/,
    SHA384_REGEX = /^[0-9a-fA-F]{96}$/,
    SHA512_REGEX = /^[0-9a-fA-F]{128}$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}


const hash: { md5: F; sha1: F; sha256: F; sha384: F; sha512: F } = {
    md5: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid MD5 hash';

        return (value, errors) => check(value, errors, MD5_REGEX, msg);
    },
    sha1: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid SHA-1 hash';

        return (value, errors) => check(value, errors, SHA1_REGEX, msg);
    },
    sha256: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid SHA-256 hash';

        return (value, errors) => check(value, errors, SHA256_REGEX, msg);
    },
    sha384: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid SHA-384 hash';

        return (value, errors) => check(value, errors, SHA384_REGEX, msg);
    },
    sha512: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid SHA-512 hash';

        return (value, errors) => check(value, errors, SHA512_REGEX, msg);
    },
};


export default hash;
