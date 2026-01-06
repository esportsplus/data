import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { contains, detectCalls, type DetectedCall } from './detector';
import { transformValidatorBuild } from './transforms';
import { transformCodec } from './transforms/proto';
import { ts } from '@esportsplus/typescript';


type TransformResult = {
    changed: boolean;
    code: string;
    sourceFile: ts.SourceFile;
};


let cache = new WeakMap<ts.SourceFile, Map<ts.CallExpression, DetectedCall>>();


function getCachedDetectedCalls(sourceFile: ts.SourceFile, program: ts.Program): Map<ts.CallExpression, DetectedCall> {
    let calls = cache.get(sourceFile);

    if (!calls) {
        calls = detectCalls(sourceFile, program);
        cache.set(sourceFile, calls);
    }

    return calls;
}

function synthesizeNode(node: ts.Node, factory: ts.NodeFactory): ts.Node {
    if (ts.isStringLiteral(node)) {
        return factory.createStringLiteral(node.text);
    }

    if (ts.isNumericLiteral(node)) {
        return factory.createNumericLiteral(node.text);
    }

    if (ts.isIdentifier(node)) {
        return factory.createIdentifier(node.text);
    }

    return ts.visitEachChild(
        node,
        (child) => synthesizeNode(child, factory),
        undefined as unknown as ts.TransformationContext
    );
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

    let expression: ts.Expression | undefined;

    ts.forEachChild(
        ts.createSourceFile(
            'generated.ts',
            `const __generated = ${generatedCode}`,
            ts.ScriptTarget.Latest,
            true
        ),
        (node) => {
            if (ts.isVariableStatement(node)) {
                let decl = node.declarationList.declarations[0];

                if (decl && decl.initializer) {
                    expression = decl.initializer;
                }
            }
        }
    );

    if (!expression) {
        return call.node;
    }

    return synthesizeNode(expression, ts.factory);
}


const transform = (sourceFile: ts.SourceFile, program: ts.Program): TransformResult => {
    let code = sourceFile.getFullText(),
        detectedCalls = getCachedDetectedCalls(sourceFile, program);

    if (!contains(code) || detectedCalls.size === 0) {
        return { code, sourceFile, changed: false };
    }

    let result = ts.transform(sourceFile, [
            (context: ts.TransformationContext) => {
                let typeChecker = program.getTypeChecker(),
                    visit = (node: ts.Node): ts.Node => {
                        if (ts.isCallExpression(node)) {
                            let call = detectedCalls.get(node);

                            if (call) {
                                return transformCall(call, typeChecker, getValidatorsForSource(call.importSource, program));
                            }
                        }

                        return ts.visitEachChild(node, visit, context);
                    };

                return (sf: ts.SourceFile) => ts.visitNode(sf, visit) as ts.SourceFile;
            }
        ]),
        transformed = result.transformed[0];

    if (transformed === sourceFile) {
        result.dispose();
        return { code, sourceFile, changed: false };
    }

    code = ts.createPrinter().printFile(transformed);
    result.dispose();

    return { code, sourceFile: transformed, changed: true };
};


export { clearValidatorCache, contains, transform };
export type { TransformResult };
