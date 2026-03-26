import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;


const trim: V & { end: V; start: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || value !== value.trim()) {
            errors.push('must be trimmed');
        }
    },
    {
        end: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || value !== value.trimEnd()) {
                errors.push('must have no trailing whitespace');
            }
        },
        start: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || value !== value.trimStart()) {
                errors.push('must have no leading whitespace');
            }
        }
    }
);


export default trim;
