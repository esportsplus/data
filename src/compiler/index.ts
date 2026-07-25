import type { ImportIntent, ReplacementIntent, TransformContext } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { ast, imports, uid } from '@esportsplus/typescript/compiler';
import { PACKAGE_NAME } from '../constants';
import { analyzeRootType, analyzeType, type AnalyzedType } from './type-analyzer';
import { NON_STATIC, extractConfig, peelAnnotations } from './json-schema-constraints';
import { default as validators, type BrandedValidator } from './validators';
import { generateJsonSchema } from '../json-schema';
import { generateValidator, type ConfigValidator, type PropertyDefault } from './validator';
import type { Annotations, JsonSchema } from '../types';


type DetectedCall = {
    configArg?: ts.Expression;
    errorMessagesType?: ts.TypeNode;
    method: 'build' | 'toJsonSchema';
    node: ts.CallExpression;
    typeArg: ts.TypeNode;
};


type ParsedConfig = {
    hasAsync: boolean;
    hoisted: string[];
    map?: Map<string, ConfigValidator[]>;
};


const VALIDATOR_ALIASES = 'compiler/validator-aliases';


function extractMessages(type: ts.Type, parts: string[], messages: Map<string, string>, checker: ts.TypeChecker): void {
    if (type.isStringLiteral()) {
        messages.set(parts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let properties = checker.getPropertiesOfType(type);

        for (let i = 0, n = properties.length; i < n; i++) {
            let prop = properties[i];

            extractMessages(checker.getTypeOfSymbol(prop), [...parts, prop.getName()], messages, checker);
        }
    }
}

function isAsyncFunction(node: ts.Expression): boolean {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
            return true;
        }

        return node.body ? ast.test(node.body, ts.isAwaitExpression) : false;
    }

    return false;
}

// Per-property config: parse the ValidatorConfig object literal, hoist each validator
// expression to a module-level const (factory calls run once at module eval), and record
// the hoisted name + AST-derived asyncness so the generator can invoke it per property.
// A raw-function config is the legacy (never-invoked) form kept only for async detection.
function parseConfig(configArg: ts.Expression, analyzed: AnalyzedType, sourceFile: ts.SourceFile): ParsedConfig {
    if (ts.isArrowFunction(configArg) || ts.isFunctionExpression(configArg)) {
        return { hasAsync: isAsyncFunction(configArg), hoisted: [] };
    }

    if (!ts.isObjectLiteralExpression(configArg)) {
        return { hasAsync: false, hoisted: [] };
    }

    let entries = configArg.properties,
        hasAsync = false,
        hoisted: string[] = [],
        map = new Map<string, ConfigValidator[]>(),
        propertyNames = new Set<string>();

    for (let i = 0, n = analyzed.properties.length; i < n; i++) {
        propertyNames.add(analyzed.properties[i].name);
    }

    for (let i = 0, n = entries.length; i < n; i++) {
        let entry = entries[i];

        if (!ts.isPropertyAssignment(entry) || ts.isComputedPropertyName(entry.name)) {
            continue;
        }

        let name = entry.name,
            key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
                ? name.text
                : null;

        if (key === null || !propertyNames.has(key)) {
            continue;
        }

        let expressions = ts.isArrayLiteralExpression(entry.initializer)
                ? entry.initializer.elements
                : [entry.initializer],
            configValidators: ConfigValidator[] = [];

        for (let j = 0, m = expressions.length; j < m; j++) {
            let expression = expressions[j];

            if (ts.isSpreadElement(expression) || ts.isOmittedExpression(expression)) {
                continue;
            }

            let base = peelAnnotations(expression, sourceFile).base,
                async = isAsyncFunction(base),
                variable = uid('v');

            hoisted.push(`const ${variable} = ${base.getText(sourceFile)};`);
            configValidators.push({ async, name: variable });

            if (async) {
                hasAsync = true;
            }
        }

        if (configValidators.length > 0) {
            map.set(key, configValidators);
        }
    }

    return { hasAsync, hoisted, map };
}

