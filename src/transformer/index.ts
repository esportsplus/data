import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { detectCalls, mightNeedTransform, type DetectedCall } from './detector';
import { transformCodec } from './transforms/proto';
import { transformValidatorBuild } from './transforms';
import { ts } from '@esportsplus/typescript';


type DetectedCallsCache = WeakMap<ts.SourceFile, Map<ts.CallExpression, DetectedCall>>;

type TransformResult = {
    code: string;
    sourceFile: ts.SourceFile;
    transformed: boolean;
};


let detectedCallsCache: DetectedCallsCache = new WeakMap();


function getCachedDetectedCalls(sourceFile: ts.SourceFile, program: ts.Program): Map<ts.CallExpression, DetectedCall> {
    let cached = detectedCallsCache.get(sourceFile);

    if (cached) {
        return cached;
    }

    let calls = detectCalls(sourceFile, program);

    detectedCallsCache.set(sourceFile, calls);

    return calls;
}

function synthesizeNode(node: ts.Node, factory: ts.NodeFactory): ts.Node {
    // For string literals, create a fresh synthesized literal
    if (ts.isStringLiteral(node)) {
        return factory.createStringLiteral(node.text);
    }

    // For numeric literals
    if (ts.isNumericLiteral(node)) {
        return factory.createNumericLiteral(node.text);
    }

    // For identifiers
    if (ts.isIdentifier(node)) {
        return factory.createIdentifier(node.text);
    }

    // For other nodes, use ts.factory to clone with synthesized children
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

    // Parse the generated code and return the expression
    let expression: ts.Expression | undefined,
        tempSourceFile = ts.createSourceFile(
            'generated.ts',
            `const __generated = ${generatedCode}`,
            ts.ScriptTarget.Latest,
            true
        );

    ts.forEachChild(tempSourceFile, (node) => {
        if (ts.isVariableStatement(node)) {
            let decl = node.declarationList.declarations[0];

            if (decl && decl.initializer) {
                expression = decl.initializer;
            }
        }
    });

    if (!expression) {
        return call.node;
    }

    // Synthesize all nodes so the printer generates proper output
    return synthesizeNode(expression, ts.factory);
}

function createVisitor(
    context: ts.TransformationContext,
    detectedCalls: Map<ts.CallExpression, DetectedCall>,
    program: ts.Program,
    typeChecker: ts.TypeChecker
): (node: ts.Node) => ts.Node {
    let visit = (node: ts.Node): ts.Node => {
        if (ts.isCallExpression(node)) {
            let call = detectedCalls.get(node);

            if (call) {
                return transformCall(call, typeChecker, getValidatorsForSource(call.importSource, program));
            }
        }

        return ts.visitEachChild(node, visit, context);
    };

    return visit;
}


const transform = (sourceFile: ts.SourceFile, program: ts.Program): TransformResult => {
    let code = sourceFile.getFullText(),
        detectedCalls = getCachedDetectedCalls(sourceFile, program);

    if (detectedCalls.size === 0) {
        return { code, sourceFile, transformed: false };
    }

    let result = ts.transform(sourceFile, [
            (context: ts.TransformationContext) => {
                let typeChecker = program.getTypeChecker(),
                    visit = createVisitor(context, detectedCalls, program, typeChecker);

                return (sf: ts.SourceFile) => ts.visitNode(sf, visit) as ts.SourceFile;
            }
        ]),
        transformed = result.transformed[0];

    if (transformed === sourceFile) {
        result.dispose();
        return { code, sourceFile, transformed: false };
    }

    code = ts.createPrinter().printFile(transformed);
    result.dispose();

    return { code, sourceFile: transformed, transformed: true };
};


export { clearValidatorCache, mightNeedTransform, transform };
export type { TransformResult };
