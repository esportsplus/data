import { ast, imports } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { PACKAGE_NAME } from '../constants';
import { resolveBrandedType } from './type-analyzer';
import { PathMode } from './types';
import error, { emitString } from './error';


interface BrandedValidator {
    async: boolean;
    body: string;
    brand: string;
}

type Registrations = {
    nodes: ts.ExpressionStatement[];
    validators: Map<string, BrandedValidator>;
};


// Sentinels are control characters that cannot occur in user source: the value parameter and
// each `errors.push(...)` call are AST-resolved in parse() and replaced with a sentinel that
// inline() maps back once the target variable name and error path are known.
const ERROR_SENTINEL = String.fromCharCode(1);

const MESSAGE_PLACEHOLDER = String.fromCharCode(2) + '__DYNAMIC_MESSAGE__' + String.fromCharCode(2);

const VALUE_SENTINEL = String.fromCharCode(0);


let cache = new WeakMap<ts.SourceFile, Map<string, BrandedValidator>>();


function collectParamRefs(node: ts.Node, paramSymbol: ts.Symbol | undefined, checker: ts.Checker, base: number, spans: [number, number][]): void {
    if (paramSymbol && ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === paramSymbol) {
        spans.push([node.getStart() - base, node.getEnd() - base]);
    }

    node.forEachChild((child) => collectParamRefs(child, paramSymbol, checker, base, spans));
}

// Collect every `<errorsParam>.push(...)` call, resolving the receiver against the second
// parameter's symbol (AST, never text). A matched call is not descended into, so a push nested
// inside another push's argument is left to that outer push's marker.
function collectPushCalls(node: ts.Node, errorsSymbol: ts.Symbol | undefined, checker: ts.Checker, calls: ts.CallExpression[]): void {
    if (errorsSymbol && ts.isCallExpression(node)) {
        let expr = node.expression;

        if (
            ts.isPropertyAccessExpression(expr) &&
            expr.name.text === 'push' &&
            ts.isIdentifier(expr.expression) &&
            checker.getSymbolAtLocation(expr.expression) === errorsSymbol &&
            node.arguments.length >= 1
        ) {
            calls.push(node);

            return;
        }
    }

    node.forEachChild((child) => collectPushCalls(child, errorsSymbol, checker, calls));
}

// Emit a push against the real `_errors` binding for a non-static argument: reuse error.generate
// for the `??=`/path rendering, then swap its placeholder message for the raw argument expression
// (a function replacer so `$` in a template literal is not treated as a replacement token).
function dynamicPush(expr: string, path: PathMode): string {
    return error.generate(MESSAGE_PLACEHOLDER, path).replace(emitString(MESSAGE_PLACEHOLDER), () => expr);
}

// Source files directly imported by `file` - the registration scope: a build site consumes
// brands registered in its own file plus the files it imports (ts module resolution), so the
// README's set-in-a-separate-validation.ts example works order-independently under any host.
function importedSourceFiles(file: ts.SourceFile, checker: ts.Checker): ts.SourceFile[] {
    let files: ts.SourceFile[] = [];

    for (let i = 0, n = file.statements.length; i < n; i++) {
        let statement = file.statements[i];

        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }

        let symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);

        if (!symbol) {
            continue;
        }

        let declarations = symbol.declarations;

        if (!declarations) {
            continue;
        }

        for (let j = 0, m = declarations.length; j < m; j++) {
            let declaration = declarations[j].resolve();

            if (declaration !== undefined && ts.isSourceFile(declaration)) {
                files.push(declaration);
            }
        }
    }

    return files;
}

function localName(file: ts.SourceFile): string | undefined {
    let found = imports.all(file, PACKAGE_NAME);

    for (let i = 0, n = found.length; i < n; i++) {
        let local = found[i].specifiers.get('validator');

        if (local !== undefined) {
            return local;
        }
    }

    return undefined;
}

