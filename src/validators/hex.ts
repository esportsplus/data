import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    HEX_RE = /^[0-9a-fA-F]+$/;


const hex: F & { color: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid hexadecimal string';

        return (value, errors) => {
            if (typeof value !== 'string' || !HEX_RE.test(value)) {
                errors.push(msg);
            }
        };
    },
    {
        color: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid hex color';

            return (value, errors) => {
                if (typeof value !== 'string' || !COLOR_RE.test(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);


export default hex;
