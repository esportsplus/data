// Standalone benchmark: Codec2 vs MsgPackr
// Run: npx tsx tests/bench/codec2-standalone.ts

import { performance } from 'perf_hooks';
import { pack, unpack } from 'msgpackr';
import { codec } from '../../src/sbc';


let c = codec();

// Test data
let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Pre-encode
let c2Simple = c.encode(simpleData),
    c2Multi = c.encode(multiData),
    c2Nested = c.encode(nestedData),
    c2Array = c.encode(arrayData),
    c2Large = c.encode(largeData);

let mpSimple = pack(simpleData),
    mpMulti = pack(multiData),
    mpNested = pack(nestedData),
    mpArray = pack(arrayData),
    mpLarge = pack(largeData);


// Verify correctness
function verify(name: string, original: unknown, encoded: Uint8Array): void {
    let decoded = c.decode(encoded),
        a = JSON.stringify(original),
        b = JSON.stringify(decoded);

    if (a !== b) {
        console.error(`MISMATCH on ${name}!`);
        console.error('Original:', a);
        console.error('Decoded: ', b);
        process.exit(1);
    }
}

verify('simple', simpleData, c2Simple);
verify('multi', multiData, c2Multi);
verify('nested', nestedData, c2Nested);
verify('array', arrayData, c2Array);
verify('large', largeData, c2Large);


console.log('\n=== Wire Size Comparison (bytes) ===');
console.log(`Simple   — Codec2: ${c2Simple.length}  MsgPack: ${mpSimple.length}`);
console.log(`Multi    — Codec2: ${c2Multi.length}  MsgPack: ${mpMulti.length}`);
console.log(`Nested   — Codec2: ${c2Nested.length}  MsgPack: ${mpNested.length}`);
console.log(`Array    — Codec2: ${c2Array.length}  MsgPack: ${mpArray.length}`);
console.log(`Large    — Codec2: ${c2Large.length}  MsgPack: ${mpLarge.length}`);


// Warmup
for (let i = 0; i < 5000; i++) {
    c.encode(simpleData);
    c.decode(c2Simple);
    c.encode(multiData);
    c.decode(c2Multi);
    c.encode(nestedData);
    c.decode(c2Nested);
    c.encode(arrayData);
    c.decode(c2Array);
    c.encode(largeData);
    c.decode(c2Large);
    pack(simpleData);
    unpack(mpSimple);
    pack(multiData);
    unpack(mpMulti);
    pack(nestedData);
    unpack(mpNested);
    pack(arrayData);
    unpack(mpArray);
    pack(largeData);
    unpack(mpLarge);
}


function benchFn(name: string, fn: () => void, iterations: number = 500000): { name: string; opsPerSec: number; nsPerOp: number } {
    // Warmup
    for (let i = 0; i < 1000; i++) {
        fn();
    }

    let start = performance.now();

    for (let i = 0; i < iterations; i++) {
        fn();
    }

    let elapsed = performance.now() - start,
        nsPerOp = (elapsed * 1_000_000) / iterations,
        opsPerSec = Math.round((iterations / elapsed) * 1000);

    return { name, nsPerOp: Math.round(nsPerOp), opsPerSec };
}


type Scenario = { c2Encoded: Uint8Array; data: unknown; mpEncoded: Uint8Array; name: string };

let scenarios: Scenario[] = [
    { c2Encoded: c2Simple, data: simpleData, mpEncoded: mpSimple, name: 'simple { name }' },
    { c2Encoded: c2Multi, data: multiData, mpEncoded: mpMulti, name: 'multi { active, age, name }' },
    { c2Encoded: c2Nested, data: nestedData, mpEncoded: mpNested, name: 'nested { address, name }' },
    { c2Encoded: c2Array, data: arrayData, mpEncoded: mpArray, name: 'array { items[100] }' },
    { c2Encoded: c2Large, data: largeData, mpEncoded: mpLarge, name: 'large { 6 fields }' },
];


console.log('\n=== ENCODE BENCHMARK ===');
console.log('Scenario                       | Codec2 ops/s  | MsgPack ops/s | Ratio');
console.log('-------------------------------|--------------|---------------|------');

let totalC2Encode = 0,
    totalMpEncode = 0;

