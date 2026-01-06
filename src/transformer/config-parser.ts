import { resolveBrandedType } from './branded-types';
import { ERRORS_VARIABLE } from '~/transformer/constants';
import { ts } from '@esportsplus/typescript';


interface BrandedValidator {
    async: boolean;
    body: string;
    brand: string;
}


const ERRORS_PUSH_REGEX = /errors\.push\((['"`])(.+?)\1\)/g;

const VALUE_WORD_REGEX = /\bvalue\b/g;


function containsAwait(node: ts.Node): boolean {
    if (ts.isAwaitExpression(node)) {
        return true;
    }

    let children = node.getChildren();

    for (let i = 0, n = children.length; i < n; i++) {
        if (containsAwait(children[i])) {
            return true;
        }
    }

    return false;
}

function inlineValidatorBody(
    body: string,
    variable: string,
    path: string
): string {
    let code = body.trim();

    // Remove outer braces if block statement
    if (code.startsWith('{') && code.endsWith('}')) {
        code = code.slice(1, -1).trim();
    }

    // Replace 'value' parameter with actual variable
    // Use word boundary to avoid replacing 'value' in 'valueOf' etc.
    code = code.replace(VALUE_WORD_REGEX, variable);

    // Replace errors.push('msg') with (ERRORS_VARIABLE ??= []).push({ message: 'msg', path: ... })
    // Handle single quotes, double quotes, and backticks
    code = code.replace(
        ERRORS_PUSH_REGEX,
        `(${ERRORS_VARIABLE} ??= []).push({ message: $1$2$1, path: ${path} })`
    );

    return code;
}

function parseValidatorSetCall(
    node: ts.CallExpression,
    typeChecker: ts.TypeChecker
): BrandedValidator | null {
    let expr = node.expression;

    // Check for validator.set()
    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'validator') {
        return null;
    }

    if (expr.name.text !== 'set') {
        return null;
    }

    // Extract the function argument
    let fn = node.arguments[0];

    if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) {
        return null;
    }

    // Get the value parameter
    let valueParam = fn.parameters[0];

    if (!valueParam || !valueParam.type) {
        return null;
    }

    // Extract brand name from type
    let type = typeChecker.getTypeAtLocation(valueParam.type),
        brand = resolveBrandedType(type, typeChecker).brand;

    if (!brand) {
        return null;
    }

    // Check if async
    let isAsync = false;

    if (ts.isArrowFunction(fn)) {
        isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
    }
    else if (ts.isFunctionExpression(fn)) {
        isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
    }

    // Also check for await in body
    if (!isAsync && fn.body) {
        isAsync = containsAwait(fn.body);
    }

    // Extract function body
    let body = fn.body.getText();

    return { async: isAsync, body, brand };
}


let validatorCache = new Map<string, Map<string, BrandedValidator>>();


function visitValidatorSetCall(
    node: ts.Node,
    brandValidators: Map<string, BrandedValidator>,
    typeChecker: ts.TypeChecker
): void {
    if (ts.isCallExpression(node)) {
        let result = parseValidatorSetCall(node, typeChecker);

        if (result) {
            brandValidators.set(result.brand, result);
        }
    }

    ts.forEachChild(node, (child) => visitValidatorSetCall(child, brandValidators, typeChecker));
}

function parseValidatorFile(
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker
): Map<string, BrandedValidator> {
    let brandValidators = new Map<string, BrandedValidator>();

    visitValidatorSetCall(sourceFile, brandValidators, typeChecker);

    return brandValidators;
}


const clearValidatorCache = (): void => {
    validatorCache.clear();
};

const getValidatorsForSource = (
    sourcePath: string | null | undefined,
    program: ts.Program
): Map<string, BrandedValidator> => {
    // No source or package import → no branded validators
    if (!sourcePath) {
        return new Map();
    }

    // Check cache
    if (validatorCache.has(sourcePath)) {
        return validatorCache.get(sourcePath)!;
    }

    // Parse source file
    let sourceFile = program.getSourceFile(sourcePath);

    if (!sourceFile) {
        validatorCache.set(sourcePath, new Map());
        return new Map();
    }

    let typeChecker = program.getTypeChecker(),
        validators = parseValidatorFile(sourceFile, typeChecker);

    validatorCache.set(sourcePath, validators);

    return validators;
};


export { clearValidatorCache, getValidatorsForSource, inlineValidatorBody };
export type { BrandedValidator };
