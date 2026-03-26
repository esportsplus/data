import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let STANDARD_RE = /^[A-Za-z0-9+/]*={0,2}$/,
    URL_RE = /^[A-Za-z0-9_-]*={0,2}$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || value.length === 0 || !re.test(value)) {
        errors.push(msg);
    }
}


const base64: F & { url: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid base64 string';

        return (value, errors) => check(value, errors, STANDARD_RE, msg);
    },
    {
        url: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid base64url string';

            return (value, errors) => check(value, errors, URL_RE, msg);
        },
    }
);


export default base64;
