import { describe, expect, it } from 'vitest';

import error from '../src/compiler/error';


describe('Error Path Modes: resolvePath', () => {
    describe('static mode', () => {
        it('returns empty string literal for empty path', () => {
            let result = error.resolvePath({ kind: 'static', path: [] });

            expect(result).toBe("''");
        });

        it('returns single part path', () => {
            let result = error.resolvePath({ kind: 'static', path: ['name'] });

            expect(result).toBe("'name'");
        });

        it('returns joined multi-part path', () => {
            let result = error.resolvePath({ kind: 'static', path: ['address', 'city'] });

            expect(result).toBe("'address.city'");
        });
    });

    describe('record mode', () => {
        it('returns key alone for empty path', () => {
            let result = error.resolvePath({ kind: 'record', key: '_key', path: [] });

            expect(result).toBe('_key');
        });

        it('returns path prefix concatenated with key', () => {
            let result = error.resolvePath({ kind: 'record', key: '_key', path: ['data'] });

            expect(result).toBe("'data.' + _key");
        });
    });

    describe('dynamic mode', () => {
        it('returns bracket notation for empty path', () => {
            let result = error.resolvePath({ kind: 'dynamic', key: '_i', path: [] });

            expect(result).toBe("'[' + _i + ']'");
        });

        it('returns path with bracket notation', () => {
            let result = error.resolvePath({ kind: 'dynamic', key: '_i', path: ['items'] });

            expect(result).toBe("'items[' + _i + ']'");
        });
    });
});


describe('Error: generate', () => {
    it('generates error push code with static path', () => {
        let result = error.generate('must be a string', { kind: 'static', path: ['name'] });

        expect(result).toContain('(_errors ??= []).push({');
        expect(result).toContain("message: 'must be a string'");
        expect(result).toContain("path: 'name'");
    });

    it('generates error push code with dynamic path', () => {
        let result = error.generate('invalid item', { kind: 'dynamic', key: '_i', path: ['items'] });

        expect(result).toContain('(_errors ??= []).push({');
        expect(result).toContain("message: 'invalid item'");
        expect(result).toContain("path: 'items[' + _i + ']'");
    });

    it('uses custom message when context provides one', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('name', 'Name is required');

        let result = error.generate('must be a string', { kind: 'static', path: ['name'] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain("message: 'Name is required'");
        expect(result).not.toContain("message: 'must be a string'");
    });

    it('falls back to default message when custom message not found', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('other', 'Other message');

        let result = error.generate('must be a string', { kind: 'static', path: ['name'] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain("message: 'must be a string'");
    });

    it('uses empty string key for non-static path mode custom message lookup', () => {
        let customMessages = new Map<string, string>();

        customMessages.set('', 'Global message');

        let result = error.generate('must be valid', { kind: 'dynamic', key: '_i', path: ['items'] }, {
            brandValidators: new Map(),
            customMessages,
            hasAsync: false
        });

        expect(result).toContain("message: 'Global message'");
    });
});
