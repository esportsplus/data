import type { ErrorType } from '~/types';


let REGEX = /^\d{15}$/;


function luhn(digits: string): boolean {
    let n = digits.length,
        sum = 0;

    for (let i = 0; i < n; i++) {
        let digit = +digits[n - 1 - i];

        if (i % 2 === 1) {
            digit *= 2;

            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
    }

    return sum % 10 === 0;
}


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid IMEI number';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value) || !luhn(value)) {
            errors.push(msg);
        }
    };
};
