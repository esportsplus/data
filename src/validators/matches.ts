import type { ErrorType } from '~/types';


export default (regex: RegExp, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must match pattern ${regex}`;

    if (regex.global || regex.sticky) {
        regex = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
    }

    return (value, errors) => {
        if (typeof value !== 'string' || !regex.test(value)) {
            errors.push(msg);
        }
    };
};
