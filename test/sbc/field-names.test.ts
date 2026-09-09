import { describe, expect, it } from 'vitest';
import { codec, createAsyncCache, createCache, resolvable } from '../../src/sbc';

import type { StoredSchema } from '../../src/sbc';


let hex = (b: Uint8Array) => Buffer.from(b).toString('hex');


describe('field names — arbitrary non-identifier keys', () => {
    describe('round-trip, same instance', () => {
        it('hyphen/dot/space/unicode keys round-trip and computeSize agrees', () => {
            let c = codec(),
                value = { 'a.b': 1, 'c d': 's', 'prompt-stash': { enabled: true }, '日本': 2 };

            let encoded = c.encode(value);

            expect(c.decode(encoded)).toEqual(value);
            expect(c.computeSize(value)).toBe(encoded.length);
        });
    });


    describe('cross-instance (T3 browser realm)', () => {
        it('a second codec sharing a non-evicting cache decodes hyphenated keys', () => {
            let shared = createCache<number, StoredSchema>(Infinity),
                c1 = codec({ cache: shared }),
                c2 = codec({ cache: shared }),
                value = { 'prompt-stash': { enabled: true }, 'source-control-github': { enabled: false } };

            expect(c2.decode(c1.encode(value))).toEqual(value);
        });

        it('async resolvable decode fetches the missing hyphenated schema', async () => {
            let shared = createCache<number, StoredSchema>(Infinity),
                isolated = createCache<number, StoredSchema>(Infinity),
                c1 = codec({ cache: shared }),
                c2 = codec({ cache: isolated }),
                value = { installedPlugins: { 'prompt-stash': { enabled: true }, 'source-control-github': { enabled: false } } };

            let encoded = c1.encode(value),
                schemas = createAsyncCache(isolated, async (hashes: number[]) => {
                    let out = new Map<number, StoredSchema>();

                    for (let i = 0, n = hashes.length; i < n; i++) {
                        let stored = shared.get(hashes[i]!);

                        if (stored) {
                            out.set(hashes[i]!, stored);
                        }
                    }

                    return out;
                });

            let decode = resolvable(c2, schemas);

            expect(await decode(encoded)).toEqual(value);
        });
    });


    describe('nested + array-of', () => {
        for (let compress of [false, true]) {
            it('nested hyphenated-key object cross-instance (compress=' + compress + ')', () => {
                let shared = createCache<number, StoredSchema>(Infinity),
                    c1 = codec({ cache: shared, compress }),
                    c2 = codec({ cache: shared, compress }),
                    value = { installedPlugins: { 'prompt-stash': { count: 3 }, 'source-control-github': { count: 7 } } };

                expect(c2.decode(c1.encode(value))).toEqual(value);
            });

            it('array of hyphenated-key objects cross-instance (compress=' + compress + ')', () => {
                let shared = createCache<number, StoredSchema>(Infinity),
                    c1 = codec({ cache: shared, compress }),
                    c2 = codec({ cache: shared, compress }),
                    value = [{ 'x-y': 1 }, { 'x-y': 2 }];

                expect(c2.decode(c1.encode(value))).toEqual(value);
            });

            it('deeply nested list of hyphenated/dotted keys cross-instance (compress=' + compress + ')', () => {
                let shared = createCache<number, StoredSchema>(Infinity),
                    c1 = codec({ cache: shared, compress }),
                    c2 = codec({ cache: shared, compress }),
                    value = { list: [{ 'k-1': { 'deep.key': true } }] };

                expect(c2.decode(c1.encode(value))).toEqual(value);
            });
        }
    });


    describe('hinted encode/decode', () => {
        it('defineSchema with hyphenated names returns a hash and round-trips by hint', () => {
            let c = codec(),
                schema = c.defineSchema([
                    { name: 'prompt-stash', type: 'object' },
                    { name: 'source-control-github', type: 'object' },
                ]),
                value = { 'prompt-stash': { enabled: true }, 'source-control-github': { enabled: false } };

            expect(typeof schema).toBe('number');

            let encoded = c.encode(value, { schema });

            expect(c.decode(encoded, { schema })).toEqual(value);
        });
    });


    describe('registry serialization', () => {
        it('deserializeRegistry accepts hyphenated names and the schema decodes', () => {
            let c1 = codec(),
                c2 = codec(),
                value = { 'prompt-stash': { enabled: true }, 'source-control-github': { enabled: false } };

            let encoded = c1.encode(value);

            c2.deserializeRegistry(c1.serializeRegistry());

            expect(c2.decode(encoded)).toEqual(value);
        });

        it('a crafted zero-length name still throws', () => {
            let c1 = codec();

            c1.defineSchema([{ name: 'prompt-stash', type: 'uint8' }]);

            let corrupt = new Uint8Array(c1.serializeRegistry());

            // Registry: u16 schemaCount(0-1) + u32 hash(2-5) + u16 fieldCount(6-7) + u16 nameLen(8-9)
            corrupt[8] = 0;
            corrupt[9] = 0;

            expect(() => codec().deserializeRegistry(corrupt)).toThrow('@esportsplus/data: codec empty field name in registry data');
        });
    });


    describe('field extraction', () => {
        it('extractField reads a hyphenated key', () => {
            let c = codec(),
                value = { 'prompt-stash': { enabled: true }, 'source-control-github': { enabled: false } };

            let encoded = c.encode(value);

            expect(c.extractField(encoded, 'prompt-stash')).toEqual({ enabled: true });
        });
    });


    describe('rejections', () => {
        it('defineSchema rejects an empty field name', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: '', type: 'uint8' }])).toThrow('@esportsplus/data: codec invalid field name');
        });

        it('encode rejects an empty field name', () => {
            let c = codec();

            expect(() => c.encode({ '': 1 })).toThrow('@esportsplus/data: codec invalid field name');
        });

        it('defineSchema rejects a name exceeding 65535 UTF-8 bytes', () => {
            let c = codec(),
                name = 'a'.repeat(65536);

            expect(() => c.defineSchema([{ name, type: 'uint8' }])).toThrow('@esportsplus/data: codec invalid field name');
        });
    });


    describe('__proto__ / constructor as own keys', () => {
        it('__proto__ (with a hyphenated sibling) round-trips as an own key on the null-proto result', () => {
            let c = codec(),
                data = Object.create(null) as Record<string, unknown>;

            data['__proto__'] = 'safe';
            data['prompt-stash'] = 'test';

            let decoded = c.decode(c.encode(data)) as Record<string, unknown>;

            expect(decoded['__proto__']).toBe('safe');
            expect(decoded['prompt-stash']).toBe('test');

            let proto = Object.getPrototypeOf(decoded);

            expect(proto).not.toBe(Object.prototype);
            expect(Object.getPrototypeOf(proto)).toBe(null);
        });

        it('an own constructor key is rejected by the plain-object backstop', () => {
            // Independent of the field-name gate: the encoder's Encodable backstop
            // (tagged.ts) reads value.constructor to reject class instances, so any
            // object carrying an own `constructor` set to a non-Object value is
            // unrepresentable — the field-name relaxation does not change this.
            let c = codec(),
                data = Object.create(null) as Record<string, unknown>;

            data['constructor'] = 'ctor';

            expect(() => c.encode(data)).toThrow('@esportsplus/data: codec unrepresentable value');
        });
    });


    describe('byte-stability regression', () => {
        // Baseline literals captured on unchanged 0.13.0 source BEFORE the field-name gate
        // relaxed; identifier-keyed structs must stay byte-identical after the change.
        it('uncompressed identifier-keyed struct is byte-identical', () => {
            let c = codec(),
                encoded = c.encode({ active: true, age: 30, name: 'Alice' });

            expect(hex(encoded)).toBe('08c5fe952308000000011e05416c696365');
            expect((encoded[1]! | (encoded[2]! << 8) | (encoded[3]! << 16) | (encoded[4]! << 24)) >>> 0).toBe(597032645);
        });

        it('compressed nested identifier-keyed struct is byte-identical', () => {
            let c = codec({ compress: true }),
                encoded = c.encode({ flag: false, score: 99.5, user: { active: true, age: 30, name: 'Alice' } });

            expect(hex(encoded)).toBe('12008e1f461b00000000010000000000e0584012c5fe952308000000011e05416c696365');
        });
    });
});
