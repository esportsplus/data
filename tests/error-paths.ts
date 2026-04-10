import { describe, expect, it } from 'vitest';

import error from '../src/compiler/error';


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
