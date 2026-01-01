import ts from 'typescript';
import type { BrandedValidator } from '../config-parser';
import { analyzeType } from '../type-analyzer';
import { generateValidator, type GeneratorContext } from './generator';


function extractMessages(
    type: ts.Type,
    pathParts: string[],
    messages: Map<string, string>,
    typeChecker: ts.TypeChecker
): void {
    // String literal type - this is a message
    if (type.isStringLiteral()) {
        messages.set(pathParts.join('.'), type.value);
        return;
    }

    // Object type - recurse into properties
    if (type.flags & ts.TypeFlags.Object) {
        let props = typeChecker.getPropertiesOfType(type);

        for (let i = 0, n = props.length; i < n; i++) {
            let prop = props[i],
                propType = typeChecker.getTypeOfSymbol(prop);

            extractMessages(propType, [...pathParts, prop.getName()], messages, typeChecker);
        }
    }
}

function isAsyncValidator(source: string): boolean {
    let trimmed = source.trim();

    // Check for async function declaration
    if (/^async\s/.test(trimmed)) {
        return true;
    }

    // Check for async arrow function
    if (/^\(?async\s/.test(trimmed)) {
        return true;
    }

    // Check for await usage in function body
    if (/\bawait\b/.test(source)) {
        return true;
    }

    return false;
}

function parseErrorMessages(typeNode: ts.TypeNode | undefined, typeChecker: ts.TypeChecker): Map<string, string> {
    let messages = new Map<string, string>();

    if (!typeNode) {
        return messages;
    }

    let type = typeChecker.getTypeAtLocation(typeNode);

    extractMessages(type, [], messages, typeChecker);

    return messages;
}


const transformValidatorBuild = (
    typeArg: ts.TypeNode,
    errorMessagesType: ts.TypeNode | undefined,
    typeChecker: ts.TypeChecker,
    brandValidators: Map<string, BrandedValidator>,
    customValidatorSource?: string
): string => {
    let analyzed = analyzeType(typeArg, typeChecker),
        customMessages = parseErrorMessages(errorMessagesType, typeChecker),
        hasAsync = customValidatorSource ? isAsyncValidator(customValidatorSource) : false;

    let context: GeneratorContext = {
        brandValidators,
        customMessages,
        hasAsync
    };

    return generateValidator(analyzed, context, customValidatorSource);
};


export { transformValidatorBuild };
