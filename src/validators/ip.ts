import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    V4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
    V6_RE = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:)|fe80:(:[0-9a-f]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/i;


function isValidV4(value: string): boolean {
    let match = V4_RE.exec(value);

    if (!match) {
        return false;
    }

    for (let i = 1; i <= 4; i++) {
        if (+match[i] > 255) {
            return false;
        }
    }

    return true;
}

function isValidV4Cidr(value: string): boolean {
    let match = V4_CIDR_RE.exec(value);

    if (!match) {
        return false;
    }

    for (let i = 1; i <= 4; i++) {
        if (+match[i] > 255) {
            return false;
        }
    }

    return +match[5] >= 0 && +match[5] <= 32;
}

function isValidV6(value: string): boolean {
    return V6_RE.test(value);
}

function isValidV6Cidr(value: string): boolean {
    let parts = value.split('/');

    if (parts.length !== 2) {
        return false;
    }

    let prefix = +parts[1];

    return V6_RE.test(parts[0]) && /^\d{1,3}$/.test(parts[1]) && prefix >= 0 && prefix <= 128;
}


let v4: V & { cidr: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || !isValidV4(value)) {
            errors.push('must be a valid IPv4 address');
        }
    },
    {
        cidr: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || !isValidV4Cidr(value)) {
                errors.push('must be a valid IPv4 CIDR');
            }
        },
    }
);

let v6: V & { cidr: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || !isValidV6(value)) {
            errors.push('must be a valid IPv6 address');
        }
    },
    {
        cidr: (value: unknown, errors: ErrorType): void => {
            if (typeof value !== 'string' || !isValidV6Cidr(value)) {
                errors.push('must be a valid IPv6 CIDR');
            }
        },
    }
);


const ip: V & { v4: V & { cidr: V }; v6: V & { cidr: V } } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || (!isValidV4(value) && !isValidV6(value))) {
            errors.push('must be a valid IP address');
        }
    },
    {
        v4,
        v6,
    }
);


export default ip;
