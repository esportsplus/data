import { afterAll, bench, describe } from 'vitest';
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


// Pre-encode for decode benchmarks

let protoArrayEncoded = protoArray.encode(arrayData),
    protoLargeEncoded = protoLarge.encode(largeData),
    protoMultiEncoded = protoMulti.encode(multiData),
    protoNestedEncoded = protoNested.encode(nestedData),
    protoSimpleEncoded = protoSimple.encode(simpleData);


// Warm up SBC (first encode infers schema + compiles)

let sbcArrayEncoded = sbcCodec.encode(arrayData),
    sbcLargeEncoded = sbcCodec.encode(largeData),
    sbcMultiEncoded = sbcCodec.encode(multiData),
    sbcNestedEncoded = sbcCodec.encode(nestedData),
    sbcSimpleEncoded = sbcCodec.encode(simpleData);


// Extra warmup — run each path 2000 times to stabilize JIT

for (let i = 0; i < 2000; i++) {
    protoSimple.encode(simpleData);
    protoSimple.decode(protoSimpleEncoded);
    protoMulti.encode(multiData);
    protoMulti.decode(protoMultiEncoded);
    protoNested.encode(nestedData);
    protoNested.decode(protoNestedEncoded);
    protoArray.encode(arrayData);
    protoArray.decode(protoArrayEncoded);
    protoLarge.encode(largeData);
    protoLarge.decode(protoLargeEncoded);
    sbcCodec.encode(simpleData);
    sbcCodec.decode(sbcSimpleEncoded);
    sbcCodec.encode(multiData);
    sbcCodec.decode(sbcMultiEncoded);
    sbcCodec.encode(nestedData);
    sbcCodec.decode(sbcNestedEncoded);
    sbcCodec.encode(arrayData);
    sbcCodec.decode(sbcArrayEncoded);
    sbcCodec.encode(largeData);
    sbcCodec.decode(sbcLargeEncoded);
}


// Wire sizes

console.log('\n--- Wire Size Comparison (bytes) ---');
console.log(`Simple   { name }              — Proto: ${protoSimpleEncoded.length}  SBC: ${sbcSimpleEncoded.length}`);
console.log(`Multi    { active, age, name }  — Proto: ${protoMultiEncoded.length}  SBC: ${sbcMultiEncoded.length}`);
console.log(`Nested   { address, name }      — Proto: ${protoNestedEncoded.length}  SBC: ${sbcNestedEncoded.length}`);
console.log(`Array    { items: number[100] } — Proto: ${protoArrayEncoded.length}  SBC: ${sbcArrayEncoded.length}`);
console.log(`Large    { 6 fields }           — Proto: ${protoLargeEncoded.length}  SBC: ${sbcLargeEncoded.length}`);
console.log('');


// Benchmark options — high warmup to ensure JIT is fully optimized

let opts = { warmupIterations: 2000, warmupTime: 1000 };


// Cooldown: burn CPU briefly with no allocation to let GC settle
// and prevent thermal-related frequency scaling from skewing results

function cooldown(): void {
    let end = Date.now() + 200,
        x = 0;

    while (Date.now() < end) {
        x += Math.sqrt(x + 1);
    }

    if (x < 0) {
        console.log(x);
    }
}


// === PROTO ENCODE (all scenarios) ===

describe('Proto Encode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { protoSimple.encode(simpleData); }, opts);
    bench('multi { active, age, name }', () => { protoMulti.encode(multiData); }, opts);
    bench('nested { address, name }', () => { protoNested.encode(nestedData); }, opts);
    bench('array { items[100] }', () => { protoArray.encode(arrayData); }, opts);
    bench('large { 6 fields }', () => { protoLarge.encode(largeData); }, opts);
});

// === SBC ENCODE (all scenarios) ===

describe('SBC Encode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { sbcCodec.encode(simpleData); }, opts);
    bench('multi { active, age, name }', () => { sbcCodec.encode(multiData); }, opts);
    bench('nested { address, name }', () => { sbcCodec.encode(nestedData); }, opts);
    bench('array { items[100] }', () => { sbcCodec.encode(arrayData); }, opts);
    bench('large { 6 fields }', () => { sbcCodec.encode(largeData); }, opts);
});

// === PROTO DECODE (all scenarios) ===

describe('Proto Decode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { protoSimple.decode(protoSimpleEncoded); }, opts);
    bench('multi { active, age, name }', () => { protoMulti.decode(protoMultiEncoded); }, opts);
    bench('nested { address, name }', () => { protoNested.decode(protoNestedEncoded); }, opts);
    bench('array { items[100] }', () => { protoArray.decode(protoArrayEncoded); }, opts);
    bench('large { 6 fields }', () => { protoLarge.decode(protoLargeEncoded); }, opts);
});

// === SBC DECODE (all scenarios) ===

describe('SBC Decode', () => {
    bench('simple { name }', () => { sbcCodec.decode(sbcSimpleEncoded); }, opts);
    bench('multi { active, age, name }', () => { sbcCodec.decode(sbcMultiEncoded); }, opts);
    bench('nested { address, name }', () => { sbcCodec.decode(sbcNestedEncoded); }, opts);
    bench('array { items[100] }', () => { sbcCodec.decode(sbcArrayEncoded); }, opts);
    bench('large { 6 fields }', () => { sbcCodec.decode(sbcLargeEncoded); }, opts);
});
