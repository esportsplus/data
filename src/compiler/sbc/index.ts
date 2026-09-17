import type { ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { imports } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';

import { PACKAGE_NAME } from '../../constants';
import { resolveBrandedType } from '../type-analyzer';
import type { FieldSpec } from '../../sbc/types';


type DetectedCall = {
    method: 'decode' | 'encode';
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
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


// Parity-or-omit (H3): a field qualifies for a hint ONLY when the FieldSpec it maps to equals
// what runtime inference (src/sbc/schema.ts `inferType` + `inferAndRegister`) derives from the
// ACTUAL value for EVERY value the static type admits. Runtime nullability is value-derived and
// number width is value-narrowed, so:
//   - a `T | null` / `T | undefined` union returns null (a present value infers non-nullable);
//   - any union without exactly one pinned non-null constituent returns null;
//   - unbranded/literal numbers return null (inference narrows uint8..float64 by value).
// A null here makes the WHOLE type hint-free, so the call is pure runtime inference and is
// byte-identical by construction. What still qualifies after the restriction: a required
// (non-optional), non-nullable property whose type is boolean, string, bigint (int64), Date,
// Uint8Array (bytes), a non-Uint8Array typed array, an array/tuple, a nested plain object, or a
// branded uint8/string/boolean — on a root object with no index signature.
function classify(type: ts.Type, checker: ts.Checker): string | null {
    // The `boolean` intrinsic is internally a `true | false` union — classify it before peeling.
    if (type.flags & ts.TypeFlags.Boolean) {
        return 'boolean';
    }

    if (type.isUnionType()) {
        let core: ts.Type | null = null,
            coreCount = 0;

        let constituents = type.getTypes();

        for (let i = 0, n = constituents.length; i < n; i++) {
            let t = constituents[i]!;

            // `null`/`undefined` mean the field is nullable/optional at runtime. Inference
            // records nullable:true only for the null value and nullable:false for a present
            // one, so no single static hint matches both. Omit the whole type.
            if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
                return null;
            }

            core = t;
            coreCount++;
        }

        if (coreCount !== 1 || core === null) {
            return null;
        }

        return classifyCore(core, checker);
    }

    return classifyCore(type, checker);
}

function classifyCore(type: ts.Type, checker: ts.Checker): string | null {
    let flags = type.flags;

    if (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) {
        return 'boolean';
    }

    if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) {
        return 'int64';
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

        // The `object` keyword admits arrays/typed arrays/Dates whose runtime inference is not
        // 'object'; the empty type `{}` admits primitives. Neither is pinned to 'object'. Omit.
        if ((flags & ts.TypeFlags.NonPrimitive) !== 0) {
            return null;
        }

        let propCount = checker.getPropertiesOfType(type).length,
            indexCount = checker.getIndexInfosOfType(type).length;

        if (propCount === 0 && indexCount === 0) {
            return null;
        }

        // Plain object / Record / interface — a NESTED object field is encoded through the
        // dynamic `_encObj` path (this hint attaches no refHash), so runtime re-infers the
        // nested shape identically and extra nested keys are preserved. The parent hint stays
        // byte-identical to pure inference.
        return 'object';
    }

    return null;
}

