import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


type V = (n: number, error?: string) => (value: unknown, errors: ErrorType) => void;

let segmenter = new Intl.Segmenter();


function assertCount(n: number): void {
    if (Number.isNaN(n) || n < 0) {
        throw new Error(`${PACKAGE_NAME}: graphemes count must be a non-negative number`);
    }
}

function graphemeCount(value: string): number {
    let count = 0;

    for (let _ of segmenter.segment(value)) {
        count++;
    }

    return count;
}


const graphemes: V & { max: V; min: V } = Object.assign(
    (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
        assertCount(n);

        let msg = error || `must be exactly ${n} graphemes`;

        return (value, errors) => {
            if (typeof value !== 'string' || graphemeCount(value) !== n) {
                errors.push(msg);
            }
        };
    },
    {
        max: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

            let msg = error || `must be at most ${n} graphemes`;

            return (value, errors) => {
                if (typeof value !== 'string' || graphemeCount(value) > n) {
                    errors.push(msg);
                }
            };
        },
        min: (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
            assertCount(n);

            let msg = error || `must be at least ${n} graphemes`;

            return (value, errors) => {
                if (typeof value !== 'string' || graphemeCount(value) < n) {
                    errors.push(msg);
                }
            };
        }
    }
);


export default graphemes;
