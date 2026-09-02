import { code, uid } from '@esportsplus/typescript/compiler';
import { IDENTIFIER } from '../constants';
import type { AnalyzedProperty, AnalyzedType } from './type-analyzer';
import { GeneratorContext, PathMode } from './types';
import error, { ERRORS_VARIABLE, emitString, resolvePath } from './error';
import validators from './validators';
import type { LiteralValue } from '../types';


type ConfigValidator = {
    async: boolean;
    name: string;
};

type PropertyDefault = {
    fresh: boolean;
    name: string;
};

// Per-validator recursion wiring, threaded as a generator parameter (never static state):
// `names` maps a ref key ('#' or '#/$defs/<key>') to the hoisted local function that validates
// that shape, and `depthArg` is the depth argument a ref CALL passes at the current nesting -
// the literal `1` at the top level and `_depth + 1` inside a recursive function body.
type RecursionState = {
    depthArg: string;
    names: Map<string, string>;
};

type TypeValidator = (prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext, recursion: RecursionState | null) => string;


const CONFIG_VARIABLE = '_config';

// Every property name Object.prototype shadows-in (constructor, toString, __proto__, ...). A
// read of one of these off a plain input returns the INHERITED value, so presence/default tests
// must go through an own-property probe instead of a bare `input.name` read.
const INHERITED_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

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

    forEachChildProp(prop, (child) => collectRefsInto(child, out));
}

