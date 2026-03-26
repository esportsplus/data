import type { ErrorType } from '~/types';


const jsonString = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string') {
        errors.push('must be a valid JSON string');
        return;
    }

    try {
        JSON.parse(value);
    }
    catch {
        errors.push('must be a valid JSON string');
    }
};


export default jsonString;
