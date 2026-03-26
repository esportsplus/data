import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let GENERAL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/,
    HTTP_RE = /^https?:\/\/[^\s]+$/,
    HTTPS_RE = /^https:\/\/[^\s]+$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}


const url: F & { http: F; https: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid URL';

        return (value, errors) => check(value, errors, GENERAL_RE, msg);
    },
    {
        http: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTP URL';

            return (value, errors) => check(value, errors, HTTP_RE, msg);
        },
        https: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTPS URL';

            return (value, errors) => check(value, errors, HTTPS_RE, msg);
        },
    }
);


export default url;
