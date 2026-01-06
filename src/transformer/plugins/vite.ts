import { program, TRANSFORM_PATTERN } from '@esportsplus/typescript/transformer';
import { clearValidatorCache, mightNeedTransform, transform } from '~/transformer';
import type { Plugin, ResolvedConfig } from 'vite';
import { ts } from '@esportsplus/typescript';


export default (options?: { root?: string; }): Plugin => {
    let root: string;

    return {
        configResolved(config: ResolvedConfig) {
            root = options?.root ?? config.root;
        },
        enforce: 'pre',
        name: '@esportsplus/data/plugin-vite',
        transform(code: string, id: string) {
            if (!TRANSFORM_PATTERN.test(id) || id.includes('node_modules')) {
                return null;
            }

            if (!mightNeedTransform(code)) {
                return null;
            }

            try {
                let result = transform(
                        ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true),
                        program.get(root)
                    );

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
            if (TRANSFORM_PATTERN.test(id)) {
                clearValidatorCache();
                program.delete(root);
            }
        }
    };
};
