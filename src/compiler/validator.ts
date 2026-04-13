import { code, uid } from '@esportsplus/typescript/compiler';
import type { AnalyzedProperty, AnalyzedType } from './type-analyzer';
import { GeneratorContext, PathMode } from './types';
import error, { ERRORS_VARIABLE } from './error';
import validators from './validators';


type LiteralValue = {
    type: 'boolean' | 'number' | 'string';
    value: boolean | number | string;
};

type TypeValidator = (prop: AnalyzedProperty, varname: string, pathMode: PathMode, context: GeneratorContext) => string;


const INPUT_VARIABLE = '_input';

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
    enum: generateEnumValidation,
    literal: generateLiteralValidation,
    null: generateNullValidation,
    number: generateNumberValidation,
    object: generateObjectValidation,
    record: generateRecordValidation,
    string: generateStringValidation,
    tuple: generateTupleValidation,
    union: generateUnionValidation
};

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;


function booleanCoercionTemplate(varname: string, message: string, pathMode: PathMode, context: GeneratorContext): string {
    return code`
        if (typeof ${varname} !== 'boolean') {
            if (${varname} === 'true' || ${varname} === 1 || ${varname} === '1') {
                ${varname} = true;
            }
            else if (${varname} === 'false' || ${varname} === 0 || ${varname} === '0') {
                ${varname} = false;
            }
            else {
                let _str = String(${varname}).toLowerCase();

                if (_str === 'true' || _str === '1') {
                    ${varname} = true;
                }
                else if (_str === 'false' || _str === '0') {
                    ${varname} = false;
                }
                else {
                    ${error.generate(message, pathMode, context)}
                }
            }
        }
    `;
}

function buildLiteralChecks(varname: string, literals: LiteralValue[]): string[] {
    let checks: string[] = [];

    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i],
            value = String(lit.value);

        checks.push(
            code`${varname} !== ${lit.type === 'string' ? `'${code.escape(value)}'` : value}`
        );
    }

    return checks;
}

function generateArrayValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let e = uid('e'),
        i = uid('i'),
        n = uid('n');

    return code`
        if (${prop.nullable && `${varname} !== null &&`} !Array.isArray(${varname})) {
            ${error.generate('must be an array', pathMode, context)}
        }
        else if (${varname} !== null) {
            let ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

            for (let ${i} = 0, ${n} = ${varname}.length; ${i} < ${n}; ${i}++) {
                ${generateTypeValidation(
                    prop.itemType || { name: 'item', optional: false, type: 'unknown' },
                    `${varname}[${i}]`,
                    {
                        key: i,
                        kind: 'dynamic',
                        path: pathMode.path
                    },
                    context
                )}

                if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                    break;
                }
            }
        }
    `;
}

function generateBigintValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        if (${prop.nullable && `${varname} !== null &&`} typeof ${varname} !== 'bigint') {
            ${error.generate('must be a bigint', pathMode, context)}
        }
    `;
}

function generateBooleanValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        if (${prop.nullable && `${varname} !== null &&`} true) {
            ${booleanCoercionTemplate(varname, 'must be true or false', pathMode, context)}
        }
    `;
}

function generateDateValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return code`
        if (${prop.nullable && `${varname} !== null &&`} (!(${varname} instanceof Date) || isNaN(${varname}.getTime()))) {
            ${error.generate('invalid date type', pathMode, context)}
        }
    `;
}

function generateEnumValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return `
        if (${buildLiteralChecks(varname, prop.literals || []).join(' && ')}) {
            ${error.generate('invalid enum type', pathMode, context)}
        }
    `;
}

function generateLiteralValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let checks = buildLiteralChecks(varname, prop.literals || []);

    if (prop.nullable) {
        checks.unshift(`${varname} !== null`);
    }

    return `
        if (${checks.join(' && ')}) {
            ${error.generate('invalid literal type', pathMode, context)}
        }
    `;
}

function generateNullValidation(
    _: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    return `
        if (${varname} !== null) {
            ${error.generate('invalid null type', pathMode, context)}
        }
    `;
}

function generateNumberValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let parts = '',
        validator = prop.brand ? context.brandValidators.get(prop.brand) : undefined;

    if (validator) {
        parts = validators.inline(validator.body, pathMode, varname);

        if (validator.async) {
            context.hasAsync = true;
        }
    }

    return code`
        if (
            ${prop.nullable && `${varname} !== null &&`}
            (
                ${varname} === null || typeof ${varname} !== 'number' &&
                isNaN(${varname} = +${varname})
                ${prop.brand === 'integer' && ` || ${varname} % 1 !== 0`}
            )
        ) {
            ${error.generate(prop.brand === 'integer' ? 'must be an integer' : 'must be a number', pathMode, context)}
        }
        ${parts && `
            else if (${varname} !== null) {
                ${parts}
            }
        `}
    `;
}

function generateObjectValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let parts: string[] = [],
        path = pathMode.path,
        properties = prop.properties || [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let prop = properties[i];

        if (prop.type === 'never') {
            continue;
        }

        parts.push(
            code`
                ${prop.optional && `if (${propertyAccess(prop.name, varname)} !== undefined) {`}
                    ${generateTypeValidation(
                        prop,
                        propertyAccess(prop.name, varname),
                        { kind: 'static', path: [...path, prop.name] },
                        context
                    )}
                ${prop.optional && `}`}
            `
        );
    }

    return code`
        if (${
            prop.nullable
                ? `${varname} !== null && (typeof ${varname} !== 'object' || Array.isArray(${varname}))`
                : `${varname} === null || typeof ${varname} !== 'object' || Array.isArray(${varname})`
        }) {
            ${error.generate('must be an object', pathMode, context)}
        }
        else if (${prop.nullable && `${varname} !== null &&`} true) {
            ${parts.join('\n')}
        }
    `;
}

function generatePropertyExtraction(properties: AnalyzedProperty[], varname: string): string {
    let parts: string[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let prop = properties[i];

        if (prop.type === 'never') {
            continue;
        }

        let access = propertyAccess(prop.name, varname),
            key = VALID_IDENTIFIER.test(prop.name) && !RESERVED_WORDS.has(prop.name)
                ? prop.name
                : `'${code.escape(prop.name)}'`;

        if (prop.optional) {
            parts.push(`...(${access} !== undefined && { ${key}: ${access} })`);
        }
        else if (prop.type === 'object' && prop.properties) {
            let extraction = generatePropertyExtraction(prop.properties, access);

            if (prop.nullable) {
                parts.push(`${key}: ${access} !== null ? ${extraction} : null`);
            }
            else {
                parts.push(`${key}: ${extraction}`);
            }
        }
        else {
            parts.push(`${key}: ${access}`);
        }
    }

    return `{ ${parts.join(', ')} }`;
}

function generateRecordValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let e = uid('e'),
        indexType = prop.indexType,
        key = uid('key'),
        body = indexType
            ? generateTypeValidation(
                indexType,
                `${varname}[${key}]`,
                { key, kind: 'record', path: pathMode.path },
                context
            )
            : '';

    return code`
        if (${
            prop.nullable
                ? `${varname} !== null && (typeof ${varname} !== 'object' || Array.isArray(${varname}))`
                : `${varname} === null || typeof ${varname} !== 'object' || Array.isArray(${varname})`
        }) {
            ${error.generate('invalid record type', pathMode, context)}
        }
        ${body && `
            else if (${varname} !== null) {
                let ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

                for (let ${key} in ${varname}) {
                    ${body}

                    if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                        break;
                    }
                }
            }
        `}
    `;
}

function generateStringValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let parts = '';

    // Template literal types - just validate as string with special error
    if (prop.brand === 'template') {
    }
    // Check for branded validator
    else if (prop.brand && context.brandValidators.has(prop.brand)) {
        let validator = context.brandValidators.get(prop.brand)!;

        // Track async
        if (validator.async) {
            context.hasAsync = true;
        }

        parts = code`
            else if (${varname} !== null) {
                ${validators.inline(validator.body, pathMode, varname)}
            }
        `;
    }

    return code`
        if (${prop.nullable && `${varname} !== null &&`} typeof ${varname} !== 'string') {
            ${error.generate('must be a string', pathMode, context)}
        }
        ${parts}
    `;
}

function generateTupleValidation(
    prop: AnalyzedProperty,
    varname: string,
    pathMode: PathMode,
    context: GeneratorContext
): string {
    let parts: string[] = [],
        path = pathMode.path,
        requiredCount = 0,
        tupleTypes = prop.tupleTypes || [];

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        if (!tupleTypes[i].optional) {
            requiredCount++;
        }
    }

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        let elementValidation = generateTypeValidation(
            tupleTypes[i],
            `${varname}[${i}]`,
            { kind: 'static', path: [...path, `[${i}]`] },
            context
        );

        if (tupleTypes[i].optional) {
            parts.push(`if (${varname}.length > ${i}) { ${elementValidation} }`);
        }
        else {
            parts.push(elementValidation);
        }
    }

    let lengthCheck = requiredCount === tupleTypes.length
        ? `${varname}.length !== ${tupleTypes.length}`
        : `${varname}.length < ${requiredCount} || ${varname}.length > ${tupleTypes.length}`;

    return `
        if (${prop.nullable ? `${varname} !== null && ` : ''}(!Array.isArray(${varname}) || ${lengthCheck})) {
            ${error.generate('invalid tuple type', pathMode, context)}
        }
        else ${prop.nullable ? `if (${varname} !== null) ` : ''}{
            ${parts.join('\n')}
        }
    `;
}

