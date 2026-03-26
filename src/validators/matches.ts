import type { ErrorType } from '~/types';


const matches = (regex: RegExp, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must match pattern ${regex}`;

    return (value, errors) => {
        if (typeof value !== 'string' || !regex.test(value)) {
            errors.push(msg);
        }
    };
};


export default matches;
