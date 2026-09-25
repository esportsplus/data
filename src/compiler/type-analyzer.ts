import { ts } from '@esportsplus/typescript';
import { escapeRegExp, IDENTIFIER } from '../constants';
import type { LiteralValue } from '../types';


type BaseType = 'boolean' | 'number' | 'string' | 'unknown';

interface BrandedTypeInfo {
    base: BaseType;
    brand?: string;
}

type PropertyType =
    | 'any'
    | 'array'
    | 'bigint'
    | 'boolean'
    | 'date'
    | 'function'
    | 'intersection'
    | 'literal'
    | 'map'
    | 'never'
    | 'null'
    | 'number'
    | 'object'
    | 'record'
    | 'set'
    | 'string'
    | 'tuple'
    | 'union'
    | 'unknown';

interface AnalyzeContext {
    defs: Map<TypeKey, AnalyzedProperty>;
    depth: number;
    root: TypeKey;
    visited: Set<TypeKey>;
}

interface AnalyzedProperty {
    bigintLiteral?: string;
    brand?: string;
    defs?: Map<TypeKey, AnalyzedProperty>;
    indexType?: AnalyzedProperty;
    intersectionTypes?: AnalyzedProperty[];
    itemType?: AnalyzedProperty;
    keyType?: AnalyzedProperty;
    literals?: LiteralValue[];
    name: string;
    nullable?: boolean;
    optional: boolean;
    pattern?: string;
    properties?: AnalyzedProperty[];
    readonly?: boolean;
    ref?: string;
    restType?: AnalyzedProperty;
    tupleTypes?: AnalyzedProperty[];
    type: PropertyType;
    unionTypes?: AnalyzedProperty[];
    valueType?: AnalyzedProperty;
}

interface AnalyzedType {
    name: string;
    properties: AnalyzedProperty[];
    root: AnalyzedProperty;
}


type TypeKey = number | ts.Type;


const BRAND_KEY = '__brand';

const MAX_ANALYSIS_DEPTH = 512;


let cache = new WeakMap<ts.TypeNode, AnalyzedType>(),
    rootCache = new WeakMap<ts.TypeNode, AnalyzedProperty>();


function analyzeArrayType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let typeArgs = checker.getTypeArguments(type as ts.TypeReference);

    if (typeArgs && typeArgs.length > 0) {
        return {
            itemType: analyzePropertyType(typeArgs[0], 'item', false, checker, ctx),
            name,
            optional,
            type: 'array'
        };
    }

    return {
        itemType: { name: 'item', optional: false, type: 'unknown' },
        name,
        optional,
        type: 'array'
    };
}

// A cycle back to the schema root emits $ref '#'; a cycle to a non-root named type
// emits a $defs entry keyed by the type name. checker.getPropertiesOfType has already
// merged an all-object intersection's members, so it flattens through here unchanged.
function analyzeObjectShape(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let typeKey = keyOf(type);

    if (ctx.visited.has(typeKey)) {
        if (typeKey === ctx.root) {
            return { name, optional, ref: '#', type: 'object' };
        }

        let defKey = defName(type);

        if (!ctx.defs.has(typeKey)) {
            ctx.defs.set(typeKey, { name: defKey, optional: false, type: 'object' });
            ctx.defs.set(typeKey, defSchema(type, defKey, checker, ctx));
        }

        return { name, optional, ref: '#/$defs/' + defKey, type: 'object' };
    }

    ctx.visited.add(typeKey);

    let result: AnalyzedProperty = {
        name,
        optional,
        properties: extractProperties(type, checker, ctx),
        type: 'object'
    };

    ctx.visited.delete(typeKey);

    return result;
}

function analyzeMapType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let typeArgs = checker.getTypeArguments(type as ts.TypeReference);

    return {
        keyType: typeArgs[0]
            ? analyzePropertyType(typeArgs[0], 'key', false, checker, ctx)
            : { name: 'key', optional: false, type: 'unknown' },
        name,
        optional,
        type: 'map',
        valueType: typeArgs[1]
            ? analyzePropertyType(typeArgs[1], 'value', false, checker, ctx)
            : { name: 'value', optional: false, type: 'unknown' }
    };
}

