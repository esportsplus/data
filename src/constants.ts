const PACKAGE_NAME = '@esportsplus/data';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// Tail of every error a compile-only validator stub throws. The build rejects any chunk still
// containing it: compiled output never calls the stubs, so a bundle only keeps them when some
// module reached validator without being compiled.
const UNCOMPILED = 'must be transformed at compile-time. Ensure the validation plugin is configured in your build tool.';


function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function escapeRegExp(value: string): string {
    return value.replace(REGEX_ESCAPE, '\\$&');
}


export { compare, escapeRegExp, IDENTIFIER, PACKAGE_NAME, UNCOMPILED };
