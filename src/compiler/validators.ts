import { ast } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { resolveBrandedType } from './type-analyzer';
import { PathMode } from './types';
import error from './error';


interface BrandedValidator {
    async: boolean;
    body: string;
    brand: string;
}


const ERRORS_PUSH_REGEX = /errors\.push\((['"`])(.+?)\1\)/g;

const VALUE_WORD_REGEX = /\bvalue\b/g;


let cache = new Map<string, Map<string, BrandedValidator>>();


function parse(node: ts.CallExpression, checker: ts.TypeChecker): BrandedValidator | null {
    let expr = node.expression;

    if (
        !ts.isPropertyAccessExpression(expr) ||
        !ts.isIdentifier(expr.expression) ||
        expr.expression.text !== 'validator' ||
        expr.name.text !== 'set'
    ) {
        return null;
    }

    let fn = node.arguments[0];

    if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) {
        return null;
    }

    let param = fn.parameters[0];

    if (!param || !param.type) {
        return null;
    }

    let brand = resolveBrandedType(checker.getTypeAtLocation(param.type), checker).brand;

    if (!brand) {
        return null;
    }

    let isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);

    if (!isAsync && fn.body) {
        isAsync = ast.test(fn.body, ts.isAwaitExpression);
    }

    return { async: isAsync, body: fn.body.getText(), brand };
}

function visit(node: ts.Node, validators: Map<string, BrandedValidator>, checker: ts.TypeChecker): void {
    if (ts.isCallExpression(node)) {
        let result = parse(node, checker);

        if (result) {
            validators.set(result.brand, result);
        }
    }

    ts.forEachChild(node, (child) => visit(child, validators, checker));
}


const clear = (): void => {
    cache.clear();
};

const get = (path: string | null | undefined, program: ts.Program) => {
    if (!path) {
        return new Map();
    }

    if (cache.has(path)) {
        return cache.get(path)!;
    }

    let file = program.getSourceFile(path);

    if (!file) {
        cache.set(path, new Map());
        return new Map();
    }

    let validators = new Map<string, BrandedValidator>();

    visit(file, validators, program.getTypeChecker());

    cache.set(path, validators);

    return validators;
};

// TODO: Research if this is fragile, what is the value word replacing?
const inline = (body: string, path: PathMode, varname: string): string => {
    body = body.trim();

    if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1).trim();
    }

    return body
        .replace(VALUE_WORD_REGEX, varname)
        .replace(ERRORS_PUSH_REGEX, error.generate('$1$2$1', path));
}


export default { clear, get, inline };
export type { BrandedValidator };
