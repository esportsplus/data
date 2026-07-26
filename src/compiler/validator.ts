import { code, uid } from '@esportsplus/typescript/compiler';
import type { AnalyzedProperty, AnalyzedType } from './type-analyzer';
import { GeneratorContext, PathMode } from './types';
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

type TypeValidator = (prop: AnalyzedProperty, source: string, target: string, pathMode: PathMode, context: GeneratorContext) => string;


const CONFIG_VARIABLE = '_config';

const INPUT_VARIABLE = '_input';

const OUTPUT_VARIABLE = '_output';

const PROTO_KEY = '__proto__';

// Decimal / scientific notation only (README:704) - no hex, no empty string, no
// whitespace-only. Booleans, arrays, objects and '' are type errors, not coercions.
const NUMBER_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

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

function propertyAccess(prop: string, varname: string): string {
    if (VALID_IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop)) {
        return `${varname}.${prop}`;
    }

    return `${varname}[${emitString(prop)}]`;
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
    let root = type.root;

    // Non-object roots (primitive, array, tuple, record, union, ...) validate `_input`
    // into a fresh `_output` - input is never written, coercion lands in the result.
    if (root.type !== 'object') {
        return `
            ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
                let ${ERRORS_VARIABLE},
                    ${OUTPUT_VARIABLE};

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
