import { ts } from '@esportsplus/typescript';
import { imports } from '@esportsplus/typescript/compiler';
import { PACKAGE_NAME } from '../constants';
import type { AnalyzedProperty } from './type-analyzer';
import type { JsonSchema } from '../types';


/**
 * Static extractor: config-argument builtin validator calls -> Draft 2020-12 keyword fragments.
 *
 * Walks a `ValidatorConfig` object literal, resolves each entry's builtin validator call(s)
 * against this package's `@esportsplus/data` / `@esportsplus/data/validators` import surface,
 * extracts static arguments, and maps them to JSON Schema keywords keyed by the property's IR type.
 *
 * Degrade policy: recognition failure is SILENT and per-call. An unresolved callee, a non-static
 * argument, a flagged regex, an unmapped builtin, an unknown/spread config key, or an absent IR
 * type row drops ONLY that validator's keywords — never throws, never warns, never emits an
 * approximate keyword. The structural schema and every other recognized constraint are kept.
 * `format` keywords are annotation-only in 2020-12 and map on intent; assertion keywords
 * (`pattern`, `min*`, `max*`, `multipleOf`, `exclusive*`, `type`) are emitted only where they
 * exactly match the runtime validator's semantics.
 */

type Contribution =
    | { key: LowerKey; kind: 'lower'; value: number }
    | { key: UpperKey; kind: 'upper'; value: number }
    | { kind: 'format'; value: string }
    | { kind: 'multipleOf'; value: number }
    | { kind: 'pattern'; value: string }
    | { kind: 'type' };

type IRType = 'array' | 'bigint' | 'number' | 'string';

type LowerKey = 'exclusiveMinimum' | 'minItems' | 'minLength' | 'minimum';

type StaticArg =
    | { flags: string; kind: 'regex'; source: string }
    | { kind: 'number'; value: number }
    | { kind: 'string'; value: string };

type UpperKey = 'exclusiveMaximum' | 'maxItems' | 'maxLength' | 'maximum';


const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

const VALIDATORS_MODULE = PACKAGE_NAME + '/validators';


function buildNamedTable(sourceFile: ts.SourceFile): Map<string, string> {
    let table = new Map<string, string>();

    for (let spec of [PACKAGE_NAME, VALIDATORS_MODULE]) {
        let infos = imports.all(sourceFile, spec);

        for (let i = 0, n = infos.length; i < n; i++) {
            for (let [canonical, local] of infos[i].specifiers) {
                table.set(local, canonical);
            }
        }
    }

    return table;
}

function collectCalls(initializer: ts.Expression): ts.CallExpression[] | null {
    if (ts.isCallExpression(initializer)) {
        return [initializer];
    }

    if (ts.isArrayLiteralExpression(initializer)) {
        let calls: ts.CallExpression[] = [],
            elements = initializer.elements;

        for (let i = 0, n = elements.length; i < n; i++) {
            let element = elements[i];

            if (!ts.isCallExpression(element)) {
                return null;
            }

            calls.push(element);
        }

        return calls;
    }

    return null;
}

const esc = (value: string): string => {
    return value.replace(REGEX_ESCAPE, '\\$&');
};

function extractArgs(args: ts.NodeArray<ts.Expression>): StaticArg[] | null {
    let result: StaticArg[] = [];

    for (let i = 0, n = args.length; i < n; i++) {
        let arg = args[i];

        if (ts.isNumericLiteral(arg)) {
            result.push({ kind: 'number', value: Number(arg.text) });
            continue;
        }

        if (
            ts.isPrefixUnaryExpression(arg)
            && arg.operator === ts.SyntaxKind.MinusToken
            && ts.isNumericLiteral(arg.operand)
        ) {
            result.push({ kind: 'number', value: -Number(arg.operand.text) });
            continue;
        }

        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            result.push({ kind: 'string', value: arg.text });
            continue;
        }

        if (ts.isRegularExpressionLiteral(arg)) {
            let last = arg.text.lastIndexOf('/');

            result.push({ flags: arg.text.slice(last + 1), kind: 'regex', source: arg.text.slice(1, last) });
            continue;
        }

        return null;
    }

    return result;
}

function isNamespaceImport(id: ts.Identifier, checker: ts.TypeChecker): boolean {
    let symbol = checker.getSymbolAtLocation(id);

    if (!symbol) {
        return false;
    }

    let declarations = symbol.getDeclarations();

    if (!declarations) {
        return false;
    }

    for (let i = 0, n = declarations.length; i < n; i++) {
        let declaration = declarations[i];

        if (ts.isNamespaceImport(declaration)) {
            let importDeclaration = declaration.parent.parent;

            if (ts.isImportDeclaration(importDeclaration) && ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
                let text = importDeclaration.moduleSpecifier.text;

                if (text === PACKAGE_NAME || text === VALIDATORS_MODULE) {
                    return true;
                }
            }
        }
    }

    return false;
}

