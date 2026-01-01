import { describe, expect, it } from 'vitest';
import { createValidator } from './utils';


describe('Array Validation', () => {
    describe('simple arrays', () => {
        let validate = createValidator(`
            type Data = { items: string[] };
            validator.build<Data>();
        `);

        it('accepts valid array', () => {
            let result = validate({ items: ['a', 'b', 'c'] });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ items: ['a', 'b', 'c'] });
        });

        it('accepts empty array', () => {
            let result = validate({ items: [] });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ items: [] });
        });

        it('rejects non-array', () => {
            let result = validate({ items: 'not an array' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('must be an array');
        });

        it('rejects array with invalid items', () => {
            let result = validate({ items: ['a', 123, 'c'] });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toMatch(/items\[\d+\]/);
        });

        it('stops on first invalid item', () => {
            let result = validate({ items: [1, 2, 3] });

            expect(result.ok).toBe(false);
            expect(result.errors).toHaveLength(1);
        });
    });

    describe('number arrays', () => {
        let validate = createValidator(`
            type Data = { values: number[] };
            validator.build<Data>();
        `);

        it('accepts number array', () => {
            let result = validate({ values: [1, 2, 3] });

            expect(result.ok).toBe(true);
        });

        it('coerces string numbers in array', () => {
            let result = validate({ values: [1, '2', 3] });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ values: [1, 2, 3] });
        });
    });

    describe('nested arrays', () => {
        let validate = createValidator(`
            type Matrix = { grid: number[][] };
            validator.build<Matrix>();
        `);

        it('accepts 2D array', () => {
            let result = validate({ grid: [[1, 2], [3, 4]] });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid nested items', () => {
            let result = validate({ grid: [[1, 'a'], [3, 4]] });

            expect(result.ok).toBe(false);
        });
    });

    describe('array of objects', () => {
        let validate = createValidator(`
            type Item = { id: number; name: string };
            type Data = { items: Item[] };
            validator.build<Data>();
        `);

        it('accepts valid array of objects', () => {
            let result = validate({
                items: [
                    { id: 1, name: 'First' },
                    { id: 2, name: 'Second' }
                ]
            });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid object in array', () => {
            let result = validate({
                items: [
                    { id: 1, name: 'First' },
                    { id: 'invalid', name: 'Second' }
                ]
            });

            expect(result.ok).toBe(false);
        });
    });
});


