// Standalone benchmark: Codec2 vs Protobuf vs MsgPackr
// Run: npx tsx tests/bench/all-codecs.ts

import { performance } from 'perf_hooks';
import { pack, unpack } from 'msgpackr';
import { codec as codec2Factory } from '../../src/sbc';
import protobuf from 'protobufjs';


// Test data

let arrayData = { items: Array.from({ length: 100 }, (_, i) => i) },
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    nestedData = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' },
    simpleData = { name: 'Alice' };


// Codec setup

let codec2 = codec2Factory();


// Protobuf schema setup (runtime-defined)

let pbRoot = new protobuf.Root();

let pbSimpleType = new protobuf.Type('Simple')
    .add(new protobuf.Field('name', 1, 'string'));

let pbMultiType = new protobuf.Type('Multi')
    .add(new protobuf.Field('active', 1, 'bool'))
    .add(new protobuf.Field('age', 2, 'int32'))
    .add(new protobuf.Field('name', 3, 'string'));

let pbAddressType = new protobuf.Type('Address')
    .add(new protobuf.Field('city', 1, 'string'))
    .add(new protobuf.Field('zip', 2, 'string'));

let pbNestedType = new protobuf.Type('Nested')
    .add(pbAddressType)
    .add(new protobuf.Field('address', 1, 'Address'))
    .add(new protobuf.Field('name', 2, 'string'));

let pbArrayType = new protobuf.Type('ArrayMsg')
    .add(new protobuf.Field('items', 1, 'int32', 'repeated'));

let pbLargeType = new protobuf.Type('Large')
    .add(new protobuf.Field('active', 1, 'bool'))
    .add(new protobuf.Field('age', 2, 'int32'))
    .add(new protobuf.Field('email', 3, 'string'))
    .add(new protobuf.Field('name', 4, 'string'))
    .add(new protobuf.Field('role', 5, 'string'))
    .add(new protobuf.Field('score', 6, 'double'));

pbRoot.add(pbSimpleType);
pbRoot.add(pbMultiType);
pbRoot.add(pbNestedType);
pbRoot.add(pbArrayType);
pbRoot.add(pbLargeType);


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

let pbSimpleEnc = pbSimpleType.encode(pbSimpleType.fromObject(simpleData)).finish(),
    pbMultiEnc = pbMultiType.encode(pbMultiType.fromObject(multiData)).finish(),
    pbNestedEnc = pbNestedType.encode(pbNestedType.fromObject(nestedData)).finish(),
    pbArrayEnc = pbArrayType.encode(pbArrayType.fromObject(arrayData)).finish(),
    pbLargeEnc = pbLargeType.encode(pbLargeType.fromObject(largeData)).finish();


// Wire size comparison

console.log('\n=== Wire Size Comparison (bytes) ===');
console.log('Scenario                       | Codec2 |  Proto | MsgPack | Winner');
console.log('-------------------------------|--------|--------|---------|--------');

let wireScenarios = [
    { c2: c2Simple, mp: mpSimple, pb: pbSimpleEnc, name: 'simple { name }' },
    { c2: c2Multi, mp: mpMulti, pb: pbMultiEnc, name: 'multi { active, age, name }' },
    { c2: c2Nested, mp: mpNested, pb: pbNestedEnc, name: 'nested { address, name }' },
    { c2: c2Array, mp: mpArray, pb: pbArrayEnc, name: 'array { items[100] }' },
    { c2: c2Large, mp: mpLarge, pb: pbLargeEnc, name: 'large { 6 fields }' },
];

for (let w of wireScenarios) {
    let win = winner([
        { label: 'Codec2', value: w.c2.length },
        { label: 'Proto', value: w.pb.length },
        { label: 'MsgPack', value: w.mp.length },
    ], 'min');

    console.log(`${w.name.padEnd(30)} | ${fmtBytes(w.c2.length)} | ${fmtBytes(w.pb.length)} | ${fmtBytes(w.mp.length)}  | ${win}`);
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
    pbSimpleType.encode(pbSimpleType.fromObject(simpleData)).finish();
    pbSimpleType.toObject(pbSimpleType.decode(pbSimpleEnc));
    pbMultiType.encode(pbMultiType.fromObject(multiData)).finish();
    pbMultiType.toObject(pbMultiType.decode(pbMultiEnc));
    pbNestedType.encode(pbNestedType.fromObject(nestedData)).finish();
    pbNestedType.toObject(pbNestedType.decode(pbNestedEnc));
    pbArrayType.encode(pbArrayType.fromObject(arrayData)).finish();
    pbArrayType.toObject(pbArrayType.decode(pbArrayEnc));
    pbLargeType.encode(pbLargeType.fromObject(largeData)).finish();
    pbLargeType.toObject(pbLargeType.decode(pbLargeEnc));
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
    data: Record<string, unknown>;
    mpEnc: Uint8Array;
    name: string;
    pbEnc: Uint8Array;
    pbType: protobuf.Type;
};

