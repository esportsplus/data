// H3 (parity-or-omit) + H4 (caller options preserved) regression guards.
//
// H3: only a hint that is provably byte-and-behavior-identical to pure runtime inference may be
// injected. Nullable unions, optional properties, open (index-signature) object types and
// value-narrowed numbers must all leave the call to runtime inference.
//
// H4: replacing a codec call must never override a caller `schema`, spread a boolean `view`,
// or discard a numeric decode length. Ambiguous shapes are left untouched.

import { describe, expect, test } from 'vitest';

import { codec } from '../../../src/sbc';
import sbcPlugin from '../../../src/compiler/sbc';
import { transformWith } from '../../utils';


// A REAL imported codec factory — the M9 detection tightening means a structurally-declared
// `codec` (no import) is never transformed.
let preamble = `
    import { codec as codecFactory } from '@esportsplus/data';

    type FieldSpec = { name: string; nullable?: boolean; type: string; };

    const codec = codecFactory();
`;


type FieldSpec = { name: string; nullable?: boolean; type: string };


function transformCodec2(code: string): string {
    return transformWith([sbcPlugin], preamble + code);
}

function extractSchema(transformed: string): FieldSpec[] | null {
    let match = transformed.match(/"schema":(\[.*?\])/);

    return match ? JSON.parse(match[1]!) as FieldSpec[] : null;
}

// The on-wire schema hash lives in bytes [1..4] of a tag-8/18 object buffer.
function bufferHash(u8: Uint8Array): number {
    return (u8[0]! === 8 || u8[0]! === 18)
        ? ((u8[1]! | (u8[2]! << 8) | (u8[3]! << 16) | (u8[4]! << 24)) >>> 0)
        : -1;
}

function extractCallExpression(code: string, prefix: string): string {
    let start = code.indexOf(prefix);

    if (start === -1) {
        throw new Error(`hints harness: '${prefix}' not found in emitted code:\n${code}`);
    }

    let depth = 0;

    for (let i = start, n = code.length; i < n; i++) {
        let ch = code[i];

        if (ch === '(') {
            depth++;
        }
        else if (ch === ')') {
            depth--;

            if (depth === 0) {
                return code.slice(start, i + 1);
            }
        }
    }

    throw new Error(`hints harness: unbalanced call starting at '${prefix}'`);
}

// Executes the single emitted call against a mock receiver that captures the options argument.
// The scratch output keeps the `encode<T>` type argument (the real TS emitter strips it), so it
// is removed before evaluation — fixtures here use simple named type arguments.
function runCall(transformed: string, prefix: string, injected: Record<string, unknown>): unknown {
    let expression = extractCallExpression(transformed, prefix).replace(/\.(encode|decode)<[^<>]*>/, '.$1'),
        keys = Object.keys(injected);

    // eslint-disable-next-line no-new-func
    return new Function(...keys, `return ${expression};`)(...keys.map((key) => injected[key]));
}


