import type { ErrorType } from '~/types';


type V = (n: number, error?: string) => (value: unknown, errors: ErrorType) => void;

let encoder = new TextEncoder();


function byteLength(value: string): number {
    return encoder.encode(value).length;
}


const bytes: V & { max: V; min: V } = Object.assign(
    (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
        let msg = error || `must be exactly ${n} bytes`;

        return (value, errors) => {
            if (typeof value !== 'string' || byteLength(value) !== n) {
                errors.push(msg);
            }
        };
    },
    {
        max: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            let msg = error || `must be at most ${n} bytes`;

            return (value, errors) => {
                if (typeof value !== 'string' || byteLength(value) > n) {
                    errors.push(msg);
                }
            };
        },
        min: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            let msg = error || `must be at least ${n} bytes`;

            return (value, errors) => {
                if (typeof value !== 'string' || byteLength(value) < n) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default bytes;
