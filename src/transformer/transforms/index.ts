import type { BrandedValidator } from '../config-parser';
import { ts } from '@esportsplus/typescript';
import { analyzeType } from '~/transformer/type-analyzer';
import { generateValidator } from './validator';


const ASYNC_PATTERN = /^\s*\(?async\s|\bawait\b/;


function extractMessages(
    type: ts.Type,
    pathParts: string[],
    messages: Map<string, string>,
    typeChecker: ts.TypeChecker
): void {
    if (type.isStringLiteral()) {
        messages.set(pathParts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let props = typeChecker.getPropertiesOfType(type);

        for (let i = 0, n = props.length; i < n; i++) {
            let prop = props[i],
                propType = typeChecker.getTypeOfSymbol(prop);

            extractMessages(propType, [...pathParts, prop.getName()], messages, typeChecker);
        }
    }
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
            hasAsync: customValidatorSource ? ASYNC_PATTERN.test(customValidatorSource) : false
        },
        customValidatorSource
    );
};


export { transformValidatorBuild };
