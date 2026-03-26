import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let STANDARD_RE = /^[A-Za-z0-9+/]*={0,2}$/,
    URL_RE = /^[A-Za-z0-9_-]*={0,2}$/;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || value.length === 0 || !re.test(value)) {
        errors.push(error);
    }
}


const base64: V & { url: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        validate(value, errors, STANDARD_RE, 'must be a valid base64 string');
    },
    {
        url: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, URL_RE, 'must be a valid base64url string');
        },
    }
);


export default base64;
