import { bench, describe } from 'vitest';
import { createCodec as createProtoCodec } from '../tests/utils';
import { createCodec as createSbcCodec } from '../src/sbc';


// Proto codec setup (compile-time code generation)

let protoSimple = createProtoCodec<{ name: string }>(`
    type T = { name: string };
    codec<T>();
`);

let protoMulti = createProtoCodec<{ active: boolean; age: number; name: string }>(`
    type T = { active: boolean; age: number; name: string };
    codec<T>();
`);

let protoNested = createProtoCodec<{ address: { city: string; zip: string }; name: string }>(`
    type T = { address: { city: string; zip: string }; name: string };
    codec<T>();
`);

let protoArray = createProtoCodec<{ items: number[] }>(`
    type T = { items: number[] };
    codec<T>();
`);

let protoLarge = createProtoCodec<{ active: boolean; age: number; email: string; name: string; role: string; score: number }>(`
    type T = { active: boolean; age: number; email: string; name: string; role: string; score: number };
    codec<T>();
`);


// SBC codec setup (runtime schema inference)

let sbcCodec = createSbcCodec();


// Test data (identical for both codecs)

let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Pre-encode for proto decode benchmarks

let protoArrayEncoded = protoArray.encode(arrayData),
    protoLargeEncoded = protoLarge.encode(largeData),
    protoMultiEncoded = protoMulti.encode(multiData),
    protoNestedEncoded = protoNested.encode(nestedData),
    protoSimpleEncoded = protoSimple.encode(simpleData);


// Warm up SBC (first encode infers schema + compiles encode/decode functions)

let sbcArrayEncoded = sbcCodec.encode(arrayData),
    sbcLargeEncoded = sbcCodec.encode(largeData),
    sbcMultiEncoded = sbcCodec.encode(multiData),
    sbcNestedEncoded = sbcCodec.encode(nestedData),
    sbcSimpleEncoded = sbcCodec.encode(simpleData);


// Verify SBC roundtrip before benchmarking

let sbcSimpleDecoded = sbcCodec.decode(sbcSimpleEncoded) as { name: string },
    sbcMultiDecoded = sbcCodec.decode(sbcMultiEncoded) as { active: boolean; age: number; name: string },
    sbcNestedDecoded = sbcCodec.decode(sbcNestedEncoded) as { address: { city: string; zip: string }; name: string },
    sbcArrayDecoded = sbcCodec.decode(sbcArrayEncoded) as { items: number[] },
    sbcLargeDecoded = sbcCodec.decode(sbcLargeEncoded) as { active: boolean; age: number; email: string; name: string; role: string; score: number };

console.log('SBC roundtrip check — simple:', JSON.stringify(sbcSimpleDecoded));
console.log('SBC roundtrip check — multi:', JSON.stringify(sbcMultiDecoded));
console.log('SBC roundtrip check — nested:', JSON.stringify(sbcNestedDecoded));
console.log('SBC roundtrip check — array[0..2]:', JSON.stringify(sbcArrayDecoded.items.slice(0, 3)));
console.log('SBC roundtrip check — large:', JSON.stringify(sbcLargeDecoded));


describe('Simple String Object: { name }', () => {
    bench('proto encode', () => {
        protoSimple.encode(simpleData);
    });

    bench('sbc encode', () => {
        sbcCodec.encode(simpleData);
    });

    bench('proto decode', () => {
        protoSimple.decode(protoSimpleEncoded);
    });

    bench('sbc decode', () => {
        sbcCodec.decode(sbcSimpleEncoded);
    });
});


describe('Multi-Field Object: { active, age, name }', () => {
    bench('proto encode', () => {
        protoMulti.encode(multiData);
    });

    bench('sbc encode', () => {
        sbcCodec.encode(multiData);
    });

    bench('proto decode', () => {
        protoMulti.decode(protoMultiEncoded);
    });

    bench('sbc decode', () => {
        sbcCodec.decode(sbcMultiEncoded);
    });
});


describe('Nested Object: { address: { city, zip }, name }', () => {
    bench('proto encode', () => {
        protoNested.encode(nestedData);
    });

    bench('sbc encode', () => {
        sbcCodec.encode(nestedData);
    });

    bench('proto decode', () => {
        protoNested.decode(protoNestedEncoded);
    });

    bench('sbc decode', () => {
        sbcCodec.decode(sbcNestedEncoded);
    });
});


describe('Number Array: { items: number[100] }', () => {
    bench('proto encode', () => {
        protoArray.encode(arrayData);
    });

    bench('sbc encode', () => {
        sbcCodec.encode(arrayData);
    });

    bench('proto decode', () => {
        protoArray.decode(protoArrayEncoded);
    });

    bench('sbc decode', () => {
        sbcCodec.decode(sbcArrayEncoded);
    });
});


describe('Large Object: { active, age, email, name, role, score }', () => {
    bench('proto encode', () => {
        protoLarge.encode(largeData);
    });

    bench('sbc encode', () => {
        sbcCodec.encode(largeData);
    });

    bench('proto decode', () => {
        protoLarge.decode(protoLargeEncoded);
    });

    bench('sbc decode', () => {
        sbcCodec.decode(sbcLargeEncoded);
    });
});


describe('Wire Size Comparison', () => {
    bench('wire sizes (logged only)', () => {
        console.log(
            'Simple — Proto:', protoSimpleEncoded.length, 'SBC:', sbcSimpleEncoded.length,
            '| Multi — Proto:', protoMultiEncoded.length, 'SBC:', sbcMultiEncoded.length,
            '| Nested — Proto:', protoNestedEncoded.length, 'SBC:', sbcNestedEncoded.length,
            '| Array — Proto:', protoArrayEncoded.length, 'SBC:', sbcArrayEncoded.length,
            '| Large — Proto:', protoLargeEncoded.length, 'SBC:', sbcLargeEncoded.length,
        );
    });
});
