import { code } from '@esportsplus/typescript/compiler';
import type { GeneratorContext, PathMode } from './types';


const ERRORS_VARIABLE = '_errors';

// Emitted into the generated code so a runtime record key renders `.key` when it is
// identifier-safe and `["k.ey"]` when it is not. Evaluated on the ERROR path only.
const IDENTIFIER_SAFE_SOURCE = '/^[A-Za-z_$][A-Za-z0-9_$]*$/';


// Renders the segment list into a JS expression. Static runs accumulate into one string
// literal so a fully-static path costs a single literal and no concatenation at runtime.
function resolvePath(mode: PathMode): string {
    let fragments: string[] = [],
        literal = '',
        segments = mode.segments;

    for (let i = 0, n = segments.length; i < n; i++) {
        let first = fragments.length === 0 && literal === '',
            segment = segments[i];

        if (segment.kind === 'key') {
            // Only a DOT makes a static key ambiguous against nesting, so only a dot earns
            // bracket-quoting; every other character renders plainly, as the path always has.
            if (segment.name.includes('.')) {
                literal += `[${JSON.stringify(segment.name)}]`;
            }
            else {
                literal += first ? segment.name : `.${segment.name}`;
            }

            continue;
        }

        if (segment.kind === 'index') {
            literal += '[';

            fragments.push(emitString(literal));
            fragments.push(segment.expr);
            literal = ']';

            continue;
        }

        if (literal !== '') {
            fragments.push(emitString(literal));
            literal = '';
        }

        fragments.push(
            first
                ? `(${IDENTIFIER_SAFE_SOURCE}.test(${segment.expr}) ? ${segment.expr} : '[' + JSON.stringify(${segment.expr}) + ']')`
                : `(${IDENTIFIER_SAFE_SOURCE}.test(${segment.expr}) ? '.' + ${segment.expr} : '[' + JSON.stringify(${segment.expr}) + ']')`
        );
    }

    if (literal !== '') {
        fragments.push(emitString(literal));
    }

    if (fragments.length === 0) {
        return emitString('');
    }

    return fragments.join(' + ');
}


const emitString = (value: string): string => JSON.stringify(value);

const generate = (message: string, pathMode: PathMode, context?: GeneratorContext): string => {
    if (context) {
        message = context.customMessages.get(messageKey(pathMode)) || message;
    }

    return code`
        (${ERRORS_VARIABLE} ??= []).push({
            message: ${emitString(message)},
            path: ${resolvePath(pathMode)}
        });
    `;
};

// The lookup key for a user-supplied message: the dot-joined STATIC property names. A path
// carrying any runtime segment has no compile-time key, so it never matches an entry.
const messageKey = (mode: PathMode): string => {
    let parts: string[] = [],
        segments = mode.segments;

    for (let i = 0, n = segments.length; i < n; i++) {
        let segment = segments[i];

        if (segment.kind !== 'key') {
            return '';
        }

        parts.push(segment.name);
    }

    return parts.join('.');
};


export default { generate };
export { emitString, messageKey, ERRORS_VARIABLE };
