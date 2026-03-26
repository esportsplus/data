import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let V48_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/,
    V64_RE = /^([0-9a-fA-F]{2}[:-]){7}[0-9a-fA-F]{2}$/;


const mac: V & { v48: V; v64: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || (!V48_RE.test(value) && !V64_RE.test(value))) {
            errors.push('must be a valid MAC address');
        }
    },
    {
        v48: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || !V48_RE.test(value)) {
                errors.push('must be a valid MAC-48 address');
            }
        },
        v64: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || !V64_RE.test(value)) {
                errors.push('must be a valid MAC-64 address');
            }
        },
    }
);


export default mac;
