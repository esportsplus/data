import type { ErrorType } from '~/types';


export default (str: string, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must include '${str}'`;

    return (value, errors) => {
        if (typeof value !== 'string' || !value.includes(str)) {
            errors.push(msg);
        }
    };
};
