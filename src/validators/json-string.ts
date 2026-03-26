import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid JSON string';

    return (value, errors) => {
        if (typeof value !== 'string') {
            errors.push(msg);
            return;
        }

        try {
            JSON.parse(value);
        }
        catch {
            errors.push(msg);
        }
    };
};
