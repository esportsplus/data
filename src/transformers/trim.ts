import type { Transformer } from '~/types';


type F = (error?: string) => Transformer<unknown>;


const trim: F & { end: F; start: F } = Object.assign(
    (error?: string): Transformer<unknown> => {
        let msg = error || 'must be trimmed';

        return (value, errors) => {
            if (typeof value !== 'string') {
                errors.push(msg);

                return value;
            }

            return value.trim();
        };
    },
    {
        end: (error?: string): Transformer<unknown> => {
            let msg = error || 'must have no trailing whitespace';

            return (value, errors) => {
                if (typeof value !== 'string') {
                    errors.push(msg);

                    return value;
                }

                return value.trimEnd();
            };
        },
        start: (error?: string): Transformer<unknown> => {
            let msg = error || 'must have no leading whitespace';

            return (value, errors) => {
                if (typeof value !== 'string') {
                    errors.push(msg);

                    return value;
                }

                return value.trimStart();
            };
        }
    }
);


export default trim;