for (let s of scenarios) {
    let c2 = benchFn(`Codec2 ${s.name}`, () => { c.encode(s.data); }),
        mp = benchFn(`MsgPack ${s.name}`, () => { pack(s.data); }),
        ratio = (c2.opsPerSec / mp.opsPerSec).toFixed(2);

    totalC2Encode += c2.opsPerSec;
    totalMpEncode += mp.opsPerSec;

    console.log(`${s.name.padEnd(30)} | ${c2.opsPerSec.toLocaleString().padStart(12)} | ${mp.opsPerSec.toLocaleString().padStart(13)} | ${ratio}x`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${totalC2Encode.toLocaleString().padStart(12)} | ${totalMpEncode.toLocaleString().padStart(13)} | ${(totalC2Encode / totalMpEncode).toFixed(2)}x`);


// Fresh objects benchmark (no WeakMap hits)
console.log('\n=== ENCODE BENCHMARK (fresh objects) ===');
console.log('Scenario                       | Codec2 ops/s  | MsgPack ops/s | Ratio');
console.log('-------------------------------|--------------|---------------|------');

let totalC2EncodeFresh = 0,
    totalMpEncodeFresh = 0;

type FreshFactory = { c2Encoded: Uint8Array; factory: () => unknown; mpEncoded: Uint8Array; name: string };

let freshScenarios: FreshFactory[] = [
    { c2Encoded: c2Simple, factory: () => ({ name: 'Alice' }), mpEncoded: mpSimple, name: 'simple { name }' },
    { c2Encoded: c2Multi, factory: () => ({ active: true, age: 30, name: 'Alice' }), mpEncoded: mpMulti, name: 'multi { active, age, name }' },
    { c2Encoded: c2Nested, factory: () => ({ address: { city: 'NYC', zip: '10001' }, name: 'Alice' }), mpEncoded: mpNested, name: 'nested { address, name }' },
    { c2Encoded: c2Array, factory: () => ({ items: Array.from({ length: 100 }, (_, i) => i) }), mpEncoded: mpArray, name: 'array { items[100] }' },
    { c2Encoded: c2Large, factory: () => ({ active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 }), mpEncoded: mpLarge, name: 'large { 6 fields }' },
];

for (let s of freshScenarios) {
    let c2 = benchFn(`Codec2 ${s.name}`, () => { c.encode(s.factory()); }),
        mp = benchFn(`MsgPack ${s.name}`, () => { pack(s.factory()); }),
        ratio = (c2.opsPerSec / mp.opsPerSec).toFixed(2);

    totalC2EncodeFresh += c2.opsPerSec;
    totalMpEncodeFresh += mp.opsPerSec;

    console.log(`${s.name.padEnd(30)} | ${c2.opsPerSec.toLocaleString().padStart(12)} | ${mp.opsPerSec.toLocaleString().padStart(13)} | ${ratio}x`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${totalC2EncodeFresh.toLocaleString().padStart(12)} | ${totalMpEncodeFresh.toLocaleString().padStart(13)} | ${(totalC2EncodeFresh / totalMpEncodeFresh).toFixed(2)}x`);


console.log('\n=== DECODE BENCHMARK ===');
console.log('Scenario                       | Codec2 ops/s  | MsgPack ops/s | Ratio');
console.log('-------------------------------|--------------|---------------|------');

let totalC2Decode = 0,
    totalMpDecode = 0;

for (let s of scenarios) {
    let c2 = benchFn(`Codec2 ${s.name}`, () => { c.decode(s.c2Encoded); }),
        mp = benchFn(`MsgPack ${s.name}`, () => { unpack(s.mpEncoded); }),
        ratio = (c2.opsPerSec / mp.opsPerSec).toFixed(2);

    totalC2Decode += c2.opsPerSec;
    totalMpDecode += mp.opsPerSec;

    console.log(`${s.name.padEnd(30)} | ${c2.opsPerSec.toLocaleString().padStart(12)} | ${mp.opsPerSec.toLocaleString().padStart(13)} | ${ratio}x`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${totalC2Decode.toLocaleString().padStart(12)} | ${totalMpDecode.toLocaleString().padStart(13)} | ${(totalC2Decode / totalMpDecode).toFixed(2)}x`);


// Output metric for autoresearch
let avgEncodeRatio = totalC2Encode / totalMpEncode,
    avgDecodeRatio = totalC2Decode / totalMpDecode;

console.log(`\ncodec2-encode-ratio: ${avgEncodeRatio.toFixed(4)}`);
console.log(`codec2-decode-ratio: ${avgDecodeRatio.toFixed(4)}`);
console.log(`codec2-combined-ratio: ${((avgEncodeRatio + avgDecodeRatio) / 2).toFixed(4)}`);
