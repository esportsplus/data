import { code } from '@esportsplus/typescript/compiler';
import type { GeneratorContext, PathMode } from './types';


const ERRORS_VARIABLE = '_errors';


function resolvePath(mode: PathMode): string {
    let parts = mode.path;

    if (mode.kind === 'static') {
        return emitString(parts.join('.'));
    }

    let key = mode.key;

    if (mode.kind === 'record') {
        return parts.length
            ? `${emitString(`${parts.join('.')}.`)} + ${key}`
            : key;
    }

    return parts.length
        ? `${emitString(`${parts.join('.')}[`)} + ${key} + ${emitString(']')}`
        : `${emitString('[')} + ${key} + ${emitString(']')}`;
}


const emitString = (value: string): string => JSON.stringify(value);

const generate = (message: string, pathMode: PathMode, context?: GeneratorContext): string => {
    if (context) {
        message = context.customMessages.get(
            pathMode.kind === 'static' ? pathMode.path.join('.') : ''
        ) || message;
    }

    return code`
        (${ERRORS_VARIABLE} ??= []).push({
            message: ${emitString(message)},
            path: ${resolvePath(pathMode)}
        });
    `;
};


export default { generate };
export { emitString, ERRORS_VARIABLE };