import type { ErrorType } from '~/types';


type FN = (n: number, error?: string) => (value: unknown, errors: ErrorType) => void;


let SPLIT_REGEX = /\s+/;


function wordCount(value: string): number {
    let trimmed = value.trim();

    return trimmed === '' ? 0 : trimmed.split(SPLIT_REGEX).length;
}


const words: FN & { max: FN; min: FN } = Object.assign(
    (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
        let msg = error || `must be exactly ${n} words`;

        return (value, errors) => {
            if (typeof value !== 'string' || wordCount(value) !== n) {
                errors.push(msg);
            }
        };
    },
    {
        max: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            let msg = error || `must be at most ${n} words`;

            return (value, errors) => {
                if (typeof value !== 'string' || wordCount(value) > n) {
                    errors.push(msg);
                }
            };
        },
        min: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            let msg = error || `must be at least ${n} words`;

            return (value, errors) => {
                if (typeof value !== 'string' || wordCount(value) < n) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default words;
