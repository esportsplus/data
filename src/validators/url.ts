import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let GENERAL_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/,
    HTTP_REGEX = /^https?:\/\/[^\s]+$/,
    HTTPS_REGEX = /^https:\/\/[^\s]+$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}


const url: F & { http: F; https: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid URL';

        return (value, errors) => check(value, errors, GENERAL_REGEX, msg);
    },
    {
        http: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTP URL';

            return (value, errors) => check(value, errors, HTTP_REGEX, msg);
        },
        https: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTPS URL';

            return (value, errors) => check(value, errors, HTTPS_REGEX, msg);
        },
    }
);


export default url;
