import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


type FN = (n: number, error?: string) => (value: unknown, errors: ErrorType) => void;


let SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });


function assertCount(n: number): void {
    if (Number.isNaN(n) || n < 0) {
        throw new Error(`${PACKAGE_NAME}: words count must be a non-negative number`);
    }
}

function wordCount(value: string): number {
    let count = 0;

    for (let segment of SEGMENTER.segment(value)) {
        if (segment.isWordLike) {
            count++;
        }
    }

    return count;
}


const words: FN & { max: FN; min: FN } = Object.assign(
    (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
        assertCount(n);

        let msg = error || `must be exactly ${n} words`;

        return (value, errors) => {
            if (typeof value !== 'string' || wordCount(value) !== n) {
                errors.push(msg);
            }
        };
    },
    {
        max: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

            let msg = error || `must be at most ${n} words`;

            return (value, errors) => {
                if (typeof value !== 'string' || wordCount(value) > n) {
                    errors.push(msg);
                }
            };
        },
        min: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

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
