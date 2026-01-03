import { analyzeRuntimeNeeds, buildRuntimeHelpers } from './runtime';
import { analyzeType } from '~/transformer/type-analyzer';
import { generateDecoder } from './decoder';
import { generateEncoder } from './encoder';
import ts from 'typescript';


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
            ).join('\n');

        defaultsApplication = `
            let _applyDefaults = (_result) => {
                ${checks}
                return _result;
            };
        `;
    }

    return `
        (() => {
            ${runtimeHelpers}

            let _defaults = ${defaultsCode};
            ${defaultsApplication}

            return {
                decode: ${
                    defaultsArg
                        ? `((_buffer) => _applyDefaults(${decoderCode}(_buffer)))`
                        : decoderCode
                },
                encode: ${encoderCode}
            };
        })()
    `;
};


export { transformCodec };
