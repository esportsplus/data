import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let V48_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/,
    V64_RE = /^([0-9a-fA-F]{2}[:-]){7}[0-9a-fA-F]{2}$/;


const mac: F & { v48: F; v64: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid MAC address';

        return (value, errors) => {
            if (typeof value !== 'string' || (!V48_RE.test(value) && !V64_RE.test(value))) {
                errors.push(msg);
            }
        };
    },
    {
        v48: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid MAC-48 address';

            return (value, errors) => {
                if (typeof value !== 'string' || !V48_RE.test(value)) {
                    errors.push(msg);
                }
            };
        },
        v64: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid MAC-64 address';

            return (value, errors) => {
                if (typeof value !== 'string' || !V64_RE.test(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);


export default mac;
