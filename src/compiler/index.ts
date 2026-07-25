import type { ImportIntent, ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { imports, uid } from '@esportsplus/typescript/compiler';
import { PACKAGE_NAME } from '../constants';
import { analyzeRootType, analyzeType } from './type-analyzer';
import { extractConstraints } from './json-schema-constraints';
import { default as validators, type BrandedValidator } from './validators';
import { generateJsonSchema } from './json-schema';
import { generateValidator } from './validator';


type DetectedCall = {
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    importSource?: string;
    method: 'build' | 'toJsonSchema';
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
};


const ASYNC_PATTERN = /^\s*\(?async\s|\bawait\b/;


function extractMessages(type: ts.Type, parts: string[], messages: Map<string, string>, checker: ts.TypeChecker): void {
    if (type.isStringLiteral()) {
        messages.set(parts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let properties = checker.getPropertiesOfType(type);

        for (let i = 0, n = properties.length; i < n; i++) {
            let prop = properties[i];

            extractMessages(checker.getTypeOfSymbol(prop), [...parts, prop.getName()], messages, checker);
        }
    }
}

// Trace symbol through re-exports to find original declaration source file
const trace = (node: ts.Identifier, checker: ts.TypeChecker): string | null => {
    let symbol = checker.getSymbolAtLocation(node);

    if (!symbol) {
        return null;
    }

    if (symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
    }

    let declarations = symbol.getDeclarations();

    if (!declarations || declarations.length === 0) {
        return null;
    }

    return declarations[0].getSourceFile().fileName;
};

function transform(call: DetectedCall, ctx: TransformContext, validators: Map<string, BrandedValidator>): string {
    let source = call.configArg?.getText(ctx.sourceFile),
        messages = new Map<string, string>();

    if (call.errorMessagesType) {
        extractMessages(ctx.checker.getTypeAtLocation(call.errorMessagesType), [], messages, ctx.checker);
    }

    return generateValidator(
        analyzeType(call.typeArg, ctx.checker),
        {
            brandValidators: validators,
            customMessages: messages,
            hasAsync: source ? ASYNC_PATTERN.test(source) : false
        },
        source
    );
}

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.TypeChecker, node: ts.Node): void {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        let expr = node.expression,
            matched = false,
            method: 'build' | 'toJsonSchema' = 'build',
            traceNode: ts.Node | undefined;

        // Property access: validator.<m><T>() or ns.validator.<m><T>()
        if (ts.isPropertyAccessExpression(expr)) {
            let methodName = expr.name.text;

            if (methodName === 'build' || methodName === 'toJsonSchema') {
                // validator.<m><T>() or aliasedValidator.<m><T>()
                if (ts.isIdentifier(expr.expression)) {
                    if (imports.includes(checker, expr.expression, PACKAGE_NAME, 'validator')) {
                        matched = true;
                        method = methodName;
                        traceNode = expr.expression;
                    }
                }
                // ns.validator.<m><T>() - namespace import with validator
                else if (ts.isPropertyAccessExpression(expr.expression)) {
                    let inner = expr.expression;

                    if (inner.name.text === 'validator' && ts.isIdentifier(inner.expression)) {
                        if (imports.includes(checker, inner.name, PACKAGE_NAME, 'validator')) {
                            matched = true;
                            method = methodName;
                            traceNode = inner.name;
                        }
                    }
                }
            }
        }

        if (matched && traceNode) {
            let detected: DetectedCall = {
                    importSource: trace(traceNode as ts.Identifier, checker) ?? undefined,
                    method,
                    node,
                    typeArg: node.typeArguments[0]
                };

            if (node.typeArguments.length > 1) {
                detected.errorMessagesType = node.typeArguments[1];
            }

            if (node.arguments.length > 0) {
                detected.configArg = node.arguments[0];
            }

            calls.set(node, detected);
        }
    }

    ts.forEachChild(node, n => visit(calls, checker, n));
}


export default {
    patterns: ['validator.build', 'validator', '.build', '.toJsonSchema'],
    transform: (ctx: TransformContext) => {
        let found = imports.all(ctx.sourceFile, PACKAGE_NAME);

        if (found.length === 0) {
            return {};
        }

        let detected = new Map<ts.CallExpression, DetectedCall>();

        visit(detected, ctx.checker, ctx.sourceFile);

        if (detected.size === 0) {
            return {};
        }

        let hoisted = new Map<string, string>(),
            intents: ImportIntent[] = [],
            prepend: string[] = [],
            remove: string[] = [],
            replacements: ReplacementIntent[] = [];

        for (let [, call] of detected) {
            if (call.method === 'toJsonSchema') {
                let root = analyzeRootType(call.typeArg, ctx.checker),
                    fragments = call.configArg
                        ? extractConstraints(call.configArg, root, ctx.sourceFile, ctx.checker)
                        : undefined,
                    text = generateJsonSchema(root, fragments),
                    name = hoisted.get(text);

                if (name === undefined) {
                    name = uid('schema');
                    hoisted.set(text, name);
                    prepend.push(`const ${name} = ${text};`);
                }

                let identifier = name;

                replacements.push({
                    generate: () => identifier,
                    node: call.node
                });
            }
            else {
                let cache = validators.get(call.importSource, ctx.program);

                replacements.push({
                    generate: () => transform(call, ctx, cache),
                    node: call.node
                });
            }

            if (remove.indexOf('validator') === -1) {
                remove.push('validator');
            }
        }

        if (remove.length > 0) {
            intents.push({
                package: PACKAGE_NAME,
                remove
            });
        }

        if (prepend.length > 0) {
            return { imports: intents, prepend, replacements };
        }

        return { imports: intents, replacements };
    }
};
