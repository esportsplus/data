import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let GENERAL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    HTML5_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    RFC5322_RE = /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|\[(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?|[a-zA-Z0-9-]*[a-zA-Z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/,
    UNICODE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(error);
    }
}


const email: V & { html5: V; rfc5322: V; unicode: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        validate(value, errors, GENERAL_RE, 'must be a valid email');
    },
    {
        html5: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, HTML5_RE, 'must be a valid email');
        },
        rfc5322: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, RFC5322_RE, 'must be a valid email');
        },
        unicode: (value: unknown, errors: ErrorType): void => {
            validate(value, errors, UNICODE_RE, 'must be a valid email');
        },
    }
);


export default email;
