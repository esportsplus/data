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

const VALUE_SENTINEL = '\0';


let cache = new WeakMap<ts.SourceFile, Map<string, BrandedValidator>>();


function collectParamRefs(node: ts.Node, paramSymbol: ts.Symbol | undefined, checker: ts.TypeChecker, bodyStart: number, spans: [number, number][]): void {
    if (paramSymbol && ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === paramSymbol) {
        spans.push([node.getStart() - bodyStart, node.getEnd() - bodyStart]);
    }

    ts.forEachChild(node, (child) => collectParamRefs(child, paramSymbol, checker, bodyStart, spans));
}

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

    let bodyStart = fn.body.getStart(),
        paramSymbol = checker.getSymbolAtLocation(param.name),
        spans: [number, number][] = [];

    collectParamRefs(fn.body, paramSymbol, checker, bodyStart, spans);

    let body = fn.body.getText();

    // Rename only identifier references bound to the value parameter (AST-resolved),
    // never textual `value` inside string literals or property names. Splice a sentinel
    // last-to-first so earlier offsets stay valid; inline() maps the sentinel to varname.
    for (let i = spans.length - 1; i >= 0; i--) {
        body = body.slice(0, spans[i]![0]) + VALUE_SENTINEL + body.slice(spans[i]![1]);
    }

    return { async: isAsync, body, brand };
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


const get = (path: string | null | undefined, program: ts.Program) => {
    let file = path ? program.getSourceFile(path) : undefined;

    if (!file) {
        return new Map();
    }

    if (cache.has(file)) {
        return cache.get(file)!;
    }

    let validators = new Map<string, BrandedValidator>();

    visit(file, validators, program.getTypeChecker());

    cache.set(file, validators);

    return validators;
};

const DISALLOWED_BODY_REGEX = /\b(eval|Function)\s*\(/;

// Inline validator body into generated code — input is compile-time source only.
// Trust boundary: the body originates from the user's own TypeScript AST via
// `fn.body.getText()`. Supply-chain risk (compromised dependency injecting
// malicious validator bodies) is mitigated by rejecting bodies that contain
// obvious code-generation escape patterns.
const inline = (body: string, path: PathMode, varname: string): string => {
    body = body.trim();

    if (DISALLOWED_BODY_REGEX.test(body)) {
        throw new Error('Validator: body contains disallowed pattern (eval/Function)');
    }

    if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1).trim();
    }

    return body
        .split(VALUE_SENTINEL)
        .join(varname)
        .replace(ERRORS_PUSH_REGEX, (_match, _quote, msg) => error.generate(msg, path));
}


export default { get, inline };
export type { BrandedValidator };
