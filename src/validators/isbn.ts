import type { ValidatorFunction } from '~/types';


let ISBN10_RE = /^\d{9}[\dX]$/,
    ISBN13_RE = /^\d{13}$/,
    STRIP_RE = /[-\s]/g;


function isbn10(value: string): boolean {
    let sum = 0;

    for (let i = 0; i < 9; i++) {
        sum += (10 - i) * +value[i];
    }

    sum += value[9] === 'X' ? 10 : +value[9];

    return sum % 11 === 0;
}

function isbn13(value: string): boolean {
    let sum = 0;

    for (let i = 0; i < 13; i++) {
        sum += (i % 2 === 0 ? 1 : 3) * +value[i];
    }

    return sum % 10 === 0;
}


const isbn = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid ISBN';

    return (value, errors) => {
        if (typeof value !== 'string') {
            errors.push(msg);
            return;
        }

        let stripped = value.replace(STRIP_RE, '');

        if (
            (ISBN10_RE.test(stripped) && isbn10(stripped)) ||
            (ISBN13_RE.test(stripped) && isbn13(stripped))
        ) {
            return;
        }

        errors.push(msg);
    };
};


export default isbn;
