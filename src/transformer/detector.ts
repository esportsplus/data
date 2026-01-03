import { mightNeedTransform as checkTransform } from '@esportsplus/typescript/transformer';
import ts from 'typescript';


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


let importMapCache = new WeakMap<ts.SourceFile, ImportMap>();

const CHECK_TRANSFORM_PATTERNS = ['codec<', 'codec(', 'validator.build'];


function buildImportMap(
    sourceFile: ts.SourceFile,
    program: ts.Program
): ImportMap {
    let cached = importMapCache.get(sourceFile);

    if (cached) {
        return cached;
    }

    let map: ImportMap = new Map();

    for (let i = 0, n = sourceFile.statements.length; i < n; i++) {
        let statement = sourceFile.statements[i];

        if (!ts.isImportDeclaration(statement)) {
            continue;
        }

        let importClause = statement.importClause;

        if (!importClause) {
            continue;
        }

        let moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text,
            resolvedPath = resolveModulePath(moduleSpecifier, sourceFile.fileName, program);

        // Check named imports: import { validator } from '...'
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

        // Check default import: import validator from '...'
        if (importClause.name) {
            map.set(importClause.name.text, resolvedPath || '');
        }
    }

    importMapCache.set(sourceFile, map);

    return map;
}


function detectCallType(node: ts.CallExpression): CallType | null {
    let expr = node.expression;

    // Check for codec<T>() - direct function call
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
    // Skip package imports
    if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
        return null;
    }

    let compilerOptions = program.getCompilerOptions(),
        resolved = ts.resolveModuleName(
            moduleSpecifier,
            containingFile,
            compilerOptions,
            ts.sys
        );

    if (resolved.resolvedModule) {
        return resolved.resolvedModule.resolvedFileName;
    }

    return null;
}

function resolveValidatorImportSource(
    node: ts.CallExpression,
    importMap: ImportMap
): string | null {
    let expr = node.expression;

    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    let identifier = expr.expression;

    if (!ts.isIdentifier(identifier)) {
        return null;
    }

    // O(1) lookup using cached import map
    let resolvedPath = importMap.get(identifier.text);

    return resolvedPath !== undefined ? (resolvedPath || null) : null;
}


function visitDetectCall(
    node: ts.Node,
    calls: DetectedCall[],
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
                // Extract defaults argument for codec
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

                // Resolve import source for validator using O(1) lookup
                if (program) {
                    detected.importSource = resolveValidatorImportSource(
                        node,
                        importMap
                    ) ?? undefined;
                }
            }

            calls.push(detected);
        }
    }

    ts.forEachChild(node, (child) => visitDetectCall(child, calls, sourceFile, program, importMap));
}


const detectCalls = (
    sourceFile: ts.SourceFile,
    program?: ts.Program
): DetectedCall[] => {
    let calls: DetectedCall[] = [],
        importMap: ImportMap = program ? buildImportMap(sourceFile, program) : new Map();

    visitDetectCall(sourceFile, calls, sourceFile, program, importMap);

    return calls;
};

const clearImportMapCache = (): void => {
    importMapCache = new WeakMap();
};

const mightNeedTransform = (code: string): boolean => {
    return checkTransform(code, { patterns: CHECK_TRANSFORM_PATTERNS });
};


export { clearImportMapCache, detectCalls, mightNeedTransform };
export type { CallType, DetectedCall };