function analyzePropertyType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    if (ctx.depth >= MAX_ANALYSIS_DEPTH) {
        throw new Error('TypeAnalyzer: recursion depth exceeded');
    }

    ctx.depth++;

    try {
        if (type.flags & ts.TypeFlags.Any) {
            return { name, optional, type: 'any' };
        }

        if (type.flags & ts.TypeFlags.Unknown) {
            return { name, optional, type: 'unknown' };
        }

        if (type.flags & ts.TypeFlags.Never) {
            return { name, optional, type: 'never' };
        }

        if (type.flags & ts.TypeFlags.Null) {
            return { name, optional, type: 'null' };
        }

        if (type.isIntersectionType()) {
            let branded = split(type, checker);

            // The brand member has no runtime value: the value validates as the type it brands,
            // then against the brand's registration
            if (branded.brand !== undefined && branded.rest.length > 0) {
                let result: AnalyzedProperty;

                if (branded.rest.length === 1) {
                    result = analyzePropertyType(branded.rest[0], name, optional, checker, ctx);
                }
                else if (isAllObject(branded.rest)) {
                    result = analyzeObjectShape(type, name, optional, checker, ctx);
                    result.properties = result.properties?.filter(property => property.name !== BRAND_KEY);
                }
                else {
                    let intersectionTypes: AnalyzedProperty[] = [];

                    for (let i = 0, n = branded.rest.length; i < n; i++) {
                        intersectionTypes.push(analyzePropertyType(branded.rest[i], name, false, checker, ctx));
                    }

                    result = { intersectionTypes, name, optional, type: 'intersection' };
                }

                result.brand = branded.brand;

                return result;
            }

            let constituents = type.getTypes();

            // All-object intersection: the checker has already merged the members - emit
            // one flat object schema (and a normal object validator). Otherwise reserve
            // `allOf` of the constituent schemas.
            if (isAllObject(constituents)) {
                return analyzeObjectShape(type, name, optional, checker, ctx);
            }

            let intersectionTypes: AnalyzedProperty[] = [];

            for (let i = 0, n = constituents.length; i < n; i++) {
                intersectionTypes.push(analyzePropertyType(constituents[i], name, false, checker, ctx));
            }

            return { intersectionTypes, name, optional, type: 'intersection' };
        }

        if (type.isStringLiteralType()) {
            return {
                literals: [{ type: 'string', value: type.value }],
                name,
                optional,
                type: 'literal'
            };
        }

        if (type.isNumberLiteralType()) {
            return {
                literals: [{ type: 'number', value: type.value }],
                name,
                optional,
                type: 'literal'
            };
        }

        if (type.isBooleanLiteralType()) {
            return {
                literals: [{ type: 'boolean', value: type.value }],
                name,
                optional,
                type: 'literal'
            };
        }

        if (type.flags & ts.TypeFlags.Boolean) {
            return { name, optional, type: 'boolean' };
        }

        if (type.flags & ts.TypeFlags.Number) {
            return { name, optional, type: 'number' };
        }

        if (type.flags & ts.TypeFlags.String) {
            return { name, optional, type: 'string' };
        }

        // Template literal types (e.g., `${string}@${string}`) carry a compile-time pattern the
        // runtime check must enforce; a placeholder we cannot render exactly is a hard error
        // rather than a silent widen to `string`.
        if (type.isTemplateLiteralType()) {
            return { name, optional, pattern: '^(?:' + templatePlaceholderList(type, checker) + ')$', type: 'string' };
        }

        // A bigint LITERAL keeps its exact value; an unbranded `bigint` is validated by typeof.
        if (type.isBigIntLiteralType()) {
            return { bigintLiteral: type.value.toString(), name, optional, type: 'bigint' };
        }

        if (type.flags & ts.TypeFlags.BigInt) {
            return { name, optional, type: 'bigint' };
        }

        if (checker.isTupleType(type)) {
            return analyzeTupleType(type as ts.TupleType, name, optional, checker, ctx);
        }

        if (checker.isArrayType(type)) {
            return analyzeArrayType(type, name, optional, checker, ctx);
        }

        if (type.isUnionType()) {
            return analyzeUnionType(type, name, optional, checker, ctx);
        }

        if (type.flags & ts.TypeFlags.Object) {
            let symbol = type.getSymbol();

            // Check for Date type
            if (symbol && symbol.name === 'Date') {
                return { name, optional, type: 'date' };
            }

            if (symbol) {
                let symbolName = symbol.name;

                if (symbolName === 'Array') {
                    return analyzeArrayType(type, name, optional, checker, ctx);
                }

                if (symbolName === 'Function') {
                    return { name, optional, type: 'function' };
                }

                if (symbolName === 'Map') {
                    return analyzeMapType(type, name, optional, checker, ctx);
                }

                // Promise carries no runtime-checkable shape - accept any value
                if (symbolName === 'Promise') {
                    return { name, optional, type: 'unknown' };
                }

                if (symbolName === 'Set') {
                    return analyzeSetType(type, name, optional, checker, ctx);
                }
            }

            // Anonymous callable (e.g. `() => void` has symbol name `__type`)
            if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
                return { name, optional, type: 'function' };
            }

            // Check for Record/index signature
            let info = stringIndexInfo(type, checker);

            // Only treat as record if it has no explicit properties (pure index signature)
            if (info && checker.getPropertiesOfType(type).length === 0) {
                let key = analyzePropertyType(info.keyType, 'key', false, checker, ctx),
                    result: AnalyzedProperty = {
                        indexType: analyzePropertyType(info.valueType, 'value', false, checker, ctx),
                        name,
                        optional,
                        type: 'record'
                    };

                // Keys are strings already; only a brand or pattern leaves something to check
                if (key.brand !== undefined || key.pattern !== undefined) {
                    result.keyType = key;
                }

                return result;
            }

            return analyzeObjectShape(type, name, optional, checker, ctx);
        }

        return { name, optional, type: 'unknown' };
    }
    finally {
        ctx.depth--;
    }
}