function parse(node: ts.CallExpression, checker: ts.Checker, name: string): BrandedValidator | null {
    let expr = node.expression;

    if (
        !ts.isPropertyAccessExpression(expr) ||
        !ts.isIdentifier(expr.expression) ||
        expr.expression.text !== name ||
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

    let paramType = checker.getTypeAtLocation(param.type);

    if (paramType === undefined) {
        return null;
    }

    let brand = resolveBrandedType(paramType, checker).brand;

    if (!brand) {
        return null;
    }

    let isAsync = !!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);

    if (!isAsync && fn.body) {
        isAsync = ast.test(fn.body, ts.isAwaitExpression);
    }

    let bodyStart = fn.body.getStart(),
        errorsParam = fn.parameters[1],
        errorsSymbol = errorsParam ? checker.getSymbolAtLocation(errorsParam.name) : undefined,
        paramSymbol = checker.getSymbolAtLocation(param.name);

    let pushCalls: ts.CallExpression[] = [];

    collectPushCalls(fn.body, errorsSymbol, checker, pushCalls);

    let valueSpans: [number, number][] = [];

    collectParamRefs(fn.body, paramSymbol, checker, bodyStart, valueSpans);

    // Both rewrites are AST-resolved. A value reference (bound to the value parameter, never
    // textual `value` inside a string literal or property name) becomes a sentinel inline()
    // maps to varname; an `errors.push(...)` call becomes an error marker inline() maps to an
    // error record. Splice last-to-first so earlier offsets stay valid; a value reference nested
    // inside a push argument is carried by that push's marker, so drop it from the top-level splice.
    let edits: { end: number; start: number; text: string }[] = [];

    for (let i = 0, n = pushCalls.length; i < n; i++) {
        let call = pushCalls[i]!;

        edits.push({ end: call.getEnd() - bodyStart, start: call.getStart() - bodyStart, text: pushMarker(call, paramSymbol, checker) });
    }

    for (let i = 0, n = valueSpans.length; i < n; i++) {
        let span = valueSpans[i]!;

        if (pushCalls.some((call) => span[0] >= call.getStart() - bodyStart && span[1] <= call.getEnd() - bodyStart)) {
            continue;
        }

        edits.push({ end: span[1], start: span[0], text: VALUE_SENTINEL });
    }

    edits.sort((a, b) => b.start - a.start);

    let body = fn.body.getText();

    for (let i = 0, n = edits.length; i < n; i++) {
        body = body.slice(0, edits[i]!.start) + edits[i]!.text + body.slice(edits[i]!.end);
    }

    return { async: isAsync, body, brand };
}

// Build the sentinel that replaces an `errors.push(...)` call. A static string argument carries
// its cooked text ('S'); every other argument carries its value-substituted source expression
// ('D') for a live push. inline() splits on ERROR_SENTINEL, so both markers wrap in it.
function pushMarker(call: ts.CallExpression, paramSymbol: ts.Symbol | undefined, checker: ts.Checker): string {
    let arg = call.arguments[0]!;

    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        return ERROR_SENTINEL + 'S' + arg.text + ERROR_SENTINEL;
    }

    let argStart = arg.getStart(),
        spans: [number, number][] = [],
        text = arg.getText();

    collectParamRefs(arg, paramSymbol, checker, argStart, spans);
    spans.sort((a, b) => b[0] - a[0]);

    for (let i = 0, n = spans.length; i < n; i++) {
        text = text.slice(0, spans[i]![0]) + VALUE_SENTINEL + text.slice(spans[i]![1]);
    }

    return ERROR_SENTINEL + 'D' + text + ERROR_SENTINEL;
}

function visit(node: ts.Node, checker: ts.Checker, name: string, registrations: Registrations): void {
    if (ts.isCallExpression(node)) {
        let result = parse(node, checker, name);

        if (result) {
            registrations.validators.set(result.brand, result);

            if (ts.isExpressionStatement(node.parent)) {
                registrations.nodes.push(node.parent);
            }
        }
    }

    node.forEachChild((child) => visit(child, checker, name, registrations));
}

// Imported files contribute brand validators only (never removable nodes - the plugin
// only emits the current file). Cached per source file since a build site re-scans the
// same registration file for every consuming file the host processes.
function scanImported(file: ts.SourceFile, checker: ts.Checker): Map<string, BrandedValidator> {
    let cached = cache.get(file);

    if (cached) {
        return cached;
    }

    let name = localName(file),
        validators = new Map<string, BrandedValidator>();

    if (name !== undefined) {
        visit(file, checker, name, { nodes: [], validators });
    }

    cache.set(file, validators);

    return validators;
}


const collect = (sourceFile: ts.SourceFile, checker: ts.Checker): Registrations => {
    let name = localName(sourceFile),
        registrations: Registrations = { nodes: [], validators: new Map() };

    let imported = importedSourceFiles(sourceFile, checker);

    for (let i = 0, n = imported.length; i < n; i++) {
        let map = scanImported(imported[i], checker);

        for (let [brand, validator] of map) {
            registrations.validators.set(brand, validator);
        }
    }

    // Current file registered last so a same-brand registration here overrides an import.
    if (name !== undefined) {
        visit(sourceFile, checker, name, registrations);
    }

    return registrations;
};

// Inline validator body into generated code. Trust boundary: the body is the user's own
// TypeScript source (spliced from `fn.body.getText()`), compiled as written.
const inline = (body: string, path: PathMode, varname: string): string => {
    body = body.trim();

    if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1).trim();
    }

    body = body.split(VALUE_SENTINEL).join(varname);

    let parts = body.split(ERROR_SENTINEL),
        result = parts[0]!;

    // Split on ERROR_SENTINEL yields [text, marker, text, marker, ...]: odd entries are markers
    // (kind char + payload), even entries the literal source between them.
    for (let i = 1, n = parts.length; i < n; i += 2) {
        let marker = parts[i]!,
            payload = marker.slice(1);

        result += (marker[0] === 'S' ? error.generate(payload, path) : dynamicPush(payload, path)) + (parts[i + 1] ?? '');
    }

    return result;
}


export default { collect, inline };
export type { BrandedValidator };
