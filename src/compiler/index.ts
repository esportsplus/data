import type { ImportIntent, Plugin, ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { getValidatorsForSource, type BrandedValidator } from './config-parser';
import { imports } from '@esportsplus/typescript/compiler';
import { analyzeType } from '~/compiler/type-analyzer';
import { generateValidator } from './validator';
import { PACKAGE } from '~/constants';
import { transformCodec } from './proto';
import { ts } from '@esportsplus/typescript';


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

const PATTERNS = ['codec<', 'codec(', 'validator.build', 'validator', '.codec', '.build'];


function collectCalls(
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
                importSource: imports.trace(traceNode as ts.Identifier, checker) ?? undefined,
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

    ts.forEachChild(node, n => collectCalls(calls, checker, n, packageImports));
}

function extractMessages(
    type: ts.Type,
    pathParts: string[],
    messages: Map<string, string>,
    typeChecker: ts.TypeChecker
): void {
    if (type.isStringLiteral()) {
        messages.set(pathParts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let props = typeChecker.getPropertiesOfType(type);

        for (let i = 0, n = props.length; i < n; i++) {
            let prop = props[i],
                propType = typeChecker.getTypeOfSymbol(prop);

            extractMessages(propType, [...pathParts, prop.getName()], messages, typeChecker);
        }
    }
}

function parseErrorMessages(typeNode: ts.TypeNode | undefined, typeChecker: ts.TypeChecker): Map<string, string> {
    let messages = new Map<string, string>();

    if (!typeNode) {
        return messages;
    }

    extractMessages(typeChecker.getTypeAtLocation(typeNode), [], messages, typeChecker);

    return messages;
}

function transformCall(
    call: DetectedCall,
    ctx: TransformContext,
    brandValidators: Map<string, BrandedValidator>
): string {
    switch (call.callType) {
        case 'codec':
            return transformCodec(call.typeArg, call.configArg, ctx.checker);

        case 'validator.build': {
            let customValidatorSource = call.configArg?.getText(ctx.sourceFile);

            return generateValidator(
                analyzeType(call.typeArg, ctx.checker),
                {
                    brandValidators,
                    customMessages: parseErrorMessages(call.errorMessagesType, ctx.checker),
                    hasAsync: customValidatorSource ? ASYNC_PATTERN.test(customValidatorSource) : false
                },
                customValidatorSource
            );
        }

        default:
            return call.node.getText(ctx.sourceFile);
    }
}


const plugin: Plugin = {
    patterns: PATTERNS,

    transform: (ctx: TransformContext) => {
        if (imports.find(ctx.sourceFile, PACKAGE).length === 0) {
            return {};
        }

        let detectedCalls = new Map<ts.CallExpression, DetectedCall>(),
            packageImports = new Set<string>();

        // Cache package imports for fallback detection
        let found = imports.find(ctx.sourceFile, PACKAGE);

        for (let i = 0, n = found.length; i < n; i++) {
            for (let [, alias] of found[i].specifiers) {
                packageImports.add(alias);
            }
        }

        collectCalls(detectedCalls, ctx.checker, ctx.sourceFile, packageImports);

        if (detectedCalls.size === 0) {
            return {};
        }

        let importsIntent: ImportIntent[] = [],
            remove: string[] = [],
            replacements: ReplacementIntent[] = [];

        for (let [, call] of detectedCalls) {
            let brandValidators = getValidatorsForSource(call.importSource, ctx.program);

            replacements.push({
                generate: () => transformCall(call, ctx, brandValidators),
                node: call.node
            });

            if (call.callType === 'codec' && !remove.includes('codec')) {
                remove.push('codec');
            }
            else if (call.callType === 'validator.build' && !remove.includes('validator')) {
                remove.push('validator');
            }
        }

        if (remove.length > 0) {
            importsIntent.push({
                package: PACKAGE,
                remove
            });
        }

        return {
            imports: importsIntent,
            replacements
        };
    }
};


export default plugin;