function foldAnnotations(annotations: Map<string, Annotations>, constraints: Map<string, JsonSchema>): Map<string, JsonSchema> {
    let folded = new Map<string, JsonSchema>(),
        names = new Set<string>();

    for (let name of constraints.keys()) {
        names.add(name);
    }

    for (let name of annotations.keys()) {
        names.add(name);
    }

    for (let name of names) {
        let annotation = annotations.get(name),
            constraint = constraints.get(name),
            fragment: Record<string, unknown> = {};

        if (annotation?.meta !== undefined) {
            Object.assign(fragment, annotation.meta);
        }

        if (constraint !== undefined) {
            Object.assign(fragment, constraint);
        }

        if (annotation?.description !== undefined) {
            fragment.description = annotation.description;
        }

        if (annotation?.default !== undefined && annotation.default.schema !== NON_STATIC) {
            fragment.default = annotation.default.schema;
        }

        if (Object.keys(fragment).length > 0) {
            folded.set(name, fragment as JsonSchema);
        }
    }

    return folded;
}

function transform(call: DetectedCall, ctx: TransformContext, validators: Map<string, BrandedValidator>): { code: string; hoisted: string[]; schema: string } {
    let analyzed = analyzeType(call.typeArg, ctx.checker),
        messages = new Map<string, string>(),
        root = analyzeRootType(call.typeArg, ctx.checker);

    if (call.errorMessagesType) {
        extractMessages(ctx.checker.getTypeAtLocation(call.errorMessagesType), [], messages, ctx.checker);
    }

    let config = call.configArg
            ? parseConfig(call.configArg, analyzed, ctx.sourceFile)
            : undefined,
        defaults = new Map<string, PropertyDefault>(),
        extracted = call.configArg
            ? extractConfig(call.configArg, root, ctx.sourceFile, ctx.checker)
            : { annotations: new Map<string, Annotations>(), constraints: new Map<string, JsonSchema>() },
        folded = foldAnnotations(extracted.annotations, extracted.constraints),
        hoisted: string[] = config?.hoisted ? [...config.hoisted] : [];

    for (let [name, annotation] of extracted.annotations) {
        if (annotation.default !== undefined) {
            let source = annotation.default.source,
                variable = uid('default');

            hoisted.push(`const ${variable} = ${annotation.default.fresh ? `() => (${source})` : source};`);
            defaults.set(name, { fresh: annotation.default.fresh, name: variable });
        }
    }

    return {
        code: generateValidator(
            analyzed,
            {
                brandValidators: validators,
                customMessages: messages,
                hasAsync: config?.hasAsync ?? false
            },
            config?.map,
            defaults
        ),
        hoisted,
        schema: generateJsonSchema(root, folded.size > 0 ? folded : undefined)
    };
}

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.TypeChecker, node: ts.Node, validatorLocalName: string | undefined): void {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        let expr = node.expression,
            matched = false,
            method: 'build' | 'toJsonSchema' = 'build';

        // Property access: validator.<m><T>() or ns.validator.<m><T>()
        if (ts.isPropertyAccessExpression(expr)) {
            let methodName = expr.name.text;

            if (methodName === 'build' || methodName === 'toJsonSchema') {
                // validator.<m><T>() or aliasedValidator.<m><T>() - matched against the LOCAL binding, alias-aware
                if (ts.isIdentifier(expr.expression)) {
                    if (validatorLocalName !== undefined && imports.includes(checker, expr.expression, PACKAGE_NAME, validatorLocalName)) {
                        matched = true;
                        method = methodName;
                    }
                }
                // ns.validator.<m><T>() - namespace import; verify the base identifier resolves to the package,
                // never the property text (which coincidentally matches an unrelated named import's local name)
                else if (ts.isPropertyAccessExpression(expr.expression)) {
                    let inner = expr.expression;

                    if (inner.name.text === 'validator' && ts.isIdentifier(inner.expression)) {
                        if (imports.includes(checker, inner.expression, PACKAGE_NAME)) {
                            matched = true;
                            method = methodName;
                        }
                    }
                }
            }
        }

        if (matched) {
            let detected: DetectedCall = {
                    method,
                    node,
                    typeArg: node.typeArguments[0]
                };

            if (node.typeArguments.length > 1) {
                detected.errorMessagesType = node.typeArguments[1];
            }

            if (node.arguments.length > 0) {
                detected.configArg = node.arguments[0];
            }

            calls.set(node, detected);
        }
    }

    ts.forEachChild(node, n => visit(calls, checker, n, validatorLocalName));
}


