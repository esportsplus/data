import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;


const normalize: V & { nfd: V; nfkc: V; nfkd: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || value !== value.normalize('NFC')) {
            errors.push('must be NFC normalized');
        }
    },
    {
        nfd: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || value !== value.normalize('NFD')) {
                errors.push('must be NFD normalized');
            }
        },
        nfkc: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || value !== value.normalize('NFKC')) {
                errors.push('must be NFKC normalized');
            }
        },
        nfkd: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || value !== value.normalize('NFKD')) {
                errors.push('must be NFKD normalized');
            }
        }
    }
);


export default normalize;
