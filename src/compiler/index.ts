import type { ImportIntent, ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { imports } from '@esportsplus/typescript/compiler';
import { analyzeType } from '~/compiler/type-analyzer';
import { PACKAGE } from '~/constants';
import { default as validators, type BrandedValidator } from './validators';
import { transformCodec } from './proto';
import { generateValidator } from './validator';


type CallType = 'codec' | 'validator.build';

type DetectedCall = {
    callType: CallType;
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    importSource?: string;
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
    switch (call.callType) {
        case 'codec':
            return transformCodec(call.typeArg, call.configArg, ctx.checker);

        case 'validator.build': {
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

        default:
            return call.node.getText(ctx.sourceFile);
    }
}

function visit(
    calls: Map<ts.CallExpression, DetectedCall>,
    checker: ts.TypeChecker,
    node: ts.Node,
    packageImports: Set<string>
): void {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        let expr = node.expression,
            callType: CallType | null = null,
            traceNode: ts.Node | undefined;

        // Direct call: codec<T>() or aliasedCodec<T>()
        if (ts.isIdentifier(expr)) {
            if (imports.inPackage(checker, expr, PACKAGE, 'codec', packageImports)) {
                callType = 'codec';
                traceNode = expr;
            }
        }
        // Property access: validator.build<T>() or ns.codec<T>() or ns.validator.build<T>()
        else if (ts.isPropertyAccessExpression(expr)) {
            let methodName = expr.name.text;

            // validator.build<T>() or aliasedValidator.build<T>()
            if (methodName === 'build' && ts.isIdentifier(expr.expression)) {
                if (imports.inPackage(checker, expr.expression, PACKAGE, 'validator', packageImports)) {
                    callType = 'validator.build';
                    traceNode = expr.expression;
                }
            }
            // ns.codec<T>() - namespace import
            else if (methodName === 'codec' && ts.isIdentifier(expr.expression)) {
                if (imports.inPackage(checker, expr.name, PACKAGE, 'codec', packageImports)) {
                    callType = 'codec';
                    traceNode = expr.name;
                }
            }
            // ns.validator.build<T>() - namespace import with validator
            else if (methodName === 'build' && ts.isPropertyAccessExpression(expr.expression)) {
                let inner = expr.expression;

                if (inner.name.text === 'validator' && ts.isIdentifier(inner.expression)) {
                    if (imports.inPackage(checker, inner.name, PACKAGE, 'validator', packageImports)) {
                        callType = 'validator.build';
                        traceNode = inner.name;
                    }
                }
            }
        }

        if (callType && traceNode) {
            let detected: DetectedCall = {
                    callType,
                    importSource: trace(traceNode as ts.Identifier, checker) ?? undefined,
                    node,
                    typeArg: node.typeArguments[0]
                };

            if (callType === 'codec' && node.arguments.length > 0) {
                detected.configArg = node.arguments[0];
            }
            else if (callType === 'validator.build') {
                if (node.typeArguments.length > 1) {
                    detected.errorMessagesType = node.typeArguments[1];
                }

                if (node.arguments.length > 0) {
                    detected.configArg = node.arguments[0];
                }
            }

            calls.set(node, detected);
        }
    }

    ts.forEachChild(node, n => visit(calls, checker, n, packageImports));
}


export default {
    patterns: ['codec<', 'codec(', 'validator.build', 'validator', '.codec', '.build'],
    transform: (ctx: TransformContext) => {
        if (imports.find(ctx.sourceFile, PACKAGE).length === 0) {
            return {};
        }

        let detected = new Map<ts.CallExpression, DetectedCall>(),
            packageImports = new Set<string>();

        // Cache package imports for fallback detection
        let found = imports.find(ctx.sourceFile, PACKAGE);

        for (let i = 0, n = found.length; i < n; i++) {
            for (let [, alias] of found[i].specifiers) {
                packageImports.add(alias);
            }
        }

        visit(detected, ctx.checker, ctx.sourceFile, packageImports);

        if (detected.size === 0) {
            return {};
        }

        let intents: ImportIntent[] = [],
            remove: string[] = [],
            replacements: ReplacementIntent[] = [];

        for (let [, call] of detected) {
            let cache = validators.get(call.importSource, ctx.program);

            replacements.push({
                generate: () => transform(call, ctx, cache),
                node: call.node
            });

            if (call.callType === 'codec' && remove.indexOf('codec') !== -1) {
                remove.push('codec');
            }
            else if (call.callType === 'validator.build' && remove.indexOf('validator') !== -1) {
                remove.push('validator');
            }
        }

        if (remove.length > 0) {
            intents.push({
                package: PACKAGE,
                remove
            });
        }

        return { imports: intents, replacements };
    }
};;
