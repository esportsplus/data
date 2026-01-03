import { program, TRANSFORM_PATTERN } from '@esportsplus/typescript/transformer';
import { clearValidatorCache, mightNeedTransform, transform } from '~/transformer';
import type { OnLoadArgs, Plugin, PluginBuild } from 'esbuild';
import fs from 'fs';
import ts from 'typescript';


export default (options?: { root?: string; }): Plugin => {
    let root = options?.root ?? process.cwd();

    return {
        name: '@esportsplus/data/plugin-esbuild',

        setup(build: PluginBuild) {
            build.onLoad({ filter: TRANSFORM_PATTERN }, async (args: OnLoadArgs) => {
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
                        result = transform(sourceFile, program.get(root));

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
                clearValidatorCache();
                program.delete(root);
            });
        }
    };
};
