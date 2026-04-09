import { resolve } from 'path';
import { defineConfig } from 'vitest/config';


export default defineConfig({
    resolve: {
        alias: {
            '~': resolve(__dirname, './src')
        }
    },
    test: {
        environment: 'node',
        globals: true,
        exclude: [
            'tests/bench/all-codecs.ts',
            'tests/bench/autoresearch-sbc.ts',
            'tests/bench/compile.ts',
            'tests/bench/sbc-standalone.ts',
            'tests/bench/sbc-vs-msgpack.ts',
            'tests/bench/validator.ts',
            'tests/compile-validators.ts',
            'tests/utils.ts',
        ],
        include: ['tests/**/*.ts']
    }
});
