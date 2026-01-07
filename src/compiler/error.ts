import { code } from '@esportsplus/typescript/compiler';
import type { GeneratorContext, PathMode } from './types';


const ERRORS_VARIABLE = '_errors';


function resolvePath(mode: PathMode): string {
    if (mode.kind === 'static') {
        if (mode.parts.length === 0) {
            return "''";
        }

        return `'${mode.parts.join('.')}'`;
    }

    return mode.parentParts.length
        ? `'${mode.parentParts.join('.')}[' + ${mode.indexVar} + ']'`
        : `'[' + ${mode.indexVar} + ']'`;
};


const generate = (message: string, pathMode: PathMode, context?: GeneratorContext): string => {
    if (context) {
        message = context.customMessages.get(
            pathMode.kind === 'static' ? pathMode.parts.join('.') : ''
        ) || message;
    }

    return code`
        (${ERRORS_VARIABLE} ??= []).push({
            message: '${code.escape(message)}',
            path: ${resolvePath(pathMode)}
        });
    `;
};


export default { generate };
export { ERRORS_VARIABLE };