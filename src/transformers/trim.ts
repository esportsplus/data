import type { Transformer } from '~/types';


const trim = <T = string>(error?: string): Transformer<T> => {
    let msg = error || 'must be trimmed';

    return (value, errors) => {
        if (typeof value !== 'string') {
            errors.push(msg);

            return value;
        }

        return value.trim() as T;
    };
};


export default trim;
