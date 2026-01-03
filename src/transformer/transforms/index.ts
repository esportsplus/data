import { analyzeType } from '~/transformer/type-analyzer';
import { generateValidator } from './validator';
import type { BrandedValidator } from '../config-parser';
import ts from 'typescript';


const ASYNC_ARROW_REGEX = /^\(?async\s/;

const ASYNC_FUNCTION_REGEX = /^async\s/;

const AWAIT_KEYWORD_REGEX = /\bawait\b/;


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
    if (ASYNC_FUNCTION_REGEX.test(trimmed)) {
        return true;
    }

    // Check for async arrow function
    if (ASYNC_ARROW_REGEX.test(trimmed)) {
        return true;
    }

    // Check for await usage in function body
    if (AWAIT_KEYWORD_REGEX.test(source)) {
        return true;
    }

    return false;
}

function parseErrorMessages(typeNode: ts.TypeNode | undefined, typeChecker: ts.TypeChecker): Map<string, string> {
    let messages = new Map<string, string>();

    if (!typeNode) {
        return messages;
    }

    extractMessages(typeChecker.getTypeAtLocation(typeNode), [], messages, typeChecker);

    return messages;
}


const transformValidatorBuild = (
    typeArg: ts.TypeNode,
    errorMessagesType: ts.TypeNode | undefined,
    typeChecker: ts.TypeChecker,
    brandValidators: Map<string, BrandedValidator>,
    customValidatorSource?: string
): string => {
    return generateValidator(
        analyzeType(typeArg, typeChecker),
        {
            brandValidators,
            customMessages: parseErrorMessages(errorMessagesType, typeChecker),
            hasAsync: customValidatorSource ? isAsyncValidator(customValidatorSource) : false
        },
        customValidatorSource
    );
};


export { transformValidatorBuild };