let scenarios: Scenario[] = [
    { c2Enc: c2Simple, data: simpleData, mpEnc: mpSimple, name: 'simple { name }', pbEnc: pbSimpleEnc, pbType: pbSimpleType },
    { c2Enc: c2Multi, data: multiData, mpEnc: mpMulti, name: 'multi { active, age, name }', pbEnc: pbMultiEnc, pbType: pbMultiType },
    { c2Enc: c2Nested, data: nestedData, mpEnc: mpNested, name: 'nested { address, name }', pbEnc: pbNestedEnc, pbType: pbNestedType },
    { c2Enc: c2Array, data: arrayData as Record<string, unknown>, mpEnc: mpArray, name: 'array { items[100] }', pbEnc: pbArrayEnc, pbType: pbArrayType },
    { c2Enc: c2Large, data: largeData, mpEnc: mpLarge, name: 'large { 6 fields }', pbEnc: pbLargeEnc, pbType: pbLargeType },
];


// === ENCODE ===

console.log('\n=== ENCODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |        Proto |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------------|--------');

let totals = { c2Encode: 0, mpEncode: 0, pbEncode: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.encode(s.data); }),
        mp = benchFn(`mp ${s.name}`, () => { pack(s.data); }),
        pb = benchFn(`pb ${s.name}`, () => { s.pbType.encode(s.pbType.fromObject(s.data)).finish(); });

    totals.c2Encode += c2.opsPerSec;
    totals.mpEncode += mp.opsPerSec;
    totals.pbEncode += pb.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'Proto', value: pb.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(pb.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(totals.c2Encode)} | ${fmtOps(totals.pbEncode)} | ${fmtOps(totals.mpEncode)} | ${winner([
    { label: 'Codec2', value: totals.c2Encode },
    { label: 'Proto', value: totals.pbEncode },
    { label: 'MsgPack', value: totals.mpEncode },
])}`);


// === DECODE ===

console.log('\n=== DECODE BENCHMARK (ops/sec) ===');
console.log('Scenario                       |        Codec2 |        Proto |      MsgPack | Winner');
console.log('-------------------------------|---------------|--------------|--------------|--------');

let decodeTotals = { c2: 0, mp: 0, pb: 0 };

for (let s of scenarios) {
    let c2 = benchFn(`c2 ${s.name}`, () => { codec2.decode(s.c2Enc); }),
        mp = benchFn(`mp ${s.name}`, () => { unpack(s.mpEnc); }),
        pb = benchFn(`pb ${s.name}`, () => { s.pbType.toObject(s.pbType.decode(s.pbEnc)); });

    decodeTotals.c2 += c2.opsPerSec;
    decodeTotals.mp += mp.opsPerSec;
    decodeTotals.pb += pb.opsPerSec;

    let win = winner([
        { label: 'Codec2', value: c2.opsPerSec },
        { label: 'Proto', value: pb.opsPerSec },
        { label: 'MsgPack', value: mp.opsPerSec },
    ]);

    console.log(`${s.name.padEnd(30)} | ${fmtOps(c2.opsPerSec)} | ${fmtOps(pb.opsPerSec)} | ${fmtOps(mp.opsPerSec)} | ${win}`);
}

console.log(`${'TOTAL'.padEnd(30)} | ${fmtOps(decodeTotals.c2)} | ${fmtOps(decodeTotals.pb)} | ${fmtOps(decodeTotals.mp)} | ${winner([
    { label: 'Codec2', value: decodeTotals.c2 },
    { label: 'Proto', value: decodeTotals.pb },
    { label: 'MsgPack', value: decodeTotals.mp },
])}`);


// Summary ratios vs MsgPack

console.log('\n=== SUMMARY (ratio vs MsgPack — higher is better) ===');
console.log(`Codec2  — Encode: ${fmtRatio(totals.c2Encode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.c2, decodeTotals.mp)}  Combined: ${fmtRatio((totals.c2Encode + decodeTotals.c2), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`Proto   — Encode: ${fmtRatio(totals.pbEncode, totals.mpEncode)}  Decode: ${fmtRatio(decodeTotals.pb, decodeTotals.mp)}  Combined: ${fmtRatio((totals.pbEncode + decodeTotals.pb), (totals.mpEncode + decodeTotals.mp))}`);
console.log(`MsgPack — Encode: 1.00x  Decode: 1.00x  Combined: 1.00x`);
