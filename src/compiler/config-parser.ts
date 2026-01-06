import { ts } from '@esportsplus/typescript';
import { ast } from '@esportsplus/typescript/compiler';
import { resolveBrandedType } from './branded-types';
import { ERRORS_VARIABLE } from './constants';


interface BrandedValidator {
    async: boolean;
    body: string;
    brand: string;
}


const ERRORS_PUSH_REGEX = /errors\.push\((['"`])(.+?)\1\)/g;

const VALUE_WORD_REGEX = /\bvalue\b/g;


let cache = new Map<string, Map<string, BrandedValidator>>();


function inlineValidatorBody(
    body: string,
    variable: string,
    path: string
): string {
    let code = body.trim();

    if (code.startsWith('{') && code.endsWith('}')) {
        code = code.slice(1, -1).trim();
    }

    code = code.replace(VALUE_WORD_REGEX, variable);
    code = code.replace(
        ERRORS_PUSH_REGEX,
        `(${ERRORS_VARIABLE} ??= []).push({ message: $1$2$1, path: ${path} })`
    );

    return code;
}

function parseValidatorFile(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    let brandValidators = new Map<string, BrandedValidator>();

    visitValidatorSetCall(sourceFile, brandValidators, typeChecker);

    return brandValidators;
}

function parseValidatorSetCall(
    node: ts.CallExpression,
    typeChecker: ts.TypeChecker
): BrandedValidator | null {
    let expr = node.expression;

    if (!ts.isPropertyAccessExpression(expr)) {
        return null;
    }

    if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'validator') {
        return null;
    }

    if (expr.name.text !== 'set') {
        return null;
    }

    let fn = node.arguments[0];

    if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) {
        return null;
    }

    let valueParam = fn.parameters[0];

    if (!valueParam || !valueParam.type) {
        return null;
    }

    let type = typeChecker.getTypeAtLocation(valueParam.type),
        brand = resolveBrandedType(type, typeChecker).brand;

    if (!brand) {
        return null;
    }

    let isAsync = false;

    if (ts.isArrowFunction(fn)) {
        isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
    }
    else if (ts.isFunctionExpression(fn)) {
        isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
    }

    if (!isAsync && fn.body) {
        isAsync = ast.hasMatch(fn.body, ts.isAwaitExpression);
    }

    return { async: isAsync, body: fn.body.getText(), brand };
}

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


const clearValidatorCache = (): void => {
    cache.clear();
};

const getValidatorsForSource = (sourcePath: string | null | undefined, program: ts.Program) => {
    if (!sourcePath) {
        return new Map();
    }

    if (cache.has(sourcePath)) {
        return cache.get(sourcePath)!;
    }

    let sourceFile = program.getSourceFile(sourcePath);

    if (!sourceFile) {
        cache.set(sourcePath, new Map());
        return new Map();
    }

    let typeChecker = program.getTypeChecker(),
        validators = parseValidatorFile(sourceFile, typeChecker);

    cache.set(sourcePath, validators);

    return validators;
};


export { clearValidatorCache, getValidatorsForSource, inlineValidatorBody };
export type { BrandedValidator };