function analyzeSetType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let typeArgs = checker.getTypeArguments(type as ts.TypeReference);

    return {
        name,
        optional,
        type: 'set',
        valueType: typeArgs[0]
            ? analyzePropertyType(typeArgs[0], 'value', false, checker, ctx)
            : { name: 'value', optional: false, type: 'unknown' }
    };
}

function analyzeTupleType(
    type: ts.TupleType,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let elements = checker.getTypeArguments(type),
        elementFlags = (type.getTarget() as ts.TupleType).elementFlags,
        restType: AnalyzedProperty | undefined,
        tupleTypes: AnalyzedProperty[] = [];

    for (let i = 0, n = elements.length; i < n; i++) {
        let flags = elementFlags?.[i] ?? 0;

        if (flags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) {
            restType = analyzePropertyType(elements[i], 'rest', false, checker, ctx);

            continue;
        }

        tupleTypes.push(
            analyzePropertyType(elements[i], `${i}`, !!(flags & ts.ElementFlags.Optional), checker, ctx)
        );
    }

    let result: AnalyzedProperty = { name, optional, tupleTypes, type: 'tuple' };

    if (restType) {
        result.restType = restType;
    }

    return result;
}

function analyzeUnionType(
    type: ts.UnionType,
    name: string,
    optional: boolean,
    checker: ts.Checker,
    ctx: AnalyzeContext
): AnalyzedProperty {
    let branded = new Map<string, LiteralValue[]>(),
        literals: LiteralValue[] = [],
        nullable = false,
        types: AnalyzedProperty[] = [],
        unionTypes = type.getTypes();

    for (let i = 0, n = unionTypes.length; i < n; i++) {
        let t = unionTypes[i],
            flags = t.flags,
            literal = t.isIntersectionType() ? brandedLiteral(t, checker) : null;

        // `Brand<boolean | 'a', B>` distributes into one branded member per literal; regroup them
        // so the brand applies once to the whole literal set
        if (literal) {
            let group = branded.get(literal.brand);

            if (!group) {
                group = [];
                branded.set(literal.brand, group);
            }

            group.push(literal.value);
        }
        else if (flags & ts.TypeFlags.Null) {
            nullable = true;
        }
        else if (flags & ts.TypeFlags.Undefined) {
            optional = true;
        }
        else if (t.isStringLiteralType()) {
            literals.push({ type: 'string', value: t.value });
        }
        else if (t.isNumberLiteralType()) {
            literals.push({ type: 'number', value: t.value });
        }
        else if (t.isBooleanLiteralType()) {
            literals.push({ type: 'boolean', value: t.value });
        }
        // Non-literal type - analyze recursively
        else {
            types.push( analyzePropertyType(t, name, false, checker, ctx) );
        }
    }

    for (let [brand, values] of branded) {
        types.push(
            values.length === 2 && values[0].type === 'boolean' && values[1].type === 'boolean'
                ? { brand, name, optional: false, type: 'boolean' }
                : { brand, literals: values, name, optional: false, type: 'literal' }
        );
    }

    // Pure literal union
    if (literals.length > 0 && types.length === 0) {
        return { literals, name, nullable, optional, type: 'literal' };
    }

    // Single non-literal type with null/undefined
    if (types.length === 1 && literals.length === 0) {
        let result = types[0];

        result.nullable = nullable;
        result.optional = optional;

        return result;
    }

    // Mixed type union
    if (types.length > 0) {
        return { literals, name, nullable, optional, type: 'union', unionTypes: types };
    }

    return { name, nullable, optional: true, type: 'null' };
}