describe('Object Validation', () => {
    describe('nested objects', () => {
        let validate = createValidator(`
            type Address = {
                city: string;
                street: string;
                zip: string;
            };
            type User = {
                address: Address;
                name: string;
            };
            validator.build<User>();
        `);

        it('accepts valid nested object', () => {
            let result = validate({
                address: {
                    city: 'NYC',
                    street: '123 Main St',
                    zip: '10001'
                },
                name: 'John'
            });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid nested property', () => {
            let result = validate({
                address: {
                    city: 'NYC',
                    street: 123,
                    zip: '10001'
                },
                name: 'John'
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('address.street');
        });

        it('rejects null for required object', () => {
            let result = validate({
                address: null,
                name: 'John'
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('address');
        });
    });

    describe('deeply nested objects', () => {
        let validate = createValidator(`
            type Inner = { value: number };
            type Middle = { inner: Inner };
            type Outer = { middle: Middle };
            validator.build<Outer>();
        `);

        it('accepts deeply nested', () => {
            let result = validate({
                middle: { inner: { value: 42 } }
            });

            expect(result.ok).toBe(true);
        });

        it('reports deep path on error', () => {
            let result = validate({
                middle: { inner: { value: 'invalid' } }
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('middle.inner.value');
        });
    });

    describe('object with optional nested', () => {
        let validate = createValidator(`
            type Config = {
                settings?: { debug: boolean };
                name: string;
            };
            validator.build<Config>();
        `);

        it('accepts without optional nested', () => {
            let result = validate({ name: 'App' });

            expect(result.ok).toBe(true);
        });

        it('accepts with optional nested', () => {
            let result = validate({
                name: 'App',
                settings: { debug: true }
            });

            expect(result.ok).toBe(true);
        });

        it('validates optional nested when present', () => {
            let result = validate({
                name: 'App',
                settings: { debug: 'not a boolean' }
            });

            expect(result.ok).toBe(false);
        });
    });
});


describe('Tuple Validation', () => {
    describe('simple tuples', () => {
        let validate = createValidator(`
            type Point = { coords: [number, number] };
            validator.build<Point>();
        `);

        it('accepts valid tuple', () => {
            let result = validate({ coords: [10, 20] });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ coords: [10, 20] });
        });

        it('rejects wrong length', () => {
            let result = validate({ coords: [10] });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('invalid tuple type');
        });

        it('rejects too many elements', () => {
            let result = validate({ coords: [10, 20, 30] });

            expect(result.ok).toBe(false);
        });

        it('rejects invalid element type', () => {
            let result = validate({ coords: [10, 'twenty'] });

            expect(result.ok).toBe(false);
        });
    });

    describe('mixed type tuples', () => {
        let validate = createValidator(`
            type Entry = { data: [string, number, boolean] };
            validator.build<Entry>();
        `);

        it('accepts valid mixed tuple', () => {
            let result = validate({ data: ['hello', 42, true] });

            expect(result.ok).toBe(true);
        });

        it('rejects wrong type at position', () => {
            let result = validate({ data: ['hello', 'wrong', true] });

            expect(result.ok).toBe(false);
        });
    });
});


describe('Record Validation', () => {
    describe('string value records', () => {
        let validate = createValidator(`
            type Dict = { data: Record<string, string> };
            validator.build<Dict>();
        `);

        it('accepts valid record', () => {
            let result = validate({
                data: { key1: 'value1', key2: 'value2' }
            });

            expect(result.ok).toBe(true);
        });

        it('accepts empty record', () => {
            let result = validate({ data: {} });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid value type', () => {
            let result = validate({
                data: { key1: 'value1', key2: 123 }
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('must be a string');
        });

        it('rejects non-object', () => {
            let result = validate({ data: 'not an object' });

            expect(result.ok).toBe(false);
        });

        it('rejects array', () => {
            let result = validate({ data: ['a', 'b'] });

            expect(result.ok).toBe(false);
        });
    });

    describe('number value records', () => {
        let validate = createValidator(`
            type Scores = { values: Record<string, number> };
            validator.build<Scores>();
        `);

        it('accepts number values', () => {
            let result = validate({
                values: { player1: 100, player2: 200 }
            });

            expect(result.ok).toBe(true);
        });

        it('rejects non-number value', () => {
            let result = validate({
                values: { player1: 100, player2: 'invalid' }
            });

            expect(result.ok).toBe(false);
        });
    });

    describe('index signature', () => {
        let validate = createValidator(`
            type Dict = { data: { [key: string]: boolean } };
            validator.build<Dict>();
        `);

        it('accepts valid index signature object', () => {
            let result = validate({
                data: { flag1: true, flag2: false }
            });

            expect(result.ok).toBe(true);
        });
    });
});


describe('Complex Combined Types', () => {
    describe('array of records', () => {
        let validate = createValidator(`
            type Entry = { id: number; metadata: Record<string, string> };
            type Data = { entries: Entry[] };
            validator.build<Data>();
        `);

        it('accepts valid complex structure', () => {
            let result = validate({
                entries: [
                    { id: 1, metadata: { key: 'value' } },
                    { id: 2, metadata: { other: 'data' } }
                ]
            });

            expect(result.ok).toBe(true);
        });
    });

    describe('nested arrays and objects', () => {
        let validate = createValidator(`
            type Category = {
                name: string;
                subcategories: {
                    id: number;
                    items: string[];
                }[];
            };
            validator.build<Category>();
        `);

        it('accepts deeply nested structure', () => {
            let result = validate({
                name: 'Electronics',
                subcategories: [
                    { id: 1, items: ['phone', 'tablet'] },
                    { id: 2, items: ['laptop'] }
                ]
            });

            expect(result.ok).toBe(true);
        });

        it('reports correct path for deep error', () => {
            let result = validate({
                name: 'Electronics',
                subcategories: [
                    { id: 1, items: ['phone', 123] }
                ]
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toMatch(/subcategories/);
        });
    });
});
