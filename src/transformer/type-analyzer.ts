import ts from 'typescript';
import { resolveBrandedType } from './branded-types';


type LiteralValue = {
    type: 'boolean' | 'number' | 'string';
    value: boolean | number | string;
};

type PropertyType =
    | 'any'
    | 'array'
    | 'bigint'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'literal'
    | 'never'
    | 'null'
    | 'number'
    | 'object'
    | 'record'
    | 'string'
    | 'tuple'
    | 'union'
    | 'unknown';

interface AnalyzedProperty {
    brand?: string;
    indexType?: AnalyzedProperty;
    itemType?: AnalyzedProperty;
    literals?: LiteralValue[];
    name: string;
    nullable?: boolean;
    optional: boolean;
    pattern?: string;
    properties?: AnalyzedProperty[];
    tupleTypes?: AnalyzedProperty[];
    type: PropertyType;
    unionTypes?: AnalyzedProperty[];
}

interface AnalyzedType {
    name: string;
    properties: AnalyzedProperty[];
}


let typeAnalysisCache = new WeakMap<ts.TypeNode, AnalyzedType>(),
    visited = new Set<ts.Type>();


function analyzeArrayType(
    type: ts.Type,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty {
    let typeArgs = (type as ts.TypeReference).typeArguments;

    if (typeArgs && typeArgs.length > 0) {
        return {
            itemType: analyzePropertyType(typeArgs[0], 'item', false, typeChecker),
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

function analyzeIndexSignature(
    type: ts.Type,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty | null {
    let indexInfo = typeChecker.getIndexInfoOfType(type, ts.IndexKind.String);

    if (indexInfo) {
        return {
            indexType: analyzePropertyType(indexInfo.type, 'value', false, typeChecker),
            name,
            optional,
            type: 'record'
        };
    }

    return null;
}

function analyzeObjectType(
    type: ts.Type,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty {
    let properties = extractProperties(type, typeChecker);

    return {
        name,
        optional,
        properties,
        type: 'object'
    };
}

function analyzePropertyType(
    type: ts.Type,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty {
    // Check for any type
    if (type.flags & ts.TypeFlags.Any) {
        return { name, optional, type: 'any' };
    }

    // Check for unknown type
    if (type.flags & ts.TypeFlags.Unknown) {
        return { name, optional, type: 'unknown' };
    }

    // Check for never type
    if (type.flags & ts.TypeFlags.Never) {
        return { name, optional, type: 'never' };
    }

    // Check for null type
    if (type.flags & ts.TypeFlags.Null) {
        return { name, optional, type: 'null' };
    }

    // Check for branded types first (intersection with __brand)
    if (type.isIntersection()) {
        let branded = resolveBrandedType(type, typeChecker);

        if (branded.brand) {
            return {
                brand: branded.brand,
                name,
                optional,
                type: branded.base === 'number' ? 'number' : branded.base as PropertyType
            };
        }
    }

    // Check for standalone literals
    if (type.isStringLiteral()) {
        return {
            literals: [{ type: 'string', value: type.value }],
            name,
            optional,
            type: 'literal'
        };
    }

    if (type.isNumberLiteral()) {
        return {
            literals: [{ type: 'number', value: type.value }],
            name,
            optional,
            type: 'literal'
        };
    }

    // Check for boolean literal
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
        let value = (type as any).intrinsicName === 'true';

        return {
            literals: [{ type: 'boolean', value }],
            name,
            optional,
            type: 'literal'
        };
    }

    // Check for primitive types
    if (type.flags & ts.TypeFlags.Boolean) {
        return { name, optional, type: 'boolean' };
    }

    if (type.flags & ts.TypeFlags.Number) {
        return { name, optional, type: 'number' };
    }

    if (type.flags & ts.TypeFlags.String) {
        return { name, optional, type: 'string' };
    }

    // Template literal types (e.g., `${string}@${string}`) - treat as branded string
    if (type.flags & ts.TypeFlags.TemplateLiteral) {
        return { brand: 'template', name, optional, type: 'string' };
    }

    if (type.flags & ts.TypeFlags.BigInt || type.flags & ts.TypeFlags.BigIntLiteral) {
        return { name, optional, type: 'bigint' };
    }

    // Check for tuple type
    if (typeChecker.isTupleType(type)) {
        return analyzeTupleType(type as ts.TupleType, name, optional, typeChecker);
    }

    // Check for array type
    if (typeChecker.isArrayType(type)) {
        return analyzeArrayType(type, name, optional, typeChecker);
    }

    // Check for union type
    if (type.isUnion()) {
        return analyzeUnionType(type, name, optional, typeChecker);
    }

    // Check for object type
    if (type.flags & ts.TypeFlags.Object) {
        let symbol = type.getSymbol();

        // Check for Date type
        if (symbol && symbol.getName() === 'Date') {
            return { name, optional, type: 'date' };
        }

        // Skip built-in types like Function, Promise
        if (symbol) {
            let symbolName = symbol.getName();

            if (symbolName === 'Array') {
                return analyzeArrayType(type, name, optional, typeChecker);
            }

            if (symbolName === 'Function' || symbolName === 'Promise') {
                return { name, optional, type: 'unknown' };
            }
        }

        // Check for Record/index signature
        let indexSignature = analyzeIndexSignature(type, name, optional, typeChecker);

        if (indexSignature) {
            let props = typeChecker.getPropertiesOfType(type);

            // Only treat as record if it has no explicit properties (pure index signature)
            if (props.length === 0) {
                return indexSignature;
            }
        }

        // Check for circular reference
        if (visited.has(type)) {
            return { name, optional, type: 'object' };
        }

        visited.add(type);

        let result = analyzeObjectType(type, name, optional, typeChecker);

        visited.delete(type);

        return result;
    }

    return { name, optional, type: 'unknown' };
}

function analyzeTupleType(
    type: ts.TupleType,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty {
    let elements = typeChecker.getTypeArguments(type as ts.TypeReference),
        tupleTypes: AnalyzedProperty[] = [];

    for (let i = 0, n = elements.length; i < n; i++) {
        tupleTypes.push(
            analyzePropertyType(elements[i], `${i}`, false, typeChecker)
        );
    }

    return { name, optional, tupleTypes, type: 'tuple' };
}

function analyzeUnionType(
    type: ts.UnionType,
    name: string,
    optional: boolean,
    typeChecker: ts.TypeChecker
): AnalyzedProperty {
    let unionTypes = type.types,
        n = unionTypes.length;

    // Fast-path: T | null (2 types, one is null)
    if (n === 2) {
        let t0 = unionTypes[0],
            t1 = unionTypes[1];

        if (t0.flags & ts.TypeFlags.Null) {
            let result = analyzePropertyType(t1, name, optional, typeChecker);

            result.nullable = true;

            return result;
        }

        if (t1.flags & ts.TypeFlags.Null) {
            let result = analyzePropertyType(t0, name, optional, typeChecker);

            result.nullable = true;

            return result;
        }

        if (t0.flags & ts.TypeFlags.Undefined) {
            let result = analyzePropertyType(t1, name, true, typeChecker);

            return result;
        }

        if (t1.flags & ts.TypeFlags.Undefined) {
            let result = analyzePropertyType(t0, name, true, typeChecker);

            return result;
        }
    }

    // Fast-path: T | null | undefined (3 types)
    if (n === 3) {
        let hasNull = false,
            hasUndefined = false,
            mainType: ts.Type | null = null;

        for (let i = 0; i < 3; i++) {
            let t = unionTypes[i];

            if (t.flags & ts.TypeFlags.Null) {
                hasNull = true;
            }
            else if (t.flags & ts.TypeFlags.Undefined) {
                hasUndefined = true;
            }
            else {
                mainType = t;
            }
        }

        if (hasNull && hasUndefined && mainType) {
            let result = analyzePropertyType(mainType, name, true, typeChecker);

            result.nullable = true;

            return result;
        }
    }

    // General case
    let hasNull = false,
        hasUndefined = false,
        literals: LiteralValue[] = [],
        types: AnalyzedProperty[] = [];

    for (let i = 0; i < n; i++) {
        let t = unionTypes[i],
            flags = t.flags;

        // Check for null/undefined first (most common modifiers)
        if (flags & ts.TypeFlags.Null) {
            hasNull = true;
            continue;
        }

        if (flags & ts.TypeFlags.Undefined) {
            hasUndefined = true;
            continue;
        }

        // Check for literals
        if (t.isStringLiteral()) {
            literals.push({ type: 'string', value: t.value });
            continue;
        }

        if (t.isNumberLiteral()) {
            literals.push({ type: 'number', value: t.value });
            continue;
        }

        if (flags & ts.TypeFlags.BooleanLiteral) {
            let value = (t as any).intrinsicName === 'true';

            literals.push({ type: 'boolean', value });
            continue;
        }

        // Non-literal type - analyze recursively
        types.push(analyzePropertyType(t, name, false, typeChecker));
    }

    // Pure literal union
    if (literals.length > 0 && types.length === 0) {
        return {
            literals,
            name,
            nullable: hasNull,
            optional: optional || hasUndefined,
            type: 'literal'
        };
    }

    // Single non-literal type with null/undefined
    if (types.length === 1 && literals.length === 0) {
        let result = types[0];

        result.nullable = hasNull;
        result.optional = optional || hasUndefined;

        return result;
    }

    // Mixed type union
    if (types.length > 0) {
        return {
            literals,
            name,
            nullable: hasNull,
            optional: optional || hasUndefined,
            type: 'union',
            unionTypes: types
        };
    }

    // Just null/undefined
    return { name, nullable: hasNull, optional: true, type: 'unknown' };
}

function extractProperties(
    type: ts.Type,
    typeChecker: ts.TypeChecker
): AnalyzedProperty[] {
    let props = typeChecker.getPropertiesOfType(type),
        result: AnalyzedProperty[] = [];

    for (let i = 0, n = props.length; i < n; i++) {
        let prop = props[i],
            // Symbol's Optional flag is the source of truth for resolved types
            // This correctly handles mapped types like Required<T> and Partial<T>
            optional = !!(prop.flags & ts.SymbolFlags.Optional),
            propType = typeChecker.getTypeOfSymbol(prop);

        result.push(
            analyzePropertyType(propType, prop.getName(), optional, typeChecker)
        );
    }

    // Sort alphabetically by property name (faster than localeCompare)
    result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    return result;
}


const analyzeType = (
    typeNode: ts.TypeNode,
    typeChecker: ts.TypeChecker
): AnalyzedType => {
    let cached = typeAnalysisCache.get(typeNode);

    if (cached) {
        return cached;
    }

    visited.clear();

    let type = typeChecker.getTypeAtLocation(typeNode),
        result: AnalyzedType = {
            name: typeChecker.typeToString(type),
            properties: extractProperties(type, typeChecker)
        };

    typeAnalysisCache.set(typeNode, result);

    return result;
};

const clearTypeAnalysisCache = (): void => {
    typeAnalysisCache = new WeakMap();
};


export { analyzeType, clearTypeAnalysisCache };
export type { AnalyzedProperty, AnalyzedType, LiteralValue, PropertyType };
