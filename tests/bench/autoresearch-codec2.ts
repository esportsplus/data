// AutoResearch benchmark: Codec2 decode optimization
// Run: npx tsx tests/bench/autoresearch-codec2.ts
// Outputs labeled metrics for autoresearch loop

import { performance } from 'perf_hooks';
import { pack, unpack } from 'msgpackr';
import { createCodec } from '../../src/codec2';


let codec = createCodec(),
    largeData = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 },
    multiData = { active: true, age: 30, name: 'Alice' },
    simpleData = { name: 'Alice' };

// Pre-encode
let c2Large = codec.encode(largeData),
    c2Multi = codec.encode(multiData),
    c2Simple = codec.encode(simpleData),
    mpLarge = pack(largeData),
    mpMulti = pack(multiData),
    mpSimple = pack(simpleData);

// Correctness check
let decoded = codec.decode(c2Large) as Record<string, unknown>;

if (decoded.name !== 'Alice' || decoded.age !== 30 || decoded.score !== 99.5) {
    console.error('CORRECTNESS FAILURE');
    process.exit(1);
}

// Warmup — 5000 iterations all scenarios
for (let i = 0; i < 5000; i++) {
    codec.encode(largeData); codec.decode(c2Large);
    codec.encode(multiData); codec.decode(c2Multi);
    codec.encode(simpleData); codec.decode(c2Simple);
    pack(largeData); unpack(mpLarge);
    pack(multiData); unpack(mpMulti);
    pack(simpleData); unpack(mpSimple);
}


function bench(fn: () => void, iterations: number = 500000): number {
    // Extra warmup
    for (let i = 0; i < 1000; i++) {
        fn();
    }

    let start = performance.now();

    for (let i = 0; i < iterations; i++) {
        fn();
    }

    return Math.round((iterations / (performance.now() - start)) * 1000);
}


// Encode benchmarks
let c2EncLarge = bench(() => { codec.encode(largeData); }),
    c2EncMulti = bench(() => { codec.encode(multiData); }),
    c2EncSimple = bench(() => { codec.encode(simpleData); }),
    mpEncLarge = bench(() => { pack(largeData); }),
    mpEncMulti = bench(() => { pack(multiData); }),
    mpEncSimple = bench(() => { pack(simpleData); });

// Decode benchmarks
let c2DecLarge = bench(() => { codec.decode(c2Large); }),
    c2DecMulti = bench(() => { codec.decode(c2Multi); }),
    c2DecSimple = bench(() => { codec.decode(c2Simple); }),
    mpDecLarge = bench(() => { unpack(mpLarge); }),
    mpDecMulti = bench(() => { unpack(mpMulti); }),
    mpDecSimple = bench(() => { unpack(mpSimple); });

// Wire sizes
console.log(`wire-large-c2: ${c2Large.length}`);
console.log(`wire-large-mp: ${mpLarge.length}`);
console.log(`wire-multi-c2: ${c2Multi.length}`);
console.log(`wire-multi-mp: ${mpMulti.length}`);
console.log(`wire-simple-c2: ${c2Simple.length}`);
console.log(`wire-simple-mp: ${mpSimple.length}`);

// Encode ops/sec
console.log(`encode-large-c2: ${c2EncLarge}`);
console.log(`encode-large-mp: ${mpEncLarge}`);
console.log(`encode-multi-c2: ${c2EncMulti}`);
console.log(`encode-multi-mp: ${mpEncMulti}`);
console.log(`encode-simple-c2: ${c2EncSimple}`);
console.log(`encode-simple-mp: ${mpEncSimple}`);

// Decode ops/sec
console.log(`decode-large-c2: ${c2DecLarge}`);
console.log(`decode-large-mp: ${mpDecLarge}`);
console.log(`decode-multi-c2: ${c2DecMulti}`);
console.log(`decode-multi-mp: ${mpDecMulti}`);
console.log(`decode-simple-c2: ${c2DecSimple}`);
console.log(`decode-simple-mp: ${mpDecSimple}`);

// Summary ratios
let c2EncTotal = c2EncLarge + c2EncMulti + c2EncSimple,
    c2DecTotal = c2DecLarge + c2DecMulti + c2DecSimple,
    mpEncTotal = mpEncLarge + mpEncMulti + mpEncSimple,
    mpDecTotal = mpDecLarge + mpDecMulti + mpDecSimple;

console.log(`\nencode-ratio: ${(c2EncTotal / mpEncTotal).toFixed(3)}`);
console.log(`decode-ratio: ${(c2DecTotal / mpDecTotal).toFixed(3)}`);
console.log(`decode-large-ratio: ${(c2DecLarge / mpDecLarge).toFixed(3)}`);
console.log(`combined-ratio: ${((c2EncTotal + c2DecTotal) / (mpEncTotal + mpDecTotal)).toFixed(3)}`);
