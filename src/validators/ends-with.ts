import type { ErrorType } from '~/types';


export default (str: string, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must end with '${str}'`;

    return (value, errors) => {
        if (typeof value !== 'string' || !value.endsWith(str)) {
            errors.push(msg);
        }
    };
};
