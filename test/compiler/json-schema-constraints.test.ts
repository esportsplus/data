import { ts } from '@esportsplus/typescript';
import { describe, expect, it } from 'vitest';

import { analyzeType } from '../../src/compiler/type-analyzer';
import { extractConstraints } from '../../src/compiler/json-schema-constraints';
import type { AnalyzedProperty } from '../../src/compiler/type-analyzer';
import type { JsonSchema } from '../../src/types';
import { compile } from '../utils';


type Setup = {
    checker: ts.Checker;
    configArg: ts.Expression;
    root: AnalyzedProperty;
    sourceFile: ts.SourceFile;
};


function build(validators: string, type: string, config: string): string {
    return `import { validator } from '@esportsplus/data';\n${validators}\nvalidator.build<${type}>(${config});\n`;
}

function extract(code: string): Map<string, JsonSchema> {
    let { checker, configArg, root, sourceFile } = setup(code);

    return extractConstraints(configArg, root, sourceFile, checker);
}

function setup(code: string): Setup {
    let { checker, sourceFile } = compile(code),
        found: ts.CallExpression | undefined;

    let walk = (node: ts.Node): void => {
        if (!found && ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0 && node.arguments.length > 0) {
            found = node;
        }

        node.forEachChild(walk);
    };

    walk(sourceFile);

    if (!found) {
        throw new Error('Test: no validator.build call found');
    }

    let analyzed = analyzeType(found.typeArguments![0], checker);

    return {
        checker,
        configArg: found.arguments[0],
        root: { name: '', optional: false, properties: analyzed.properties, type: 'object' },
        sourceFile
    };
}


