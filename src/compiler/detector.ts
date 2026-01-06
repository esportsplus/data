import { code as c } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';


type CallType = 'codec' | 'validator.build';

type ImportMap = Map<string, string>;

interface DetectedCall {
    callType: CallType;
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    importSource?: string;
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
}


const CHECK_TRANSFORM_PATTERNS = ['codec<', 'codec(', 'validator.build'];


let cache = new WeakMap<ts.SourceFile, ImportMap>();


function buildImportMap(sourceFile: ts.SourceFile, program: ts.Program): ImportMap {
    let cached = cache.get(sourceFile);

    if (cached) {
        return cached;
    }

    let map = new Map<string, string>();

    for (let i = 0, n = sourceFile.statements.length; i < n; i++) {
        let statement = sourceFile.statements[i];

        if (!ts.isImportDeclaration(statement)) {
            break;
        }

        let importClause = statement.importClause;

        if (!importClause) {
            continue;
        }

        let moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text,
            resolvedPath = resolveModulePath(moduleSpecifier, sourceFile.fileName, program);

        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
            let elements = importClause.namedBindings.elements;

            for (let j = 0, m = elements.length; j < m; j++) {
                let element = elements[j],
                    importedName = element.propertyName?.text ?? element.name.text,
                    localName = element.name.text;

                if (importedName === 'validator') {
                    map.set(localName, resolvedPath || '');
                }
            }
        }

        if (importClause.name) {
            map.set(importClause.name.text, resolvedPath || '');
        }
    }

    cache.set(sourceFile, map);

    return map;
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

    let objectName = objectExpr.text;

    if (objectName === 'validator' && methodName === 'build') {
        return 'validator.build';
    }

    return null;
}

function resolveModulePath(
    moduleSpecifier: string,
    containingFile: string,
    program: ts.Program
): string | null {
    if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
        return null;
    }

    let resolved = ts.resolveModuleName(
            moduleSpecifier,
            containingFile,
            program.getCompilerOptions(),
            ts.sys
        );

    if (resolved.resolvedModule) {
        return resolved.resolvedModule.resolvedFileName;
    }

    return null;
}

function resolveValidatorImportSource(node: ts.CallExpression, importMap: ImportMap): string | null {
    let expr = node.expression;

    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    let identifier = expr.expression;

    if (!ts.isIdentifier(identifier)) {
        return null;
    }

    return importMap.get(identifier.text) || null;
}

function visitDetectCall(
    node: ts.Node,
    calls: Map<ts.CallExpression, DetectedCall>,
    sourceFile: ts.SourceFile,
    program: ts.Program | undefined,
    importMap: ImportMap
): void {
    if (ts.isCallExpression(node)) {
        let callType = detectCallType(node);

        if (callType && node.typeArguments && node.typeArguments.length > 0) {
            let detected: DetectedCall = {
                callType,
                node,
                typeArg: node.typeArguments[0]
            };

            if (callType === 'codec') {
                if (node.arguments.length > 0) {
                    detected.configArg = node.arguments[0];
                }
            }
            else if (callType === 'validator.build') {
                if (node.typeArguments.length > 1) {
                    detected.errorMessagesType = node.typeArguments[1];
                }

                if (node.arguments.length > 0) {
                    detected.configArg = node.arguments[0];
                }

                if (program) {
                    detected.importSource = resolveValidatorImportSource(
                        node,
                        importMap
                    ) ?? undefined;
                }
            }

            calls.set(node, detected);
        }
    }

    ts.forEachChild(node, (child) => visitDetectCall(child, calls, sourceFile, program, importMap));
}


const contains = (code: string): boolean => {
    return c.contains(code, { patterns: CHECK_TRANSFORM_PATTERNS });
};

const detectCalls = (sourceFile: ts.SourceFile, program?: ts.Program): Map<ts.CallExpression, DetectedCall> => {
    let calls = new Map<ts.CallExpression, DetectedCall>(),
        map = program ? buildImportMap(sourceFile, program) : new Map<string, string>();

    visitDetectCall(sourceFile, calls, sourceFile, program, map);

    return calls;
};


export { contains, detectCalls };
export type { DetectedCall };
