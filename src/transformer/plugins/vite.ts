import { program, TRANSFORM_PATTERN } from '@esportsplus/typescript/transformer';
import { createTransformer, mightNeedTransform } from '~/transformer';
import { clearValidatorCache } from '~/transformer/config-parser';
import type { Plugin, ResolvedConfig } from 'vite';
import { ts } from '@esportsplus/typescript';


export default (options?: { root?: string; }): Plugin => {
    let root: string;

    return {
        enforce: 'pre',
        name: '@esportsplus/data/plugin-vite',

        configResolved(config: ResolvedConfig) {
            root = options?.root ?? config.root;
        },

        transform(code: string, id: string) {
            if (!TRANSFORM_PATTERN.test(id) || id.includes('node_modules')) {
                return null;
            }

            if (!mightNeedTransform(code)) {
                return null;
            }

            try {
                let p = program.get(root),
                    printer = ts.createPrinter(),
                    sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true),
                    transformer = createTransformer(p),
                    result = ts.transform(sourceFile, [transformer]),
                    transformed = result.transformed[0];

                if (transformed === sourceFile) {
                    result.dispose();
                    return null;
                }

                let output = printer.printFile(transformed);

                result.dispose();

                return { code: output, map: null };
            }
            catch (error) {
                console.error(`@esportsplus/data: Error transforming ${id}:`, error);
                return null;
            }
        },

        watchChange(id: string) {
            // Invalidate caches when files change
            if (TRANSFORM_PATTERN.test(id)) {
                clearValidatorCache();
                program.delete(root);
            }
        }
    };
};