// The single structural field walk shared by ref collection and the async pre-walk: forwards
// to every child slot and list entry a node can carry, so a defect fixed here is fixed for both.
function forEachChildProp(prop: AnalyzedProperty, visit: (child: AnalyzedProperty) => void): void {
    let children = [prop.indexType, prop.itemType, prop.keyType, prop.restType, prop.valueType],
        lists = [prop.intersectionTypes, prop.properties, prop.tupleTypes, prop.unionTypes];

    for (let i = 0, n = children.length; i < n; i++) {
        let child = children[i];

        if (child !== undefined) {
            visit(child);
        }
    }

    for (let i = 0, n = lists.length; i < n; i++) {
        let list = lists[i];

        if (list !== undefined) {
            for (let j = 0, m = list.length; j < m; j++) {
                visit(list[j]);
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
    context: GeneratorContext,
    recursion: RecursionState | null
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
                    context,
                    recursion
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
                ${error.generate('must be true or false', pathMode, context)}
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
    context: GeneratorContext,
    recursion: RecursionState | null
): string {
    let e = uid('e'),
        fresh = uid('m'),
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
            let ${fresh} = new Map(),
                ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

            for (let [${key}, ${value}] of ${source}) {
                let ${keyOut},
                    ${valueOut};

                ${validateOrCopy(
                    prop.keyType || { name: 'key', optional: false, type: 'unknown' },
                    key,
                    keyOut,
                    { segments: [...pathMode.segments, { expr: key, kind: 'record' }] },
                    context,
                    recursion
                )}

                ${validateOrCopy(
                    prop.valueType || { name: 'value', optional: false, type: 'unknown' },
                    value,
                    valueOut,
                    { segments: [...pathMode.segments, { expr: key, kind: 'record' }] },
                    context,
                    recursion
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }

                ${fresh}.set(${keyOut}, ${valueOut});
            }

            ${target} = ${fresh};
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
    context: GeneratorContext,
    recursion: RecursionState | null
): string {
    // A recursion back-edge: instead of inlining an empty body (which drops the sub-object's
    // data and replaces it with {}), call the hoisted function that validates the ref'd shape,
    // passing the call-site path string and the incremented depth. prepareRecursion mints a name
    // for every collected ref before any body generates, so a wired ref is unreachable-by-miss;
    // a miss is an internal defect worth a loud throw, never a silent regeneration of the bug.
    if (prop.ref !== undefined) {
        let fnName = recursion === null ? undefined : recursion.names.get(prop.ref);

        if (recursion === null || fnName === undefined) {
            throw new Error(`Validator: recursion back-edge '${prop.ref}' reached with no generated function`);
        }

        return `${target} = ${context.hasAsync ? 'await ' : ''}${fnName}(${source}, ${resolvePath(pathMode)}, ${recursion.depthArg});`;
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

        let probe = propertyAccess(property.name, source),
            access = probe.expr,
            inner = validateInto(property, access, container, { segments: [...path, { kind: 'key', name: property.name }] }, context, recursion);

        parts.push(
            property.optional
                ? code`${probe.seed} if (${access} !== undefined) { ${inner} }`
                : code`${probe.seed} ${inner}`
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
    context: GeneratorContext,
    recursion: RecursionState | null
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
                context,
                recursion
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

            for (let ${key} of Object.keys(${source})) {
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

// A hoisted local function that validates one recursive shape into a fresh object. Its property
// body validates with paths RELATIVE to this shape (base segments []), so message text, custom
// messages and path rendering behave exactly as the inline path does; the boundary loop then
// prefixes the caller-supplied `_path` onto every error THIS call appended, once, before return -
// so prefixing composes across depths (an inner call already prefixed its own appends). `_depth`
// guards a cyclic INPUT; both failure arms return the fresh empty `_o`, never `_src`, so a raw
// (possibly cyclic) input reference is never placed into output. The object-shape check mirrors
// generateObjectValidation's guard so a ref'd slot holding a non-object reports rather than throws.
// Accepted limitation: custom messages resolve by schema position relative to THIS function's
// shape, so a '#' root resolves its own keys at every depth (one schema, one message set, per
// JSON-Schema $ref) while a flattened $defs shape resolves none - no message test touches a
// recursive shape, which never validated at all before this item.
function generateRecursiveFunction(
    fnName: string,
    properties: AnalyzedProperty[],
    config: Map<string, ConfigValidator[]> | undefined,
    defaults: Map<string, PropertyDefault> | undefined,
    context: GeneratorContext,
    recursion: RecursionState
): string {
    return code`
        ${context.hasAsync ? 'async ' : ''}function ${fnName}(_src, _path, _depth) {
            let _o = {},
                _e = ${ERRORS_VARIABLE}?.length ?? 0;

            if (_depth > ${String(MAX_RECURSION_DEPTH)}) {
                ${error.generate(RECURSION_DEPTH_MESSAGE, { segments: [] }, context)}
            }
            else if (_src === null || typeof _src !== 'object' || Array.isArray(_src)) {
                ${error.generate('must be an object', { segments: [] }, context)}
            }
            else {
                ${generateRootParts(properties, config, defaults, '_src', '_o', context, recursion)}
            }

            if (_path !== '' && ${ERRORS_VARIABLE} !== undefined) {
                for (let _i = _e, _n = ${ERRORS_VARIABLE}.length; _i < _n; _i++) {
                    let _r = ${ERRORS_VARIABLE}[_i].path;

                    ${ERRORS_VARIABLE}[_i].path = _r === '' ? _path : (_r[0] === '[' ? _path + _r : _path + '.' + _r);
                }
            }

            return _o;
        }
    `;
}

function generateSetValidation(
    prop: AnalyzedProperty,
    source: string,
    target: string,
    pathMode: PathMode,
    context: GeneratorContext,
    recursion: RecursionState | null
): string {
    let e = uid('e'),
        fresh = uid('s'),
        i = uid('i'),
        value = uid('v'),
        valueOut = uid('vo');

    return code`
        if (${prop.nullable ? `${source} !== null && ` : ''}!(${source} instanceof Set)) {
            ${error.generate('must be a Set', pathMode, context)}
        }
        ${prop.nullable ? `else if (${source} === null) { ${target} = null; }` : ''}
        else {
            let ${fresh} = new Set(),
                ${e} = ${ERRORS_VARIABLE}?.length ?? 0,
                ${i} = 0;

            for (let ${value} of ${source}) {
                let ${valueOut};

                ${validateOrCopy(
                    prop.valueType || { name: 'value', optional: false, type: 'unknown' },
                    value,
                    valueOut,
                    { segments: [...pathMode.segments, { expr: i, kind: 'index', position: '0' }] },
                    context,
                    recursion
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }

                ${fresh}.add(${valueOut});

                ${i}++;
            }

            ${target} = ${fresh};
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
    context: GeneratorContext,
    recursion: RecursionState | null
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
            context,
            recursion
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
                    context,
                    recursion
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

function generateTypeValidation(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext, recursion: RecursionState | null): string {
    return TYPE_VALIDATORS[prop.type]?.(prop, source, target, pathMode, context, recursion) ?? '';
}

function generateUnionValidation(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext, recursion: RecursionState | null): string {
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
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                break;

            case 'bigint':
                guard = `typeof ${source} === 'bigint'`;
                break;

            case 'boolean':
                guard = `typeof ${source} === 'boolean'`;
                break;

            case 'date':
                guard = `${source} instanceof Date`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                break;

            case 'function':
                guard = `typeof ${source} === 'function'`;
                break;

            case 'map':
                guard = `${source} instanceof Map`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                break;

            case 'number':
                guard = `typeof ${source} === 'number'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                }
                break;

            case 'object':
            case 'record':
                guard = `typeof ${source} === 'object' && ${source} !== null && !Array.isArray(${source})`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                break;

            case 'set':
                guard = `${source} instanceof Set`;
                body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
                break;

            case 'string':
                guard = `typeof ${source} === 'string'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, source, tmp, pathMode, context, recursion);
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
    if (IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop) && prop !== PROTO_KEY) {
        return `${container}.${prop}`;
    }

    return `${container}[${emitString(prop)}]`;
}

// The root property loop, extracted so the top level and every recursive function share ONE
// body: a type with no refs generates with recursion `null` and source/container `_input`/
// `_output`, emitting byte-identical output to the pre-extraction inline loop. Config validators
// and default fills therefore execute at EVERY depth when a recursive function reuses it.
function generateRootParts(
    properties: AnalyzedProperty[],
    config: Map<string, ConfigValidator[]> | undefined,
    defaults: Map<string, PropertyDefault> | undefined,
    source: string,
    container: string,
    context: GeneratorContext,
    recursion: RecursionState | null
): string {
    let parts: string[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'never') {
            continue;
        }

        let configValidators = config?.get(property.name),
            def = defaults?.get(property.name),
            probe = propertyAccess(property.name, source),
            propSource = probe.expr,
            core: string;

        if (configValidators !== undefined && configValidators.length > 0) {
            let count = uid('c'),
                nullableNonUnion = property.nullable === true && property.type !== 'union',
                slot = property.name === PROTO_KEY ? uid('p') : outputAccess(property.name, container),
                structural = property.name === PROTO_KEY
                    ? code`
                        let ${slot};

                        ${validateOrCopy(property, propSource, slot, { segments: [{ kind: 'key', name: property.name }] }, context, recursion)}
                    `
                    : validateOrCopy(property, propSource, slot, { segments: [{ kind: 'key', name: property.name }] }, context, recursion);

            core = code`
                let ${count} = ${ERRORS_VARIABLE}?.length ?? 0;

                ${structural}

                if ((${ERRORS_VARIABLE}?.length ?? 0) === ${count}${nullableNonUnion ? ` && ${slot} !== null` : ''}) {
                    ${CONFIG_VARIABLE}.path = ${emitString(property.name)};
                    ${configInvocations(configValidators, slot)}
                }

                ${property.name === PROTO_KEY ? emitWrite(container, PROTO_KEY, slot) : ''}
            `;
        }
        else {
            core = validateInto(property, propSource, container, { segments: [{ kind: 'key', name: property.name }] }, context, recursion);
        }

        if (def !== undefined) {
            parts.push(
                code`
                    ${probe.seed}

                    if (${propSource} === undefined) {
                        ${emitWrite(container, property.name, def.fresh ? `${def.name}()` : def.name)}
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
                    ${probe.seed}

                    if (${propSource} !== undefined) {
                        ${core}
                    }
                `
            );
        }
        else {
            parts.push(code`${probe.seed} ${core}`);
        }
    }

    return parts.join('\n');
}

// A single node's brand resolves to an async validator: matches generateNumberValidation
// (any brand) and generateStringValidation (brand set, not 'template') exactly, so the pre-walk
// flags precisely the nodes those generators would inline an `await`-bearing body for.
function nodeBrandAsync(prop: AnalyzedProperty, context: GeneratorContext): boolean {
    if (prop.brand === undefined) {
        return false;
    }

    if (prop.type === 'number' || (prop.type === 'string' && prop.brand !== 'template')) {
        let validator = context.brandValidators.get(prop.brand);

        return validator !== undefined && validator.async;
    }

    return false;
}

// True when `prop` or any structural descendant carries an async brand. A ref back-edge stops
// the walk - the ref'd shape is walked at its own root/def entry - so the traversal is finite.
function walkAsync(prop: AnalyzedProperty, context: GeneratorContext): boolean {
    if (prop.ref !== undefined) {
        return false;
    }

    if (nodeBrandAsync(prop, context)) {
        return true;
    }

    let found = false;

    forEachChildProp(prop, (child) => {
        if (walkAsync(child, context)) {
            found = true;
        }
    });

    return found;
}

// Register the ref -> function-name wiring and return the hoisted recursive function
// declarations: one per $defs entry plus one for the root shape when a '#' back-edge exists.
// Function bodies generate with depthArg '_depth + 1'; the returned `names` map lets the caller
// build the top-level state (depthArg '1') so TOP-LEVEL ref calls enter the recursion at depth 1.
function prepareRecursion(
    analyzed: AnalyzedType,
    context: GeneratorContext,
    config: Map<string, ConfigValidator[]> | undefined,
    defaults: Map<string, PropertyDefault> | undefined
): { decls: string; names: Map<string, string> } {
    let defs = analyzed.root.defs,
        names = new Map<string, string>(),
        refs = new Set<string>();

    collectRefsInto(analyzed.root, refs);

    if (defs !== undefined) {
        for (let [, ir] of defs) {
            collectRefsInto(ir, refs);
        }
    }

    if (refs.size === 0) {
        return { decls: '', names };
    }

    let needRoot = refs.has('#');

    if (needRoot) {
        names.set('#', uid('recurse_root'));
    }

    if (defs !== undefined) {
        for (let [, ir] of defs) {
            names.set('#/$defs/' + ir.name, uid('recurse_' + ir.name));
        }
    }

    // Async must SETTLE before any body generates: a decl's `function` keyword and a ref call's
    // `await` are read from context.hasAsync at the moment the body string is built, so an async
    // brand discovered mid-body would splice `await` into a plain `function` (a SyntaxError).
    if (walkAsync(analyzed.root, context)) {
        context.hasAsync = true;
    }

    if (defs !== undefined) {
        for (let [, ir] of defs) {
            if (walkAsync(ir, context)) {
                context.hasAsync = true;
            }
        }
    }

    let bodyState: RecursionState = { depthArg: '_depth + 1', names },
        decls: string[] = [];

    if (needRoot) {
        decls.push(generateRecursiveFunction(names.get('#')!, analyzed.properties, config, defaults, context, bodyState));
    }

    if (defs !== undefined) {
        for (let [, ir] of defs) {
            // A $defs entry is always object-shaped with `properties` set (defSchema in the
            // type-analyzer), so read `ir.properties!`: a `?? []` fallback would silently
            // regenerate the original drop-to-{} bug for a hypothetically malformed def.
            decls.push(generateRecursiveFunction(names.get('#/$defs/' + ir.name)!, ir.properties!, undefined, undefined, context, bodyState));
        }
    }

    return { decls: decls.join('\n'), names };
}

// The twin of outputAccess for READS. A name Object.prototype shadows-in - PROTO_KEY and every
// other inherited key - is read through a hoisted local seeded via Object.hasOwn so an inherited
// value never masquerades as the input's own property; the seed feeds the presence test, the
// default test and the validation source. Every other name keeps its bare dot/bracket spelling
// with an empty seed, so its generated code is unchanged.
function propertyAccess(prop: string, varname: string): { expr: string; seed: string } {
    if (prop === PROTO_KEY || INHERITED_KEYS.has(prop)) {
        let key = emitString(prop),
            local = uid('own');

        return { expr: local, seed: `let ${local} = Object.hasOwn(${varname}, ${key}) ? ${varname}[${key}] : undefined;` };
    }

    if (IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop)) {
        return { expr: `${varname}.${prop}`, seed: '' };
    }

    return { expr: `${varname}[${emitString(prop)}]`, seed: '' };
}

// Validate `source` into the container slot named `prop.name`. A __proto__ slot cannot
// be a plain lvalue target (assignment hits the prototype setter), so it validates into a
// temp local and is placed via defineProperty.
function validateInto(prop: AnalyzedProperty, source: string, container: string, pathMode: PathMode, context: GeneratorContext, recursion: RecursionState | null): string {
    if (prop.name === PROTO_KEY) {
        let temp = uid('p');

        return code`
            let ${temp};

            ${validateOrCopy(prop, source, temp, pathMode, context, recursion)}

            ${emitWrite(container, PROTO_KEY, temp)}
        `;
    }

    return validateOrCopy(prop, source, outputAccess(prop.name, container), pathMode, context, recursion);
}

// A type with no runtime validator (any / unknown) still contributes its value to the
// fresh output - copy it through so nested containers keep the caller's data.
function validateOrCopy(prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext, recursion: RecursionState | null): string {
    let generated = generateTypeValidation(prop, source, target, pathMode, context, recursion);

    if (generated === '') {
        return `${target} = ${source};`;
    }

    return generated;
}


const generateValidator = (type: AnalyzedType, context: GeneratorContext, config?: Map<string, ConfigValidator[]>, defaults?: Map<string, PropertyDefault>): string => {
    // Register the recursion wiring FIRST: emits the hoisted function declarations, settles
    // context.hasAsync, and returns the ref -> function-name map. Every ref call generated below
    // resolves through it, and the two shared state objects (top-level '1', bodies '_depth + 1')
    // read the same `names` map.
    let recursion = prepareRecursion(type, context, config, defaults),
        names = recursion.names,
        root = type.root,
        topState: RecursionState | null = names.size > 0 ? { depthArg: '1', names } : null;

    // Non-object roots (primitive, array, tuple, record, union, ...) validate `_input`
    // into a fresh `_output` - input is never written, coercion lands in the result.
    if (root.type !== 'object') {
        return `
            ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
                let ${ERRORS_VARIABLE},
                    ${OUTPUT_VARIABLE};
                ${recursion.decls}

                ${validateOrCopy(root, INPUT_VARIABLE, OUTPUT_VARIABLE, { segments: [] }, context, topState)}

                if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                    return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
                }

                return { ok: true, data: ${OUTPUT_VARIABLE}, errors: undefined };
            }
        `;
    }

    let hasConfig = config !== undefined && config.size > 0;

    // A self-recursive root ('#' back-edge): the root function IS the top-level body, so config
    // validators and default fills run at EVERY depth. The top level keeps its own non-object
    // guard verbatim, then calls the root function - which re-guards each recursive sub-value.
    if (names.has('#')) {
        return `
            ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
                let ${ERRORS_VARIABLE},
                    ${OUTPUT_VARIABLE};
                ${hasConfig ? `let ${CONFIG_VARIABLE} = { path: '', push(_message) { (${ERRORS_VARIABLE} ??= []).push({ message: _message, path: this.path }); } };` : ''}
                ${recursion.decls}

                if (${INPUT_VARIABLE} === null || typeof ${INPUT_VARIABLE} !== 'object' || Array.isArray(${INPUT_VARIABLE})) {
                    ${error.generate('must be an object', { segments: [] }, context)}

                    return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
                }

                ${OUTPUT_VARIABLE} = ${context.hasAsync ? 'await ' : ''}${names.get('#')}(${INPUT_VARIABLE}, '', 0);

                if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                    return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
                }

                return { ok: true, data: ${OUTPUT_VARIABLE}, errors: undefined };
            }
        `;
    }

    // Generate the parts BEFORE the return template: an async brand inlined here flips
    // context.hasAsync, and the `${context.hasAsync ? 'async ' : ''}` prefix below reads it
    // eagerly - so the body must exist before the prefix is evaluated (the pre-extraction loop
    // built `parts` before its return for exactly this reason).
    let parts = generateRootParts(type.properties, config, defaults, INPUT_VARIABLE, OUTPUT_VARIABLE, context, topState);

    return `
        ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
            let ${ERRORS_VARIABLE},
                ${OUTPUT_VARIABLE};
            ${hasConfig ? `let ${CONFIG_VARIABLE} = { path: '', push(_message) { (${ERRORS_VARIABLE} ??= []).push({ message: _message, path: this.path }); } };` : ''}
            ${recursion.decls}

            if (${INPUT_VARIABLE} === null || typeof ${INPUT_VARIABLE} !== 'object' || Array.isArray(${INPUT_VARIABLE})) {
                ${error.generate('must be an object', { segments: [] }, context)}

                return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
            }

            ${OUTPUT_VARIABLE} = {};

            ${parts}

            if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
            }

            return { ok: true, data: ${OUTPUT_VARIABLE}, errors: undefined };
        }
    `;
};


export { generateValidator };
export type { ConfigValidator, PropertyDefault };
