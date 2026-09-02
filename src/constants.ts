const PACKAGE_NAME = '@esportsplus/data';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;


function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function escapeRegExp(value: string): string {
    return value.replace(REGEX_ESCAPE, '\\$&');
}


export { compare, escapeRegExp, IDENTIFIER, PACKAGE_NAME };
