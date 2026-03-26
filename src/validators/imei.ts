import type { ErrorType } from '~/types';


let RE = /^\d{15}$/;


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


const imei = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value) || !luhn(value)) {
        errors.push('must be a valid IMEI number');
    }
};


export default imei;
