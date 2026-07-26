import { code, uid } from '@esportsplus/typescript/compiler';
import type { AnalyzedProperty, AnalyzedType } from './type-analyzer';
import { GeneratorContext, PathMode, PathSegment } from './types';
import error, { ERRORS_VARIABLE, emitString } from './error';
import validators from './validators';


type ConfigValidator = {
    async: boolean;
    name: string;
};

type LiteralValue = {
    type: 'boolean' | 'number' | 'string';
    value: boolean | number | string;
};

type PropertyDefault = {
    fresh: boolean;
    name: string;
};

// Per-validator recursion wiring: `names` maps a ref key ('#' or '#/$defs/<key>') to the
// hoisted local function that validates that shape, and `depthArg` is the depth argument a
// ref CALL passes at the current nesting - the literal `1` at the top level and `_depth + 1`
// inside a recursive function body.
type RecursionState = {
    depthArg: string;
    names: Map<string, string>;
};

type TypeValidator = (prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext) => string;


const CONFIG_VARIABLE = '_config';

const INPUT_VARIABLE = '_input';

// A cyclic INPUT value (an object that points back at itself) makes the type graph finite but
// the value graph infinite, so the recursive functions carry a depth counter and push a named
// error once it exceeds this ceiling rather than spinning forever.
const MAX_RECURSION_DEPTH = 512;

const OUTPUT_VARIABLE = '_output';

const PROTO_KEY = '__proto__';

// Decimal / scientific notation only (README:704) - no hex, no empty string, no
// whitespace-only. Booleans, arrays, objects and '' are type errors, not coercions.
const NUMBER_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

// Keyed by the per-transform GeneratorContext so a ref node deep in the tree can look up the
// recursive function to call - GeneratorContext is a read-only contract shape, so the wiring
// rides alongside it here instead of as a new field on it.
const RECURSION = new WeakMap<GeneratorContext, RecursionState>();

const RECURSION_DEPTH_MESSAGE = 'exceeds maximum validation depth';

const RESERVED_WORDS = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield'
]);

const TYPE_VALIDATORS: Record<string, TypeValidator> = {
    array: generateArrayValidation,
    bigint: generateBigintValidation,
    boolean: generateBooleanValidation,
    date: generateDateValidation,
    function: generateFunctionValidation,
    literal: generateLiteralValidation,
    map: generateMapValidation,
    null: generateNullValidation,
    number: generateNumberValidation,
    object: generateObjectValidation,
    record: generateRecordValidation,
    set: generateSetValidation,
    string: generateStringValidation,
    tuple: generateTupleValidation,
    union: generateUnionValidation
};

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;


function buildLiteralChecks(source: string, literals: LiteralValue[]): string[] {
    let checks: string[] = [];

    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i],
            value = String(lit.value);

        checks.push(
            code`${source} !== ${lit.type === 'string' ? emitString(value) : value}`
        );
    }

    return checks;
}

// A ref node is a recursion back-edge and carries no children, so its key is recorded and the
// walk stops; every other node forwards to its structural children so a ref nested inside an
// array/tuple/union/inline object is still discovered.
function collectRefsInto(prop: AnalyzedProperty, out: Set<string>): void {
    if (prop.ref !== undefined) {
        out.add(prop.ref);

        return;
    }

    let children = [prop.indexType, prop.itemType, prop.keyType, prop.restType, prop.valueType],
        lists = [prop.intersectionTypes, prop.properties, prop.tupleTypes, prop.unionTypes];

    for (let i = 0, n = children.length; i < n; i++) {
        let child = children[i];

        if (child !== undefined) {
            collectRefsInto(child, out);
        }
    }

    for (let i = 0, n = lists.length; i < n; i++) {
        let list = lists[i];

        if (list !== undefined) {
            for (let j = 0, m = list.length; j < m; j++) {
                collectRefsInto(list[j], out);
            }
        }
    }
}