// Render the inner pattern of a template literal type: literal text segments escaped,
// placeholder spans replaced by a regex fragment that mirrors the placeholder's type.
function templatePlaceholderList(type: ts.TemplateLiteralType, checker: ts.Checker): string {
    let texts = type.texts,
        types = type.getTypes(),
        pattern = '';

    for (let i = 0, n = types.length; i < n; i++) {
        pattern += escapeRegExp(texts[i] ?? '');
        pattern += templatePlaceholderPattern(types[i], checker);
    }

    pattern += escapeRegExp(texts[types.length] ?? '');

    return pattern;
}

function templatePlaceholderPattern(type: ts.Type, checker: ts.Checker): string {
    if (type.isStringLiteralType()) {
        return escapeRegExp(type.value);
    }

    if (type.isNumberLiteralType()) {
        return escapeRegExp(String(type.value));
    }

    if (type.isBigIntLiteralType()) {
        return escapeRegExp(type.value.toString());
    }

    if (type.isBooleanLiteralType()) {
        return type.value ? 'true' : 'false';
    }

    // The `boolean` intrinsic is internally a `true | false` union - classify it before peeling.
    if (type.flags & ts.TypeFlags.Boolean) {
        return '(?:true|false)';
    }

    if (type.isUnionType()) {
        let parts: string[] = [],
            constituents = type.getTypes();

        for (let i = 0, n = constituents.length; i < n; i++) {
            parts.push(templatePlaceholderPattern(constituents[i], checker));
        }

        return '(?:' + parts.join('|') + ')';
    }

    if (type.isTemplateLiteralType()) {
        return templatePlaceholderList(type, checker);
    }

    if (type.flags & ts.TypeFlags.String) {
        return '[\\s\\S]*';
    }

    if (type.flags & ts.TypeFlags.Number) {
        // Mirrors TypeScript's `${number}` admission set: decimal (with fraction/exponent),
        // hex/binary/octal integers, and leading whitespace (trailing whitespace is rejected).
        return '\\s*(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)';
    }

    if (type.flags & ts.TypeFlags.BigInt) {
        return '\\s*(?:[+-]?\\d+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)';
    }

    if (type.flags & ts.TypeFlags.Null) {
        return 'null';
    }

    if (type.flags & ts.TypeFlags.Undefined) {
        return 'undefined';
    }

    throw new Error(`TypeAnalyzer: unsupported template literal placeholder '${checker.typeToString(type)}'`);
}

// The `{ __brand: B }` member of `Brand<T, B>`: a lone string-literal `__brand` property
function brandOf(type: ts.Type, checker: ts.Checker): string | undefined {
    if ((type.flags & ts.TypeFlags.Object) === 0) {
        return undefined;
    }

    let property = checker.getPropertyOfType(type, BRAND_KEY);

    if (!property || checker.getPropertiesOfType(type).length !== 1) {
        return undefined;
    }

    let value = checker.getTypeOfSymbol(property);

    return value !== undefined && value.isStringLiteralType() ? value.value : undefined;
}

