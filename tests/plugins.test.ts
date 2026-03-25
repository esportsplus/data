import { describe, expect, it } from 'vitest';


describe('Plugin Smoke Tests', () => {
    describe('tsc plugin', () => {
        it('exports without throwing', async () => {
            let mod = await import('../src/compiler/plugins/tsc');

            expect(mod.default).toBeDefined();
        });

        it('returns a function', async () => {
            let mod = await import('../src/compiler/plugins/tsc');

            expect(typeof mod.default).toBe('function');
        });

        it('calling the factory returns plugins array', async () => {
            let mod = await import('../src/compiler/plugins/tsc'),
                result = mod.default();

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('vite plugin', () => {
        it('exports without throwing', async () => {
            let mod = await import('../src/compiler/plugins/vite');

            expect(mod.default).toBeDefined();
        });

        it('returns a function', async () => {
            let mod = await import('../src/compiler/plugins/vite');

            expect(typeof mod.default).toBe('function');
        });

        it('calling the factory returns a vite plugin object', async () => {
            let mod = await import('../src/compiler/plugins/vite'),
                result = mod.default();

            expect(result).toBeDefined();
            expect(typeof result.name).toBe('string');
            expect(result.enforce).toBe('pre');
            expect(typeof result.transform).toBe('function');
            expect(typeof result.configResolved).toBe('function');
            expect(typeof result.watchChange).toBe('function');
        });

        it('name contains package name', async () => {
            let mod = await import('../src/compiler/plugins/vite'),
                result = mod.default();

            expect(result.name).toContain('@esportsplus/data');
        });
    });
});
