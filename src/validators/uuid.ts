import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let GENERAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}

function versionFactory(version: string): F {
    let re = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');

    return (error?: string): ValidatorFunction<unknown> => {
        let msg = error || `must be a valid UUID v${version}`;

        return (value, errors) => check(value, errors, re, msg);
    };
}


const uuid: F & { v1: F; v2: F; v3: F; v4: F; v5: F; v6: F; v7: F; v8: F } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid UUID';

        return (value, errors) => check(value, errors, GENERAL_RE, msg);
    },
    {
        v1: versionFactory('1'),
        v2: versionFactory('2'),
        v3: versionFactory('3'),
        v4: versionFactory('4'),
        v5: versionFactory('5'),
        v6: versionFactory('6'),
        v7: versionFactory('7'),
        v8: versionFactory('8'),
    }
);


export default uuid;