function computeSchemaLiteral(typeArg: ts.TypeNode, checker: ts.Checker): string | null {
    let rootType = checker.getTypeAtLocation(typeArg);

    if (rootType === undefined || (rootType.flags & ts.TypeFlags.Object) === 0) {
        return null;
    }

    // An index signature (Record / `[key: string]: T`) is an "open" root: the runtime value may
    // carry own-properties the static type never names, and a fixed field list would drop them.
    // Omit the whole type rather than diverge from inference's full key set.
    if (checker.getIndexInfosOfType(rootType).length > 0) {
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

        // Optional properties are absent at runtime for some values. Inference omits an absent
        // key but records an explicit null as a nullable field, so a static `nullable:true`
        // hint would materialise an absent key as null. Omit the whole type.
        if ((prop.flags & ts.SymbolFlags.Optional) !== 0) {
            return null;
        }

        let classified = classify(propType, checker);

        // A single non-determinate field makes the WHOLE type hint-free (kills the D5 hash
        // divergence class outright rather than chasing per-field width heuristics).
        if (classified === null) {
            return null;
        }

        specs.push({ name: prop.name, type: classified });
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

type CodecBinding = {
    local?: string;
    namespace?: string;
};


function codecBinding(sourceFile: ts.SourceFile): CodecBinding {
    let local: string | undefined,
        namespace: string | undefined;

    for (let info of imports.all(sourceFile, PACKAGE_NAME)) {
        let name = info.specifiers.get('codec');

        if (name !== undefined) {
            local = name;
        }

        if (info.namespace !== undefined) {
            namespace = info.namespace;
        }
    }

    return { local, namespace };
}

// The `codec` factory itself: the package's named import (possibly aliased) or `ns.codec`.
function isCodecFactory(expr: ts.Expression, checker: ts.Checker, binding: CodecBinding): boolean {
    if (ts.isIdentifier(expr)) {
        return binding.local !== undefined && imports.includes(checker, expr, PACKAGE_NAME, binding.local);
    }

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'codec' && ts.isIdentifier(expr.expression)) {
        return binding.namespace !== undefined && expr.expression.text === binding.namespace;
    }

    return false;
}

// A receiver is a real codec only when it traces back to the package's `codec` export - the
// imported binding itself, `ns.codec`, `codec()`/`ns.codec()`, or a local initialized from one
// of those - never when an unrelated object merely happens to carry a `defineSchema` method.
function isCodecReceiver(expr: ts.Expression, checker: ts.Checker, binding: CodecBinding, depth: number = 0): boolean {
    if (depth > 8) {
        return false;
    }

    if (ts.isCallExpression(expr)) {
        return isCodecFactory(expr.expression, checker, binding);
    }

    if (ts.isIdentifier(expr)) {
        if (binding.local !== undefined && imports.includes(checker, expr, PACKAGE_NAME, binding.local)) {
            return true;
        }

        let declaration = checker.getSymbolAtLocation(expr)?.valueDeclaration?.resolve();

        if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
            return isCodecReceiver(declaration.initializer, checker, binding, depth + 1);
        }

        return false;
    }

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'codec' && ts.isIdentifier(expr.expression)) {
        return binding.namespace !== undefined && expr.expression.text === binding.namespace;
    }

    return false;
}

// The static text of a property key (identifier / string / numeric literal), or null when the
// name is computed and could therefore evaluate to `schema` (unsafe to merge around).
function staticPropertyName(name: ts.PropertyName | undefined): string | null {
    if (name === undefined) {
        return null;
    }

    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }

    return null;
}

// True only when appending `"schema":…` to this options object provably cannot change or
// override a caller-supplied option: no spread (could carry `schema`), no computed key (could
// be `schema`), and no property/accessor already named `schema`.
function canMergeSchema(options: ts.ObjectLiteralExpression): boolean {
    for (let i = 0, n = options.properties.length; i < n; i++) {
        let prop = options.properties[i]!;

        if (ts.isSpreadAssignment(prop)) {
            return false;
        }

        if (ts.isPropertyAssignment(prop)) {
            let key = staticPropertyName(prop.name);

            if (key === null || key === 'schema') {
                return false;
            }

            continue;
        }

        if (ts.isShorthandPropertyAssignment(prop)) {
            if (staticPropertyName(prop.name) === 'schema') {
                return false;
            }

            continue;
        }

        if (ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
            let key = staticPropertyName(prop.name);

            if (key === null || key === 'schema') {
                return false;
            }

            continue;
        }

        // Anything else is an options shape we cannot reason about — bail.
        return false;
    }

    return true;
}

function isBooleanType(type: ts.Type | undefined): boolean {
    return type !== undefined && (type.flags & ts.TypeFlags.Boolean) !== 0;
}

function isNumberType(type: ts.Type | undefined): boolean {
    return type !== undefined && (type.flags & ts.TypeFlags.Number) !== 0;
}

