import ts from 'typescript';


type CallType = 'codec' | 'validator.build';

interface DetectedCall {
    callType: CallType;
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    importSource?: string;
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
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
    sourceFile: ts.SourceFile,
    program: ts.Program
): string | null {
    let expr = node.expression;

    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    let identifier = expr.expression;

    if (!ts.isIdentifier(identifier)) {
        return null;
    }

    let identifierName = identifier.text;

    // Find the import declaration for this identifier
    for (let i = 0, n = sourceFile.statements.length; i < n; i++) {
        let statement = sourceFile.statements[i];

        if (!ts.isImportDeclaration(statement)) {
            continue;
        }

        let importClause = statement.importClause;

        if (!importClause) {
            continue;
        }

        // Check named imports: import { validator } from '...'
        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
            let elements = importClause.namedBindings.elements;

            for (let j = 0, m = elements.length; j < m; j++) {
                let element = elements[j],
                    importedName = element.propertyName?.text ?? element.name.text,
                    localName = element.name.text;

                if (localName === identifierName && importedName === 'validator') {
                    let moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;

                    return resolveModulePath(moduleSpecifier, sourceFile.fileName, program);
                }
            }
        }

        // Check default import: import validator from '...'
        if (importClause.name?.text === identifierName) {
            let moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;

            return resolveModulePath(moduleSpecifier, sourceFile.fileName, program);
        }
    }

    return null;
}


const detectCalls = (
    sourceFile: ts.SourceFile,
    program?: ts.Program
): DetectedCall[] => {
    let calls: DetectedCall[] = [];

    function visit(node: ts.Node): void {
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

                    // Resolve import source for validator
                    if (program) {
                        detected.importSource = resolveValidatorImportSource(
                            node,
                            sourceFile,
                            program
                        ) ?? undefined;
                    }
                }

                calls.push(detected);
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    return calls;
};

const mightNeedTransform = (code: string): boolean => {
    return code.includes('codec<') ||
           code.includes('codec(') ||
           code.includes('validator.build');
};


export { detectCalls, mightNeedTransform };
export type { CallType, DetectedCall };
