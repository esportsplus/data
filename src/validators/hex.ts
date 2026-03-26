import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    HEX_RE = /^[0-9a-fA-F]+$/;


const hex: V & { color: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || !HEX_RE.test(value)) {
            errors.push('must be a valid hexadecimal string');
        }
    },
    {
        color: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || !COLOR_RE.test(value)) {
                errors.push('must be a valid hex color');
            }
        },
    }
);


export default hex;
