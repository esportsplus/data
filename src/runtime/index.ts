import type { AnalyzedProperty } from '../compiler/type-analyzer';
import { compare } from '../constants';
import type { JsonSchema } from '../types';
import type { LiteralValue } from '../types';
import { generateJsonSchema } from '../json-schema';

type NodeOptions = {
    default?: unknown;
    description?: string;
    nullable?: boolean;
    optional?: boolean;
};

type SchemaNode = AnalyzedProperty & {
    default?: unknown;
    description?: string;
};


function apply(node: SchemaNode, options: NodeOptions | undefined): SchemaNode {
    if (options === undefined) {
        return node;
    }

    if (options.default !== undefined) {
        node.default = options.default;
    }

    if (options.description !== undefined) {
        node.description = options.description;
    }

    if (options.nullable) {
        node.nullable = true;
    }

    if (options.optional) {
        node.optional = true;
    }

    return node;
}

function array(element: SchemaNode, options?: NodeOptions): SchemaNode {
    if (!isNode(element)) {
        throw new Error('Runtime: schema.array requires an element schema node');
    }

    return apply({ itemType: element, name: '', optional: false, type: 'array' }, options);
}

function boolean(options?: NodeOptions): SchemaNode {
    return apply({ name: '', optional: false, type: 'boolean' }, options);
}

function enumeration(values: string[], options?: NodeOptions): SchemaNode {
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Runtime: schema.enum requires a non-empty array of string values');
    }

    let literals: LiteralValue[] = [];

    for (let i = 0, n = values.length; i < n; i++) {
        if (typeof values[i] !== 'string') {
            throw new Error('Runtime: schema.enum values must all be strings');
        }

        literals.push({ type: 'string', value: values[i] });
    }

    return apply({ literals, name: '', optional: false, type: 'literal' }, options);
}

function isNode(value: unknown): value is SchemaNode {
    return typeof value === 'object' && value !== null && typeof (value as SchemaNode).type === 'string';
}

function literal(value: boolean | number | string, options?: NodeOptions): SchemaNode {
    return apply({ literals: [{ type: literalType(value), value }], name: '', optional: false, type: 'literal' }, options);
}

function literalType(value: unknown): 'boolean' | 'number' | 'string' {
    let type = typeof value;

    if (type === 'boolean' || type === 'number' || type === 'string') {
        return type;
    }

    throw new Error('Runtime: schema.literal requires a boolean, number, or string value');
}

function number(options?: NodeOptions): SchemaNode {
    return apply({ name: '', optional: false, type: 'number' }, options);
}

function object(properties: Record<string, SchemaNode>, options?: NodeOptions): SchemaNode {
    if (properties === null || typeof properties !== 'object') {
        throw new Error('Runtime: schema.object requires a properties record');
    }

    let names = Object.keys(properties).sort(compare),
        result: SchemaNode[] = [];

    for (let i = 0, n = names.length; i < n; i++) {
        let name = names[i],
            node = properties[name];

        if (!isNode(node)) {
            throw new Error(`Runtime: schema.object property '${name}' must be a schema node`);
        }

        result.push({ ...node, name });
    }

    return apply({ name: '', optional: false, properties: result, type: 'object' }, options);
}

function record(value: SchemaNode, options?: NodeOptions): SchemaNode {
    if (!isNode(value)) {
        throw new Error('Runtime: schema.record requires a value schema node');
    }

    return apply({ indexType: value, name: '', optional: false, type: 'record' }, options);
}

function string(options?: NodeOptions): SchemaNode {
    return apply({ name: '', optional: false, type: 'string' }, options);
}

// The emitter reads `default`/`description` only through its per-property constraint channel
// (structural emit ignores them), so route each root property's carried annotations back through
// that same channel — exactly the compiler's foldAnnotations -> generateJsonSchema(root, folded) path.
function toConstraints(node: SchemaNode): Map<string, JsonSchema> | undefined {
    if (node.type !== 'object' || node.properties === undefined) {
        return undefined;
    }

    let constraints = new Map<string, JsonSchema>(),
        properties = node.properties;

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i] as SchemaNode,
            fragment: Record<string, unknown> = {};

        if (property.default !== undefined) {
            fragment.default = property.default;
        }

        if (property.description !== undefined) {
            fragment.description = property.description;
        }

        if (Object.keys(fragment).length > 0) {
            constraints.set(property.name, fragment as JsonSchema);
        }
    }

    return constraints.size > 0 ? constraints : undefined;
}

function union(branches: SchemaNode[], options?: NodeOptions): SchemaNode {
    if (!Array.isArray(branches) || branches.length === 0) {
        throw new Error('Runtime: schema.union requires a non-empty array of branch schema nodes');
    }

    for (let i = 0, n = branches.length; i < n; i++) {
        if (!isNode(branches[i])) {
            throw new Error('Runtime: schema.union branches must all be schema nodes');
        }
    }

    return apply({ name: '', optional: false, type: 'union', unionTypes: branches }, options);
}

function unknown(options?: NodeOptions): SchemaNode {
    return apply({ name: '', optional: false, type: 'unknown' }, options);
}


const schema = {
    array,
    boolean,
    enum: enumeration,
    literal,
    number,
    object,
    record,
    string,
    union,
    unknown
};

const toJsonSchema = (node: SchemaNode): JsonSchema => {
    if (!isNode(node)) {
        throw new Error('Runtime: toJsonSchema requires a schema node');
    }

    return JSON.parse(generateJsonSchema(node, toConstraints(node)));
};


export { schema, toJsonSchema };
export type { NodeOptions, SchemaNode };
