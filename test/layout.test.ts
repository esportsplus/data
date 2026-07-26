import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve } from 'path';


const ROOT = fileURLToPath(new URL('..', import.meta.url));

const BENCH_FILES = [
    'bench/compiler/compile.bench.ts',
    'bench/compiler/validator.bench.ts',
    'bench/sbc/all-codecs.bench.ts',
    'bench/sbc/sbc-standalone.bench.ts',
    'bench/sbc/sbc-vs-msgpack.bench.ts'
];

const HELPER_FILES = [
    'bench/sbc/autoresearch-sbc.ts',
    'test/utils.ts'
];

const TEST_FILES = [
    'test/compiler/async-validators.test.ts',
    'test/compiler/branded-strings.test.ts',
    'test/compiler/complex.test.ts',
    'test/compiler/custom-messages.test.ts',
    'test/compiler/edge-cases.test.ts',
    'test/compiler/error.test.ts',
    'test/compiler/index.test.ts',
    'test/compiler/json-schema-constraints.test.ts',
    'test/compiler/json-schema-e2e.test.ts',
    'test/compiler/json-schema.test.ts',
    'test/compiler/namespace-imports.test.ts',
    'test/compiler/plugins.test.ts',
    'test/compiler/primitives.test.ts',
    'test/compiler/sbc/index.test.ts',
    'test/compiler/type-analyzer-root.test.ts',
    'test/compiler/type-analyzer.test.ts',
    'test/compiler/unions.test.ts',
    'test/sbc/decode-interleave.test.ts',
    'test/sbc/index.test.ts',
    'test/sbc/schema-store.test.ts',
    'test/typed-array-codec.test.ts',
    'test/validators/advanced.test.ts',
    'test/validators/constraints.test.ts',
    'test/validators/format.test.ts',
    'test/validators/index.test.ts',
    'test/validators/number-date.test.ts'
];


describe('repository layout', () => {
    it('has removed the pre-standard tests/ directory', () => {
        expect(existsSync(resolve(ROOT, 'tests'))).toBe(false);
    });

    it.each(TEST_FILES)('mirrors a suite at %s', (path) => {
        expect(existsSync(resolve(ROOT, path))).toBe(true);
    });

    it.each(BENCH_FILES)('discovers a benchmark at %s', (path) => {
        expect(existsSync(resolve(ROOT, path))).toBe(true);
    });

    it.each(HELPER_FILES)('keeps the helper %s outside discovery', (path) => {
        expect(existsSync(resolve(ROOT, path))).toBe(true);
        expect(path.includes('.test.') || path.includes('.bench.')).toBe(false);
    });
});