function generateTypeValidation(prop: AnalyzedProperty, varname: string, pathMode: PathMode, context: GeneratorContext): string {
    return TYPE_VALIDATORS[prop.type]?.(prop, varname, pathMode, context) ?? '';
}

function generateUnionValidation(prop: AnalyzedProperty, varname: string, pathMode: PathMode, context: GeneratorContext): string {
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
            `${varname} === ${lit.type === 'string' ? `'${code.escape(String(lit.value))}'` : String(lit.value)}`
        );
    }

    for (let i = 0, n = unionTypes.length; i < n; i++) {
        let branch = unionTypes[i],
            branchType = branch.type,
            guard: string,
            body = '',
            start = uid('u');

        switch (branchType) {
            case 'array':
            case 'tuple':
                guard = `Array.isArray(${varname})`;
                body = generateTypeValidation({ ...branch, nullable: false }, varname, pathMode, context);
                break;

            case 'bigint':
                guard = `typeof ${varname} === 'bigint'`;
                break;

            case 'boolean':
                guard = `typeof ${varname} === 'boolean'`;
                break;

            case 'date':
                guard = `${varname} instanceof Date`;
                body = generateTypeValidation({ ...branch, nullable: false }, varname, pathMode, context);
                break;

            case 'number':
                guard = `typeof ${varname} === 'number'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, varname, pathMode, context);
                }
                break;

            case 'object':
            case 'record':
                guard = `typeof ${varname} === 'object' && ${varname} !== null && !Array.isArray(${varname})`;
                body = generateTypeValidation({ ...branch, nullable: false }, varname, pathMode, context);
                break;

            case 'string':
                guard = `typeof ${varname} === 'string'`;

                if (branch.brand) {
                    body = generateTypeValidation({ ...branch, nullable: false }, varname, pathMode, context);
                }
                break;

            default:
                continue;
        }

        if (body) {
            branchParts.push(code`
                if (!${ok} && ${guard}) {
                    let ${start} = ${ERRORS_VARIABLE}?.length ?? 0;

                    ${body}

                    if ((${ERRORS_VARIABLE}?.length ?? 0) === ${start}) {
                        ${ok} = true;
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
                }
            `);
        }
    }

    if (literalHits.length > 0) {
        branchParts.unshift(code`
            if (!${ok} && (${literalHits.join(' || ')})) {
                ${ok} = true;
            }
        `);
    }

    return code`
        {
            let ${ok} = ${prop.nullable ? `${varname} === null` : 'false'};

            ${branchParts.join('\n')}

            if (!${ok}) {
                ${error.generate('invalid union type', pathMode, context)}
            }
        }
    `;
}

function propertyAccess(prop: string, varname: string): string {
    if (VALID_IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop)) {
        return `${varname}.${prop}`;
    }

    return `${varname}['${code.escape(prop)}']`;
}


const generateValidator = (type: AnalyzedType, context: GeneratorContext, customValidatorCode?: string): string => {
    let parts: string[] = [],
        properties = type.properties;

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        if (property.type === 'any' || property.type === 'unknown' || property.type === 'never') {
            continue;
        }

        let varname = propertyAccess(property.name, INPUT_VARIABLE);

        parts.push(
            code`
                ${property.optional && `if (${varname} !== undefined) {`}
                    ${generateTypeValidation(property, varname, { kind: 'static', path: [property.name] }, context)}
                ${property.optional && `}`}
            `
        );
    }

    if (customValidatorCode) {
        parts.push(`
            if (!${ERRORS_VARIABLE}) {
                ${customValidatorCode}
            }
        `);
    }

    return `
        ${context.hasAsync ? 'async ' : ''}(${INPUT_VARIABLE}) => {
            let ${ERRORS_VARIABLE};

            ${parts.join('\n')}

            if (${ERRORS_VARIABLE} && ${ERRORS_VARIABLE}.length > 0) {
                return { ok: false, data: ${INPUT_VARIABLE}, errors: ${ERRORS_VARIABLE} };
            }

            return { ok: true, data: ${generatePropertyExtraction(properties, INPUT_VARIABLE)}, errors: undefined };
        }
    `;
};


export { generateValidator };
