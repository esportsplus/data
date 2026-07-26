import { ast, imports } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { PACKAGE_NAME } from '../constants';
import { resolveBrandedType } from './type-analyzer';
import { PathMode } from './types';
import error from './error';


interface BrandedValidator {
    async: boolean;
    body: string;
    brand: string;
}

type Registrations = {
    nodes: ts.ExpressionStatement[];
    validators: Map<string, BrandedValidator>;
};


const DISALLOWED_BODY_REGEX = /\b(eval|Function)\s*\(/;

const ERRORS_PUSH_REGEX = /errors\.push\((['"`])(.+?)\1\)/g;

const VALUE_SENTINEL = '\0';


let cache = new WeakMap<ts.SourceFile, Map<string, BrandedValidator>>();


function collectParamRefs(node: ts.Node, paramSymbol: ts.Symbol | undefined, checker: ts.Checker, bodyStart: number, spans: [number, number][]): void {
    if (paramSymbol && ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === paramSymbol) {
        spans.push([node.getStart() - bodyStart, node.getEnd() - bodyStart]);
    }

    node.forEachChild((child) => collectParamRefs(child, paramSymbol, checker, bodyStart, spans));
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

// Inline validator body into generated code - input is compile-time source only.
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


export default { collect, inline };
export type { BrandedValidator };
