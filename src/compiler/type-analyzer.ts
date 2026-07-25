import { ts } from '@esportsplus/typescript';


type BaseType = 'boolean' | 'number' | 'string' | 'unknown';

interface BrandedTypeInfo {
    base: BaseType;
    brand?: string;
}

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
    | 'function'
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

interface AnalyzedProperty {
    brand?: string;
    indexType?: AnalyzedProperty;
    itemType?: AnalyzedProperty;
    keyType?: AnalyzedProperty;
    literals?: LiteralValue[];
    name: string;
    nullable?: boolean;
    optional: boolean;
    properties?: AnalyzedProperty[];
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


let cache = new WeakMap<ts.TypeNode, AnalyzedType>(),
    rootCache = new WeakMap<ts.TypeNode, AnalyzedProperty>();


function analyzeArrayType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
    let typeArgs = (type as ts.TypeReference).typeArguments;

    if (typeArgs && typeArgs.length > 0) {
        return {
            itemType: analyzePropertyType(typeArgs[0], 'item', false, checker, visited),
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

function analyzeMapType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
    let typeArgs = checker.getTypeArguments(type as ts.TypeReference);

    return {
        keyType: typeArgs[0]
            ? analyzePropertyType(typeArgs[0], 'key', false, checker, visited)
            : { name: 'key', optional: false, type: 'unknown' },
        name,
        optional,
        type: 'map',
        valueType: typeArgs[1]
            ? analyzePropertyType(typeArgs[1], 'value', false, checker, visited)
            : { name: 'value', optional: false, type: 'unknown' }
    };
}

function analyzePropertyType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
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

    if (type.isIntersection()) {
        let branded = resolveBrandedType(type, checker);

        if (branded.brand) {
            return {
                brand: branded.brand,
                name,
                optional,
                type: branded.base === 'number' ? 'number' : branded.base as PropertyType
            };
        }
    }

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

    if (type.flags & ts.TypeFlags.BooleanLiteral) {
        let value = (type as any).intrinsicName === 'true';

        return {
            literals: [{ type: 'boolean', value }],
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

    // Template literal types (e.g., `${string}@${string}`) - treat as branded string
    if (type.flags & ts.TypeFlags.TemplateLiteral) {
        return { brand: 'template', name, optional, type: 'string' };
    }

    if (type.flags & ts.TypeFlags.BigInt || type.flags & ts.TypeFlags.BigIntLiteral) {
        return { name, optional, type: 'bigint' };
    }

    if (checker.isTupleType(type)) {
        return analyzeTupleType(type as ts.TupleType, name, optional, checker, visited);
    }

    if (checker.isArrayType(type)) {
        return analyzeArrayType(type, name, optional, checker, visited);
    }

    if (type.isUnion()) {
        return analyzeUnionType(type, name, optional, checker, visited);
    }

    if (type.flags & ts.TypeFlags.Object) {
        let symbol = type.getSymbol();

        // Check for Date type
        if (symbol && symbol.getName() === 'Date') {
            return { name, optional, type: 'date' };
        }

        if (symbol) {
            let symbolName = symbol.getName();

            if (symbolName === 'Array') {
                return analyzeArrayType(type, name, optional, checker, visited);
            }

            if (symbolName === 'Function') {
                return { name, optional, type: 'function' };
            }

            if (symbolName === 'Map') {
                return analyzeMapType(type, name, optional, checker, visited);
            }

            // Promise carries no runtime-checkable shape - accept any value
            if (symbolName === 'Promise') {
                return { name, optional, type: 'unknown' };
            }

            if (symbolName === 'Set') {
                return analyzeSetType(type, name, optional, checker, visited);
            }
        }

        // Anonymous callable (e.g. `() => void` has symbol name `__type`)
        if (type.getCallSignatures().length > 0) {
            return { name, optional, type: 'function' };
        }

        // Check for Record/index signature
        let info = checker.getIndexInfoOfType(type, ts.IndexKind.String);

        // Only treat as record if it has no explicit properties (pure index signature)
        if (info && checker.getPropertiesOfType(type).length === 0) {
            return {
                indexType: analyzePropertyType(info.type, 'value', false, checker, visited),
                name,
                optional,
                type: 'record'
            };
        }

        // Check for circular reference
        if (visited.has(type)) {
            return { name, optional, type: 'object' };
        }

        visited.add(type);

        let result: AnalyzedProperty = {
                name,
                optional,
                properties: extractProperties(type, checker, visited),
                type: 'object'
            };

        visited.delete(type);

        return result;
    }

    return { name, optional, type: 'unknown' };
}

function analyzeSetType(
    type: ts.Type,
    name: string,
    optional: boolean,
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
    let typeArgs = checker.getTypeArguments(type as ts.TypeReference);

    return {
        name,
        optional,
        type: 'set',
        valueType: typeArgs[0]
            ? analyzePropertyType(typeArgs[0], 'value', false, checker, visited)
            : { name: 'value', optional: false, type: 'unknown' }
    };
}

function analyzeTupleType(
    type: ts.TupleType,
    name: string,
    optional: boolean,
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
    let elements = checker.getTypeArguments(type as ts.TypeReference),
        elementFlags = ((type as ts.TypeReference).target as ts.TupleType).elementFlags,
        restType: AnalyzedProperty | undefined,
        tupleTypes: AnalyzedProperty[] = [];

    for (let i = 0, n = elements.length; i < n; i++) {
        let flags = elementFlags?.[i] ?? 0;

        if (flags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) {
            restType = analyzePropertyType(elements[i], 'rest', false, checker, visited);

            continue;
        }

        tupleTypes.push(
            analyzePropertyType(elements[i], `${i}`, !!(flags & ts.ElementFlags.Optional), checker, visited)
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
    checker: ts.TypeChecker,
    visited: Set<ts.Type>
): AnalyzedProperty {
    let literals: LiteralValue[] = [],
        nullable = false,
        types: AnalyzedProperty[] = [],
        unionTypes = type.types;

    for (let i = 0, n = type.types.length; i < n; i++) {
        let t = unionTypes[i],
            flags = t.flags;

        if (flags & ts.TypeFlags.Null) {
            nullable = true;
        }
        else if (flags & ts.TypeFlags.Undefined) {
            optional = true;
        }
        else if (t.isStringLiteral()) {
            literals.push({ type: 'string', value: t.value });
        }
        else if (t.isNumberLiteral()) {
            literals.push({ type: 'number', value: t.value });
        }
        else if (flags & ts.TypeFlags.BooleanLiteral) {
            literals.push({
                type: 'boolean',
                value: (t as any).intrinsicName === 'true'
            });
        }
        // Non-literal type - analyze recursively
        else {
            types.push( analyzePropertyType(t, name, false, checker, visited) );
        }
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

function extractProperties(type: ts.Type, checker: ts.TypeChecker, visited: Set<ts.Type>): AnalyzedProperty[] {
    let props = checker.getPropertiesOfType(type),
        result: AnalyzedProperty[] = [];

    for (let i = 0, n = props.length; i < n; i++) {
        let prop = props[i];

        result.push(
            analyzePropertyType(
                checker.getTypeOfSymbol(prop),
                prop.getName(),
                // Symbol's Optional flag is the source of truth for resolved types
                // This correctly handles mapped types like Required<T> and Partial<T>
                !!(prop.flags & ts.SymbolFlags.Optional),
                checker,
                visited
            )
        );
    }

    // Sort alphabetically by property name (faster than localeCompare)
    result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    return result;
}


const analyzeRootType = (typeNode: ts.TypeNode, checker: ts.TypeChecker): AnalyzedProperty => {
    let cached = rootCache.get(typeNode);

    if (cached) {
        return cached;
    }

    let type = checker.getTypeAtLocation(typeNode),
        result = analyzePropertyType(type, checker.typeToString(type), false, checker, new Set<ts.Type>());

    rootCache.set(typeNode, result);

    return result;
};

const analyzeType = (typeNode: ts.TypeNode, checker: ts.TypeChecker): AnalyzedType => {
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

const resolveBrandedType = (type: ts.Type, checker: ts.TypeChecker): BrandedTypeInfo => {
    let base: BaseType = 'unknown',
        brand: string | undefined;

    if (!type.isIntersection()) {
        if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
            base = 'boolean';
        }
        else if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
            base = 'number';
        }
        else if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
            base = 'string';
        }

        return { base };
    }

    for (let i = 0, n = type.types.length; i < n; i++) {
        let constituent = type.types[i];

        if (constituent.flags & ts.TypeFlags.Boolean) {
            base = 'boolean';
        }
        else if (constituent.flags & ts.TypeFlags.Number) {
            base = 'number';
        }
        else if (constituent.flags & ts.TypeFlags.String) {
            base = 'string';
        }
        else if (constituent.flags & ts.TypeFlags.Object) {
            let brandProp = checker.getPropertyOfType(constituent, '__brand');

            if (brandProp) {
                let brandType = checker.getTypeOfSymbol(brandProp);

                if (brandType.isStringLiteral()) {
                    brand = brandType.value;
                }
            }
        }
    }

    return { base, brand };
};


export { analyzeRootType, analyzeType, resolveBrandedType };
export type { AnalyzedProperty, AnalyzedType };
