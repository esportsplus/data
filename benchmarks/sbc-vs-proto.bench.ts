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


// Extra warmup — run each path 1000 times to stabilize JIT

for (let i = 0; i < 1000; i++) {
    protoSimple.encode(simpleData);
    protoSimple.decode(protoSimpleEncoded);
    sbcCodec.encode(simpleData);
    sbcCodec.decode(sbcSimpleEncoded);
    protoMulti.encode(multiData);
    protoMulti.decode(protoMultiEncoded);
    sbcCodec.encode(multiData);
    sbcCodec.decode(sbcMultiEncoded);
    protoLarge.encode(largeData);
    protoLarge.decode(protoLargeEncoded);
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


// Benchmarks — each scenario in its own describe block with warmup iterations
// The { warmupIterations, warmupTime } ensure JIT is hot before measurement

let opts = { warmupIterations: 1000, warmupTime: 500 };


describe('Encode: Simple { name }', () => {
    bench('proto', () => { protoSimple.encode(simpleData); }, opts);
    bench('sbc', () => { sbcCodec.encode(simpleData); }, opts);
});

describe('Decode: Simple { name }', () => {
    bench('proto', () => { protoSimple.decode(protoSimpleEncoded); }, opts);
    bench('sbc', () => { sbcCodec.decode(sbcSimpleEncoded); }, opts);
});

describe('Encode: Multi-Field { active, age, name }', () => {
    bench('proto', () => { protoMulti.encode(multiData); }, opts);
    bench('sbc', () => { sbcCodec.encode(multiData); }, opts);
});

describe('Decode: Multi-Field { active, age, name }', () => {
    bench('proto', () => { protoMulti.decode(protoMultiEncoded); }, opts);
    bench('sbc', () => { sbcCodec.decode(sbcMultiEncoded); }, opts);
});

describe('Encode: Nested { address: { city, zip }, name }', () => {
    bench('proto', () => { protoNested.encode(nestedData); }, opts);
    bench('sbc', () => { sbcCodec.encode(nestedData); }, opts);
});

describe('Decode: Nested { address: { city, zip }, name }', () => {
    bench('proto', () => { protoNested.decode(protoNestedEncoded); }, opts);
    bench('sbc', () => { sbcCodec.decode(sbcNestedEncoded); }, opts);
});

describe('Encode: Array { items: number[100] }', () => {
    bench('proto', () => { protoArray.encode(arrayData); }, opts);
    bench('sbc', () => { sbcCodec.encode(arrayData); }, opts);
});

describe('Decode: Array { items: number[100] }', () => {
    bench('proto', () => { protoArray.decode(protoArrayEncoded); }, opts);
    bench('sbc', () => { sbcCodec.decode(sbcArrayEncoded); }, opts);
});

describe('Encode: Large { 6 fields }', () => {
    bench('proto', () => { protoLarge.encode(largeData); }, opts);
    bench('sbc', () => { sbcCodec.encode(largeData); }, opts);
});

describe('Decode: Large { 6 fields }', () => {
    bench('proto', () => { protoLarge.decode(protoLargeEncoded); }, opts);
    bench('sbc', () => { sbcCodec.decode(sbcLargeEncoded); }, opts);
});
