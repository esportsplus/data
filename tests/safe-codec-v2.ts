import { describe, expect, it } from 'vitest';

import { createCodec } from '~/sbc';
import { createSafeCodecV2 } from '~/sbc/safe-v2';


describe('CSP-Safe Codec v2', () => {
    describe('primitive encoding/decoding', () => {
        it('encodes and decodes null', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(null))).toBe(null);
        });

        it('encodes and decodes undefined as null', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(undefined))).toBe(null);
        });

        it('encodes and decodes boolean', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(true))).toBe(true);
            expect(codec.decode(codec.encode(false))).toBe(false);
        });

        it('encodes and decodes number', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(42.5))).toBe(42.5);
            expect(codec.decode(codec.encode(-3.14))).toBe(-3.14);
        });

        it('encodes and decodes uint8', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(255))).toBe(255);
            expect(codec.decode(codec.encode(0))).toBe(0);
        });

        it('encodes and decodes bigint', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode(9007199254740993n))).toBe(9007199254740993n);
        });

        it('encodes and decodes string', () => {
            let codec = createSafeCodecV2();

            expect(codec.decode(codec.encode('hello world'))).toBe('hello world');
            expect(codec.decode(codec.encode(''))).toBe('');
        });

        it('encodes and decodes date', () => {
            let codec = createSafeCodecV2();
            let d = new Date('2026-04-07T12:00:00Z');
            let decoded = codec.decode(codec.encode(d)) as Date;

            expect(decoded.getTime()).toBe(d.getTime());
        });

        it('encodes and decodes Uint8Array', () => {
            let codec = createSafeCodecV2();
            let bytes = new Uint8Array([1, 2, 3, 4, 5]);
            let decoded = codec.decode(codec.encode(bytes)) as Uint8Array;

            expect(new Uint8Array(decoded)).toEqual(bytes);
        });

        it('encodes and decodes arrays', () => {
            let codec = createSafeCodecV2();
            let arr = [1, 2, 3];

            expect(codec.decode(codec.encode(arr))).toEqual(arr);
        });
    });

    describe('object encoding/decoding', () => {
        it('encodes and decodes simple object', () => {
            let codec = createSafeCodecV2();
            let data = { name: 'Alice' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('encodes and decodes multi-field object', () => {
            let codec = createSafeCodecV2();
            let data = { active: true, age: 30.0, name: 'John' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('encodes and decodes object with all fixed types', () => {
            let codec = createSafeCodecV2();
            let data = { active: true, score: 99.5, ts: new Date('2026-01-01') };
            let decoded = codec.decode(codec.encode(data)) as Record<string, unknown>;

            expect(decoded.active).toBe(true);
            expect(decoded.score).toBe(99.5);
            expect((decoded.ts as Date).getTime()).toBe(data.ts.getTime());
        });

        it('encodes and decodes object with bytes field', () => {
            let codec = createSafeCodecV2();
            let data = { name: 'test', payload: new Uint8Array([10, 20, 30]) };
            let decoded = codec.decode(codec.encode(data)) as Record<string, unknown>;

            expect(decoded.name).toBe('test');
            expect(new Uint8Array(decoded.payload as Uint8Array)).toEqual(new Uint8Array([10, 20, 30]));
        });

        it('encodes same schema on second call from cache', () => {
            let codec = createSafeCodecV2();
            let d1 = { name: 'Alice' };
            let d2 = { name: 'Bob' };

            let e1 = codec.encode(d1);
            let e2 = codec.encode(d2);

            expect(codec.decode(e1)).toEqual(d1);
            expect(codec.decode(e2)).toEqual(d2);
        });
    });

    describe('wire compatibility with codegen codec', () => {
        it('safe-v2-encoded data is decodable by codegen codec', () => {
            let safe = createSafeCodecV2();
            let codegen = createCodec();
            let data = { active: true, age: 30.0, name: 'Alice' };

            let safeEncoded = safe.encode(data);
            let codegenEncoded = codegen.encode(data);

            expect(safeEncoded).toEqual(codegenEncoded);

            expect(codegen.decode(safeEncoded)).toEqual(data);
            expect(safe.decode(codegenEncoded)).toEqual(data);
        });

        it('wire compatible for string-only object', () => {
            let safe = createSafeCodecV2();
            let codegen = createCodec();
            let data = { name: 'Bob' };

            expect(safe.encode(data)).toEqual(codegen.encode(data));
        });

        it('wire compatible for large object', () => {
            let safe = createSafeCodecV2();
            let codegen = createCodec();
            let data = { active: true, age: 30.0, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 };

            expect(safe.encode(data)).toEqual(codegen.encode(data));
        });
    });

    describe('schema serialization', () => {
        it('exports schema from object', () => {
            let codec = createSafeCodecV2();
            let data = { active: true, name: 'Alice' };
            let serialized = codec.exportSchema(data);

            expect(serialized.hash).toBeTypeOf('number');
            expect(serialized.fields).toHaveLength(2);
            expect(serialized.fields[0]!.name).toBe('active');
            expect(serialized.fields[1]!.name).toBe('name');
        });

        it('imports schema and decodes', () => {
            let server = createSafeCodecV2();
            let data = { active: true, age: 30.0, name: 'Alice' };

            let encoded = server.encode(data);
            let schemaDef = server.exportSchema(data);

            let client = createSafeCodecV2();

            client.importSchema(schemaDef);

            let decoded = client.decode(encoded);

            expect(decoded).toEqual(data);
        });

        it('imported schema produces identical wire output', () => {
            let server = createSafeCodecV2();
            let data = { key: 'value', score: 42.0 };

            let serverEncoded = server.encode(data);
            let schemaDef = server.exportSchema(data);

            let client = createSafeCodecV2();

            client.importSchema(schemaDef);

            let clientEncoded = client.encode(data);

            expect(clientEncoded).toEqual(serverEncoded);
        });

        it('schema survives JSON round-trip', () => {
            let server = createSafeCodecV2();
            let data = { active: true, name: 'test' };

            let schemaDef = server.exportSchema(data);
            let json = JSON.stringify(schemaDef);
            let parsed = JSON.parse(json);

            let client = createSafeCodecV2();

            client.importSchema(parsed);

            let encoded = server.encode(data);

            expect(client.decode(encoded)).toEqual(data);
        });

        it('cross-codec schema sharing (safe-v2 → codegen)', () => {
            let safe = createSafeCodecV2();
            let codegen = createCodec();
            let data = { email: 'test@test.com', name: 'Alice' };

            codegen.encode(data);

            let encoded = safe.encode(data);

            expect(codegen.decode(encoded)).toEqual(data);
        });
    });

    describe('field extraction', () => {
        it('extracts string field', () => {
            let codec = createSafeCodecV2();
            let data = { active: true, name: 'Alice' };
            let encoded = codec.encode(data);

            expect(codec.extractField(encoded, 'name')).toBe('Alice');
        });

        it('extracts fixed field', () => {
            let codec = createSafeCodecV2();
            let data = { active: true, name: 'test' };
            let encoded = codec.encode(data);

            expect(codec.extractField(encoded, 'active')).toBe(true);
        });

        it('returns undefined for missing field', () => {
            let codec = createSafeCodecV2();
            let data = { name: 'Alice' };
            let encoded = codec.encode(data);

            expect(codec.extractField(encoded, 'missing')).toBe(undefined);
        });
    });

    describe('edge cases', () => {
        it('handles unicode strings', () => {
            let codec = createSafeCodecV2();
            let data = { name: 'こんにちは世界' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('handles empty string fields', () => {
            let codec = createSafeCodecV2();
            let data = { name: '' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('handles Map encoding', () => {
            let codec = createSafeCodecV2();
            let map = new Map<string, number>([['a', 1], ['b', 2]]);
            let decoded = codec.decode(codec.encode(map)) as [string, number][];

            expect(decoded).toHaveLength(2);
        });

        it('handles Set encoding', () => {
            let codec = createSafeCodecV2();
            let set = new Set([1, 2, 3]);
            let decoded = codec.decode(codec.encode(set)) as number[];

            expect(decoded).toHaveLength(3);
        });

        it('handles nested arrays', () => {
            let codec = createSafeCodecV2();
            let data = [1, 'hello', true];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });
});
