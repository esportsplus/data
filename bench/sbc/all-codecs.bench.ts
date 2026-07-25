// Comparative benchmark: Codec2 vs Protobuf vs MsgPackr
// Run: vitest bench bench/sbc/all-codecs.bench.ts

import { bench, describe } from 'vitest';
import { pack, unpack } from 'msgpackr';
import { codec as codec2Factory } from '../../src/sbc';
import protobuf from 'protobufjs';


type Scenario = {
    c2Enc: Uint8Array;
    data: Record<string, unknown>;
    mpEnc: Uint8Array;
    name: string;
    pbEnc: Uint8Array;
    pbType: protobuf.Type;
};


function fmtBytes(n: number): string {
    return String(n).padStart(6);
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


let scenarios: Scenario[] = [
    { c2Enc: c2Simple, data: simpleData, mpEnc: mpSimple, name: 'simple { name }', pbEnc: pbSimpleEnc, pbType: pbSimpleType },
    { c2Enc: c2Multi, data: multiData, mpEnc: mpMulti, name: 'multi { active, age, name }', pbEnc: pbMultiEnc, pbType: pbMultiType },
    { c2Enc: c2Nested, data: nestedData, mpEnc: mpNested, name: 'nested { address, name }', pbEnc: pbNestedEnc, pbType: pbNestedType },
    { c2Enc: c2Array, data: arrayData as Record<string, unknown>, mpEnc: mpArray, name: 'array { items[100] }', pbEnc: pbArrayEnc, pbType: pbArrayType },
    { c2Enc: c2Large, data: largeData, mpEnc: mpLarge, name: 'large { 6 fields }', pbEnc: pbLargeEnc, pbType: pbLargeType },
];


// Wire size comparison (setup-time logging)

console.log('\n=== Wire Size Comparison (bytes) ===');
console.log('Scenario                       | Codec2 |  Proto | MsgPack | Winner');
console.log('-------------------------------|--------|--------|---------|--------');

for (let s of scenarios) {
    let win = winner([
        { label: 'Codec2', value: s.c2Enc.length },
        { label: 'Proto', value: s.pbEnc.length },
        { label: 'MsgPack', value: s.mpEnc.length },
    ], 'min');

    console.log(`${s.name.padEnd(30)} | ${fmtBytes(s.c2Enc.length)} | ${fmtBytes(s.pbEnc.length)} | ${fmtBytes(s.mpEnc.length)}  | ${win}`);
}


describe('Encode', () => {
    for (let s of scenarios) {
        bench(`Codec2 ${s.name}`, () => { codec2.encode(s.data); });
        bench(`Proto ${s.name}`, () => { s.pbType.encode(s.pbType.fromObject(s.data)).finish(); });
        bench(`MsgPack ${s.name}`, () => { pack(s.data); });
    }
});


describe('Decode', () => {
    for (let s of scenarios) {
        bench(`Codec2 ${s.name}`, () => { codec2.decode(s.c2Enc); });
        bench(`Proto ${s.name}`, () => { s.pbType.toObject(s.pbType.decode(s.pbEnc)); });
        bench(`MsgPack ${s.name}`, () => { unpack(s.mpEnc); });
    }
});
