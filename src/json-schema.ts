import type { AnalyzedProperty } from './compiler/type-analyzer';
import type { JsonSchema } from './types';


type LiteralValue = {
    type: 'boolean' | 'number' | 'string';
    value: boolean | number | string;
};

// Draft 2020-12 keywords the shared JsonSchema shape does not carry: recursion refs
// and the readonly annotation.
interface EmittedSchema extends JsonSchema {
    $defs?: Record<string, JsonSchema>;
    $ref?: string;
    readOnly?: boolean;
}


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function emitArray(prop: AnalyzedProperty): JsonSchema {
    return { items: prop.itemType ? emit(prop.itemType) : {}, type: 'array' };
}

function emitBigint(): JsonSchema {
    return { type: 'integer' };
}

function emitBoolean(): JsonSchema {
    return { type: 'boolean' };
}

function emitDate(): JsonSchema {
    return { format: 'date-time', type: 'string' };
}

function emitEmpty(): JsonSchema {
    return {};
}

function emitIntersection(prop: AnalyzedProperty): JsonSchema {
    let allOf: JsonSchema[] = [],
        types = prop.intersectionTypes || [];

    for (let i = 0, n = types.length; i < n; i++) {
        allOf.push(emit(types[i]));
    }

    return { allOf };
}

function emitLiteral(prop: AnalyzedProperty): JsonSchema {
    return emitLiterals(prop.literals || []);
}

function emitLiterals(literals: LiteralValue[]): JsonSchema {
    if (literals.length === 1) {
        return { const: literals[0].value };
    }

    let sorted = sortLiterals(literals),
        values: (boolean | number | string)[] = [];

    for (let i = 0, n = sorted.length; i < n; i++) {
        values.push(sorted[i].value);
    }

    return { enum: values };
}

function emitNever(): JsonSchema {
    return { not: {} };
}

function emitNull(): JsonSchema {
    return { type: 'null' };
}

function emitNumber(prop: AnalyzedProperty): JsonSchema {
    return { type: prop.brand === 'integer' ? 'integer' : 'number' };
}

function emitObject(prop: AnalyzedProperty, constraints?: Map<string, JsonSchema>): JsonSchema {
    let properties = prop.properties;

    if (properties === undefined) {
        return { type: 'object' };
    }

    let props: Record<string, JsonSchema> = {},
        required: string[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'never') {
            continue;
        }

        let structural = emitStructural(property);

        if (constraints !== undefined && constraints.has(property.name)) {
            mergeConstraint(structural, constraints.get(property.name)!);
        }

        let emitted = wrapNullable(property, structural) as EmittedSchema;

        if (property.readonly) {
            emitted.readOnly = true;
        }

        props[property.name] = emitted;

        if (!property.optional) {
            required.push(property.name);
        }
    }

    let schema: JsonSchema = { additionalProperties: false, properties: props, type: 'object' };

    if (required.length > 0) {
        schema.required = required;
    }

    return schema;
}

function emitObjectDefault(prop: AnalyzedProperty): JsonSchema {
    return emitObject(prop, undefined);
}

function emitRecord(prop: AnalyzedProperty): JsonSchema {
    return { additionalProperties: prop.indexType ? emit(prop.indexType) : {}, type: 'object' };
}

function emitStructural(prop: AnalyzedProperty): JsonSchema {
    if (prop.ref !== undefined) {
        let ref: EmittedSchema = { $ref: prop.ref };

        return ref;
    }

    let fn = EMITTERS[prop.type];

    return fn ? fn(prop) : {};
}

function emitString(): JsonSchema {
    return { type: 'string' };
}

function emitTuple(prop: AnalyzedProperty): JsonSchema {
    let prefixItems: JsonSchema[] = [],
        requiredCount = 0,
        tupleTypes = prop.tupleTypes || [];

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        if (!tupleTypes[i].optional) {
            requiredCount++;
        }

        prefixItems.push(emit(tupleTypes[i]));
    }

    return { items: false, minItems: requiredCount, prefixItems, type: 'array' };
}

function emitUnion(prop: AnalyzedProperty): JsonSchema {
    let anyOf: JsonSchema[] = [],
        literals = prop.literals || [],
        unionTypes = prop.unionTypes || [];

    if (literals.length > 0) {
        anyOf.push(emitLiterals(literals));
    }

    for (let i = 0, n = unionTypes.length; i < n; i++) {
        anyOf.push(emit(unionTypes[i]));
    }

    return { anyOf };
}

function emit(prop: AnalyzedProperty): JsonSchema {
    return wrapNullable(prop, emitStructural(prop));
}

function mergeConstraint(schema: JsonSchema, fragment: JsonSchema): void {
    let source = fragment as Record<string, unknown>,
        target = schema as Record<string, unknown>,
        keys = Object.keys(source);

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i];

        if (key === 'type') {
            if (source.type === 'integer') {
                target.type = 'integer';
            }

            continue;
        }

        target[key] = source[key];
    }
}

function sortLiterals(literals: LiteralValue[]): LiteralValue[] {
    return literals.slice().sort((a, b) => {
        let byType = compare(a.type, b.type);

        if (byType !== 0) {
            return byType;
        }

        return compare(String(a.value), String(b.value));
    });
}

function stringify(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        let parts: string[] = [];

        for (let i = 0, n = value.length; i < n; i++) {
            parts.push(stringify(value[i]));
        }

        return '[' + parts.join(',') + ']';
    }

    if (typeof value === 'object') {
        let record = value as Record<string, unknown>,
            keys = Object.keys(record).sort(compare),
            parts: string[] = [];

        for (let i = 0, n = keys.length; i < n; i++) {
            let key = keys[i];

            if (record[key] === undefined) {
                continue;
            }

            parts.push(JSON.stringify(key) + ':' + stringify(record[key]));
        }

        return '{' + parts.join(',') + '}';
    }

    return JSON.stringify(value);
}

function wrapNullable(prop: AnalyzedProperty, schema: JsonSchema): JsonSchema {
    if (!prop.nullable) {
        return schema;
    }

    let keys = Object.keys(schema);

    if (keys.length === 1 && keys[0] === 'type' && typeof schema.type === 'string') {
        return { type: [schema.type, 'null'] };
    }

    return { anyOf: [schema, { type: 'null' }] };
}


const EMITTERS: Record<string, (prop: AnalyzedProperty) => JsonSchema> = {
    any: emitEmpty,
    array: emitArray,
    bigint: emitBigint,
    boolean: emitBoolean,
    date: emitDate,
    enum: emitLiteral,
    intersection: emitIntersection,
    literal: emitLiteral,
    never: emitNever,
    null: emitNull,
    number: emitNumber,
    object: emitObjectDefault,
    record: emitRecord,
    string: emitString,
    tuple: emitTuple,
    union: emitUnion,
    unknown: emitEmpty
};


const generateJsonSchema = (root: AnalyzedProperty, constraints?: Map<string, JsonSchema>): string => {
    let structural = root.type === 'object'
            ? emitObject(root, constraints)
            : emitStructural(root),
        schema = wrapNullable(root, structural) as EmittedSchema;

    if (root.defs !== undefined && root.defs.size > 0) {
        let defs: Record<string, JsonSchema> = {};

        for (let [name, ir] of root.defs) {
            defs[name] = emitObject(ir);
        }

        schema.$defs = defs;
    }

    schema.$schema = DRAFT;

    return stringify(schema);
};


export { generateJsonSchema };
