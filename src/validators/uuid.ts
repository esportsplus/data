import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let GENERAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(error);
    }
}

function versionValidator(version: string): V {
    let re = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');

    return (value: unknown, errors: ErrorType): void => {
        validate(value, errors, re, `must be a valid UUID v${version}`);
    };
}


const uuid: V & { v1: V; v2: V; v3: V; v4: V; v5: V; v6: V; v7: V; v8: V } = Object.assign(
    (value: unknown, errors: ErrorType): void => {
        validate(value, errors, GENERAL_RE, 'must be a valid UUID');
    },
    {
        v1: versionValidator('1'),
        v2: versionValidator('2'),
        v3: versionValidator('3'),
        v4: versionValidator('4'),
        v5: versionValidator('5'),
        v6: versionValidator('6'),
        v7: versionValidator('7'),
        v8: versionValidator('8'),
    }
);


export default uuid;
