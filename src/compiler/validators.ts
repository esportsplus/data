import { ast, references } from '@esportsplus/typescript/compiler';
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

type Registration = {
    call: ts.CallExpression;
    validator: BrandedValidator;
};

type Registrations = {
    // Other modules whose registrations can reach this module's output
    dependencies: Set<string>;
    nodes: ts.ExpressionStatement[];
    validators: Map<string, BrandedValidator>;
};


// Sentinels are control characters that cannot occur in user source: the value parameter and
// each `errors.push(...)` call are AST-resolved in parse() and replaced with a sentinel that
// inline() maps back once the target variable name and error path are known.
const ERROR_SENTINEL = String.fromCharCode(1);

const MESSAGE_PLACEHOLDER = String.fromCharCode(2) + '__DYNAMIC_MESSAGE__' + String.fromCharCode(2);

const VALUE_SENTINEL = String.fromCharCode(0);


// Every validator.set() registration in a program snapshot, by brand
let registry = new WeakMap<ts.Program, Map<string, Registration[]>>();


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

function parse(node: ts.CallExpression, checker: ts.Checker, program: ts.Program, targets: Set<string>): BrandedValidator | null {
    let expr = node.expression;

    if (
        !ts.isPropertyAccessExpression(expr) ||
        expr.name.text !== 'set' ||
        // The receiver must resolve to the package's own `validator` (through any alias): a
        // shadowing local that merely shares its name must not register a brand
        !references.denotes(checker, program, expr.expression, targets)
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



// Every registration in the program, found through the checker's references to Validator.set:
// a brand registered anywhere applies wherever it is built, however its module is reached
function registered(checker: ts.Checker, program: ts.Program, declarations: ts.NodeHandle[]): Map<string, Registration[]> {
    let found = registry.get(program);

    if (found) {
        return found;
    }

    let result = new Map<string, Registration[]>(),
        targets = new Set(declarations.map(references.key));

    for (let i = 0, n = declarations.length; i < n; i++) {
        let declaration = declarations[i].resolve() as ts.Node | undefined,
            name = declaration && (declaration as { name?: ts.Node }).name,
            type = name && checker.getTypeAtLocation(name),
            member = type && checker.getPropertyOfType(type, 'set'),
            memberDeclaration = member?.declarations?.[0]?.resolve() as ts.Node | undefined,
            memberName = memberDeclaration && (memberDeclaration as { name?: ts.Node }).name;

        if (!memberName) {
            continue;
        }

        let groups = checker.getReferencedSymbolsForNode(memberName, memberName.getStart());

        for (let j = 0, m = groups.length; j < m; j++) {
            let handles = groups[j].references;

            for (let k = 0, o = handles.length; k < o; k++) {
                let node = handles[k].resolve() as ts.Node | undefined,
                    access = node?.parent;

                if (
                    !access ||
                    !ts.isPropertyAccessExpression(access) ||
                    access.name !== node ||
                    !access.parent ||
                    !ts.isCallExpression(access.parent) ||
                    access.parent.expression !== access
                ) {
                    continue;
                }

                let call = access.parent,
                    validator = parse(call, checker, program, targets);

                if (!validator) {
                    continue;
                }

                let list = result.get(validator.brand);

                if (!list) {
                    list = [];
                    result.set(validator.brand, list);
                }

                if (!list.some(entry => entry.call === call)) {
                    list.push({ call, validator });
                }
            }
        }
    }

    registry.set(program, result);

    return result;
}

// A module's own registrations take precedence; any other brand resolves to the registration
// elsewhere in the program. Two registrations of one brand elsewhere are ambiguous and fail the
// build rather than apply whichever happened to be found last.
const collect = (sourceFile: ts.SourceFile, checker: ts.Checker, program: ts.Program, declarations: ts.NodeHandle[]): Registrations => {
    let registrations: Registrations = { dependencies: new Set(), nodes: [], validators: new Map() },
        ambiguous: string[] = [];

    for (let [brand, list] of registered(checker, program, declarations)) {
        let local = list.filter(entry => entry.call.getSourceFile().fileName === sourceFile.fileName),
            foreign = list.filter(entry => entry.call.getSourceFile().fileName !== sourceFile.fileName);

        for (let i = 0, n = foreign.length; i < n; i++) {
            registrations.dependencies.add(foreign[i].call.getSourceFile().fileName);
        }

        for (let i = 0, n = local.length; i < n; i++) {
            if (ts.isExpressionStatement(local[i].call.parent)) {
                registrations.nodes.push(local[i].call.parent as ts.ExpressionStatement);
            }
        }

        if (local.length > 0) {
            registrations.validators.set(brand, local[local.length - 1].validator);
        }
        else if (foreign.length === 1) {
            registrations.validators.set(brand, foreign[0].validator);
        }
        else if (foreign.length > 1) {
            ambiguous.push(`'${brand}' (${foreign.map(entry => entry.call.getSourceFile().fileName).join(', ')})`);
        }
    }

    if (ambiguous.length > 0) {
        throw new Error(`${PACKAGE_NAME}: brands registered more than once with validator.set(): ${ambiguous.join('; ')}`);
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
