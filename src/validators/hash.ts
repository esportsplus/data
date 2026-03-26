import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let MD5_RE = /^[0-9a-fA-F]{32}$/,
    SHA1_RE = /^[0-9a-fA-F]{40}$/,
    SHA256_RE = /^[0-9a-fA-F]{64}$/,
    SHA384_RE = /^[0-9a-fA-F]{96}$/,
    SHA512_RE = /^[0-9a-fA-F]{128}$/;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(error);
    }
}


const hash: { md5: V; sha1: V; sha256: V; sha384: V; sha512: V } = {
    md5: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, MD5_RE, 'must be a valid MD5 hash');
    },
    sha1: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, SHA1_RE, 'must be a valid SHA-1 hash');
    },
    sha256: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, SHA256_RE, 'must be a valid SHA-256 hash');
    },
    sha384: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, SHA384_RE, 'must be a valid SHA-384 hash');
    },
    sha512: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, SHA512_RE, 'must be a valid SHA-512 hash');
    },
};


export default hash;