function mapBuiltin(name: string, variant: string | undefined, ir: IRType, args: StaticArg[]): Contribution[] | null {
    if (variant !== undefined && name !== 'email' && name !== 'url' && name !== 'uuid') {
        return null;
    }

    switch (name) {
        case 'email': {
            if (ir !== 'string') {
                return null;
            }

            if (variant === undefined || variant === 'html5' || variant === 'rfc5322') {
                return [{ kind: 'format', value: 'email' }];
            }

            if (variant === 'unicode') {
                return [{ kind: 'format', value: 'idn-email' }];
            }

            return null;
        }
        case 'endsWith': {
            let value = stringArg(args, 0);

            if (ir !== 'string' || value === null) {
                return null;
            }

            return [{ kind: 'pattern', value: esc(value) + '$' }];
        }
        case 'includes': {
            let value = stringArg(args, 0);

            if (ir !== 'string' || value === null) {
                return null;
            }

            return [{ kind: 'pattern', value: esc(value) }];
        }
        case 'integer': {
            if (ir !== 'number') {
                return null;
            }

            return [{ kind: 'type' }];
        }
        case 'length': {
            let value = numberArg(args, 0);

            if (ir !== 'string' || value === null) {
                return null;
            }

            return [{ key: 'minLength', kind: 'lower', value }, { key: 'maxLength', kind: 'upper', value }];
        }
        case 'matches': {
            let value = args[0];

            if (ir !== 'string' || !value || value.kind !== 'regex' || value.flags.length > 0) {
                return null;
            }

            return [{ kind: 'pattern', value: value.source }];
        }
        case 'max': {
            let value = numberArg(args, 0);

            if (value === null) {
                return null;
            }

            if (ir === 'number' || ir === 'bigint') {
                return [{ key: 'maximum', kind: 'upper', value }];
            }

            if (ir === 'string') {
                return [{ key: 'maxLength', kind: 'upper', value }];
            }

            return [{ key: 'maxItems', kind: 'upper', value }];
        }
        case 'min': {
            let value = numberArg(args, 0);

            if (value === null) {
                return null;
            }

            if (ir === 'number' || ir === 'bigint') {
                return [{ key: 'minimum', kind: 'lower', value }];
            }

            if (ir === 'string') {
                return [{ key: 'minLength', kind: 'lower', value }];
            }

            return [{ key: 'minItems', kind: 'lower', value }];
        }
        case 'multipleOf': {
            let value = numberArg(args, 0);

            if (ir !== 'number' || value === null) {
                return null;
            }

            return [{ kind: 'multipleOf', value }];
        }
        case 'negative': {
            if (ir !== 'number') {
                return null;
            }

            return [{ key: 'exclusiveMaximum', kind: 'upper', value: 0 }];
        }
        case 'nonNegative': {
            if (ir !== 'number') {
                return null;
            }

            return [{ key: 'minimum', kind: 'lower', value: 0 }];
        }
        case 'nonPositive': {
            if (ir !== 'number') {
                return null;
            }

            return [{ key: 'maximum', kind: 'upper', value: 0 }];
        }
        case 'positive': {
            if (ir !== 'number') {
                return null;
            }

            return [{ key: 'exclusiveMinimum', kind: 'lower', value: 0 }];
        }
        case 'range': {
            let lower = numberArg(args, 0),
                upper = numberArg(args, 1);

            if (lower === null || upper === null) {
                return null;
            }

            if (ir === 'number' || ir === 'bigint') {
                return [{ key: 'minimum', kind: 'lower', value: lower }, { key: 'maximum', kind: 'upper', value: upper }];
            }

            if (ir === 'string') {
                return [{ key: 'minLength', kind: 'lower', value: lower }, { key: 'maxLength', kind: 'upper', value: upper }];
            }

            return [{ key: 'minItems', kind: 'lower', value: lower }, { key: 'maxItems', kind: 'upper', value: upper }];
        }
        case 'safeInteger': {
            if (ir !== 'number') {
                return null;
            }

            return [
                { kind: 'type' },
                { key: 'minimum', kind: 'lower', value: -9007199254740991 },
                { key: 'maximum', kind: 'upper', value: 9007199254740991 }
            ];
        }
        case 'startsWith': {
            let value = stringArg(args, 0);

            if (ir !== 'string' || value === null) {
                return null;
            }

            return [{ kind: 'pattern', value: '^' + esc(value) }];
        }
        case 'url': {
            if (ir !== 'string') {
                return null;
            }

            if (variant === undefined) {
                return [{ kind: 'format', value: 'uri' }];
            }

            if (variant === 'http') {
                return [{ kind: 'format', value: 'uri' }, { kind: 'pattern', value: '^https?://' }];
            }

            if (variant === 'https') {
                return [{ kind: 'format', value: 'uri' }, { kind: 'pattern', value: '^https://' }];
            }

            return null;
        }
        case 'uuid': {
            if (ir !== 'string') {
                return null;
            }

            if (variant === undefined || /^v[1-8]$/.test(variant)) {
                return [{ kind: 'format', value: 'uuid' }];
            }

            return null;
        }
        default:
            return null;
    }
}

