import { code as c, imports } from '@esportsplus/typescript/compiler';
import { PACKAGE } from '~/constants';
import { ts } from '@esportsplus/typescript';


type CallType = 'codec' | 'validator.build';

interface DetectedCall {
    callType: CallType;
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    importSource?: string;
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
}


const CHECK_TRANSFORM_PATTERNS = ['codec<', 'codec(', 'validator.build'];

let packageImports: Set<string> | null = null;


function cachePackageImports(sourceFile: ts.SourceFile): Set<string> {
    if (packageImports) {
        return packageImports;
    }

    packageImports = new Set();

    let found = imports.find(sourceFile, PACKAGE);

    for (let i = 0, n = found.length; i < n; i++) {
        for (let [, alias] of found[i].specifiers) {
            packageImports.add(alias);
        }
    }

    return packageImports;
}

function isIdentifierFromPackage(
    identifier: ts.Identifier,
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker | undefined
): boolean {
    if (imports.isFromPackage(identifier, PACKAGE, typeChecker)) {
        return true;
    }

    return cachePackageImports(sourceFile).has(identifier.text);
}


function detectCallType(node: ts.CallExpression): CallType | null {
    let expr = node.expression;

    if (ts.isIdentifier(expr) && expr.text === 'codec') {
        return 'codec';
    }

    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    let methodName = expr.name.text,
        objectExpr = expr.expression;

    if (!ts.isIdentifier(objectExpr)) {
        return null;
    }

    if (objectExpr.text === 'validator' && methodName === 'build') {
        return 'validator.build';
    }

    return null;
}

function visitDetectCall(
    node: ts.Node,
    calls: Map<ts.CallExpression, DetectedCall>,
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker | undefined
): void {
    if (ts.isCallExpression(node)) {
        let callType = detectCallType(node);

        if (callType && node.typeArguments && node.typeArguments.length > 0) {
            let expr = node.expression,
                identifier: ts.Identifier | undefined;

            if (callType === 'codec' && ts.isIdentifier(expr)) {
                identifier = expr;
            }
            else if (callType === 'validator.build' && ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
                identifier = expr.expression;
            }

            if (!identifier || !isIdentifierFromPackage(identifier, sourceFile, typeChecker)) {
                ts.forEachChild(node, (child) => visitDetectCall(child, calls, sourceFile, typeChecker));
                return;
            }

            let detected: DetectedCall = {
                callType,
                node,
                typeArg: node.typeArguments[0]
            };

            if (callType === 'codec') {
                if (node.arguments.length > 0) {
                    detected.configArg = node.arguments[0];
                }

                if (typeChecker) {
                    detected.importSource = imports.trace(identifier, typeChecker) ?? undefined;
                }
            }
            else if (callType === 'validator.build') {
                if (node.typeArguments.length > 1) {
                    detected.errorMessagesType = node.typeArguments[1];
                }

                if (node.arguments.length > 0) {
                    detected.configArg = node.arguments[0];
                }

                if (typeChecker) {
                    detected.importSource = imports.trace(identifier, typeChecker) ?? undefined;
                }
            }

            calls.set(node, detected);
        }
    }

    ts.forEachChild(node, (child) => visitDetectCall(child, calls, sourceFile, typeChecker));
}


const contains = (code: string): boolean => {
    return c.contains(code, { patterns: CHECK_TRANSFORM_PATTERNS });
};

const detectCalls = (sourceFile: ts.SourceFile, program?: ts.Program): Map<ts.CallExpression, DetectedCall> => {
    let calls = new Map<ts.CallExpression, DetectedCall>();

    packageImports = null;
    visitDetectCall(sourceFile, calls, sourceFile, program?.getTypeChecker());

    return calls;
};


export { contains, detectCalls };
export type { DetectedCall };
