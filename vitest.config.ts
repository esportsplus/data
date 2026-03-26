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
        exclude: ['tests/compile-validators.ts', 'tests/utils.ts'],
        include: ['tests/**/*.ts']
    }
});