// Rewrites one `codec.encode` / `codec.decode` call to inject the parity-safe schema hint while
// preserving every caller argument verbatim (H4). The real overloads are:
//   encode(value, viewOrOptions?: boolean | EncodeOptions)
//   decode(buffer, lengthOrOptions?: number | DecodeOptions)
// so a boolean view, a numeric decode length and an options object are three DISTINCT shapes and
// are never coerced into one another. Any shape that cannot be rewritten unambiguously is left
// unchanged (no injection) rather than guessed. An explicit caller `schema` is never overridden.
function replaceCall(call: DetectedCall, ctx: TransformContext, schema: string): string {
    let expr = call.node.expression as ts.PropertyAccessExpression,
        methodName = expr.name.text,
        receiverText = expr.expression.getText(ctx.sourceFile),
        sourceText = call.node.getText(ctx.sourceFile),
        args = call.node.arguments;

    // Both overloads take at most two arguments; anything else is not a shape we rewrite.
    if (args.length === 0 || args.length > 2) {
        return sourceText;
    }

    let firstArgText = args[0].getText(ctx.sourceFile);

    // Only the value/buffer is present — the schema bag is the one and only option.
    if (args.length === 1) {
        return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema}})`;
    }

    let secondArg = args[1];

    if (call.method === 'encode') {
        // encode(value, view) — boolean literal.
        if (secondArg.kind === ts.SyntaxKind.TrueKeyword || secondArg.kind === ts.SyntaxKind.FalseKeyword) {
            return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema},"view":${secondArg.getText(ctx.sourceFile)}})`;
        }

        // encode(value, { ...options }) — merge only a provably safe literal.
        if (ts.isObjectLiteralExpression(secondArg)) {
            if (!canMergeSchema(secondArg)) {
                return sourceText;
            }

            let props = secondArg.properties.map((prop) => prop.getText(ctx.sourceFile));

            props.push(`"schema":${schema}`);

            return `${receiverText}.${methodName}(${firstArgText},{${props.join(',')}})`;
        }

        // encode(value, view) where view is an identifier/expression of boolean type — preserve
        // view mode explicitly instead of spreading the boolean away. A non-boolean second arg
        // is an options object we must not spread (that could drop/override caller options), so
        // leave the call unchanged.
        if (isBooleanType(ctx.checker.getTypeAtLocation(secondArg))) {
            return `${receiverText}.${methodName}(${firstArgText},{"schema":${schema},"view":${secondArg.getText(ctx.sourceFile)}})`;
        }

        return sourceText;
    }

    // decode(buffer, length) — a numeric length (literal or typed variable) is the length
    // overload. Injecting would discard it, and the runtime cannot take both a length and a
    // schema, so leave the call unchanged and preserve the length exactly.
    if (ts.isNumericLiteral(secondArg) || isNumberType(ctx.checker.getTypeAtLocation(secondArg))) {
        return sourceText;
    }

    // decode(buffer, { ...options }) — merge only a provably safe literal.
    if (ts.isObjectLiteralExpression(secondArg)) {
        if (!canMergeSchema(secondArg)) {
            return sourceText;
        }

        let props = secondArg.properties.map((prop) => prop.getText(ctx.sourceFile));

        props.push(`"schema":${schema}`);

        return `${receiverText}.${methodName}(${firstArgText},{${props.join(',')}})`;
    }

    // decode(buffer, options) where options is a variable/expression — leave it untouched so no
    // existing option can be lost or overridden.
    return sourceText;
}

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.Checker, node: ts.Node, binding: CodecBinding): void {
    if (
        ts.isCallExpression(node) &&
        node.typeArguments &&
        node.typeArguments.length > 0 &&
        ts.isPropertyAccessExpression(node.expression)
    ) {
        let expr = node.expression,
            methodName = expr.name.text;

        if (methodName === 'decode' || methodName === 'encode') {
            if (isCodecReceiver(expr.expression, checker, binding)) {
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

    node.forEachChild(n => visit(calls, checker, n, binding));
}


export default {
    patterns: ['.encode<', '.decode<'],
    transform: (ctx: TransformContext) => {
        let detected = new Map<ts.CallExpression, DetectedCall>();

        visit(detected, ctx.checker, ctx.sourceFile, codecBinding(ctx.sourceFile));

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
