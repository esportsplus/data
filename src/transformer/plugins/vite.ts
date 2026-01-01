import type { Plugin, ResolvedConfig } from 'vite';
import ts from 'typescript';
import { clearValidatorCache, mightNeedTransform, transform } from '~/transformer/core';
import { createProgramFromTsConfig } from '~/transformer/core/program';


interface PluginOptions {
    root?: string;
}


let TRANSFORM_PATTERN = /\.[tj]sx?$/;


const plugin = (options?: PluginOptions): Plugin => {
    let program: ts.Program | null = null,
        root: string;

    function getProgram(): ts.Program {
        if (!program) {
            program = createProgramFromTsConfig(root);
        }

        return program;
    }

    return {
        enforce: 'pre',
        name: 'validation-transform',

        configResolved(config: ResolvedConfig) {
            root = options?.root ?? config.root;
        },

        transform(code: string, id: string) {
            if (!TRANSFORM_PATTERN.test(id) || !mightNeedTransform(code)) {
                return null;
            }

            try {
                let sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true),
                    result = transform(sourceFile, getProgram());

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
                program = null;
                clearValidatorCache();
            }
        }
    };
};


export { plugin };
export type { PluginOptions };
