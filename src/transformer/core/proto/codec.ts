import ts from 'typescript';
import { analyzeType } from '../type-analyzer';
import { generateDecoder } from './decoder';
import { generateEncoder } from './encoder';
import { analyzeRuntimeNeeds, buildRuntimeHelpers } from './runtime';


const transformCodec = (
    typeArg: ts.TypeNode,
    defaultsArg: ts.Expression | undefined,
    typeChecker: ts.TypeChecker
): string => {
    let analyzed = analyzeType(typeArg, typeChecker),
        defaultsCode = defaultsArg ? defaultsArg.getText() : 'undefined',
        decoderCode = generateDecoder(analyzed),
        encoderCode = generateEncoder(analyzed),
        runtimeHelpers = buildRuntimeHelpers(analyzeRuntimeNeeds(analyzed));

    let defaultsApplication = '',
        propertyNames = analyzed.properties.map(p => p.name);

    if (defaultsArg) {
        let checks = propertyNames.map(name =>
            `if (_result['${name}'] === undefined && _defaults['${name}'] !== undefined) { _result['${name}'] = _defaults['${name}']; }`
        ).join('\n            ');

        defaultsApplication = `
        let _applyDefaults = (_result) => {
            ${checks}
            return _result;
        };`;
    }

    let wrappedDecoder = defaultsArg
        ? `((_buffer) => _applyDefaults(${decoderCode}(_buffer)))`
        : decoderCode;

    return `(() => {
${runtimeHelpers}

    let _defaults = ${defaultsCode};
    ${defaultsApplication}

    return {
        decode: ${wrappedDecoder},
        encode: ${encoderCode}
    };
})()`;
};


export { transformCodec };