describe('H3 — injected hints are parity-or-omit', () => {
    test('nullable union is omitted and byte-matches runtime inference', () => {
        let transformed = transformCodec2(`
            type Data = { email: string | null; name: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `);

        // No hint: runtime derives nullable from the VALUE.
        expect(transformed).not.toContain('"schema"');
        expect(transformed).toContain('codec.encode<Data>(d)');

        let value = { email: 'a@b.com', name: 'x' },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });

    test('optional-absent property is omitted and the key stays absent', () => {
        let transformed = transformCodec2(`
            type Data = { id: string; name?: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `);

        expect(transformed).not.toContain('"schema"');

        let value = { id: 'x' }, // `name` absent
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));

        let decoded = compiled.decode(encoded) as Record<string, unknown>;

        expect(decoded).toEqual(value);
        expect(decoded).not.toHaveProperty('name');
    });

    test('open (index-signature) object type is omitted and extra keys survive', () => {
        let transformed = transformCodec2(`
            type Data = { name: string; [key: string]: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `);

        expect(transformed).not.toContain('"schema"');

        let value = { extra: 'y', name: 'x' },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(bufferHash(encoded)).toBe(bufferHash(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });

    test('plain number field is omitted (inference narrows the width by value)', () => {
        let transformed = transformCodec2(`
            type Data = { count: number; name: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `);

        expect(transformed).not.toContain('"schema"');

        let value = { count: 25, name: 'x' },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });

    test('positive: a fully-pinned closed type emits a hint byte-identical to runtime', () => {
        let transformed = transformCodec2(`
            type Uint8 = number & { __brand: 'uint8' };
            type Packet = { flag: boolean; id: Uint8; label: string };
            declare let p: Packet;
            codec.encode<Packet>(p);
        `),
            schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        for (let i = 0, n = schema!.length; i < n; i++) {
            expect(schema![i]!.nullable).toBeUndefined();
        }

        let value = { flag: true, id: 42, label: 'hi' },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value, { schema: schema! }),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(bufferHash(encoded)).toBe(bufferHash(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });

    test('positive: a nested object field stays dynamic and preserves extra nested keys', () => {
        let transformed = transformCodec2(`
            type Data = { meta: { city: string } };
            declare let d: Data;
            codec.encode<Data>(d);
        `),
            schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let value = { meta: { city: 'NYC', zip: '10001' } },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value, { schema: schema! }),
            inferred = runtime.encode(value);

        // The nested object is re-inferred by `_encObj` on both paths.
        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(bufferHash(encoded)).toBe(bufferHash(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });

    test('positive: a nested Record field stays hinted and byte-identical', () => {
        let transformed = transformCodec2(`
            type Data = { scores: Record<string, number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `),
            schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let value = { scores: { a: 1, b: 2 } },
            compiled = codec(),
            runtime = codec();
        let encoded = compiled.encode(value, { schema: schema! }),
            inferred = runtime.encode(value);

        expect(Array.from(encoded)).toEqual(Array.from(inferred));
        expect(bufferHash(encoded)).toBe(bufferHash(inferred));
        expect(compiled.decode(encoded)).toEqual(value);
    });
});


describe('H4 — call rewriting preserves caller options and argument semantics', () => {
    test('an explicit encode `schema` option is never overridden', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            codec.encode<Data>(d, { schema: 12345 });
        `);

        // No generated schema array was appended.
        expect(transformed).not.toContain('"schema":[');
        expect(transformed).toContain('codec.encode<Data>(d, { schema: 12345 })');

        let captured: Record<string, unknown> | null = null,
            mock = {
                encode: (_value: unknown, options: Record<string, unknown>) => {
                    captured = options;

                    return new Uint8Array();
                }
            };

        runCall(transformed, 'codec.encode', { codec: mock, d: { name: 'x' } });

        expect(captured).toEqual({ schema: 12345 });
    });

    test('an explicit decode `schema` option is never overridden', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let buf: Uint8Array;
            codec.decode<Data>(buf, { schema: 12345 });
        `);

        expect(transformed).not.toContain('"schema":[');
        expect(transformed).toContain('codec.decode<Data>(buf, { schema: 12345 })');
    });

    test('a boolean `view` variable keeps view mode (not spread away)', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            declare let view: boolean;
            codec.encode<Data>(d, view);
        `);

        // The boolean is threaded as an explicit `view` property; it is never spread.
        expect(transformed).not.toContain('{...view');
        expect(transformed).toContain('"view":view');
        expect(transformed).toContain('"schema"');

        let captured: Record<string, unknown> | null = null,
            mock = {
                encode: (_value: unknown, options: Record<string, unknown>) => {
                    captured = options;

                    return new Uint8Array();
                }
            };

        runCall(transformed, 'codec.encode', { codec: mock, d: { name: 'x' }, view: true });

        expect(captured).not.toBeNull();
        expect(captured!.view).toBe(true);
        expect(captured!.schema).toBeDefined();
    });

    test('a boolean `view` literal is preserved alongside the schema', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            codec.encode<Data>(d, true);
        `);

        expect(transformed).toContain('"view":true');
        expect(transformed).toContain('"schema"');
    });

    test('a numeric decode length is preserved (no schema injected)', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let buf: Uint8Array;
            codec.decode<Data>(buf, 10);
        `);

        expect(transformed).not.toContain('"schema"');
        expect(transformed).toContain('codec.decode<Data>(buf, 10)');

        let captured: { length: unknown } | null = null,
            mock = {
                decode: (_buf: Uint8Array, length: unknown) => {
                    captured = { length };

                    return {};
                }
            };

        runCall(transformed, 'codec.decode', { codec: mock, buf: new Uint8Array([1]) });

        expect(captured).toEqual({ length: 10 });
    });

    test('a numeric decode-length variable is preserved (no schema injected)', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let buf: Uint8Array;
            declare let len: number;
            codec.decode<Data>(buf, len);
        `);

        expect(transformed).not.toContain('"schema"');
        expect(transformed).toContain('codec.decode<Data>(buf, len)');
    });

    test('a spread options literal is left unchanged (cannot prove no schema override)', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            declare let opts: { view?: boolean };
            codec.encode<Data>(d, { ...opts });
        `);

        expect(transformed).not.toContain('"schema"');
        expect(transformed).toContain('{ ...opts }');
    });

    test('a variable options object is left unchanged rather than spread', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            declare let opts: { view?: boolean };
            codec.encode<Data>(d, opts);
        `);

        expect(transformed).not.toContain('"schema"');
        expect(transformed).not.toContain('{...opts');
    });

    test('a safe object-literal options bag is merged without disturbing its options', () => {
        let transformed = transformCodec2(`
            type Data = { name: string };
            declare let d: Data;
            codec.encode<Data>(d, { view: true });
        `);

        expect(transformed).toMatch(/view:\s*true/);
        expect(transformed).toContain('"schema"');

        let captured: Record<string, unknown> | null = null,
            mock = {
                encode: (_value: unknown, options: Record<string, unknown>) => {
                    captured = options;

                    return new Uint8Array();
                }
            };

        runCall(transformed, 'codec.encode', { codec: mock, d: { name: 'x' } });

        expect(captured).not.toBeNull();
        expect(captured!.view).toBe(true);
        expect(Array.isArray(captured!.schema)).toBe(true);
    });
});
