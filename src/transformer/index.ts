import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { clearImportMapCache, detectCalls, mightNeedTransform, type DetectedCall } from './detector';
import { clearTypeAnalysisCache } from './type-analyzer';
import { transformCodec } from './transforms/proto';
import { transformValidatorBuild } from './transforms';
import { ts } from '@esportsplus/typescript';


type DetectedCallsCache = WeakMap<ts.SourceFile, DetectedCall[]>;


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

    if (!expression) {
        return call.node;
    }

    // Synthesize all nodes so the printer generates proper output
    return synthesizeNode(expression, ts.factory);
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


const clearCaches = (): void => {
    clearImportMapCache();
    clearTypeAnalysisCache();
    clearValidatorCache();
    detectedCallsCache = new WeakMap();
};

const createTransformer = (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
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
};


export { clearCaches, clearValidatorCache, createTransformer, mightNeedTransform };
