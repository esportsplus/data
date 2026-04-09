// Standalone benchmark: Codec2 vs SBC vs Proto vs MsgPackr
// Run: npx tsx tests/bench/all-codecs.ts

import { performance } from 'perf_hooks';
import { pack, unpack } from 'msgpackr';
import { createCodec as createCodec2 } from '../../src/sbc';
import { createCodec as createSbcCodec } from '../../src/sbc';
import { createCodec as createProtoCodec } from '../utils';


// Test data

let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Codec setup

let codec2 = createCodec2(),
    sbc = createSbcCodec();

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


// Pre-encode

let c2Simple = codec2.encode(simpleData),
    c2Multi = codec2.encode(multiData),
    c2Nested = codec2.encode(nestedData),
    c2Array = codec2.encode(arrayData),
    c2Large = codec2.encode(largeData);

let sbcSimple = sbc.encode(simpleData),
    sbcMulti = sbc.encode(multiData),
    sbcNested = sbc.encode(nestedData),
    sbcArray = sbc.encode(arrayData),
    sbcLarge = sbc.encode(largeData);

let protoSimpleEnc = protoSimple.encode(simpleData),
    protoMultiEnc = protoMulti.encode(multiData),
    protoNestedEnc = protoNested.encode(nestedData),
    protoArrayEnc = protoArray.encode(arrayData),
    protoLargeEnc = protoLarge.encode(largeData);

let mpSimple = pack(simpleData),
    mpMulti = pack(multiData),
    mpNested = pack(nestedData),
    mpArray = pack(arrayData),
    mpLarge = pack(largeData);


// Wire size comparison

console.log('\n=== Wire Size Comparison (bytes) ===');
console.log('Scenario                       | Codec2 | SBC    | Proto  | MsgPack | Winner');
console.log('-------------------------------|--------|--------|--------|---------|--------');

let wireScenarios = [
    { c2: c2Simple, mp: mpSimple, name: 'simple { name }', proto: protoSimpleEnc, sbc: sbcSimple },
    { c2: c2Multi, mp: mpMulti, name: 'multi { active, age, name }', proto: protoMultiEnc, sbc: sbcMulti },
    { c2: c2Nested, mp: mpNested, name: 'nested { address, name }', proto: protoNestedEnc, sbc: sbcNested },
    { c2: c2Array, mp: mpArray, name: 'array { items[100] }', proto: protoArrayEnc, sbc: sbcArray },
    { c2: c2Large, mp: mpLarge, name: 'large { 6 fields }', proto: protoLargeEnc, sbc: sbcLarge },
];

for (let w of wireScenarios) {
    let win = winner([
        { label: 'Codec2', value: w.c2.length },
        { label: 'SBC', value: w.sbc.length },
        { label: 'Proto', value: w.proto.length },
        { label: 'MsgPack', value: w.mp.length },
    ], 'min');

    console.log(`${w.name.padEnd(30)} | ${fmtBytes(w.c2.length)} | ${fmtBytes(w.sbc.length)} | ${fmtBytes(w.proto.length)} | ${fmtBytes(w.mp.length)}  | ${win}`);
}


// Warmup all codecs

for (let i = 0; i < 5000; i++) {
    codec2.encode(simpleData); codec2.decode(c2Simple);
    codec2.encode(multiData); codec2.decode(c2Multi);
    codec2.encode(nestedData); codec2.decode(c2Nested);
    codec2.encode(arrayData); codec2.decode(c2Array);
    codec2.encode(largeData); codec2.decode(c2Large);
    sbc.encode(simpleData); sbc.decode(sbcSimple);
    sbc.encode(multiData); sbc.decode(sbcMulti);
    sbc.encode(nestedData); sbc.decode(sbcNested);
    sbc.encode(arrayData); sbc.decode(sbcArray);
    sbc.encode(largeData); sbc.decode(sbcLarge);
    protoSimple.encode(simpleData); protoSimple.decode(protoSimpleEnc);
    protoMulti.encode(multiData); protoMulti.decode(protoMultiEnc);
    protoNested.encode(nestedData); protoNested.decode(protoNestedEnc);
    protoArray.encode(arrayData); protoArray.decode(protoArrayEnc);
    protoLarge.encode(largeData); protoLarge.decode(protoLargeEnc);
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
    protoCodec: { encode: (d: unknown) => Uint8Array; decode: (b: Uint8Array) => unknown };
    protoEnc: Uint8Array;
    sbcEnc: Uint8Array;
};

