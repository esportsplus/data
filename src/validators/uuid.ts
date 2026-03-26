import type { ValidatorFunction } from '~/types';


type FN = (error?: string) => ValidatorFunction<unknown>;


let GENERAL_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}

function factory(version: string): FN {
    let re = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');

    return (error?: string): ValidatorFunction<unknown> => {
        let msg = error || `must be a valid UUID v${version}`;

        return (value, errors) => check(value, errors, re, msg);
    };
}


const uuid: FN & { v1: FN; v2: FN; v3: FN; v4: FN; v5: FN; v6: FN; v7: FN; v8: FN } = Object.assign(
    (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid UUID';

        return (value, errors) => check(value, errors, GENERAL_REGEX, msg);
    },
    {
        v1: factory('1'),
        v2: factory('2'),
        v3: factory('3'),
        v4: factory('4'),
        v5: factory('5'),
        v6: factory('6'),
        v7: factory('7'),
        v8: factory('8'),
    }
);


export default uuid;
