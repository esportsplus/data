import { applyReplacementsReverse, type Replacement } from '@esportsplus/typescript/transformer';
import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { clearImportMapCache, detectCalls, mightNeedTransform, type DetectedCall } from './detector';
import { clearTypeAnalysisCache } from './type-analyzer';
import { transformCodec } from './transforms/proto';
import { transformValidatorBuild } from './transforms';
import ts from 'typescript';


type DetectedCallsCache = WeakMap<ts.SourceFile, DetectedCall[]>;

interface TransformResult {
    code: string;
    sourceFile: ts.SourceFile;
    transformed: boolean;
}


let detectedCallsCache: DetectedCallsCache = new WeakMap();


function getCachedDetectedCalls(
    sourceFile: ts.SourceFile,
    program: ts.Program
): DetectedCall[] {
    let cached = detectedCallsCache.get(sourceFile);

    if (cached) {
        return cached;
    }

    let calls = detectCalls(sourceFile, program);

    detectedCallsCache.set(sourceFile, calls);

    return calls;
}


function visitTransformNode(
    node: ts.Node,
    context: ts.TransformationContext,
    detectedCalls: DetectedCall[],
    program: ts.Program,
    typeChecker: ts.TypeChecker
): ts.Node {
    // Check if this node is one of our detected calls
    if (ts.isCallExpression(node)) {
        for (let i = 0, n = detectedCalls.length; i < n; i++) {
            let call = detectedCalls[i];

            if (call.node === node) {
                let brandValidators = getValidatorsForSource(call.importSource, program);

                return transformCall(call, typeChecker, brandValidators);
            }
        }
    }

    return ts.visitEachChild(
        node,
        (child) => visitTransformNode(child, context, detectedCalls, program, typeChecker),
        context
    );
}

function createTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
    let typeChecker = program.getTypeChecker();

    return (context: ts.TransformationContext) => {
        return (sourceFile: ts.SourceFile): ts.SourceFile => {
            let detectedCalls = getCachedDetectedCalls(sourceFile, program);

            if (detectedCalls.length === 0) {
                return sourceFile;
            }

            return ts.visitNode(
                sourceFile,
                (node) => visitTransformNode(node, context, detectedCalls, program, typeChecker)
            ) as ts.SourceFile;
        };
    };
}

function transformCall(
    call: DetectedCall,
    typeChecker: ts.TypeChecker,
    brandValidators: Map<string, BrandedValidator>
): ts.Node {
    let generatedCode: string;

    switch (call.callType) {
        case 'codec':
            generatedCode = transformCodec(call.typeArg, call.configArg, typeChecker);
            break;

        case 'validator.build':
            generatedCode = transformValidatorBuild(
                call.typeArg,
                call.errorMessagesType,
                typeChecker,
                brandValidators
            );
            break;

        default:
            return call.node;
    }

    // Parse the generated code and return the expression
    let tempSourceFile = ts.createSourceFile(
        'generated.ts',
        `const __generated = ${generatedCode}`,
        ts.ScriptTarget.Latest,
        true
    );

    let expression: ts.Expression | undefined;

    ts.forEachChild(tempSourceFile, (node) => {
        if (ts.isVariableStatement(node)) {
            let decl = node.declarationList.declarations[0];

            if (decl && decl.initializer) {
                expression = decl.initializer;
            }
        }
    });

    return expression || call.node;
}


const transform = (
    sourceFile: ts.SourceFile,
    program: ts.Program
): TransformResult => {
    let code = sourceFile.getFullText();

    if (!mightNeedTransform(code)) {
        return { code, sourceFile, transformed: false };
    }

    let detectedCalls = getCachedDetectedCalls(sourceFile, program);

    if (detectedCalls.length === 0) {
        return { code, sourceFile, transformed: false };
    }

    let replacements: Replacement[] = [],
        typeChecker = program.getTypeChecker();

    for (let i = 0, n = detectedCalls.length; i < n; i++) {
        let call = detectedCalls[i],
            generatedCode: string;

        try {
            switch (call.callType) {
                case 'codec':
                    generatedCode = transformCodec(call.typeArg, call.configArg, typeChecker);
                    break;

                case 'validator.build': {
                    let brandValidators = getValidatorsForSource(call.importSource, program);

                    generatedCode = transformValidatorBuild(
                        call.typeArg,
                        call.errorMessagesType,
                        typeChecker,
                        brandValidators
                    );
                    break;
                }

                default:
                    continue;
            }

            replacements.push({
                end: call.node.end,
                newText: generatedCode,
                start: call.node.pos
            });
        }
        catch (error) {
            console.error(`@esportsplus/data: transform error:`, error);
        }
    }

    if (replacements.length === 0) {
        return { code, sourceFile, transformed: false };
    }

    let transformedCode = applyReplacementsReverse(code, replacements);

    // Create new source file from transformed code
    let transformedSourceFile = ts.createSourceFile(
        sourceFile.fileName,
        transformedCode,
        sourceFile.languageVersion,
        true
    );

    return {
        code: transformedCode,
        sourceFile: transformedSourceFile,
        transformed: transformedCode !== code
    };
};


const clearCaches = (): void => {
    clearImportMapCache();
    clearTypeAnalysisCache();
    clearValidatorCache();
    detectedCallsCache = new WeakMap();
};


export type { TransformResult };
export { clearCaches, clearValidatorCache, createTransformer, mightNeedTransform, transform };
