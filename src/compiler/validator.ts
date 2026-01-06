import type { AnalyzedProperty, AnalyzedType } from '~/compiler/type-analyzer';
import { inlineValidatorBody, type BrandedValidator } from './config-parser';
import { uid } from '@esportsplus/typescript/compiler';
import { ERRORS_VARIABLE } from '~/compiler/constants';


type GeneratorContext = {
    brandValidators: Map<string, BrandedValidator>;
    customMessages: Map<string, string>;
    hasAsync: boolean;
};


const RESERVED_WORDS = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield'
]);

const SINGLE_QUOTE_REGEX = /'/g;

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;


function escape(str: string): string {
    return str.replace(SINGLE_QUOTE_REGEX, "\\'");
}

function booleanCoercionTemplate(variable: string, errorMessage: string, path: string): string {
    return `
        if (typeof ${variable} !== 'boolean') {
            if (${variable} === 'true' || ${variable} === 1 || ${variable} === '1') {
                ${variable} = true;
            }
            else if (${variable} === 'false' || ${variable} === 0 || ${variable} === '0') {
                ${variable} = false;
            }
            else {
                let _str = String(${variable}).toLowerCase();

                if (_str === 'true' || _str === '1') {
                    ${variable} = true;
                }
                else if (_str === 'false' || _str === '0') {
                    ${variable} = false;
                }
                else {
                    (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
                }
            }
        }
    `;
}

function generateArrayValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let e = uid('e'),
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'must be an array',
        i = uid('i'),
        itemType = prop.itemType || { name: 'item', optional: false, type: 'unknown' },
        n = uid('n'),
        nullCheck = prop.nullable ? `${variable} !== null && ` : '',
        path = generatePath(pathParts);

    return `
        if (${nullCheck}!Array.isArray(${variable})) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
        else if (${variable} !== null) {
            let ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

            for (let ${i} = 0, ${n} = ${variable}.length; ${i} < ${n}; ${i}++) {
                ${generateItemValidation(
                    itemType,
                    `${variable}[${i}]`,
                    pathParts,
                    i,
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
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'must be a bigint',
        nullCheck = prop.nullable ? `${variable} !== null && ` : '',
        path = generatePath(pathParts);

    return `
        if (${nullCheck}typeof ${variable} !== 'bigint') {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateBooleanValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'must be true or false',
        path = generatePath(pathParts);

    if (prop.nullable) {
        return `
            if (${variable} !== null) {
                ${booleanCoercionTemplate(variable, errorMessage, path)}
            }
        `;
    }

    return booleanCoercionTemplate(variable, errorMessage, path);
}

function generateDateValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid date type',
        nullCheck = prop.nullable ? `${variable} !== null && ` : '',
        path = generatePath(pathParts);

    return `
        if (${nullCheck}(!(${variable} instanceof Date) || isNaN(${variable}.getTime()))) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateEnumValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let checks: string[] = [],
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid enum type',
        literals = prop.literals || [],
        path = generatePath(pathParts);

    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i];

        checks.push(`${variable} !== ${lit.type === 'string' ? `'${escape(String(lit.value))}'` : lit.value}`);
    }

    return `
        if (${checks.join(' && ')}) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateItemValidation(
    itemType: AnalyzedProperty,
    variable: string,
    parentPathParts: string[],
    indexVar: string,
    context: GeneratorContext
): string {
    let dynamicPath = parentPathParts.length
        ? `'${parentPathParts.join('.')}[' + ${indexVar} + ']'`
        : `'[' + ${indexVar} + ']'`;

    switch (itemType.type) {
        case 'any':
        case 'unknown':
            return '';

        case 'array':
            if (itemType.itemType) {
                let e = uid('e'),
                    i = uid('i'),
                    n = uid('n');

                return `
                    if (!Array.isArray(${variable})) {
                        (${ERRORS_VARIABLE} ??= []).push({ message: 'must be an array', path: ${dynamicPath} });
                    }
                    else {
                        let ${e} = ${ERRORS_VARIABLE}?.length ?? 0;

                        for (let ${i} = 0, ${n} = ${variable}.length; ${i} < ${n}; ${i}++) {
                            ${generateItemValidation(
                                itemType.itemType,
                                `${variable}[${i}]`,
                                [...parentPathParts, '[*]'],
                                i,
                                context
                            )}

                            if ((${ERRORS_VARIABLE}?.length ?? 0) > ${e}) {
                                break;
                            }
                        }
                    }
                `;
            }

            return '';

        case 'bigint':
            return `
                if (typeof ${variable} !== 'bigint') {
                    (${ERRORS_VARIABLE} ??= []).push({ message: 'must be a bigint', path: ${dynamicPath} });
                }
            `;

        case 'boolean':
            return booleanCoercionTemplate(variable, 'must be true or false', dynamicPath);

        case 'date':
            return `
                if (!(${variable} instanceof Date) || isNaN(${variable}.getTime())) {
                    (${ERRORS_VARIABLE} ??= []).push({ message: 'invalid date type', path: ${dynamicPath} });
                }
            `;

        case 'enum':
        case 'literal': {
            let checks: string[] = [],
                literals = itemType.literals || [];

            for (let i = 0, n = literals.length; i < n; i++) {
                let lit = literals[i];

                checks.push(`${variable} !== ${lit.type === 'string' ? `'${escape(String(lit.value))}'` : lit.value}`);
            }

            let errorMsg = itemType.type === 'enum' ? 'invalid enum type' : 'invalid literal type';

            return `
                if (${checks.join(' && ')}) {
                    (${ERRORS_VARIABLE} ??= []).push({ message: '${errorMsg}', path: ${dynamicPath} });
                }
            `;
        }

        case 'null':
            return `
                if (${variable} !== null) {
                    (${ERRORS_VARIABLE} ??= []).push({ message: 'invalid null type', path: ${dynamicPath} });
                }
            `;

        case 'number':
            if (itemType.brand === 'integer') {
                return `
                    if ((typeof ${variable} !== 'number' && isNaN(${variable} = +${variable})) || ${variable} % 1 !== 0) {
                        (${ERRORS_VARIABLE} ??= []).push({ message: 'must be an integer', path: ${dynamicPath} });
                    }
                `;
            }

            return `
                if (typeof ${variable} !== 'number' && isNaN(${variable} = +${variable})) {
                    (${ERRORS_VARIABLE} ??= []).push({ message: 'must be a number', path: ${dynamicPath} });
                }
            `;

        case 'object':
            return generateObjectValidation(
                itemType,
                variable,
                parentPathParts,
                context,
                true
            );

        case 'string':
            return `
                if (typeof ${variable} !== 'string') {
                    (${ERRORS_VARIABLE} ??= []).push({ message: 'must be a string', path: ${dynamicPath} });
                }
            `;

        case 'union':
            return generateUnionValidation(itemType, variable, parentPathParts, context);

        default:
            return '';
    }
}

function generateLiteralValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let checks: string[] = [],
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid literal type',
        literals = prop.literals || [],
        path = generatePath(pathParts);

    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i];

        checks.push(`${variable} !== ${lit.type === 'string' ? `'${escape(String(lit.value))}'` : lit.value}`);
    }

    // Handle nullable
    if (prop.nullable) {
        checks.unshift(`${variable} !== null`);
    }

    return `
        if (${checks.join(' && ')}) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateNullValidation(
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid null type',
        path = generatePath(pathParts);

    return `
        if (${variable} !== null) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateNumberValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let isInteger = prop.brand === 'integer',
        defaultMessage = isInteger ? 'must be an integer' : 'must be a number',
        errorMessage = context.customMessages.get(pathParts.join('.')) || defaultMessage,
        integerCheck = isInteger ? ` || ${variable} % 1 !== 0` : '',
        nullCheck = prop.nullable ? `${variable} !== null && ` : '',
        path = generatePath(pathParts);

    // Check for branded validator
    let inlinedBody = '',
        validator = prop.brand ? context.brandValidators.get(prop.brand) : undefined;

    if (validator) {
        inlinedBody = inlineValidatorBody(validator.body, variable, path);

        if (validator.async) {
            context.hasAsync = true;
        }
    }

    let baseCheck = `${nullCheck}(typeof ${variable} !== 'number' && isNaN(${variable} = +${variable})${integerCheck})`;

    if (inlinedBody) {
        return `
            if (${baseCheck}) {
                (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
            }
            else if (${variable} !== null) {
                ${inlinedBody}
            }
        `;
    }

    return `
        if (${baseCheck}) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function generateObjectValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext,
    isDynamic: boolean = false
): string {
    let codeParts: string[] = [],
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'must be an object',
        path = isDynamic
            ? (pathParts.length ? `'${pathParts.join('.')}'` : "''")
            : generatePath(pathParts),
        properties = prop.properties || [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let p = properties[i];

        // Skip never properties entirely
        if (p.type === 'never') {
            continue;
        }

        let propVar = propertyAccess(p.name, variable),
            propPathParts = [...pathParts, p.name];

        let code = generateTypeValidation(p, propVar, propPathParts, context);

        if (p.optional) {
            codeParts.push(`
                if (${propVar} !== undefined) {
                    ${code}
                }
            `);
        }
        else {
            codeParts.push(code);
        }
    }

    // Optimized object check - handle nullable
    if (prop.nullable) {
        return `
            if (${variable} !== null && (typeof ${variable} !== 'object' || Array.isArray(${variable}))) {
                (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
            }
            else if (${variable} !== null) {
                ${codeParts.join('\n')}
            }
        `;
    }

    return `
        if (${variable} === null || typeof ${variable} !== 'object' || Array.isArray(${variable})) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
        else {
            ${codeParts.join('\n')}
        }
    `;
}

function generatePath(pathParts: string[]): string {
    if (pathParts.length === 0) {
        return "''";
    }

    return `'${pathParts.join('.')}'`;
}

function generatePropertyExtraction(
    properties: AnalyzedProperty[],
    variable: string
): string {
    let parts: string[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let prop = properties[i];

        if (prop.type === 'never') {
            continue;
        }

        let access = propertyAccess(prop.name, variable),
            key = VALID_IDENTIFIER.test(prop.name) && !RESERVED_WORDS.has(prop.name)
                ? prop.name
                : `'${escape(prop.name)}'`;

        if (prop.optional) {
            parts.push(`...(${access} !== undefined && { ${key}: ${access} })`);
        }
        else if (prop.type === 'object' && prop.properties) {
            parts.push(`${key}: ${generatePropertyExtraction(prop.properties, access)}`);
        }
        else {
            parts.push(`${key}: ${access}`);
        }
    }

    return `{ ${parts.join(', ')} }`;
}

function generateRecordValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid record type',
        indexType = prop.indexType,
        key = uid('key'),
        path = generatePath(pathParts);

    if (!indexType) {
        return `
            if (${variable} === null || typeof ${variable} !== 'object' || Array.isArray(${variable})) {
                (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
            }
        `;
    }

    let valueCheck = '';

    switch (indexType.type) {
        case 'boolean':
            valueCheck = `typeof ${variable}[${key}] !== 'boolean'`;
            break;
        case 'number':
            valueCheck = `typeof ${variable}[${key}] !== 'number'`;
            break;
        case 'string':
            valueCheck = `typeof ${variable}[${key}] !== 'string'`;
            break;
        default:
            valueCheck = 'false';
    }

    return `
        if (${variable} === null || typeof ${variable} !== 'object' || Array.isArray(${variable})) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
        else {
            for (let ${key} in ${variable}) {
                if (${valueCheck}) {
                    (${ERRORS_VARIABLE} ??= []).push({
                        message: '${
                            indexType.type === 'boolean'
                                ? 'must be a boolean'
                                : indexType.type === 'number'
                                    ? 'must be a number'
                                    : indexType.type === 'string'
                                        ? 'must be a string'
                                        : 'invalid value'
                        }',
                        path: ${pathParts.length ? `'${pathParts.join('.')}.' + ` : ''}${key}
                    });
                    break;
                }
            }
        }
    `;
}

function generateStringValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let nullCheck = prop.nullable ? `${variable} !== null && ` : '',
        path = generatePath(pathParts);

    // Template literal types - just validate as string with special error
    if (prop.brand === 'template') {
        let errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid template type';

        return `
            if (${nullCheck}typeof ${variable} !== 'string') {
                (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
            }
        `;
    }

    let errorMessage = context.customMessages.get(pathParts.join('.')) || 'must be a string';

    let baseCheck = `
        if (${nullCheck}typeof ${variable} !== 'string') {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;

    // Check for branded validator
    if (prop.brand && context.brandValidators.has(prop.brand)) {
        let validator = context.brandValidators.get(prop.brand)!,
            inlinedBody = inlineValidatorBody(validator.body, variable, path);

        // Track async
        if (validator.async) {
            context.hasAsync = true;
        }

        return `
            if (${nullCheck}typeof ${variable} !== 'string') {
                (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
            }
            else if (${variable} !== null) {
                ${inlinedBody}
            }
        `;
    }

    return baseCheck;
}

function generateTupleValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let codeParts: string[] = [],
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid tuple type',
        path = generatePath(pathParts),
        tupleTypes = prop.tupleTypes || [];

    for (let i = 0, n = tupleTypes.length; i < n; i++) {
        let elemType = tupleTypes[i],
            elemPathParts = [...pathParts, `[${i}]`],
            elemVar = `${variable}[${i}]`;

        codeParts.push(generateTypeValidation(elemType, elemVar, elemPathParts, context));
    }

    return `
        if (!Array.isArray(${variable}) || ${variable}.length !== ${tupleTypes.length}) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
        else {
            ${codeParts.join('\n')}
        }
    `;
}

function generateTypeValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    switch (prop.type) {
        case 'any':
        case 'never':
        case 'unknown':
            return '';

        case 'array':
            return generateArrayValidation(prop, variable, pathParts, context);

        case 'bigint':
            return generateBigintValidation(prop, variable, pathParts, context);

        case 'boolean':
            return generateBooleanValidation(prop, variable, pathParts, context);

        case 'date':
            return generateDateValidation(prop, variable, pathParts, context);

        case 'enum':
            return generateEnumValidation(prop, variable, pathParts, context);

        case 'literal':
            return generateLiteralValidation(prop, variable, pathParts, context);

        case 'null':
            return generateNullValidation(variable, pathParts, context);

        case 'number':
            return generateNumberValidation(prop, variable, pathParts, context);

        case 'object':
            return generateObjectValidation(prop, variable, pathParts, context);

        case 'record':
            return generateRecordValidation(prop, variable, pathParts, context);

        case 'string':
            return generateStringValidation(prop, variable, pathParts, context);

        case 'tuple':
            return generateTupleValidation(prop, variable, pathParts, context);

        case 'union':
            return generateUnionValidation(prop, variable, pathParts, context);

        default:
            return '';
    }
}

