// Standalone benchmark: Codec2 vs SBC vs MsgPackr
// Run: npx tsx tests/bench/all-codecs.ts

import { performance } from 'perf_hooks';
import { pack, unpack } from 'msgpackr';
import { codec as codec2Factory } from '../../src/sbc';


// Test data

let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Codec setup

let codec2 = codec2Factory();


// Pre-encode

let c2Simple = codec2.encode(simpleData),
    c2Multi = codec2.encode(multiData),
    c2Nested = codec2.encode(nestedData),
    c2Array = codec2.encode(arrayData),
    c2Large = codec2.encode(largeData);

let mpSimple = pack(simpleData),
    mpMulti = pack(multiData),
    mpNested = pack(nestedData),
    mpArray = pack(arrayData),
    mpLarge = pack(largeData);


// Wire size comparison

console.log('\n=== Wire Size Comparison (bytes) ===');
console.log('Scenario                       | Codec2 | MsgPack | Winner');
console.log('-------------------------------|--------|---------|--------');

let wireScenarios = [
    { c2: c2Simple, mp: mpSimple, name: 'simple { name }' },
    { c2: c2Multi, mp: mpMulti, name: 'multi { active, age, name }' },
    { c2: c2Nested, mp: mpNested, name: 'nested { address, name }' },
    { c2: c2Array, mp: mpArray, name: 'array { items[100] }' },
    { c2: c2Large, mp: mpLarge, name: 'large { 6 fields }' },
];

for (let w of wireScenarios) {
    let win = winner([
        { label: 'Codec2', value: w.c2.length },
        { label: 'MsgPack', value: w.mp.length },
    ], 'min');

    console.log(`${w.name.padEnd(30)} | ${fmtBytes(w.c2.length)} | ${fmtBytes(w.mp.length)}  | ${win}`);
}


// Warmup all codecs

for (let i = 0; i < 5000; i++) {
    codec2.encode(simpleData); codec2.decode(c2Simple);
    codec2.encode(multiData); codec2.decode(c2Multi);
    codec2.encode(nestedData); codec2.decode(c2Nested);
    codec2.encode(arrayData); codec2.decode(c2Array);
    codec2.encode(largeData); codec2.decode(c2Large);
    pack(simpleData); unpack(mpSimple);
    pack(multiData); unpack(mpMulti);
    pack(nestedData); unpack(mpNested);
    pack(arrayData); unpack(mpArray);
    pack(largeData); unpack(mpLarge);
}


function benchFn(name: string, fn: () => void, iterations: number = 500000): { name: string; opsPerSec: number } {
    for (let i = 0; i < 1000; i++) {
        fn();
    }

    let start = performance.now();

    for (let i = 0; i < iterations; i++) {
        fn();
    }

    let elapsed = performance.now() - start;

    return { name, opsPerSec: Math.round((iterations / elapsed) * 1000) };
}


function fmtBytes(n: number): string {
    return String(n).padStart(6);
}

function fmtOps(n: number): string {
    return n.toLocaleString().padStart(13);
}

function fmtRatio(a: number, b: number): string {
    return (a / b).toFixed(2) + 'x';
}

function winner(values: { label: string; value: number }[], mode: 'min' | 'max' = 'max'): string {
    let best = values[0];

    for (let i = 1, n = values.length; i < n; i++) {
        if (mode === 'max' ? values[i].value > best.value : values[i].value < best.value) {
            best = values[i];
        }
    }

    return best.label;
}


type Scenario = {
    c2Enc: Uint8Array;
    data: unknown;
    mpEnc: Uint8Array;
    name: string;
};

let scenarios: Scenario[] = [
    { c2Enc: c2Simple, data: simpleData, mpEnc: mpSimple, name: 'simple { name }' },
    { c2Enc: c2Multi, data: multiData, mpEnc: mpMulti, name: 'multi { active, age, name }' },
    { c2Enc: c2Nested, data: nestedData, mpEnc: mpNested, name: 'nested { address, name }' },
    { c2Enc: c2Array, data: arrayData, mpEnc: mpArray, name: 'array { items[100] }' },
    { c2Enc: c2Large, data: largeData, mpEnc: mpLarge, name: 'large { 6 fields }' },
];


// === ENCODE ===

console.log('\n=== ENCODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------');

let totals = { c2Encode: 0, mpEncode: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.encode(s.data); }),
        mp = benchFn(`mp ${s.name}`, () => { pack(s.data); });

    totals.c2Encode += c2.opsPerSec;
    totals.mpEncode += mp.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(totals.c2Encode)} | ${fmtOps(totals.mpEncode)} | ${winner([
    { label: 'Codec2', value: totals.c2Encode },
    { label: 'MsgPack', value: totals.mpEncode },
])}`);


// === DECODE ===

console.log('\n=== DECODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------');

let decodeTotals = { c2: 0, mp: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.decode(s.c2Enc); }),
        mp = benchFn(`mp ${s.name}`, () => { unpack(s.mpEnc); });

    decodeTotals.c2 += c2.opsPerSec;
    decodeTotals.mp += mp.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(decodeTotals.c2)} | ${fmtOps(decodeTotals.mp)} | ${winner([
    { label: 'Codec2', value: decodeTotals.c2 },
    { label: 'MsgPack', value: decodeTotals.mp },
])}`);


// Summary ratios vs MsgPack

console.log('\n=== SUMMARY (ratio vs MsgPack — higher is better) ===');
console.log(`Codec2  — Encode: ${fmtRatio(totals.c2Encode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.c2, decodeTotals.mp)}  Combined: ${fmtRatio((totals.c2Encode + decodeTotals.c2), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`MsgPack — Encode: 1.00x  Decode: 1.00x  Combined: 1.00x`);
