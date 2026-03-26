import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;


const normalize: F & { nfd: F; nfkc: F; nfkd: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be NFC normalized';

        return (value, errors) => {
            if (typeof value !== 'string' || value !== value.normalize('NFC')) {
                errors.push(msg);
            }
        };
    },
    {
        nfd: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be NFD normalized';

            return (value, errors) => {
                if (typeof value !== 'string' || value !== value.normalize('NFD')) {
                    errors.push(msg);
                }
            };
        },
        nfkc: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be NFKC normalized';

            return (value, errors) => {
                if (typeof value !== 'string' || value !== value.normalize('NFKC')) {
                    errors.push(msg);
                }
            };
        },
        nfkd: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be NFKD normalized';

            return (value, errors) => {
                if (typeof value !== 'string' || value !== value.normalize('NFKD')) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default normalize;