describe('extractConstraints', () => {
    describe('mapping table — polymorphic min/max/range by IR type', () => {
        it('min maps to minimum on number', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: min(0) }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
        });

        it('min maps to minimum on bigint', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: bigint }', '{ age: min(1) }'));

            expect(result.get('age')).toEqual({ minimum: 1 });
        });

        it('min maps to minLength on string', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ name: string }', '{ name: min(2) }'));

            expect(result.get('name')).toEqual({ minLength: 2 });
        });

        it('min maps to minItems on array', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ tags: string[] }', '{ tags: min(3) }'));

            expect(result.get('tags')).toEqual({ minItems: 3 });
        });

        it('max maps to maximum on number', () => {
            let result = extract(build("import { max } from '@esportsplus/data/validators';", '{ age: number }', '{ age: max(150) }'));

            expect(result.get('age')).toEqual({ maximum: 150 });
        });

        it('max maps to maximum on bigint', () => {
            let result = extract(build("import { max } from '@esportsplus/data/validators';", '{ age: bigint }', '{ age: max(9) }'));

            expect(result.get('age')).toEqual({ maximum: 9 });
        });

        it('max maps to maxLength on string', () => {
            let result = extract(build("import { max } from '@esportsplus/data/validators';", '{ name: string }', '{ name: max(100) }'));

            expect(result.get('name')).toEqual({ maxLength: 100 });
        });

        it('max maps to maxItems on array', () => {
            let result = extract(build("import { max } from '@esportsplus/data/validators';", '{ tags: string[] }', '{ tags: max(5) }'));

            expect(result.get('tags')).toEqual({ maxItems: 5 });
        });

        it('range maps to minimum+maximum on number', () => {
            let result = extract(build("import { range } from '@esportsplus/data/validators';", '{ age: number }', '{ age: range(0, 150) }'));

            expect(result.get('age')).toEqual({ maximum: 150, minimum: 0 });
        });

        it('range maps to minimum+maximum on bigint', () => {
            let result = extract(build("import { range } from '@esportsplus/data/validators';", '{ age: bigint }', '{ age: range(1, 8) }'));

            expect(result.get('age')).toEqual({ maximum: 8, minimum: 1 });
        });

        it('range maps to minLength+maxLength on string', () => {
            let result = extract(build("import { range } from '@esportsplus/data/validators';", '{ name: string }', '{ name: range(1, 20) }'));

            expect(result.get('name')).toEqual({ maxLength: 20, minLength: 1 });
        });

        it('range maps to minItems+maxItems on array', () => {
            let result = extract(build("import { range } from '@esportsplus/data/validators';", '{ tags: string[] }', '{ tags: range(1, 4) }'));

            expect(result.get('tags')).toEqual({ maxItems: 4, minItems: 1 });
        });
    });

    describe('mapping table — number-only and string-only builtins', () => {
        it('length maps to minLength+maxLength on string', () => {
            let result = extract(build("import { length } from '@esportsplus/data/validators';", '{ code: string }', '{ code: length(6) }'));

            expect(result.get('code')).toEqual({ maxLength: 6, minLength: 6 });
        });

        it('length degrades on non-string', () => {
            let result = extract(build("import { length } from '@esportsplus/data/validators';", '{ age: number }', '{ age: length(6) }'));

            expect(result.has('age')).toBe(false);
        });

        it('multipleOf maps to multipleOf on number', () => {
            let result = extract(build("import { multipleOf } from '@esportsplus/data/validators';", '{ age: number }', '{ age: multipleOf(5) }'));

            expect(result.get('age')).toEqual({ multipleOf: 5 });
        });

        it('integer maps to type integer on number', () => {
            let result = extract(build("import { integer } from '@esportsplus/data/validators';", '{ age: number }', '{ age: integer() }'));

            expect(result.get('age')).toEqual({ type: 'integer' });
        });

        it('safeInteger maps to type integer with safe bounds', () => {
            let result = extract(build("import { safeInteger } from '@esportsplus/data/validators';", '{ age: number }', '{ age: safeInteger() }'));

            expect(result.get('age')).toEqual({ maximum: 9007199254740991, minimum: -9007199254740991, type: 'integer' });
        });

        it('positive maps to exclusiveMinimum 0', () => {
            let result = extract(build("import { positive } from '@esportsplus/data/validators';", '{ age: number }', '{ age: positive() }'));

            expect(result.get('age')).toEqual({ exclusiveMinimum: 0 });
        });

        it('negative maps to exclusiveMaximum 0', () => {
            let result = extract(build("import { negative } from '@esportsplus/data/validators';", '{ age: number }', '{ age: negative() }'));

            expect(result.get('age')).toEqual({ exclusiveMaximum: 0 });
        });

        it('nonNegative maps to minimum 0', () => {
            let result = extract(build("import { nonNegative } from '@esportsplus/data/validators';", '{ age: number }', '{ age: nonNegative() }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
        });

        it('nonPositive maps to maximum 0', () => {
            let result = extract(build("import { nonPositive } from '@esportsplus/data/validators';", '{ age: number }', '{ age: nonPositive() }'));

            expect(result.get('age')).toEqual({ maximum: 0 });
        });
    });

    describe('mapping table — string pattern builtins', () => {
        it('matches maps to pattern from an unflagged regex', () => {
            let result = extract(build("import { matches } from '@esportsplus/data/validators';", '{ code: string }', '{ code: matches(/^[a-z]+$/) }'));

            expect(result.get('code')).toEqual({ pattern: '^[a-z]+$' });
        });

        it('matches degrades on a flagged regex', () => {
            let result = extract(build("import { matches } from '@esportsplus/data/validators';", '{ code: string }', '{ code: matches(/^[a-z]+$/i) }'));

            expect(result.has('code')).toBe(false);
        });

        it('startsWith maps to an anchored escaped pattern', () => {
            let result = extract(build("import { startsWith } from '@esportsplus/data/validators';", '{ code: string }', "{ code: startsWith('a.b') }"));

            expect(result.get('code')).toEqual({ pattern: '^a\\.b' });
        });

        it('endsWith maps to a trailing escaped pattern', () => {
            let result = extract(build("import { endsWith } from '@esportsplus/data/validators';", '{ code: string }', "{ code: endsWith('.com') }"));

            expect(result.get('code')).toEqual({ pattern: '\\.com$' });
        });

        it('includes maps to an escaped pattern', () => {
            let result = extract(build("import { includes } from '@esportsplus/data/validators';", '{ code: string }', "{ code: includes('a+b') }"));

            expect(result.get('code')).toEqual({ pattern: 'a\\+b' });
        });
    });

    describe('mapping table — format builtins', () => {
        it('email maps to format email', () => {
            let result = extract(build("import { email } from '@esportsplus/data/validators';", '{ mail: string }', '{ mail: email() }'));

            expect(result.get('mail')).toEqual({ format: 'email' });
        });

        it('email.html5 maps to format email', () => {
            let result = extract(build("import { email } from '@esportsplus/data/validators';", '{ mail: string }', '{ mail: email.html5() }'));

            expect(result.get('mail')).toEqual({ format: 'email' });
        });

        it('email.rfc5322 maps to format email', () => {
            let result = extract(build("import { email } from '@esportsplus/data/validators';", '{ mail: string }', '{ mail: email.rfc5322() }'));

            expect(result.get('mail')).toEqual({ format: 'email' });
        });

        it('email.unicode maps to format idn-email', () => {
            let result = extract(build("import { email } from '@esportsplus/data/validators';", '{ mail: string }', '{ mail: email.unicode() }'));

            expect(result.get('mail')).toEqual({ format: 'idn-email' });
        });

        it('uuid maps to format uuid', () => {
            let result = extract(build("import { uuid } from '@esportsplus/data/validators';", '{ id: string }', '{ id: uuid() }'));

            expect(result.get('id')).toEqual({ format: 'uuid' });
        });

        it('uuid.v4 maps to format uuid', () => {
            let result = extract(build("import { uuid } from '@esportsplus/data/validators';", '{ id: string }', '{ id: uuid.v4() }'));

            expect(result.get('id')).toEqual({ format: 'uuid' });
        });

        it('uuid.v7 maps to format uuid', () => {
            let result = extract(build("import { uuid } from '@esportsplus/data/validators';", '{ id: string }', '{ id: uuid.v7() }'));

            expect(result.get('id')).toEqual({ format: 'uuid' });
        });

        it('url maps to format uri', () => {
            let result = extract(build("import { url } from '@esportsplus/data/validators';", '{ site: string }', '{ site: url() }'));

            expect(result.get('site')).toEqual({ format: 'uri' });
        });

        it('url.http maps to format uri with a pattern', () => {
            let result = extract(build("import { url } from '@esportsplus/data/validators';", '{ site: string }', '{ site: url.http() }'));

            expect(result.get('site')).toEqual({ format: 'uri', pattern: '^https?://' });
        });

        it('url.https maps to format uri with an https pattern', () => {
            let result = extract(build("import { url } from '@esportsplus/data/validators';", '{ site: string }', '{ site: url.https() }'));

            expect(result.get('site')).toEqual({ format: 'uri', pattern: '^https://' });
        });
    });

    describe('callee shape recognition', () => {
        it('resolves an aliased named import to its canonical name', () => {
            let result = extract(build("import { min as m } from '@esportsplus/data/validators';", '{ age: number }', '{ age: m(0) }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
        });

        it('resolves a namespace import at depth one', () => {
            let result = extract(build("import * as v from '@esportsplus/data/validators';", '{ age: number }', '{ age: v.min(0) }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
        });

        it('resolves a namespace import variant at depth two', () => {
            let result = extract(build("import * as v from '@esportsplus/data/validators';", '{ mail: string }', '{ mail: v.email.rfc5322() }'));

            expect(result.get('mail')).toEqual({ format: 'email' });
        });

        it('recognizes an array of calls and composes them', () => {
            let result = extract(build("import { max, min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [min(0), max(150)] }'));

            expect(result.get('age')).toEqual({ maximum: 150, minimum: 0 });
        });
    });

    describe('intra-property conflict resolution', () => {
        it('takes the max of contributed lower bounds', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [min(0), min(5)] }'));

            expect(result.get('age')).toEqual({ minimum: 5 });
        });

        it('takes the min of contributed upper bounds', () => {
            let result = extract(build("import { max } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [max(150), max(100)] }'));

            expect(result.get('age')).toEqual({ maximum: 100 });
        });

        it('composes multiple pattern contributions as allOf', () => {
            let result = extract(build("import { endsWith, startsWith } from '@esportsplus/data/validators';", '{ code: string }', "{ code: [startsWith('a'), endsWith('z')] }"));

            expect(result.get('code')).toEqual({ allOf: [{ pattern: '^a' }, { pattern: 'z$' }] });
        });

        it('keeps a single pattern as a bare keyword', () => {
            let result = extract(build("import { startsWith } from '@esportsplus/data/validators';", '{ code: string }', "{ code: startsWith('a') }"));

            expect(result.get('code')).toEqual({ pattern: '^a' });
        });

        it('drops all formats when they conflict but keeps other keywords', () => {
            let result = extract(build("import { email, url } from '@esportsplus/data/validators';", '{ site: string }', '{ site: [url.http(), email()] }'));

            expect(result.get('site')).toEqual({ pattern: '^https?://' });
        });

        it('drops conflicting multipleOf but keeps other keywords', () => {
            let result = extract(build("import { min, multipleOf } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [multipleOf(2), multipleOf(3), min(0)] }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
        });

        it('treats a duplicate multipleOf as idempotent', () => {
            let result = extract(build("import { multipleOf } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [multipleOf(2), multipleOf(2)] }'));

            expect(result.get('age')).toEqual({ multipleOf: 2 });
        });

        it('treats a duplicate type integer as idempotent', () => {
            let result = extract(build("import { integer } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [integer(), integer()] }'));

            expect(result.get('age')).toEqual({ type: 'integer' });
        });
    });

    describe('degrade paths', () => {
        it('degrades an unknown builtin, keeping recognized siblings', () => {
            let result = extract(build("import { min, trim } from '@esportsplus/data/validators';", '{ name: string }', '{ name: [trim(), min(1)] }'));

            expect(result.get('name')).toEqual({ minLength: 1 });
        });

        it('degrades a validator call with a non-static argument', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: min(Math.floor(1)) }'));

            expect(result.has('age')).toBe(false);
        });

        it('degrades an array entry containing a non-call element', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: [min(0), 5] }'));

            expect(result.has('age')).toBe(false);
        });

        it('degrades a spread config key, keeping the rest', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ ...base, age: min(0) }'));

            expect(result.get('age')).toEqual({ minimum: 0 });
            expect(result.size).toBe(1);
        });

        it('degrades a computed config key', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ [key]: min(0) }'));

            expect(result.size).toBe(0);
        });

        it('degrades an unknown property name', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ other: min(0) }'));

            expect(result.size).toBe(0);
        });

        it('degrades a property whose IR type row is absent', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ flag: boolean }', '{ flag: min(0) }'));

            expect(result.size).toBe(0);
        });

        it('returns an empty map for a function-form config', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '(value, errors) => { errors.push(String(value)); }'));

            expect(result.size).toBe(0);
        });

        it('returns an empty map for an identifier config reference', () => {
            let code = "import { validator } from '@esportsplus/data';\n"
                + "import { min } from '@esportsplus/data/validators';\n"
                + 'let cfg = { age: min(0) };\n'
                + 'validator.build<{ age: number }>(cfg);\n';
            let result = extract(code);

            expect(result.size).toBe(0);
        });

        it('returns an empty map for a non-object root', () => {
            let { checker, configArg, sourceFile } = setup(build("import { min } from '@esportsplus/data/validators';", '{ age: number }', '{ age: min(0) }'));
            let result = extractConstraints(configArg, { name: '', optional: false, type: 'string' }, sourceFile, checker);

            expect(result.size).toBe(0);
        });
    });

    describe('property coverage', () => {
        it('omits fragments for untouched properties', () => {
            let result = extract(build("import { min } from '@esportsplus/data/validators';", '{ age: number; name: string }', '{ age: min(0) }'));

            expect(result.has('age')).toBe(true);
            expect(result.has('name')).toBe(false);
        });
    });
});