function brandedLiteral(type: ts.IntersectionType, checker: ts.Checker): { brand: string; value: LiteralValue } | null {
    let branded = split(type, checker);

    if (branded.brand === undefined || branded.rest.length !== 1) {
        return null;
    }

    let rest = branded.rest[0];

    if (rest.isBooleanLiteralType()) {
        return { brand: branded.brand, value: { type: 'boolean', value: rest.value } };
    }

    if (rest.isNumberLiteralType()) {
        return { brand: branded.brand, value: { type: 'number', value: rest.value } };
    }

    if (rest.isStringLiteralType()) {
        return { brand: branded.brand, value: { type: 'string', value: rest.value } };
    }

    return null;
}

function defName(type: ts.Type): string {
    let symbol = type.getAliasSymbol() ?? type.getSymbol(),
        name = symbol?.name,
        declaration = symbol?.declarations[0]?.resolve() as { name?: ts.Node } | undefined;

    if ((name === undefined || name === '__type' || name === '__object' || !IDENTIFIER.test(name)) &&
        declaration?.name !== undefined && ts.isIdentifier(declaration.name)) {
        name = declaration.name.text;
    }

    if (name === undefined || name === '__type' || name === '__object' || !IDENTIFIER.test(name)) {
        throw new Error('TypeAnalyzer: cannot emit a JSON Schema $ref for an unnamed recursive type');
    }

    return name;
}

// Build a self-contained $defs entry for a non-root named recursive type. A fresh
// visited set lets the type's own shape expand once; back-edges to it resolve to its
// reserved $defs key.
function defSchema(type: ts.Type, key: string, checker: ts.Checker, ctx: AnalyzeContext): AnalyzedProperty {
    let saved = ctx.visited;

    ctx.visited = new Set<TypeKey>();
    ctx.visited.add(keyOf(type));

    let properties = extractProperties(type, checker, ctx);

    ctx.visited = saved;

    return { name: key, optional: false, properties, type: 'object' };
}