function configInvocations(validators: ConfigValidator[], varname: string): string {
    let parts: string[] = [];

    for (let i = 0, n = validators.length; i < n; i++) {
        let validator = validators[i];

        parts.push(`${validator.async ? 'await ' : ''}${validator.name}(${varname}, ${CONFIG_VARIABLE});`);
    }

    return parts.join('\n');
}

// Assign `valueExpr` into `container[name]`. A key equal to __proto__ is written
// via defineProperty - an object-literal or bracket-assignment spelling would hit
// the prototype setter and mutate the output's [[Prototype]] instead (finding C16).
function emitWrite(container: string, name: string, valueExpr: string): string {
    if (name === PROTO_KEY) {
        return `Object.defineProperty(${container}, "__proto__", { configurable: true, enumerable: true, value: ${valueExpr}, writable: true });`;
    }

    return `${outputAccess(name, container)} = ${valueExpr};`;
}

function generateArrayValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let a = uid('a'),
        e = uid('e'),
        i = uid('i'),
        n = uid('n');

    return code`
        if (${prop.nullable ? `${source} !== null && ` : ''}!Array.isArray(${source})) {
            ${error.generate('must be an array', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${a} = [],
                ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

            for (let ${i} = 0, ${n} = ${source}.length; ${i} < ${n}; ${i}++) {
                ${validateOrCopy(
                    prop.itemType || { name: 'item', optional: false, type: 'unknown' },
                    `${source}[${i}]`,
                    `${a}[${i}]`,
                    { segments: [...pathMode.segments, { expr: i, kind: 'index', position: '0' }] },
                    context
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }
            }

            ${target} = ${a};
        }
    `;
}

function generateBigintValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (typeof ${source} !== 'bigint') {
                ${error.generate('must be a bigint', pathMode, context)}
            }
            else {
                ${target} = ${source};
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateBooleanValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let str = uid('str');

    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (typeof ${source} === 'boolean') {
                ${target} = ${source};
            }
            else if (${source} === 'true' || ${source} === 1 || ${source} === '1') {
                ${target} = true;
            }
            else if (${source} === 'false' || ${source} === 0 || ${source} === '0') {
                ${target} = false;
            }
            else {
                let ${str} = String(${source}).toLowerCase();

                if (${str} === 'true' || ${str} === '1') {
                    ${target} = true;
                }
                else if (${str} === 'false' || ${str} === '0') {
                    ${target} = false;
                }
                else {
                    ${error.generate('must be true or false', pathMode, context)}
                }
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateDateValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (!(${source} instanceof Date) || isNaN(${source}.getTime())) {
                ${error.generate('invalid date type', pathMode, context)}
            }
            else {
                ${target} = ${source};
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateFunctionValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (typeof ${source} !== 'function') {
                ${error.generate('must be a function', pathMode, context)}
            }
            else {
                ${target} = ${source};
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateLiteralValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let checks = buildLiteralChecks(source, prop.literals || []);

    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (${checks.join(' && ')}) {
                ${error.generate('invalid literal type', pathMode, context)}
            }
            else {
                ${target} = ${source};
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateMapValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let e = uid('e'),
        key = uid('k'),
        keyOut = uid('ko'),
        value = uid('v'),
        valueOut = uid('vo');

    return code`
        if (${prop.nullable ? `${source} !== null && ` : ''}!(${source} instanceof Map)) {
            ${error.generate('must be a Map', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${e} = ${ERRORS_VARIABLE}?.length ?? 0,
                ${keyOut},
                ${valueOut};

            for (let [${key}, ${value}] of ${source}) {
                ${generateTypeValidation(
                    prop.keyType || { name: 'key', optional: false, type: 'unknown' },
                    key,
                    keyOut,
                    { segments: [...pathMode.segments, { expr: key, kind: 'record' }] },
                    context
                )}

                ${generateTypeValidation(
                    prop.valueType || { name: 'value', optional: false, type: 'unknown' },
                    value,
                    valueOut,
                    { segments: [...pathMode.segments, { expr: key, kind: 'record' }] },
                    context
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }
            }

            ${target} = ${source};
        }
    `;
}

function generateNullValidation(
    _: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        if (${source} !== null) {
            ${error.generate('invalid null type', pathMode, context)}
        }
        else {
            ${target} = ${source};
        }
    `;
}

function generateNumberValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let n = uid('n'),
        parts = '',
        validator = prop.brand ? context.brandValidators.get(prop.brand) : undefined;

    if (validator) {
        parts = validators.inline(validator.body, pathMode, target);

        if (validator.async) {
            context.hasAsync = true;
        }
    }

    // Unary + throws a TypeError on bigint and symbol, so coerce only once the value is
    // known numeric (number or decimal/scientific string); otherwise n is NaN and the
    // finite gate rejects it - keeping coercion total (never throwing) per finding C15.
    let numeric = `typeof ${source} === 'number' || (typeof ${source} === 'string' && ${NUMBER_STRING.toString()}.test(${source}))`;

    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            let ${n} = (${numeric}) ? +${source} : NaN;

            if (!isFinite(${n})${prop.brand === 'integer' ? ` || ${n} % 1 !== 0` : ''}) {
                ${error.generate(prop.brand === 'integer' ? 'must be an integer' : 'must be a number', pathMode, context)}
            }
            else {
                ${target} = ${n};
                ${parts}
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateObjectValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    // A recursion back-edge: instead of inlining an empty body (which drops the sub-object's
    // data and replaces it with {}), call the hoisted function that validates the ref'd shape,
    // threading the runtime path and the incremented depth.
    if (prop.ref !== undefined) {
        let state = RECURSION.get(context);

        if (state !== undefined) {
            let fnName = state.names.get(prop.ref);

            if (fnName !== undefined) {
                return `${target} = ${fnName}(${source}, ${renderChildPath(pathMode.segments)}, ${state.depthArg});`;
            }
        }
    }

    let container = uid('o'),
        parts: string[] = [],
        path = pathMode.segments,
        properties = prop.properties || [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'never') {
            continue;
        }

        let access = propertyAccess(property.name, source),
            inner = validateInto(property, access, container, { segments: [...path, { kind: 'key', name: property.name }] }, context);

        parts.push(
            property.optional
                ? code`if (${access} !== undefined) { ${inner} }`
                : inner
        );
    }

    return code`
        if (${
            prop.nullable
                ? `${source} !== null && (typeof ${source} !== 'object' || Array.isArray(${source}))`
                : `${source} === null || typeof ${source} !== 'object' || Array.isArray(${source})`
        }) {
            ${error.generate('must be an object', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${container} = {};

            ${parts.join('\n')}

            ${target} = ${container};
        }
    `;
}

function generateRecordValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let e = uid('e'),
        indexType = prop.indexType,
        key = uid('key'),
        out = uid('out'),
        record = uid('r'),
        // The value local is copied from input first, then validated in place (source
        // and target are the SAME local, so no input storage is ever written), then
        // placed into the fresh record. An unknown index type leaves the copy untouched.
        body = indexType
            ? generateTypeValidation(
                indexType,
                out,
                out,
                { segments: [...pathMode.segments, { expr: key, kind: 'record' }] },
                context
            )
            : '';

    return code`
        if (${
            prop.nullable
                ? `${source} !== null && (typeof ${source} !== 'object' || Array.isArray(${source}))`
                : `${source} === null || typeof ${source} !== 'object' || Array.isArray(${source})`
        }) {
            ${error.generate('invalid record type', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${record} = {},
                ${e} = ${ERRORS_VARIABLE}?.length ?? 0,
                ${out};

            for (let ${key} in ${source}) {
                ${out} = ${source}[${key}];

                ${body}

                if (${key} === '__proto__') {
                    Object.defineProperty(${record}, ${key}, { configurable: true, enumerable: true, value: ${out}, writable: true });
                }
                else {
                    ${record}[${key}] = ${out};
                }

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }
            }

            ${target} = ${record};
        }
    `;
}

// The properties of a recursive shape, validated into the fresh `_o` container. The base path
// is the runtime `_path` parameter (a `record` segment), so every property error renders under
// the caller-supplied prefix and a nested ref threads the accumulated path into its own call.
function generateRecursiveBody(properties: AnalyzedProperty[], context: GeneratorContext): string {
    let parts: string[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'never') {
            continue;
        }

        let access = propertyAccess(property.name, '_src'),
            inner = validateInto(property, access, '_o', { segments: [{ expr: '_path', kind: 'record' }, { kind: 'key', name: property.name }] }, context);

        parts.push(
            property.optional
                ? code`if (${access} !== undefined) { ${inner} }`
                : inner
        );
    }

    return parts.join('\n');
}

// A hoisted local function that validates one recursive shape into a fresh object. `_depth`
// guards a cyclic INPUT value; the object-shape check mirrors generateObjectValidation's own
// guard so a ref'd slot holding a non-object still reports rather than throws.
function generateRecursiveFunction(fnName: string, properties: AnalyzedProperty[], context: GeneratorContext): string {
    return code`
        function ${fnName}(_src, _path, _depth) {
            if (_depth > ${String(MAX_RECURSION_DEPTH)}) {
                (${ERRORS_VARIABLE} ??= []).push({ message: ${emitString(RECURSION_DEPTH_MESSAGE)}, path: _path });

                return _src;
            }

            if (_src === null || typeof _src !== 'object' || Array.isArray(_src)) {
                (${ERRORS_VARIABLE} ??= []).push({ message: "must be an object", path: _path });

                return _src;
            }

            let _o = {};

            ${generateRecursiveBody(properties, context)}

            return _o;
        }
    `;
}

function generateSetValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let e = uid('e'),
        i = uid('i'),
        value = uid('v'),
        valueOut = uid('vo');

    return code`
        if (${prop.nullable ? `${source} !== null && ` : ''}!(${source} instanceof Set)) {
            ${error.generate('must be a Set', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${e} = ${ERRORS_VARIABLE}?.length ?? 0,
                ${i} = 0,
                ${valueOut};

            for (let ${value} of ${source}) {
                ${generateTypeValidation(
                    prop.valueType || { name: 'value', optional: false, type: 'unknown' },
                    value,
                    valueOut,
                    { segments: [...pathMode.segments, { expr: i, kind: 'index', position: '0' }] },
                    context
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }

                ${i}++;
            }

            ${target} = ${source};
        }
    `;
}

function generateStringValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let parts = '';

    // Template-literal brand carries no runtime check - validate as plain string
    if (prop.brand && prop.brand !== 'template' && context.brandValidators.has(prop.brand)) {
        let validator = context.brandValidators.get(prop.brand)!;

        if (validator.async) {
            context.hasAsync = true;
        }

        parts = validators.inline(validator.body, pathMode, target);
    }

    return code`
        {
            ${prop.nullable ? `if (${source} === null) { ${target} = null; } else {` : ''}
            if (typeof ${source} !== 'string') {
                ${error.generate('must be a string', pathMode, context)}
            }
            else {
                ${target} = ${source};
                ${parts}
            }
            ${prop.nullable ? `}` : ''}
        }
    `;
}

function generateTupleValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let a = uid('a'),
        parts: string[] = [],
        path = pathMode.segments,
        requiredCount = 0,
        restType = prop.restType,
        tupleTypes = prop.tupleTypes || [];

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        if (!tupleTypes[i].optional) {
            requiredCount++;
        }
    }

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        let elementValidation = validateOrCopy(
            tupleTypes[i],
            `${source}[${i}]`,
            `${a}[${i}]`,
            { segments: [...path, { expr: String(i), kind: 'index', position: String(i) }] },
            context
        );

        if (tupleTypes[i].optional) {
            parts.push(`if (${source}.length > ${i}) { ${elementValidation} }`);
        }
        else {
            parts.push(elementValidation);
        }
    }

    if (restType) {
        let e = uid('e'),
            i = uid('i'),
            n = uid('n');

        parts.push(code`
            let ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

            for (let ${i} = ${tupleTypes.length}, ${n} = ${source}.length; ${i} < ${n}; ${i}++) {
                ${validateOrCopy(
                    restType,
                    `${source}[${i}]`,
                    `${a}[${i}]`,
                    { segments: [...path, { expr: i, kind: 'index', position: String(tupleTypes.length) }] },
                    context
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }
            }
        `);
    }

    let lengthCheck = restType
        ? `${source}.length < ${requiredCount}`
        : requiredCount === tupleTypes.length
            ? `${source}.length !== ${tupleTypes.length}`
            : `${source}.length < ${requiredCount} || ${source}.length > ${tupleTypes.length}`;

    return code`
        if (${prop.nullable ? `${source} !== null && ` : ''}(!Array.isArray(${source}) || ${lengthCheck})) {
            ${error.generate('invalid tuple type', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${a} = [];

            ${parts.join('\n')}

            ${target} = ${a};
        }
    `;
}

function generateTypeValidation(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext): string {
    return TYPE_VALIDATORS[prop.type]?.(prop, source, target, pathMode, context) ?? '';
}

function generateUnionValidation(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext): string {
    let literals = prop.literals || [],
        unionTypes = prop.unionTypes || [];

    if (literals.length === 0 && unionTypes.length === 0) {
        return '';
    }

    let branchParts: string[] = [],
        literalHits: string[] = [],
        ok = uid('ok');

    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i];

        literalHits.push(
            `${source} === ${lit.type === 'string' ? emitString(String(lit.value)) : String(lit.value)}`
        );
    }

    for (let i = 0, n = unionTypes.length; i < n; i++) {
        let branch = unionTypes[i],
            branchType = branch.type,
            guard: string,
            body = '',
            start = uid('u'),
            tmp = uid('t');

        switch (branchType) {
            case 'array':
            case 'tuple':
                guard = `Array.isArray(${source})`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                break;

            case 'bigint':
                guard = `typeof ${source} === 'bigint'`;
                break;

            case 'boolean':
                guard = `typeof ${source} === 'boolean'`;
                break;

            case 'date':
                guard = `${source} instanceof Date`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                break;

            case 'function':
                guard = `typeof ${source} === 'function'`;
                break;

            case 'map':
                guard = `${source} instanceof Map`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                break;

            case 'number':
                guard = `typeof ${source} === 'number'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                }
                break;

            case 'object':
            case 'record':
                guard = `typeof ${source} === 'object' && ${source} !== null && !Array.isArray(${source})`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                break;

            case 'set':
                guard = `${source} instanceof Set`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                break;

            case 'string':
                guard = `typeof ${source} === 'string'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context);
                }
                break;

            default:
                continue;
        }

        if (body) {
            branchParts.push(code`
                if (!${ok} && ${guard}) {
                    let ${start} = ${ERRORS_VARIABLE}?.length ?? 0,
                        ${tmp};

                    ${body}

                    if ((${ERRORS_VARIABLE}?.length ?? 0) === ${start}) {
                        ${ok} = true;
                        ${target} = ${tmp};
                    }
                    else {
                        ${ERRORS_VARIABLE}.length = ${start};
                    }
                }
            `);
        }
        else {
            branchParts.push(code`
                if (!${ok} && ${guard}) {
                    ${ok} = true;
                    ${target} = ${source};
                }
            `);
        }
    }

    if (literalHits.length > 0) {
        branchParts.unshift(code`
            if (!${ok} && (${literalHits.join(' || ')})) {
                ${ok} = true;
                ${target} = ${source};
            }
        `);
    }

    return code`
        {
            let ${ok} = ${prop.nullable ? `${source} === null` : 'false'};

            ${prop.nullable ? `if (${ok}) { ${target} = null; }` : ''}

            ${branchParts.join('\n')}

            if (!${ok}) {
                ${error.generate('invalid union type', pathMode, context)}
            }
        }
    `;
}

function outputAccess(prop: string, container: string): string {
    if (VALID_IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop) && prop !== PROTO_KEY) {
        return `${container}.${prop}`;
    }

    return `${container}[${emitString(prop)}]`;
}

// Register the ref -> function-name wiring for `context` and return the hoisted recursive
// function declarations: one per $defs entry plus one for the root shape when a '#' back-edge
// exists. Function bodies generate with depthArg '_depth + 1'; on return depthArg is left at
// '1' so the TOP-LEVEL ref calls (generated afterwards) enter the recursion at depth 1.
function prepareRecursion(analyzed: AnalyzedType, context: GeneratorContext): string {
    let defs = analyzed.root.defs,
        refs = new Set<string>();

    collectRefsInto(analyzed.root, refs);

    if (defs !== undefined) {
        for (let [, ir] of defs) {
            collectRefsInto(ir, refs);
        }
    }

    let names = new Map<string, string>(),
        needRoot = refs.has('#');

    if (needRoot) {
        names.set('#', uid('recurse'));
    }

    if (defs !== undefined) {
        for (let [key] of defs) {
            names.set('#/$defs/' + key, uid('recurse'));
        }
    }

    if (names.size === 0) {
        return '';
    }

    let decls: string[] = [],
        state: RecursionState = { depthArg: '_depth + 1', names };

    RECURSION.set(context, state);

    if (needRoot) {
        decls.push(generateRecursiveFunction(names.get('#')!, analyzed.properties, context));
    }

    if (defs !== undefined) {
        for (let [key, ir] of defs) {
            decls.push(generateRecursiveFunction(names.get('#/$defs/' + key)!, ir.properties ?? [], context));
        }
    }

    state.depthArg = '1';

    return decls.join('\n');
}

function propertyAccess(prop: string, varname: string): string {
    if (VALID_IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop)) {
        return `${varname}.${prop}`;
    }

    return `${varname}[${emitString(prop)}]`;
}

// The runtime path expression a recursive CALL threads as its `_path` argument. Mirrors
// error.resolvePath except a `record` base renders raw (never id-safe wrapped), so the value
// stays a clean dotted string as it accumulates across recursion levels.
function renderChildPath(segments: PathSegment[]): string {
    let fragments: string[] = [],
        literal = '';

    for (let i = 0, n = segments.length; i < n; i++) {
        let first = fragments.length === 0 && literal === '',
            segment = segments[i];

        if (segment.kind === 'record') {
            if (literal !== '') {
                fragments.push(emitString(literal));
                literal = '';
            }

            fragments.push(segment.expr);

            continue;
        }

        if (segment.kind === 'key') {
            if (segment.name.includes('.')) {
                literal += `[${emitString(segment.name)}]`;
            }
            else {
                literal += first ? segment.name : `.${segment.name}`;
            }

            continue;
        }

        literal += '[';
        fragments.push(emitString(literal));
        fragments.push(segment.expr);
        literal = ']';
    }

    if (literal !== '') {
        fragments.push(emitString(literal));
    }

    if (fragments.length === 0) {
        return emitString('');
    }

    return fragments.join(' + ');
}

// Validate `source` into the container slot named `prop.name`. A __proto__ slot cannot
// be a plain lvalue target (assignment hits the prototype setter), so it validates into a
// temp local and is placed via defineProperty.
function validateInto(prop: AnalyzedProperty, source: string, container: string, pathMode: PathMode, context: GeneratorContext): string {
    if (prop.name === PROTO_KEY) {
        let temp = uid('p');

        return code`
            let ${temp};

            ${validateOrCopy(prop, source, temp, pathMode, context)}

            ${emitWrite(container, PROTO_KEY, temp)}
        `;
    }

    return validateOrCopy(prop, source, outputAccess(prop.name, container), pathMode, context);
}

// A type with no runtime validator (any / unknown) still contributes its value to the
// fresh output - copy it through so nested containers keep the caller's data.
function validateOrCopy(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext): string {
    let generated = generateTypeValidation(prop, source, target, pathMode, context);

    if (generated === '') {
        return `${target} = ${source};`;
    }

    return generated;
}


const generateValidator = (type: AnalyzedType, context: GeneratorContext, config?: Map<string, ConfigValidator[]>, defaults?: Map<string, PropertyDefault>): string => {
    // Register the recursion wiring FIRST so every ref call generated below (in either branch)
    // resolves to a hoisted function; returns the function declarations to inject into the body.
    let recursion = prepareRecursion(type, context),
        root = type.root;

    // Non-object roots (primitive, array, tuple, record, union, ...) validate `_input`
    // into a fresh `_output` - input is never written, coercion lands in the result.
    if (root.type !== 'object') {
        return `
            ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
                let ${ERRORS_VARIABLE},
                    ${OUTPUT_VARIABLE};
                ${recursion}

                ${validateOrCopy(root, INPUT_VARIABLE, OUTPUT_VARIABLE, { segments: [] }, context)}

                if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                    return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
                }

                return { ok: true, data: ${OUTPUT_VARIABLE}, errors: undefined };
            }
        `;
    }

    let parts: string[] = [],
        properties = type.properties;

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'never') {
            continue;
        }

        let configValidators = config?.get(property.name),
            def = defaults?.get(property.name),
            source = propertyAccess(property.name, INPUT_VARIABLE),
            core: string;

        if (configValidators !== undefined && configValidators.length > 0) {
            let count = uid('c'),
                nullableNonUnion = property.nullable === true && property.type !== 'union',
                slot = property.name === PROTO_KEY ? uid('p') : outputAccess(property.name, OUTPUT_VARIABLE),
                structural = property.name === PROTO_KEY
                    ? code`
                        let ${slot};

                        ${validateOrCopy(property, source, slot, { segments: [{ kind: 'key', name: property.name }] }, context)}
                    `
                    : validateOrCopy(property, source, slot, { segments: [{ kind: 'key', name: property.name }] }, context);

            core = code`
                let ${count} = ${ERRORS_VARIABLE}?.length ?? 0;

                ${structural}

                if ((${ERRORS_VARIABLE}?.length ?? 0) === ${count}${nullableNonUnion ? ` && ${slot} !== null` : ''}) {
                    ${CONFIG_VARIABLE}.path = ${emitString(property.name)};
                    ${configInvocations(configValidators, slot)}
                }

                ${property.name === PROTO_KEY ? emitWrite(OUTPUT_VARIABLE, PROTO_KEY, slot) : ''}
            `;
        }
        else {
            core = validateInto(property, source, OUTPUT_VARIABLE, { segments: [{ kind: 'key', name: property.name }] }, context);
        }

        if (def !== undefined) {
            parts.push(
                code`
                    if (${source} === undefined) {
                        ${emitWrite(OUTPUT_VARIABLE, property.name, def.fresh ? `${def.name}()` : def.name)}
                    }
                    else {
                        ${core}
                    }
                `
            );
        }
        else if (property.optional) {
            parts.push(
                code`
                    if (${source} !== undefined) {
                        ${core}
                    }
                `
            );
        }
        else {
            parts.push(core);
        }
    }

    let hasConfig = config !== undefined && config.size > 0;

    return `
        ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
            let ${ERRORS_VARIABLE},
                ${OUTPUT_VARIABLE};
            ${hasConfig ? `let ${CONFIG_VARIABLE} = { path: '', push(_message) { (${ERRORS_VARIABLE} ??= []).push({ message: _message, path: this.path }); } };` : ''}
            ${recursion}

            if (${INPUT_VARIABLE} === null || typeof ${INPUT_VARIABLE} !== 'object' || Array.isArray(${INPUT_VARIABLE})) {
                ${error.generate('must be an object', { segments: [] }, context)}

                return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
            }

            ${OUTPUT_VARIABLE} = {};

            ${parts.join('\n')}

            if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
            }

            return { ok: true, data: ${OUTPUT_VARIABLE}, errors: undefined };
        }
    `;
};


export { generateValidator };
export type { ConfigValidator, PropertyDefault };
