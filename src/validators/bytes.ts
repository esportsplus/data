import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


type V = (n: number, error?: string) => (value: unknown, errors: ErrorType) => void;

let encoder = new TextEncoder();


function assertCount(n: number): void {
    if (Number.isNaN(n) || n < 0) {
        throw new Error(`${PACKAGE_NAME}: bytes count must be a non-negative number`);
    }
}

function byteLength(value: string): number | null {
    for (let i = 0, n = value.length; i < n; i++) {
        let code = value.charCodeAt(i);

        if (code >= 0xD800 && code <= 0xDBFF) {
            if (i + 1 >= n) {
                return null;
            }

            let next = value.charCodeAt(i + 1);

            if (next < 0xDC00 || next > 0xDFFF) {
                return null;
            }

            i++;
        }
        else if (code >= 0xDC00 && code <= 0xDFFF) {
            return null;
        }
    }

    return encoder.encode(value).length;
}


const bytes: V & { max: V; min: V } = Object.assign(
    (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
        assertCount(n);

        let msg = error || `must be exactly ${n} bytes`;

        return (value, errors) => {
            if (typeof value !== 'string') {
                errors.push(msg);

                return;
            }

            let length = byteLength(value);

            if (length === null || length !== n) {
                errors.push(msg);
            }
        };
    },
    {
        max: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

            let msg = error || `must be at most ${n} bytes`;

            return (value, errors) => {
                if (typeof value !== 'string') {
                    errors.push(msg);

                    return;
                }

                let length = byteLength(value);

                if (length === null || length > n) {
                    errors.push(msg);
                }
            };
        },
        min: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

            let msg = error || `must be at least ${n} bytes`;

            return (value, errors) => {
                if (typeof value !== 'string') {
                    errors.push(msg);

                    return;
                }

                let length = byteLength(value);

                if (length === null || length < n) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default bytes;
