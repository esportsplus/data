import { clearValidatorCache, getValidatorsForSource, type BrandedValidator } from './config-parser';
import { contains, detectCalls, type DetectedCall } from './detector';
import { analyzeType } from '~/compiler/type-analyzer';
import { generateValidator } from './validator';
import { imports } from '@esportsplus/typescript/compiler';
import { PACKAGE } from '~/constants';
import { transformCodec } from './proto';
import { ts } from '@esportsplus/typescript';


type TransformResult = {
    changed: boolean;
    code: string;
    sourceFile: ts.SourceFile;
};


const ASYNC_PATTERN = /^\s*\(?async\s|\bawait\b/;

let cache = new WeakMap<ts.SourceFile, Map<ts.CallExpression, DetectedCall>>();


function extractMessages(
    type: ts.Type,
    pathParts: string[],
    messages: Map<string, string>,
    typeChecker: ts.TypeChecker
): void {
    if (type.isStringLiteral()) {
        messages.set(pathParts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let props = typeChecker.getPropertiesOfType(type);

        for (let i = 0, n = props.length; i < n; i++) {
            let prop = props[i],
                propType = typeChecker.getTypeOfSymbol(prop);

            extractMessages(propType, [...pathParts, prop.getName()], messages, typeChecker);
        }
    }
}

function getCachedDetectedCalls(sourceFile: ts.SourceFile, program: ts.Program): Map<ts.CallExpression, DetectedCall> {
    let calls = cache.get(sourceFile);

    if (!calls) {
        calls = detectCalls(sourceFile, program);
        cache.set(sourceFile, calls);
    }

    return calls;
}

function parseErrorMessages(typeNode: ts.TypeNode | undefined, typeChecker: ts.TypeChecker): Map<string, string> {
    let messages = new Map<string, string>();

    if (!typeNode) {
        return messages;
    }

    extractMessages(typeChecker.getTypeAtLocation(typeNode), [], messages, typeChecker);

    return messages;
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
    brandValidators: Map<string, BrandedValidator>,
    sourceFile: ts.SourceFile
): ts.Node {
    let generatedCode: string;

    switch (call.callType) {
        case 'codec':
            generatedCode = transformCodec(call.typeArg, call.configArg, typeChecker);
            break;

        case 'validator.build': {
            let customValidatorSource = call.configArg?.getText(sourceFile);

            generatedCode = generateValidator(
                analyzeType(call.typeArg, typeChecker),
                {
                    brandValidators,
                    customMessages: parseErrorMessages(call.errorMessagesType, typeChecker),
                    hasAsync: customValidatorSource ? ASYNC_PATTERN.test(customValidatorSource) : false
                },
                customValidatorSource
            );
            break;
        }

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

    let remove: string[] = [],
        result = ts.transform(sourceFile, [
            (context: ts.TransformationContext) => {
                let typeChecker = program.getTypeChecker(),
                    visit = (node: ts.Node): ts.Node => {
                        if (ts.isCallExpression(node)) {
                            let call = detectedCalls.get(node);

                            if (call) {
                                if (call.callType === 'codec') {
                                    remove.push('codec');
                                }
                                else if (call.callType === 'validator.build') {
                                    remove.push('validator');
                                }

                                return transformCall(call, typeChecker, getValidatorsForSource(call.importSource, program), sourceFile);
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

    if (remove.length > 0) {
        code = imports.modify(code, transformed, PACKAGE, { remove });
        transformed = ts.createSourceFile(sourceFile.fileName, code, sourceFile.languageVersion, true);
    }

    return { code, sourceFile: transformed, changed: true };
};


export { clearValidatorCache, contains, transform };
export type { TransformResult };
