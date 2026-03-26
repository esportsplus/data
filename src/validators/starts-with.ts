import type { ErrorType } from '~/types';


const startsWith = (str: string, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must start with '${str}'`;

    return (value, errors) => {
        if (typeof value !== 'string' || !value.startsWith(str)) {
            errors.push(msg);
        }
    };
};


export default startsWith;
