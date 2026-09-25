import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vite from '../../src/compiler/plugins/vite';
import { UNCOMPILED } from '../../src/constants';


const TYPES = [
    'type Brand<T, B extends string> = T & { __brand: B };',
    'export type Slug = Brand<string, \'slug\'>;',
    'export type ErrorType = { push(message: string): void };',
    'export type Plain = { title: string };',
    'export type Post = { slug: Slug; title: string };'
].join('\n');

let fixtures: string[] = [];


function project(files: Record<string, string>) {
    let directory = mkdtempSync(join(process.cwd(), '.fixture-coverage-')).replace(/\\/g, '/');

    fixtures.push(directory);

    for (let [name, code] of Object.entries(files)) {
        writeFileSync(join(directory, name), code);
    }

    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true, target: 'esnext', types: [] },
        files: Object.keys(files).map(name => './' + name)
    }));

    let plugin = vite({ root: directory });

    plugin.configResolved({ command: 'build', root: directory });

    return (name: string) => plugin.transform(files[name], directory + '/' + name)?.code ?? files[name];
}


afterEach(() => {
    for (let fixture of fixtures) {
        rmSync(fixture, { force: true, recursive: true });
    }

    fixtures = [];
});


describe('compiler coverage', () => {
    it('compiles validator reached through a renamed barrel, nested namespaces and a cross-module const alias', () => {
        let transform = project({
                'types.ts': TYPES,
                'barrel.ts': [
                    "export { validator as v } from '@esportsplus/data';",
                    "export * as D from '@esportsplus/data';",
                    "import { validator } from '@esportsplus/data';",
                    'export const alias = validator;'
                ].join('\n'),
                'app.ts': [
                    "import type { Plain } from './types';",
                    "import { alias, v } from './barrel';",
                    "import * as B from './barrel';",
                    'export const a = v.build<Plain>();',
                    'export const b = B.D.validator.build<Plain>();',
                    'export const c = alias.build<Plain>();',
                    "export const d = B.D['validator'].toJsonSchema<Plain>();"
                ].join('\n')
            }),
            output = transform('app.ts');

        expect(output).not.toMatch(/\.(build|toJsonSchema)</);
        expect(output).toContain('toJsonSchema:');
    });

    it('fails the build on a use of validator that cannot be compiled, naming each location', () => {
        let transform = project({
                'app.ts': [
                    "import { validator } from '@esportsplus/data';",
                    'declare function take(value: unknown): void;',
                    'take(validator);',
                    'const { build } = validator;'
                ].join('\n')
            });

        expect(() => transform('app.ts')).toThrow(/app\.ts:3:6[\s\S]*app\.ts:4:19/);
    });

    it('applies a brand registration reached only through a barrel', () => {
        let transform = project({
                'types.ts': TYPES,
                'validation.ts': [
                    "import { validator } from '@esportsplus/data';",
                    "import type { ErrorType, Slug } from './types';",
                    "validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });"
                ].join('\n'),
                'barrel.ts': "export * from './validation';\nexport {};",
                'app.ts': [
                    "import './barrel';",
                    "import { validator } from '@esportsplus/data';",
                    "import type { Post } from './types';",
                    'export const v = validator.build<Post>();'
                ].join('\n')
            });

        expect(transform('app.ts')).toContain('slug too short');
    });

    it('fails the build when a brand is registered more than once elsewhere', () => {
        let registration = (message: string) => [
                "import { validator } from '@esportsplus/data';",
                "import type { ErrorType, Slug } from './types';",
                `validator.set((value: Slug, errors: ErrorType) => { errors.push('${message}'); });`
            ].join('\n'),
            transform = project({
                'types.ts': TYPES,
                'one.ts': registration('one'),
                'two.ts': registration('two'),
                'app.ts': [
                    "import { validator } from '@esportsplus/data';",
                    "import type { Post } from './types';",
                    'export const v = validator.build<Post>();'
                ].join('\n')
            });

        expect(() => transform('app.ts')).toThrow(/'slug'.*one\.ts.*two\.ts/);
    });

    it('rejects a bundle chunk that still contains an uncompiled validator stub', () => {
        let plugin = vite({ root: process.cwd() });

        expect(() => plugin.renderChunk(`throw new Error("validator.build<T>() ${UNCOMPILED}")`, { fileName: 'app.js' })).toThrow(/app\.js/);
        expect(plugin.renderChunk('let compiled = build_u1.validate;', { fileName: 'app.js' })).toBeNull();
    });

    it('injects codec hints whichever way the codec reached the call', () => {
        let transform = project({
                'app.ts': [
                    "import { codec } from '@esportsplus/data';",
                    'type Point = { active: boolean; name: string };',
                    'export let write = (c: ReturnType<typeof codec>, value: Point) => c.encode<Point>(value);'
                ].join('\n')
            });

        expect(transform('app.ts')).toContain('schema');
    });
});
