// Codec2 vs MsgPackr benchmark
// Measures encode/decode throughput across multiple data shapes

import { afterAll, bench, describe } from 'vitest';
import { pack, unpack } from 'msgpackr';
import { codec } from '../../src/sbc';


let c = codec();


// Test data
let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Pre-encode for decode benchmarks
let codec2ArrayEncoded = c.encode(arrayData),
    codec2LargeEncoded = c.encode(largeData),
    codec2MultiEncoded = c.encode(multiData),
    codec2NestedEncoded = c.encode(nestedData),
    codec2SimpleEncoded = c.encode(simpleData);

let msgArrayEncoded = pack(arrayData),
    msgLargeEncoded = pack(largeData),
    msgMultiEncoded = pack(multiData),
    msgNestedEncoded = pack(nestedData),
    msgSimpleEncoded = pack(simpleData);


// Warmup — 2000 iterations each to stabilize JIT
for (let i = 0; i < 2000; i++) {
    c.encode(simpleData);
    c.decode(codec2SimpleEncoded);
    c.encode(multiData);
    c.decode(codec2MultiEncoded);
    c.encode(nestedData);
    c.decode(codec2NestedEncoded);
    c.encode(arrayData);
    c.decode(codec2ArrayEncoded);
    c.encode(largeData);
    c.decode(codec2LargeEncoded);
    pack(simpleData);
    unpack(msgSimpleEncoded);
    pack(multiData);
    unpack(msgMultiEncoded);
    pack(nestedData);
    unpack(msgNestedEncoded);
    pack(arrayData);
    unpack(msgArrayEncoded);
    pack(largeData);
    unpack(msgLargeEncoded);
}

// Verify correctness
function verify(original: unknown, encoded: Uint8Array): void {
    let decoded = c.decode(encoded);
    let a = JSON.stringify(original),
        b = JSON.stringify(decoded);

    if (a !== b) {
        console.error('MISMATCH!');
        console.error('Original:', a);
        console.error('Decoded: ', b);
        throw new Error('Codec2 encode/decode mismatch');
    }
}

verify(simpleData, codec2SimpleEncoded);
verify(multiData, codec2MultiEncoded);
verify(nestedData, codec2NestedEncoded);
verify(arrayData, codec2ArrayEncoded);
verify(largeData, codec2LargeEncoded);


// Wire sizes
console.log('\n--- Wire Size Comparison (bytes) ---');
console.log(`Simple   { name }              — Codec2: ${codec2SimpleEncoded.length}  MsgPack: ${msgSimpleEncoded.length}`);
console.log(`Multi    { active, age, name }  — Codec2: ${codec2MultiEncoded.length}  MsgPack: ${msgMultiEncoded.length}`);
console.log(`Nested   { address, name }      — Codec2: ${codec2NestedEncoded.length}  MsgPack: ${msgNestedEncoded.length}`);
console.log(`Array    { items: number[100] } — Codec2: ${codec2ArrayEncoded.length}  MsgPack: ${msgArrayEncoded.length}`);
console.log(`Large    { 6 fields }           — Codec2: ${codec2LargeEncoded.length}  MsgPack: ${msgLargeEncoded.length}`);
console.log('');


let opts = { warmupIterations: 2000, warmupTime: 1000 };

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


// === CODEC2 ENCODE ===

describe('Codec2 Encode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { c.encode(simpleData); }, opts);
    bench('multi { active, age, name }', () => { c.encode(multiData); }, opts);
    bench('nested { address, name }', () => { c.encode(nestedData); }, opts);
    bench('array { items[100] }', () => { c.encode(arrayData); }, opts);
    bench('large { 6 fields }', () => { c.encode(largeData); }, opts);
});


// === MSGPACK ENCODE ===

describe('MsgPack Encode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { pack(simpleData); }, opts);
    bench('multi { active, age, name }', () => { pack(multiData); }, opts);
    bench('nested { address, name }', () => { pack(nestedData); }, opts);
    bench('array { items[100] }', () => { pack(arrayData); }, opts);
    bench('large { 6 fields }', () => { pack(largeData); }, opts);
});


// === CODEC2 DECODE ===

describe('Codec2 Decode', () => {
    afterAll(() => cooldown());
    bench('simple { name }', () => { c.decode(codec2SimpleEncoded); }, opts);
    bench('multi { active, age, name }', () => { c.decode(codec2MultiEncoded); }, opts);
    bench('nested { address, name }', () => { c.decode(codec2NestedEncoded); }, opts);
    bench('array { items[100] }', () => { c.decode(codec2ArrayEncoded); }, opts);
    bench('large { 6 fields }', () => { c.decode(codec2LargeEncoded); }, opts);
});


// === MSGPACK DECODE ===

describe('MsgPack Decode', () => {
    bench('simple { name }', () => { unpack(msgSimpleEncoded); }, opts);
    bench('multi { active, age, name }', () => { unpack(msgMultiEncoded); }, opts);
    bench('nested { address, name }', () => { unpack(msgNestedEncoded); }, opts);
    bench('array { items[100] }', () => { unpack(msgArrayEncoded); }, opts);
    bench('large { 6 fields }', () => { unpack(msgLargeEncoded); }, opts);
});
