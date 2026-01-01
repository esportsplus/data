import type { Plugin } from 'esbuild';
import fs from 'fs';
import ts from 'typescript';
import { clearValidatorCache, mightNeedTransform, transform } from '~/transformer/core';
import { createProgramFromTsConfig } from '~/transformer/core/program';


interface PluginOptions {
    root?: string;
}


const plugin = (options?: PluginOptions): Plugin => {
    let program: ts.Program | null = null,
        root = options?.root ?? process.cwd();

    function getProgram(): ts.Program {
        if (!program) {
            program = createProgramFromTsConfig(root);
        }

        return program;
    }

    return {
        name: 'validation-transform',

        setup(build) {
            build.onLoad({ filter: /\.[tj]sx?$/ }, async (args) => {
                let code = await fs.promises.readFile(args.path, 'utf8');

                if (!mightNeedTransform(code)) {
                    return null;
                }

                try {
                    let sourceFile = ts.createSourceFile(
                            args.path,
                            code,
                            ts.ScriptTarget.Latest,
                            true
                        ),
                        result = transform(sourceFile, getProgram());

                    if (!result.transformed) {
                        return null;
                    }

                    return {
                        contents: result.code,
                        loader: args.path.endsWith('x') ? 'tsx' : 'ts'
                    };
                }
                catch (error) {
                    console.error(`@esportsplus/data: Error transforming ${args.path}:`, error);
                    return null;
                }
            });

            build.onEnd(() => {
                program = null;
                clearValidatorCache();
            });
        }
    };
};


export { plugin };
export type { PluginOptions };