function generateUnionValidation(
    prop: AnalyzedProperty,
    variable: string,
    pathParts: string[],
    context: GeneratorContext
): string {
    let checks: string[] = [],
        errorMessage = context.customMessages.get(pathParts.join('.')) || 'invalid union type',
        literals = prop.literals || [],
        path = generatePath(pathParts),
        unionTypes = prop.unionTypes || [];

    // Handle nullable first
    if (prop.nullable) {
        checks.push(`${variable} !== null`);
    }

    // Add literal checks
    for (let i = 0, n = literals.length; i < n; i++) {
        let lit = literals[i];

        checks.push(`${variable} !== ${lit.type === 'string' ? `'${escape(String(lit.value))}'` : lit.value}`);
    }

    // Add type checks
    for (let i = 0, n = unionTypes.length; i < n; i++) {
        let ut = unionTypes[i];

        switch (ut.type) {
            case 'boolean':
                checks.push(`typeof ${variable} !== 'boolean'`);
                break;
            case 'date':
                checks.push(`!(${variable} instanceof Date)`);
                break;
            case 'number':
                checks.push(`typeof ${variable} !== 'number'`);
                break;
            case 'string':
                checks.push(`typeof ${variable} !== 'string'`);
                break;
            case 'object':
                checks.push(`(typeof ${variable} !== 'object' || ${variable} === null || Array.isArray(${variable}))`);
                break;
            case 'array':
                checks.push(`!Array.isArray(${variable})`);
                break;
        }
    }

    if (checks.length === 0) {
        return '';
    }

    return `
        if (${checks.join(' && ')}) {
            (${ERRORS_VARIABLE} ??= []).push({ message: '${escape(errorMessage)}', path: ${path} });
        }
    `;
}

function propertyAccess(prop: string, variable: string): string {
    if (VALID_IDENTIFIER.test(prop) && !RESERVED_WORDS.has(prop)) {
        return `${variable}.${prop}`;
    }

    return `${variable}['${escape(prop)}']`;
}


const generateValidator = (
    type: AnalyzedType,
    context: GeneratorContext,
    customValidatorCode?: string
): string => {
    let codeParts: string[] = [],
        properties = type.properties;

    for (let i = 0, n = properties.length; i < n; i++) {
        let property = properties[i];

        // Skip any/unknown/never at root level
        if (property.type === 'any' || property.type === 'unknown' || property.type === 'never') {
            continue;
        }

        let variable = propertyAccess(property.name, '_input');

        if (property.optional) {
            codeParts.push(`
                if (${variable} !== undefined) {
                    ${generateTypeValidation(property, variable, [property.name], context)}
                }
            `);
        }
        else {
            codeParts.push(generateTypeValidation(property, variable, [property.name], context));
        }
    }

    if (customValidatorCode) {
        codeParts.push(`
            if (!${ERRORS_VARIABLE}) {
                ${customValidatorCode}
            }
        `);
    }

    return `
        ${context.hasAsync ? 'async ' : ''}(_input) => {
            let ${ERRORS_VARIABLE};

            ${codeParts.join('\n')}

            if (${ERRORS_VARIABLE}) {
                return { ok: false, data: _input, errors: ${ERRORS_VARIABLE} };
            }

            return { ok: true, data: ${generatePropertyExtraction(properties, '_input')}, errors: undefined };
        }
    `;
};


export { generateValidator };