function extractProperties(type: ts.Type, checker: ts.Checker, ctx: AnalyzeContext): AnalyzedProperty[] {
    let props = checker.getPropertiesOfType(type),
        result: AnalyzedProperty[] = [];

    for (let i = 0, n = props.length; i < n; i++) {
        let prop = props[i],
            propType = checker.getTypeOfSymbol(prop);

        // A property whose type the checker cannot resolve would silently analyze as `unknown`
        // and emit a validator that accepts anything, so refuse to emit rather than widen.
        if (propType === undefined) {
            throw new Error(`TypeAnalyzer: unable to resolve the type of property '${prop.name}'`);
        }

        let optional = !!(prop.flags & ts.SymbolFlags.Optional),
            declaration = prop.valueDeclaration?.resolve(),
            analyzed = analyzePropertyType(
                propType,
                prop.name,
                // Symbol's Optional flag is the source of truth for resolved types
                // This correctly handles mapped types like Required<T> and Partial<T>
                optional,
                checker,
                ctx
            );

        // `bad?: never` resolves to `never | undefined` = `undefined`, so the resolved type
        // loses the never. The declaration still spells it, and a PRESENT optional slot must
        // reject (absence remains valid).
        if (
            optional &&
            declaration !== undefined &&
            (ts.isPropertySignatureDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
            declaration.type !== undefined &&
            declaration.type.kind === ts.SyntaxKind.NeverKeyword
        ) {
            analyzed = { name: prop.name, optional: true, type: 'never' };
        }

        if (declaration !== undefined && isReadonly(declaration)) {
            analyzed.readonly = true;
        }

        result.push(analyzed);
    }

    // Sort alphabetically by property name (faster than localeCompare)
    result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    return result;
}

function isAllObject(constituents: readonly ts.Type[]): boolean {
    if (constituents.length === 0) {
        return false;
    }

    for (let i = 0, n = constituents.length; i < n; i++) {
        if ((constituents[i].flags & ts.TypeFlags.Object) === 0) {
            return false;
        }
    }

    return true;
}

function keyOf(type: ts.Type): TypeKey {
    return typeof type.id === 'number' ? type.id : type;
}

function isReadonly(node: ts.Node): boolean {
    if (ts.isPropertySignatureDeclaration(node) || ts.isPropertyDeclaration(node)) {
        return (node.modifierFlags & ts.ModifierFlags.Readonly) !== 0;
    }

    return false;
}

function split(type: ts.IntersectionType, checker: ts.Checker): { brand: string | undefined; rest: ts.Type[] } {
    let brand: string | undefined,
        constituents = type.getTypes(),
        rest: ts.Type[] = [];

    for (let i = 0, n = constituents.length; i < n; i++) {
        let found = brandOf(constituents[i], checker);

        if (found === undefined) {
            rest.push(constituents[i]);
        }
        else if (brand !== undefined && brand !== found) {
            throw new Error(`TypeAnalyzer: '${checker.typeToString(type)}' carries more than one brand ('${brand}', '${found}')`);
        }
        else {
            brand = found;
        }
    }

    return { brand, rest };
}

function stringIndexInfo(type: ts.Type, checker: ts.Checker): ts.IndexInfo | undefined {
    let infos = checker.getIndexInfosOfType(type);

    // A branded key (`Record<Brand<string, ...>, V>`) resolves to a `string & {...}`
    // intersection whose flags are Intersection, not String, so match on the resolved
    // base type instead of the raw flag or the whole record's entries are dropped.
    for (let i = 0, n = infos.length; i < n; i++) {
        let key = infos[i].keyType;

        if (resolveBrandedType(key, checker).base === 'string' || key.flags & ts.TypeFlags.TemplateLiteral) {
            return infos[i];
        }
    }

    return undefined;
}


const analyzeRootType = (typeNode: ts.TypeNode, checker: ts.Checker): AnalyzedProperty => {
    let cached = rootCache.get(typeNode);

    if (cached) {
        return cached;
    }

    let type = checker.getTypeAtLocation(typeNode);

    if (type === undefined) {
        throw new Error('TypeAnalyzer: unable to resolve the type argument');
    }

    let ctx: AnalyzeContext = { defs: new Map<TypeKey, AnalyzedProperty>(), depth: 0, root: keyOf(type), visited: new Set<TypeKey>() },
        result = analyzePropertyType(type, checker.typeToString(type), false, checker, ctx);

    if (ctx.defs.size > 0) {
        result.defs = ctx.defs;
    }

    rootCache.set(typeNode, result);

    return result;
};

const analyzeType = (typeNode: ts.TypeNode, checker: ts.Checker): AnalyzedType => {
    let cached = cache.get(typeNode);

    if (cached) {
        return cached;
    }

    let root = analyzeRootType(typeNode, checker),
        result: AnalyzedType = {
            name: root.name,
            properties: root.type === 'object' ? (root.properties ?? []) : [],
            root
        };

    cache.set(typeNode, result);

    return result;
};

const resolveBrandedType = (type: ts.Type, checker: ts.Checker): BrandedTypeInfo => {
    if (type.isUnionType()) {
        // `Brand<boolean, B>` is `(false & ...) | (true & ...)`: branded only when every member
        // carries the same brand
        let base: BaseType | undefined,
            brand: string | undefined,
            members = type.getTypes();

        for (let i = 0, n = members.length; i < n; i++) {
            let member = resolveBrandedType(members[i], checker);

            if (member.brand === undefined || (brand !== undefined && member.brand !== brand)) {
                return { base: 'unknown' };
            }

            base = base === undefined || base === member.base ? member.base : 'unknown';
            brand = member.brand;
        }

        return { base: base ?? 'unknown', brand };
    }

    if (!type.isIntersectionType()) {
        if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) {
            return { base: 'boolean' };
        }

        if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) {
            return { base: 'number' };
        }

        if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) {
            return { base: 'string' };
        }

        return { base: 'unknown' };
    }

    let branded = split(type, checker);

    return {
        base: branded.rest.length === 1 ? resolveBrandedType(branded.rest[0], checker).base : 'unknown',
        brand: branded.brand
    };
};


export { analyzeRootType, analyzeType, resolveBrandedType };
export type { AnalyzedProperty, AnalyzedType };
