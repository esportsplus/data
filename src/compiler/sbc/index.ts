import type { ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';

import { resolveBrandedType } from '../type-analyzer';


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


// Non-Uint8Array typed arrays runtime-infer to 'typedarray'; Uint8Array infers to 'bytes'.
const TYPED_ARRAY_NAMES = new Set([
    'BigInt64Array',
    'BigUint64Array',
    'Float32Array',
    'Float64Array',
    'Int16Array',
    'Int32Array',
    'Int8Array',
    'Uint16Array',
    'Uint32Array',
    'Uint8ClampedArray',
]);


let schemaCache = new WeakMap<ts.TypeNode, string | null>();


// Parity-or-omit: a field is width-determinate ONLY when the FieldSpec it maps to equals what
// runtime `inferType` (src/sbc/schema.ts) produces for EVERY value the static type admits.
// Numbers narrow by value at runtime (uint8..float64), so only a branded uint8 (whose range
// [0,255] always infers 'uint8') is determinate; any other number forces the whole type
// hint-free. A non-determinate field returns null so the call falls back to runtime inference,
// which is byte-identical by construction.
function classify(type: ts.Type, checker: ts.Checker): { nullable: boolean; type: string } | null {
    // The `boolean` intrinsic is internally a `true | false` union — classify it before peeling.
    if (type.flags & ts.TypeFlags.Boolean) {
        return { nullable: false, type: 'boolean' };
    }

    if (type.isUnionType()) {
        let core: ts.Type | null = null,
            coreCount = 0,
            nullable = false;

        let constituents = type.getTypes();

        for (let i = 0, n = constituents.length; i < n; i++) {
            let t = constituents[i]!;

            if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
                nullable = true;

                continue;
            }

            core = t;
            coreCount++;
        }

        if (coreCount !== 1 || core === null) {
            return null;
        }

        let base = classifyCore(core, checker);

        return base === null ? null : { nullable, type: base };
    }

    let base = classifyCore(type, checker);

    return base === null ? null : { nullable: false, type: base };
}

function classifyCore(type: ts.Type, checker: ts.Checker): string | null {
    let flags = type.flags;

    if (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) {
        return 'boolean';
    }

    if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) {
        return 'bigint';
    }

    if (flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral)) {
        return 'string';
    }

    // Unbranded/literal number width depends on the value at runtime — never determinate.
    if (flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) {
        return null;
    }

    if (type.isIntersectionType()) {
        let branded = resolveBrandedType(type, checker);

        if (branded.brand !== undefined) {
            if (branded.base === 'number') {
                return branded.brand === 'uint8' ? 'uint8' : null;
            }

            if (branded.base === 'string') {
                return 'string';
            }

            if (branded.base === 'boolean') {
                return 'boolean';
            }
        }

        return null;
    }

    if (flags & ts.TypeFlags.Object) {
        if (checker.isArrayType(type) || checker.isTupleType(type)) {
            return 'array';
        }

        let name = type.getSymbol()?.name;

        if (name === 'Date') {
            return 'date';
        }

        if (name === 'Uint8Array') {
            return 'bytes';
        }

        if (name !== undefined && TYPED_ARRAY_NAMES.has(name)) {
            return 'typedarray';
        }

        // Map/Set/WeakMap/WeakSet/Promise/RegExp are not plain records — runtime cannot
        // faithfully encode them, so force the hint-free fallback rather than emit a wrong spec.
        if (name === 'Map' || name === 'Promise' || name === 'RegExp' || name === 'Set' || name === 'WeakMap' || name === 'WeakSet') {
            return null;
        }

        if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
            return null;
        }

        // Plain object / Record / interface — runtime infers 'object' and re-infers the nested
        // shape identically, so the parent hint stays byte-identical to pure inference.
        return 'object';
    }

    return null;
}

function computeSchemaLiteral(typeArg: ts.TypeNode, checker: ts.Checker): string | null {
    let rootType = checker.getTypeAtLocation(typeArg);

    if (rootType === undefined || (rootType.flags & ts.TypeFlags.Object) === 0) {
        return null;
    }

    let props = checker.getPropertiesOfType(rootType);

    if (props.length === 0) {
        return null;
    }

    let specs: FieldSpec[] = [];

    for (let i = 0, n = props.length; i < n; i++) {
        let prop = props[i]!,
            propType = checker.getTypeOfSymbol(prop);

        if (propType === undefined) {
            return null;
        }

        let classified = classify(propType, checker);

        // A single non-determinate field makes the WHOLE type hint-free (kills the D5 hash
        // divergence class outright rather than chasing per-field width heuristics).
        if (classified === null) {
            return null;
        }

        let spec: FieldSpec = { name: prop.name, type: classified.type };

        if (classified.nullable || (prop.flags & ts.SymbolFlags.Optional) !== 0) {
            spec.nullable = true;
        }

        specs.push(spec);
    }

    if (specs.length === 0) {
        return null;
    }

    specs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    return JSON.stringify(specs);
}

function getSchemaLiteral(typeArg: ts.TypeNode, checker: ts.Checker): string | null {
    if (schemaCache.has(typeArg)) {
        return schemaCache.get(typeArg) ?? null;
    }

    let result = computeSchemaLiteral(typeArg, checker);

    schemaCache.set(typeArg, result);

    return result;
}

function hasDefineSchemaMethod(type: ts.Type, checker: ts.Checker): boolean {
    let prop = checker.getPropertyOfType(type, 'defineSchema');

    if (!prop) {
        return false;
    }

    let propType = checker.getTypeOfSymbol(prop);

    if (propType === undefined) {
        return false;
    }

    return checker.getSignaturesOfType(propType, ts.SignatureKind.Call).length > 0;
}

function replaceCall(call: DetectedCall, ctx: TransformContext, schema: string): string {
    let expr = call.node.expression as ts.PropertyAccessExpression,
        methodName = expr.name.text,
        receiverText = expr.expression.getText(ctx.sourceFile),
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

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.Checker, node: ts.Node): void {
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

            if (receiverType !== undefined && hasDefineSchemaMethod(receiverType, checker)) {
                let typeArg = node.typeArguments[0],
                    type = checker.getTypeAtLocation(typeArg);

                // Skip primitive types — only transform object types with properties
                if (type !== undefined && (type.flags & ts.TypeFlags.Object)) {
                    calls.set(node, {
                        method: methodName,
                        node,
                        typeArg
                    });
                }
            }
        }
    }

    node.forEachChild(n => visit(calls, checker, n));
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
            let schema = getSchemaLiteral(call.typeArg, ctx.checker);

            // Hint-free (any non-determinate field) — leave the call for runtime inference.
            if (schema === null) {
                continue;
            }

            replacements.push({
                generate: () => replaceCall(call, ctx, schema),
                node: call.node
            });
        }

        if (replacements.length === 0) {
            return {};
        }

        return { replacements };
    }
};
