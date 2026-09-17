import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let HTTP_REGEX = /^https?:\/\/[^\s]+$/,
    HTTPS_REGEX = /^https:\/\/[^\s]+$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}

function isValidHttpsUrl(value: string): boolean {
    if (!HTTPS_REGEX.test(value)) {
        return false;
    }

    try {
        let parsed = new URL(value);

        // HTTPS_REGEX alone accepts host-less values like "https://?" and
        // "https:///"; require a parsed host just like the general url() validator.
        return parsed.protocol === 'https:' && parsed.hostname.length > 0;
    }
    catch {
        return false;
    }
}

function isValidUrl(value: string): boolean {
    try {
        new URL(value);

        return true;
    }
    catch {
        return false;
    }
}


const url: F & { http: F; https: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid URL';

        return (value, errors) => {
            if (typeof value !== 'string' || !isValidUrl(value)) {
                errors.push(msg);
            }
        };
    },
    {
        http: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTP URL';

            return (value, errors) => check(value, errors, HTTP_REGEX, msg);
        },
        https: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid HTTPS URL';

            return (value, errors) => {
                if (typeof value !== 'string' || !isValidHttpsUrl(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);


export default url;
