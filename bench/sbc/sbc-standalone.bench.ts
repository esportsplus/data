// Standalone benchmark: Codec2 vs MsgPackr
// Run: vitest bench bench/sbc/sbc-standalone.bench.ts

import { bench, describe } from 'vitest';
import { pack, unpack } from 'msgpackr';
import { codec } from '../../src/sbc';


type FreshScenario = { factory: () => unknown; name: string };

type Scenario = { c2Encoded: Uint8Array; data: unknown; mpEncoded: Uint8Array; name: string };


// Correctness guard — throws on any encode/decode mismatch (setup-time)

function verify(name: string, original: unknown, encoded: Uint8Array): void {
    let decoded = c.decode(encoded),
        a = JSON.stringify(original),
        b = JSON.stringify(decoded);

    if (a !== b) {
        throw new Error(`Bench: codec2 mismatch on ${name} — original ${a} decoded ${b}`);
    }
}


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


verify('simple', simpleData, c2Simple);
verify('multi', multiData, c2Multi);
verify('nested', nestedData, c2Nested);
verify('array', arrayData, c2Array);
verify('large', largeData, c2Large);


// Wire size comparison (setup-time logging)

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


let scenarios: Scenario[] = [
    { c2Encoded: c2Simple, data: simpleData, mpEncoded: mpSimple, name: 'simple { name }' },
    { c2Encoded: c2Multi, data: multiData, mpEncoded: mpMulti, name: 'multi { active, age, name }' },
    { c2Encoded: c2Nested, data: nestedData, mpEncoded: mpNested, name: 'nested { address, name }' },
    { c2Encoded: c2Array, data: arrayData, mpEncoded: mpArray, name: 'array { items[100] }' },
    { c2Encoded: c2Large, data: largeData, mpEncoded: mpLarge, name: 'large { 6 fields }' },
];

let freshScenarios: FreshScenario[] = [
    { factory: () => ({ name: 'Alice' }), name: 'simple { name }' },
    { factory: () => ({ active: true, age: 30, name: 'Alice' }), name: 'multi { active, age, name }' },
    { factory: () => ({ address: { city: 'NYC', zip: '10001' }, name: 'Alice' }), name: 'nested { address, name }' },
    { factory: () => ({ items: Array.from({ length: 100 }, (_, i) => i) }), name: 'array { items[100] }' },
    { factory: () => ({ active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 }), name: 'large { 6 fields }' },
];


describe('Encode', () => {
    for (let s of scenarios) {
        bench(`Codec2 ${s.name}`, () => { c.encode(s.data); });
        bench(`MsgPack ${s.name}`, () => { pack(s.data); });
    }
});


describe('Encode (fresh objects)', () => {
    for (let s of freshScenarios) {
        bench(`Codec2 ${s.name}`, () => { c.encode(s.factory()); });
        bench(`MsgPack ${s.name}`, () => { pack(s.factory()); });
    }
});


describe('Decode', () => {
    for (let s of scenarios) {
        bench(`Codec2 ${s.name}`, () => { c.decode(s.c2Encoded); });
        bench(`MsgPack ${s.name}`, () => { unpack(s.mpEncoded); });
    }
});