export default {
    patterns: ['.build', '.set', '.toJsonSchema'],
    transform: (ctx: TransformContext) => {
        let found = imports.all(ctx.sourceFile, PACKAGE_NAME);

        if (found.length === 0) {
            return {};
        }

        let aliases = new Map<string, string>();

        for (let i = 0, n = found.length; i < n; i++) {
            for (let [propertyName, localName] of found[i].specifiers) {
                aliases.set(propertyName, localName);
            }
        }

        // Some hosts (e.g. single-plugin test harnesses) omit the coordinator's `root` argument
        // and the `shared` context arrives undefined; the alias map is a courtesy for downstream
        // plugins, never required for this plugin's own detection, so the write is best-effort
        ctx.shared?.set(VALIDATOR_ALIASES, aliases);

        let detected = new Map<ts.CallExpression, DetectedCall>(),
            registrations = validators.collect(ctx.sourceFile, ctx.checker);

        visit(detected, ctx.checker, ctx.sourceFile, aliases.get('validator'));

        if (detected.size === 0 && registrations.nodes.length === 0) {
            return {};
        }

        let brands = registrations.validators,
            builds = new Map<string, string>(),
            hoisted = new Map<string, string>(),
            intents: ImportIntent[] = [],
            prepend: string[] = [],
            remove: string[] = [],
            replacements: ReplacementIntent[] = [];

        for (let [, call] of detected) {
            if (call.method === 'toJsonSchema') {
                let root = analyzeRootType(call.typeArg, ctx.checker),
                    extracted = call.configArg
                        ? extractConfig(call.configArg, root, ctx.sourceFile, ctx.checker)
                        : undefined,
                    folded = extracted
                        ? foldAnnotations(extracted.annotations, extracted.constraints)
                        : undefined,
                    text = generateJsonSchema(root, folded && folded.size > 0 ? folded : undefined),
                    name = hoisted.get(text);

                if (name === undefined) {
                    name = uid('schema');
                    hoisted.set(text, name);
                    prepend.push(`const ${name} = ${text};`);
                }

                let identifier = name;

                replacements.push({
                    generate: () => identifier,
                    node: call.node
                });
            }
            else {
                let configText = call.configArg ? call.configArg.getText(ctx.sourceFile) : '',
                    typeIdentity = ctx.checker.typeToString(ctx.checker.getTypeAtLocation(call.typeArg)),
                    buildKey = JSON.stringify([typeIdentity, configText]),
                    buildName = builds.get(buildKey);

                if (buildName === undefined) {
                    let generated = transform(call, ctx, brands),
                        schemaName = hoisted.get(generated.schema);

                    if (schemaName === undefined) {
                        schemaName = uid('schema');
                        hoisted.set(generated.schema, schemaName);
                        prepend.push(`const ${schemaName} = ${generated.schema};`);
                    }

                    for (let i = 0, n = generated.hoisted.length; i < n; i++) {
                        prepend.push(generated.hoisted[i]);
                    }

                    buildName = uid('build');
                    builds.set(buildKey, buildName);
                    prepend.push(`const ${buildName} = { toJsonSchema: () => ${schemaName}, validate: ${generated.code} };`);
                }

                let identifier = buildName;

                replacements.push({
                    generate: () => identifier,
                    node: call.node
                });
            }

        }

        for (let i = 0, n = registrations.nodes.length; i < n; i++) {
            replacements.push({
                generate: () => '',
                node: registrations.nodes[i]
            });
        }

        // Every validator reference is either replaced (build/toJsonSchema) or removed (set),
        // so the import is always dead once the file is transformed.
        remove.push('validator');

        intents.push({
            package: PACKAGE_NAME,
            remove
        });

        if (prepend.length > 0) {
            return { imports: intents, prepend, replacements };
        }

        return { imports: intents, replacements };
    }
};
