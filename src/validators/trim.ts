import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;


const trim: F & { end: F; start: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be trimmed';

        return (value, errors) => {
            if (typeof value !== 'string' || value !== value.trim()) {
                errors.push(msg);
            }
        };
    },
    {
        end: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must have no trailing whitespace';

            return (value, errors) => {
                if (typeof value !== 'string' || value !== value.trimEnd()) {
                    errors.push(msg);
                }
            };
        },
        start: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must have no leading whitespace';

            return (value, errors) => {
                if (typeof value !== 'string' || value !== value.trimStart()) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default trim;
