import ts from 'typescript';
import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { detectCalls, mightNeedTransform, type DetectedCall } from './detector';
import { transformCodec } from './proto';
import { transformValidatorBuild } from './validator';


interface TransformResult {
    code: string;
    sourceFile: ts.SourceFile;
    transformed: boolean;
}


function createTransformer(
    program: ts.Program
): ts.TransformerFactory<ts.SourceFile> {
    let typeChecker = program.getTypeChecker();

    return (context: ts.TransformationContext) => {
        return (sourceFile: ts.SourceFile): ts.SourceFile => {
            let detectedCalls = detectCalls(sourceFile, program);

            if (detectedCalls.length === 0) {
                return sourceFile;
            }

            function visit(node: ts.Node): ts.Node {
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

                return ts.visitEachChild(node, visit, context);
            }

            return ts.visitNode(sourceFile, visit) as ts.SourceFile;
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

    let detectedCalls = detectCalls(sourceFile, program);

    if (detectedCalls.length === 0) {
        return { code, sourceFile, transformed: false };
    }

    let typeChecker = program.getTypeChecker();

    // Sort calls in reverse order by position to avoid offset issues
    let sortedCalls = [...detectedCalls].sort((a, b) => b.node.pos - a.node.pos);

    let transformedCode = code;

    for (let i = 0, n = sortedCalls.length; i < n; i++) {
        let call = sortedCalls[i],
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

            transformedCode =
                transformedCode.substring(0, call.node.pos) +
                generatedCode +
                transformedCode.substring(call.node.end);
        }
        catch (error) {
            console.error(`@esportsplus/data: transform error:`, error);
        }
    }

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


export { clearValidatorCache, createTransformer, mightNeedTransform, transform };
export type { TransformResult };
