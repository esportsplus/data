import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let GENERAL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    HTML5_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    RFC5322_RE = /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|\[(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?|[a-zA-Z0-9-]*[a-zA-Z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/,
    UNICODE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}


const email: F & { html5: F; rfc5322: F; unicode: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid email';

        return (value, errors) => check(value, errors, GENERAL_RE, msg);
    },
    {
        html5: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid email';

            return (value, errors) => check(value, errors, HTML5_RE, msg);
        },
        rfc5322: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid email';

            return (value, errors) => check(value, errors, RFC5322_RE, msg);
        },
        unicode: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid email';

            return (value, errors) => check(value, errors, UNICODE_RE, msg);
        },
    }
);


export default email;
