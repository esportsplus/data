import type { ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';

import type { AnalyzedProperty } from '../type-analyzer';
import { analyzeType } from '../type-analyzer';


type DetectedCall = {
    method: 'decode' | 'encode';
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
};

type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: string;
};


let fieldSpecCache = new WeakMap<ts.TypeNode, FieldSpec[]>();


function analyzePropertyToFieldSpec(prop: AnalyzedProperty): FieldSpec | null {
    let nullable = prop.nullable || prop.optional || false,
        type: string;

    switch (prop.type) {
        case 'any':
        case 'unknown':
            type = 'mixed';
            break;

        case 'array':
            type = 'array';
            break;

        case 'bigint':
            type = 'bigint';
            break;

        case 'boolean':
            type = 'boolean';
            break;

        case 'date':
            type = 'date';
            break;

        case 'null':
            return null;

        case 'number':
            if (prop.brand === 'float') {
                type = 'float64';
            }
            else if (prop.brand === 'int8') {
                type = 'int8';
            }
            else if (prop.brand === 'int16') {
                type = 'int16';
            }
            else if (prop.brand === 'int32' || prop.brand === 'integer') {
                type = 'int32';
            }
            else if (prop.brand === 'uint8') {
                type = 'uint8';
            }
            else if (prop.brand === 'uint16') {
                type = 'uint16';
            }
            else if (prop.brand === 'uint32') {
                type = 'uint32';
            }
            else {
                type = 'float64';
            }
            break;

        case 'object':
            type = 'object';
            break;

        case 'record':
            type = 'map';
            break;

        case 'string':
            type = 'string';
            break;

        case 'union':
            type = 'mixed';
            break;

        default:
            type = 'mixed';
            break;
    }

    let spec: FieldSpec = { name: prop.name, type };

    if (nullable) {
        spec.nullable = true;
    }

    return spec;
}

function generateSchemaLiteral(properties: AnalyzedProperty[]): string {
    let specs: FieldSpec[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let spec = analyzePropertyToFieldSpec(properties[i]);

        if (spec) {
            specs.push(spec);
        }
    }

    return JSON.stringify(specs);
}

function getFieldSpecs(typeArg: ts.TypeNode, checker: ts.TypeChecker): FieldSpec[] | null {
    let cached = fieldSpecCache.get(typeArg);

    if (cached) {
        return cached;
    }

    let analyzed = analyzeType(typeArg, checker);

    // Skip primitive types (no properties to map)
    if (analyzed.properties.length === 0) {
        return null;
    }

    let specs: FieldSpec[] = [];

    for (let i = 0, n = analyzed.properties.length; i < n; i++) {
        let spec = analyzePropertyToFieldSpec(analyzed.properties[i]);

        if (spec) {
            specs.push(spec);
        }
    }

    fieldSpecCache.set(typeArg, specs);

    return specs;
}

function hasDefineSchemaMethod(type: ts.Type, checker: ts.TypeChecker): boolean {
    let prop = type.getProperty('defineSchema');

    if (!prop) {
        return false;
    }

    let propType = checker.getTypeOfSymbol(prop);

    return propType.getCallSignatures().length > 0;
}

function replaceCall(call: DetectedCall, ctx: TransformContext): string {
    let expr = call.node.expression as ts.PropertyAccessExpression,
        methodName = expr.name.text,
        receiverText = expr.expression.getText(ctx.sourceFile),
        schema = generateSchemaLiteral(analyzeType(call.typeArg, ctx.checker).properties),
        args = call.node.arguments;

    if (call.method === 'encode') {
        if (args.length === 0) {
            return call.node.getText(ctx.sourceFile);
        }

        let firstArgText = args[0].getText(ctx.sourceFile);

        // No existing 2nd arg
        if (args.length === 1) {
            return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema}})`;
        }

        let secondArg = args[1],
            secondArgText = secondArg.getText(ctx.sourceFile);

        // 2nd arg is boolean literal (view parameter)
        if (
            secondArg.kind === ts.SyntaxKind.TrueKeyword ||
            secondArg.kind === ts.SyntaxKind.FalseKeyword
        ) {
            return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema},"view":${secondArgText}})`;
        }

        // 2nd arg is an object literal — merge schema into it
        if (ts.isObjectLiteralExpression(secondArg)) {
            let existingProps = secondArgText.slice(1, -1).trim();
            let separator = existingProps.length > 0 ? ',' : '';

            return `${receiverText}.${methodName}(${firstArgText},{${existingProps}${separator}"schema":${schema}})`;
        }

        // 2nd arg is a variable — spread it
        return `${receiverText}.${methodName}(${firstArgText},{...${secondArgText},"schema":${schema}})`;
    }

    // decode
    if (args.length === 0) {
        return call.node.getText(ctx.sourceFile);
    }

    let firstArgText = args[0].getText(ctx.sourceFile);

    // No existing 2nd arg
    if (args.length <= 1) {
        return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema}})`;
    }

    let secondArg = args[1],
        secondArgText = secondArg.getText(ctx.sourceFile);

    // 2nd arg is an object literal — merge schema into it
    if (ts.isObjectLiteralExpression(secondArg)) {
        let existingProps = secondArgText.slice(1, -1).trim();
        let separator = existingProps.length > 0 ? ',' : '';

        return `${receiverText}.${methodName}(${firstArgText},{${existingProps}${separator}"schema":${schema}})`;
    }

    // 2nd arg is a number (length) — replace with schema options
    if (ts.isNumericLiteral(secondArg)) {
        return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema}})`;
    }

    // 2nd arg is a variable — spread it
    return `${receiverText}.${methodName}(${firstArgText},{...${secondArgText},"schema":${schema}})`;
}

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.TypeChecker, node: ts.Node): void {
    if (
        ts.isCallExpression(node) &&
        node.typeArguments &&
        node.typeArguments.length > 0 &&
        ts.isPropertyAccessExpression(node.expression)
    ) {
        let expr = node.expression,
            methodName = expr.name.text;

        if (methodName === 'decode' || methodName === 'encode') {
            let receiverType = checker.getTypeAtLocation(expr.expression);

            if (hasDefineSchemaMethod(receiverType, checker)) {
                let typeArg = node.typeArguments[0],
                    type = checker.getTypeAtLocation(typeArg);

                // Skip primitive types — only transform object types with properties
                if (type.flags & ts.TypeFlags.Object) {
                    calls.set(node, {
                        method: methodName,
                        node,
                        typeArg
                    });
                }
            }
        }
    }

    ts.forEachChild(node, n => visit(calls, checker, n));
}


export default {
    patterns: ['.encode<', '.decode<'],
    transform: (ctx: TransformContext) => {
        let detected = new Map<ts.CallExpression, DetectedCall>();

        visit(detected, ctx.checker, ctx.sourceFile);

        if (detected.size === 0) {
            return {};
        }

        let replacements: ReplacementIntent[] = [];

        for (let [, call] of detected) {
            let specs = getFieldSpecs(call.typeArg, ctx.checker);

            if (!specs || specs.length === 0) {
                continue;
            }

            replacements.push({
                generate: () => replaceCall(call, ctx),
                node: call.node
            });
        }

        if (replacements.length === 0) {
            return {};
        }

        return { replacements };
    }
};
