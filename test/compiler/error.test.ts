import { describe, expect, it } from 'vitest';

import error from '../../src/compiler/error';
import { createValidator } from '../utils';


function buildKeyValidator(key: string) {
    return createValidator(
        `type T = { ${JSON.stringify(key)}: string };\n` +
        'validator.build<T>();\n'
    );
}


describe('Error: generate', () => {
    it('generates error push code with static path', () => {
        let result = error.generate('must be a string', { segments: [{ kind: 'key', name: 'name' }] });

        expect(result).toContain('(_errors ??= []).push({');
        expect(result).toContain('message: "must be a string"');
        expect(result).toContain('path: "name"');
    });

    it('generates error push code with dynamic path', () => {
        let result = error.generate('invalid item', { segments: [{ kind: 'key', name: 'items' }, { expr: '_i', kind: 'index' }] });

        expect(result).toContain('(_errors ??= []).push({');
        expect(result).toContain('message: "invalid item"');
        expect(result).toContain('path: "items[" + _i + "]"');
    });

    it('uses custom message when context provides one', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('name', 'Name is required');

        let result = error.generate('must be a string', { segments: [{ kind: 'key', name: 'name' }] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain('message: "Name is required"');
        expect(result).not.toContain('message: "must be a string"');
    });

    it('falls back to default message when custom message not found', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('other', 'Other message');

        let result = error.generate('must be a string', { segments: [{ kind: 'key', name: 'name' }] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain('message: "must be a string"');
    });

    it('uses empty string key for non-static path mode custom message lookup', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('', 'Global message');

        let result = error.generate('must be valid', { segments: [{ kind: 'key', name: 'items' }, { expr: '_i', kind: 'index' }] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain('message: "Global message"');
    });

    it('escapes a message containing quotes and a newline via JSON.stringify', () => {
        let message = 'she said "hi"\nand it\'s true',
            result = error.generate(message, { segments: [{ kind: 'key', name: 'name' }] });

        expect(result).toContain(`message: ${JSON.stringify(message)}`);
        // eslint-disable-next-line no-new-func
        expect(new Function('_errors', `${result}\nreturn _errors[0].message;`)()).toBe(message);
    });

    it('escapes a static path segment containing a quote and backslash', () => {
        let key = `it's "quoted"\\`,
            result = error.generate('bad', { segments: [{ kind: 'key', name: key }] });

        // eslint-disable-next-line no-new-func
        expect(new Function('_errors', `${result}\nreturn _errors[0].path;`)()).toBe(key);
    });
});


describe('Error: emitted module escaping', () => {
    it('parses and validates keys containing a single quote, double quote, and space', () => {
        for (let key of ["it's", 'she said "hi"', 'has a space']) {
            let validate = buildKeyValidator(key);

            expect(validate({ [key]: 'value' }).ok).toBe(true);

            let invalid = validate({});

            expect(invalid.ok).toBe(false);
            expect(invalid.errors![0].path).toBe(key);
        }
    });

    it('parses and validates a key containing a newline', () => {
        let key = 'line one\nline two',
            validate = buildKeyValidator(key);

        expect(validate({ [key]: 'value' }).ok).toBe(true);
        expect(validate({}).errors![0].path).toBe(key);
    });

    it('parses and validates a key containing an emoji', () => {
        let key = 'name\u{1F600}',
            validate = buildKeyValidator(key);

        expect(validate({ [key]: 'value' }).ok).toBe(true);
        expect(validate({}).errors![0].path).toBe(key);
    });

    it('reads the correct property for a backslash key instead of a backspace-miscompiled one', () => {
        let key = 'a\\b',
            validate = buildKeyValidator(key);

        expect(key).toBe('a' + '\\' + 'b');
        expect(validate({ [key]: 'value' }).ok).toBe(true);
        expect(validate({ [key]: 'value' }).data).toEqual({ [key]: 'value' });

        // An object keyed by the BACKSPACE control character (the old miscompile's target)
        // must NOT satisfy the validator - the real backslash-keyed property is what's read
        let backspaceKeyed = { 'a\bb': 'value' };

        expect(validate(backspaceKeyed).ok).toBe(false);
    });

    it('preserves quotes and newlines in a custom error message verbatim', () => {
        let message = 'she said "hi"\nand it\'s true',
            code = `type User = { name: string };\n` +
                `type UserErrors = { name: ${JSON.stringify(message)} };\n` +
                'validator.build<User, UserErrors>();\n',
            validate = createValidator(code);

        let result = validate({ name: 123 });

        expect(result.ok).toBe(false);
        expect(result.errors![0].message).toBe(message);
    });
});

describe('Error: path fidelity', () => {
    const paths = (source: string, input: unknown): string[] => {
        let built = createValidator(source) as unknown as { validate?: (i: unknown) => unknown },
            validate = (typeof built === 'function' ? built : built.validate) as (i: unknown) => { errors?: Array<{ path: string }> };

        return (validate(input).errors ?? []).map((error) => error.path);
    };

    it('carries the array index into a nested property path', () => {
        expect(paths('type U = { users: { id: string }[] };\nexport const x = validator.build<U>();', { users: [{ id: null }] }))
            .toEqual(['users[0].id']);
    });

    it('carries the record key into a nested property path', () => {
        expect(paths('type U = { m: Record<string, { a: string }> };\nexport const x = validator.build<U>();', { m: { k: { a: 1 } } }))
            .toEqual(['m.k.a']);
    });

    it('renders a tuple index with no stray dot', () => {
        expect(paths('type U = { t: [string, number] };\nexport const x = validator.build<U>();', { t: ['a', 'b'] }))
            .toEqual(['t[1]']);
    });

    it('carries both indices through nested arrays', () => {
        expect(paths('type U = { grid: number[][] };\nexport const x = validator.build<U>();', { grid: [[1, 'x']] }))
            .toEqual(['grid[0][1]']);
    });

    it('bracket-quotes a dotted key so it cannot be read as nesting', () => {
        expect(paths('type U = { a: { "b.c": string } };\nexport const x = validator.build<U>();', { a: { 'b.c': 1 } }))
            .toEqual(['a["b.c"]']);
    });
});
