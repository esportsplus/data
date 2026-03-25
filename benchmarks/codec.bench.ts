import { bench, describe } from 'vitest';
import { createCodec } from '../tests/utils';


// Setup: create codecs outside bench functions (setup cost not measured)

let simpleCodec = createCodec<{ name: string }>(`
    type T = { name: string };
    codec<T>();
`);

let multiFieldCodec = createCodec<{ active: boolean; age: number; name: string }>(`
    type T = { active: boolean; age: number; name: string };
    codec<T>();
`);

let nestedCodec = createCodec<{ address: { city: string; zip: string }; name: string }>(`
    type T = { address: { city: string; zip: string }; name: string };
    codec<T>();
`);

let arrayCodec = createCodec<{ items: number[] }>(`
    type T = { items: number[] };
    codec<T>();
`);

let largeCodec = createCodec<{ active: boolean; age: number; email: string; name: string; score: number; tags: string[] }>(`
    type T = { active: boolean; age: number; email: string; name: string; score: number; tags: string[] };
    codec<T>();
`);


// Test data

let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'john@example.com', name: 'John', score: 99.5, tags: ['admin', 'user'] },
    multiFieldData = { active: true, age: 30, name: 'John' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'John' },
    simpleData = { name: 'John' };


// Pre-encode for decode benchmarks

let arrayEncoded = arrayCodec.encode(arrayData),
    largeEncoded = largeCodec.encode(largeData),
    multiFieldEncoded = multiFieldCodec.encode(multiFieldData),
    nestedEncoded = nestedCodec.encode(nestedData),
    simpleEncoded = simpleCodec.encode(simpleData);


describe('Codec Encode', () => {
    bench('encode: simple string', () => {
        simpleCodec.encode(simpleData);
    });

    bench('encode: multi-field', () => {
        multiFieldCodec.encode(multiFieldData);
    });

    bench('encode: nested object', () => {
        nestedCodec.encode(nestedData);
    });

    bench('encode: array (100 numbers)', () => {
        arrayCodec.encode(arrayData);
    });

    bench('encode: large object (6 fields)', () => {
        largeCodec.encode(largeData);
    });
});


describe('Codec Decode', () => {
    bench('decode: simple string', () => {
        simpleCodec.decode(simpleEncoded);
    });

    bench('decode: multi-field', () => {
        multiFieldCodec.decode(multiFieldEncoded);
    });

    bench('decode: nested object', () => {
        nestedCodec.decode(nestedEncoded);
    });

    bench('decode: array (100 numbers)', () => {
        arrayCodec.decode(arrayEncoded);
    });

    bench('decode: large object (6 fields)', () => {
        largeCodec.decode(largeEncoded);
    });
});
