import type { ErrorType } from '~/types';


const excludes = (str: string, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must not include '${str}'`;

    return (value, errors) => {
        if (typeof value !== 'string' || value.includes(str)) {
            errors.push(msg);
        }
    };
};


export default excludes;