let scenarios: Scenario[] = [
    { c2Enc: c2Simple, data: simpleData, mpEnc: mpSimple, name: 'simple { name }', protoCodec: protoSimple as never, protoEnc: protoSimpleEnc, sbcEnc: sbcSimple },
    { c2Enc: c2Multi, data: multiData, mpEnc: mpMulti, name: 'multi { active, age, name }', protoCodec: protoMulti as never, protoEnc: protoMultiEnc, sbcEnc: sbcMulti },
    { c2Enc: c2Nested, data: nestedData, mpEnc: mpNested, name: 'nested { address, name }', protoCodec: protoNested as never, protoEnc: protoNestedEnc, sbcEnc: sbcNested },
    { c2Enc: c2Array, data: arrayData, mpEnc: mpArray, name: 'array { items[100] }', protoCodec: protoArray as never, protoEnc: protoArrayEnc, sbcEnc: sbcArray },
    { c2Enc: c2Large, data: largeData, mpEnc: mpLarge, name: 'large { 6 fields }', protoCodec: protoLarge as never, protoEnc: protoLargeEnc, sbcEnc: sbcLarge },
];


// === ENCODE ===

console.log('\n=== ENCODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |          SBC |        Proto |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------------|--------------|--------');

let totals = { c2Encode: 0, mpEncode: 0, protoEncode: 0, sbcEncode: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.encode(s.data); }),
        sb = benchFn(`sbc ${s.name}`, () => { sbc.encode(s.data); }),
        pr = benchFn(`proto ${s.name}`, () => { s.protoCodec.encode(s.data); }),
        mp = benchFn(`mp ${s.name}`, () => { pack(s.data); });

    totals.c2Encode += c2.opsPerSec;
    totals.sbcEncode += sb.opsPerSec;
    totals.protoEncode += pr.opsPerSec;
    totals.mpEncode += mp.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'SBC', value: sb.opsPerSec },
        { label: 'Proto', value: pr.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(sb.opsPerSec)} | ${fmtOps(pr.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(totals.c2Encode)} | ${fmtOps(totals.sbcEncode)} | ${fmtOps(totals.protoEncode)} | ${fmtOps(totals.mpEncode)} | ${winner([
    { label: 'Codec2', value: totals.c2Encode },
    { label: 'SBC', value: totals.sbcEncode },
    { label: 'Proto', value: totals.protoEncode },
    { label: 'MsgPack', value: totals.mpEncode },
])}`);


// === DECODE ===

console.log('\n=== DECODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |          SBC |        Proto |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------------|--------------|--------');

let decodeTotals = { c2: 0, mp: 0, proto: 0, sbc: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.decode(s.c2Enc); }),
        sb = benchFn(`sbc ${s.name}`, () => { sbc.decode(s.sbcEnc); }),
        pr = benchFn(`proto ${s.name}`, () => { s.protoCodec.decode(s.protoEnc); }),
        mp = benchFn(`mp ${s.name}`, () => { unpack(s.mpEnc); });

    decodeTotals.c2 += c2.opsPerSec;
    decodeTotals.sbc += sb.opsPerSec;
    decodeTotals.proto += pr.opsPerSec;
    decodeTotals.mp += mp.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'SBC', value: sb.opsPerSec },
        { label: 'Proto', value: pr.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(sb.opsPerSec)} | ${fmtOps(pr.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(decodeTotals.c2)} | ${fmtOps(decodeTotals.sbc)} | ${fmtOps(decodeTotals.proto)} | ${fmtOps(decodeTotals.mp)} | ${winner([
    { label: 'Codec2', value: decodeTotals.c2 },
    { label: 'SBC', value: decodeTotals.sbc },
    { label: 'Proto', value: decodeTotals.proto },
    { label: 'MsgPack', value: decodeTotals.mp },
])}`);


// Summary ratios vs MsgPack

console.log('\n=== SUMMARY (ratio vs MsgPack — higher is better) ===');
console.log(`Codec2  — Encode: ${fmtRatio(totals.c2Encode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.c2, decodeTotals.mp)}  Combined: ${fmtRatio((totals.c2Encode + decodeTotals.c2), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`SBC     — Encode: ${fmtRatio(totals.sbcEncode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.sbc, decodeTotals.mp)}  Combined: ${fmtRatio((totals.sbcEncode + decodeTotals.sbc), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`Proto   — Encode: ${fmtRatio(totals.protoEncode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.proto, decodeTotals.mp)}  Combined: ${fmtRatio((totals.protoEncode + decodeTotals.proto), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`MsgPack — Encode: 1.00x  Decode: 1.00x  Combined: 1.00x`);
