import { ts } from '@esportsplus/typescript';
import { analyzeType } from '~/transformer/type-analyzer';
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

    let defaultsApplication = '';

    if (defaultsArg) {
        let checks = '',
            properties = analyzed.properties;

        for (let i = 0, n = properties.length; i < n; i++) {
            let name = properties[i].name;

            checks += `if (_result['${name}'] === undefined && _defaults['${name}'] !== undefined) { _result['${name}'] = _defaults['${name}']; }\n`;
        }

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