function numberArg(args: StaticArg[], index: number): number | null {
    let arg = args[index];

    return arg && arg.kind === 'number' ? arg.value : null;
}

function propertyName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
        return name.text;
    }

    return null;
}

function recognizeCallee(
    call: ts.CallExpression,
    namedTable: Map<string, string>,
    checker: ts.TypeChecker
): { name: string; variant?: string } | null {
    let callee = call.expression;

    if (ts.isIdentifier(callee)) {
        let canonical = namedTable.get(callee.text);

        return canonical ? { name: canonical } : null;
    }

    if (ts.isPropertyAccessExpression(callee)) {
        let base = callee.expression;

        if (ts.isIdentifier(base)) {
            let canonical = namedTable.get(base.text);

            if (canonical) {
                return { name: canonical, variant: callee.name.text };
            }

            if (isNamespaceImport(base, checker)) {
                return { name: callee.name.text };
            }

            return null;
        }

        if (ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression) && isNamespaceImport(base.expression, checker)) {
            return { name: base.name.text, variant: callee.name.text };
        }
    }

    return null;
}

function resolveConflicts(contributions: Contribution[]): JsonSchema | null {
    let bounds: Partial<Record<LowerKey | UpperKey, number>> = {},
        formats: string[] = [],
        fragment: JsonSchema = {},
        hasInteger = false,
        multiples: number[] = [],
        patterns: string[] = [];

    for (let i = 0, n = contributions.length; i < n; i++) {
        let contribution = contributions[i];

        if (contribution.kind === 'lower') {
            let previous = bounds[contribution.key];

            bounds[contribution.key] = previous === undefined ? contribution.value : Math.max(previous, contribution.value);
        }
        else if (contribution.kind === 'upper') {
            let previous = bounds[contribution.key];

            bounds[contribution.key] = previous === undefined ? contribution.value : Math.min(previous, contribution.value);
        }
        else if (contribution.kind === 'format') {
            formats.push(contribution.value);
        }
        else if (contribution.kind === 'multipleOf') {
            multiples.push(contribution.value);
        }
        else if (contribution.kind === 'pattern') {
            patterns.push(contribution.value);
        }
        else {
            hasInteger = true;
        }
    }

    Object.assign(fragment, bounds);

    if (hasInteger) {
        fragment.type = 'integer';
    }

    let uniqueFormats = [...new Set(formats)];

    if (uniqueFormats.length === 1) {
        fragment.format = uniqueFormats[0];
    }

    let uniqueMultiples = [...new Set(multiples)];

    if (uniqueMultiples.length === 1) {
        fragment.multipleOf = uniqueMultiples[0];
    }

    if (patterns.length === 1) {
        fragment.pattern = patterns[0];
    }
    else if (patterns.length > 1) {
        fragment.allOf = patterns.map((pattern) => ({ pattern }));
    }

    return Object.keys(fragment).length > 0 ? fragment : null;
}

function stringArg(args: StaticArg[], index: number): string | null {
    let arg = args[index];

    return arg && arg.kind === 'string' ? arg.value : null;
}

function toIR(type: AnalyzedProperty['type']): IRType | null {
    if (type === 'array' || type === 'bigint' || type === 'number' || type === 'string') {
        return type;
    }

    return null;
}


const extractConstraints = (
    configArg: ts.Expression,
    root: AnalyzedProperty,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker
): Map<string, JsonSchema> => {
    let result = new Map<string, JsonSchema>();

    if (!ts.isObjectLiteralExpression(configArg) || root.type !== 'object' || !root.properties) {
        return result;
    }

    let irByName = new Map<string, IRType>();

    for (let i = 0, n = root.properties.length; i < n; i++) {
        let property = root.properties[i],
            ir = toIR(property.type);

        if (ir) {
            irByName.set(property.name, ir);
        }
    }

    let namedTable = buildNamedTable(sourceFile),
        properties = configArg.properties;

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        let name = propertyName(property.name);

        if (name === null) {
            continue;
        }

        let ir = irByName.get(name);

        if (!ir) {
            continue;
        }

        let calls = collectCalls(property.initializer);

        if (!calls) {
            continue;
        }

        let contributions: Contribution[] = [];

        for (let j = 0, m = calls.length; j < m; j++) {
            let recognized = recognizeCallee(calls[j], namedTable, checker);

            if (!recognized) {
                continue;
            }

            let args = extractArgs(calls[j].arguments);

            if (args === null) {
                continue;
            }

            let mapped = mapBuiltin(recognized.name, recognized.variant, ir, args);

            if (mapped) {
                for (let k = 0, l = mapped.length; k < l; k++) {
                    contributions.push(mapped[k]);
                }
            }
        }

        if (contributions.length === 0) {
            continue;
        }

        let fragment = resolveConflicts(contributions);

        if (fragment) {
            result.set(name, fragment);
        }
    }

    return result;
};


export { extractConstraints };
