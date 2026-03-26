import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let GENERAL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/,
    HTTP_RE = /^https?:\/\/[^\s]+$/,
    HTTPS_RE = /^https:\/\/[^\s]+$/;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(error);
    }
}


const url: V & { http: V; https: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        validate(value, errors, GENERAL_RE, 'must be a valid URL');
    },
    {
        http: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, HTTP_RE, 'must be a valid HTTP URL');
        },
        https: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, HTTPS_RE, 'must be a valid HTTPS URL');
        },
    }
);


export default url;
