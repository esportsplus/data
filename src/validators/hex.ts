import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    HEX_REGEX = /^[0-9a-fA-F]+$/;


const hex: F & { color: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid hexadecimal string';

        return (value, errors) => {
            if (typeof value !== 'string' || !HEX_REGEX.test(value)) {
                errors.push(msg);
            }
        };
    },
    {
        color: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid hex color';

            return (value, errors) => {
                if (typeof value !== 'string' || !COLOR_REGEX.test(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);


export default hex;
