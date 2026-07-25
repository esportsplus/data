import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let V4_REGEX = /^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/,
    V4_CIDR_REGEX = /^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}\/(?:3[0-2]|[12]?[0-9])$/,
    V6_REGEX = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:)|fe80:(:[0-9a-f]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/i;


function isValidV4(value: string): boolean {
    return V4_REGEX.test(value);
}

function isValidV4Cidr(value: string): boolean {
    return V4_CIDR_REGEX.test(value);
}

function isValidV6(value: string): boolean {
    return V6_REGEX.test(value);
}

function isValidV6Cidr(value: string): boolean {
    let parts = value.split('/');

    if (parts.length !== 2) {
        return false;
    }

    let prefix = +parts[1];

    return V6_REGEX.test(parts[0]) && /^\d{1,3}$/.test(parts[1]) && prefix >= 0 && prefix <= 128;
}


let v4: F & { cidr: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid IPv4 address';

        return (value, errors) => {
            if (typeof value !== 'string' || !isValidV4(value)) {
                errors.push(msg);
            }
        };
    },
    {
        cidr: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid IPv4 CIDR';

            return (value, errors) => {
                if (typeof value !== 'string' || !isValidV4Cidr(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);

let v6: F & { cidr: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid IPv6 address';

        return (value, errors) => {
            if (typeof value !== 'string' || !isValidV6(value)) {
                errors.push(msg);
            }
        };
    },
    {
        cidr: (error?: string): ValidatorFunction<unknown> => {
            let msg = error || 'must be a valid IPv6 CIDR';

            return (value, errors) => {
                if (typeof value !== 'string' || !isValidV6Cidr(value)) {
                    errors.push(msg);
                }
            };
        },
    }
);


const ip: F & { v4: F & { cidr: F }; v6: F & { cidr: F } } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid IP address';

        return (value, errors) => {
            if (typeof value !== 'string' || (!isValidV4(value) && !isValidV6(value))) {
                errors.push(msg);
            }
        };
    },
    {
        v4,
        v6,
    }
);


export default ip;
