import { program, TRANSFORM_PATTERN } from '@esportsplus/typescript/transformer';
import { clearValidatorCache, mightNeedTransform, transform } from '~/transformer';
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
                let sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true),
                    result = transform(sourceFile, program.get(root));

                if (!result.transformed) {
                    return null;
                }

                return { code: result.code, map: null };
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
