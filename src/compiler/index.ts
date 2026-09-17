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


type Survivor = {
    column: number;
    line: number;
    method: 'build' | 'set' | 'toJsonSchema';
    node: ts.CallExpression;
};


function extractMessages(type: ts.Type, parts: string[], messages: Map<string, string>, checker: ts.Checker): void {
    if (type.isStringLiteralType()) {
        messages.set(parts.join('.'), type.value);
        return;
    }

    if (type.flags & ts.TypeFlags.Object) {
        let properties = checker.getPropertiesOfType(type);

        for (let i = 0, n = properties.length; i < n; i++) {
            let prop = properties[i],
                propType = checker.getTypeOfSymbol(prop);

            // Custom messages are cosmetic overrides - an unresolvable member contributes no
            // message and the generated validator falls back to its default text.
            if (propType !== undefined) {
                extractMessages(propType, [...parts, prop.name], messages, checker);
            }
        }
    }
}

function isAsyncExpression(node: ts.Expression, checker: ts.Checker): boolean {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
            return true;
        }

        if (node.body && ast.test(node.body, ts.isAwaitExpression)) {
            return true;
        }
    }

    // Inline syntax is not the only source of asyncness: an identifier bound to an async
    // function (or any callable whose declared return is a Promise) must be awaited too.
    // Classify from the call signature's return type so the misdetection cannot recur.
    let type = checker.getTypeAtLocation(node);

    if (type === undefined) {
        return false;
    }

    let signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);

    if (signatures.length === 0) {
        return false;
    }

    let returnType = checker.getReturnTypeOfSignature(signatures[0]);

    return returnType !== undefined && isPromiseType(returnType, checker);
}

function isPromiseType(type: ts.Type, checker: ts.Checker): boolean {
    if (type.isUnionType()) {
        let constituents = type.getTypes(),
            hasPromise = false;

        for (let i = 0, n = constituents.length; i < n; i++) {
            let constituent = constituents[i];

            if (isVoidLike(constituent)) {
                continue;
            }

            if (isPromiseType(constituent, checker)) {
                hasPromise = true;

                continue;
            }

            // A union that also admits a non-Promise value (e.g. Transformer<T>'s `T | Promise<T>`)
            // is not definitely async, so it must not force `await` + an `async` wrapper.
            return false;
        }

        return hasPromise;
    }

    let symbol = type.getSymbol();

    return symbol !== undefined && symbol.name === 'Promise';
}

// A config entry is a transformer when its declared return type carries a value the compiler
// must assign back to the slot. Classify by the first call signature's return type: unwrap a
// `Promise<X>` wrapper, then treat a return whose every (union) constituent is void/undefined/never
// as an assertion. Anything else (a real value, `unknown`, an inferred inline-arrow body) is a
// transformer. An unresolved callee (no type, no signature) degrades to an assertion.
function isTransformer(base: ts.Expression, checker: ts.Checker): boolean {
    let type = checker.getTypeAtLocation(base);

    if (type === undefined) {
        return false;
    }

    let signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);

    if (signatures.length === 0) {
        return false;
    }

    let returnType = checker.getReturnTypeOfSignature(signatures[0]);

    if (returnType === undefined) {
        return false;
    }

    let constituents = returnType.isUnionType() ? returnType.getTypes() : [returnType];

    for (let i = 0, n = constituents.length; i < n; i++) {
        if (!isVoidLike(unwrapPromise(constituents[i], checker))) {
            return true;
        }
    }

    return false;
}

function isVoidLike(type: ts.Type): boolean {
    return (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) !== 0;
}

function unwrapPromise(type: ts.Type, checker: ts.Checker): ts.Type {
    let symbol = type.getSymbol();

    if (symbol !== undefined && symbol.name === 'Promise' && type.isTypeReference()) {
        let args = checker.getTypeArguments(type);

        if (args.length > 0) {
            return args[0];
        }
    }

    return type;
}

// `imports.includes` resolves LOCAL BINDINGS built from named specifiers only, so a namespace
// import (`import * as data from '@esportsplus/data'`) contributes no name and can never match
// through it. Resolve that binding here so ns.validator.<m><T>() is detected, while still keying
// off the base identifier's own import binding rather than text coincidence with a named import.
function namespaceLocalName(sourceFile: ts.SourceFile): string | undefined {
    let statements = sourceFile.statements;

    for (let i = 0, n = statements.length; i < n; i++) {
        let statement = statements[i];

        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }

        if (statement.moduleSpecifier.text !== PACKAGE_NAME) {
            continue;
        }

        let bindings = statement.importClause?.namedBindings;

        if (bindings && ts.isNamespaceImport(bindings)) {
            return bindings.name.text;
        }
    }

    return undefined;
}

// A config expression is hoisted to module scope, which is only sound when it neither
// references a function-local binding (invisible there) nor - for an eagerly-evaluated
// expression - a module lexical declared after the hoist point (TDZ). `checkConfigScope`
// refuses to emit rather than silently produce a module-level reference that cannot resolve.
type HoistReference = {
    eager: boolean;
    node: ts.Identifier;
};

function checkConfigScope(expr: ts.Expression, sourceFile: ts.SourceFile, checker: ts.Checker, hoisting: boolean): void {
    let start = expr.getStart(sourceFile),
        end = expr.getEnd(),
        references: HoistReference[] = [];

    collectHoistReferences(expr, true, references);

    for (let i = 0, n = references.length; i < n; i++) {
        let reference = references[i],
            symbol = checker.getSymbolAtLocation(reference.node);

        if (symbol === undefined) {
            continue;
        }

        let declarations = symbol.declarations;

        for (let j = 0, m = declarations.length; j < m; j++) {
            let declaration = declarations[j].resolve();

            if (declaration === undefined) {
                continue;
            }

            let position = sourceFile.getLineAndCharacterOfPosition(reference.node.getStart());

            // Bound inside the config expression itself (an arrow parameter, say) - safe.
            if (declaration.getStart(sourceFile) >= start && declaration.getEnd() <= end) {
                continue;
            }

            if (hasFunctionAncestor(declaration)) {
                throw new Error(
                    `${PACKAGE_NAME}: validator config references the function-local binding '${reference.node.text}' ` +
                    `at ${sourceFile.fileName}:${position.line + 1}:${position.character + 1} - move the build to module scope or lift the binding to module scope`
                );
            }

            if (hoisting && reference.eager && isLexicalDeclaration(declaration)) {
                throw new Error(
                    `${PACKAGE_NAME}: validator config references '${reference.node.text}' before its initialization ` +
                    `at ${sourceFile.fileName}:${position.line + 1}:${position.character + 1} - the config factory is hoisted above this declaration`
                );
            }
        }
    }
}

// Walk only value references: property names, property-access member names and the contents
// of nested functions (which run later) are excluded or marked non-eager.
function collectHoistReferences(node: ts.Node, eager: boolean, out: HoistReference[]): void {
    if (ts.isIdentifier(node)) {
        out.push({ eager, node });

        return;
    }

    if (ts.isPropertyAccessExpression(node)) {
        collectHoistReferences(node.expression, eager, out);

        return;
    }

    if (ts.isPropertyAssignment(node)) {
        if (ts.isComputedPropertyName(node.name)) {
            collectHoistReferences(node.name.expression, eager, out);
        }

        collectHoistReferences(node.initializer, eager, out);

        return;
    }

    if (ts.isShorthandPropertyAssignment(node)) {
        if (ts.isIdentifier(node.name)) {
            out.push({ eager, node: node.name });
        }

        return;
    }

    // A function value is created eagerly, but its body and parameter defaults run later:
    // references there are not subject to the TDZ, though a function-local binding from the
    // enclosing scope is still invisible to the hoisted closure.
    if (ts.isFunctionLikeDeclaration(node)) {
        node.forEachChild((child) => collectHoistReferences(child, false, out));

        return;
    }

    node.forEachChild((child) => collectHoistReferences(child, eager, out));
}

function computedPropertyKey(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }

    if (ts.isComputedPropertyName(name)) {
        let expr = name.expression;

        if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isNumericLiteral(expr)) {
            return expr.text;
        }
    }

    return null;
}

function hasFunctionAncestor(node: ts.Node): boolean {
    let current: ts.Node | undefined = node.parent;

    while (current !== undefined && !ts.isSourceFile(current)) {
        if (ts.isFunctionLikeDeclaration(current)) {
            return true;
        }

        current = current.parent;
    }

    return false;
}

function isLexicalDeclaration(node: ts.Node): boolean {
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
        return (node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using)) !== 0;
    }

    // A class or (non-const) enum emits a lexical/IIFE initializer that runs in statement
    // order; a hoisted config that reads it eagerly sees it uninitialized.
    return ts.isClassDeclaration(node) || ts.isEnumDeclaration(node);
}

// A bare identifier or dot-property chain evaluates to the same value at module scope and at
// validation time, so it is referenced in place instead of being hoisted (which would read a
// module lexical in its TDZ). Anything else is a factory call/arrow and is hoisted.
function isStableReference(expr: ts.Expression): boolean {
    if (ts.isIdentifier(expr)) {
        return true;
    }

    if (ts.isPropertyAccessExpression(expr)) {
        return isStableReference(expr.expression);
    }

    return false;
}

// Per-property config: parse the ValidatorConfig object literal, hoist each validator
// expression to a module-level const (factory calls run once at module eval), and record
// the hoisted name + AST-derived asyncness so the generator can invoke it per property.
// A stable reference is instead used in place. Unsupported forms (a non-object config, a
// spread, a dynamic computed key) are compile errors - never a silently dropped config.
function parseConfig(configArg: ts.Expression, analyzed: AnalyzedType, sourceFile: ts.SourceFile, checker: ts.Checker): ParsedConfig {
    if (!ts.isObjectLiteralExpression(configArg)) {
        throw new Error(`${PACKAGE_NAME}: validator config must be an inline object literal at ${sourceFile.fileName}; a variable, spread or function argument is not supported`);
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

        if (ts.isSpreadAssignment(entry)) {
            throw new Error(`${PACKAGE_NAME}: validator config spread properties are not supported in ${sourceFile.fileName}; list each property explicitly`);
        }

        let key: string | null = null,
            initializer: ts.Expression,
            direct = false;

        if (ts.isShorthandPropertyAssignment(entry)) {
            if (!ts.isIdentifier(entry.name)) {
                throw new Error(`${PACKAGE_NAME}: validator config shorthand key is not an identifier at ${sourceFile.fileName}`);
            }

            key = entry.name.text;
            initializer = entry.name;
            direct = true;
        }
        else if (ts.isPropertyAssignment(entry)) {
            key = computedPropertyKey(entry.name);
            initializer = entry.initializer;

            if (key === null) {
                throw new Error(`${PACKAGE_NAME}: validator config computed key must be a static string at ${sourceFile.fileName}`);
            }
        }
        else {
            throw new Error(`${PACKAGE_NAME}: validator config entries must be property assignments at ${sourceFile.fileName}`);
        }

        if (key === null || !propertyNames.has(key)) {
            continue;
        }

        let assertions: ConfigValidator[] = [],
            expressions = ts.isArrayLiteralExpression(initializer)
                ? initializer.elements
                : [initializer],
            transformers: ConfigValidator[] = [];

        for (let j = 0, m = expressions.length; j < m; j++) {
            let expression = expressions[j];

            if (ts.isSpreadElement(expression) || ts.isOmittedExpression(expression)) {
                throw new Error(`${PACKAGE_NAME}: validator config arrays do not support spread or omitted elements at ${sourceFile.fileName}`);
            }

            let base = peelAnnotations(expression, sourceFile).base,
                name: string;

            if (direct || isStableReference(base)) {
                checkConfigScope(base, sourceFile, checker, false);
                name = base.getText(sourceFile);
            }
            else {
                checkConfigScope(base, sourceFile, checker, true);

                let variable = uid('v');

                hoisted.push(`const ${variable} = ${base.getText(sourceFile)};`);
                name = variable;
            }

            let async = isAsyncExpression(base, checker),
                transform = isTransformer(base, checker);

            (transform ? transformers : assertions).push({ async, name, transform });

            if (async) {
                hasAsync = true;
            }
        }

        // Every transformer runs before every assertion regardless of authored order, so a later
        // assertion validates the replaced value; source order is preserved within each group.
        let configValidators = [...transformers, ...assertions];

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
        let messagesType = ctx.checker.getTypeAtLocation(call.errorMessagesType);

        if (messagesType !== undefined) {
            extractMessages(messagesType, [], messages, ctx.checker);
        }
    }

    let config = call.configArg
            ? parseConfig(call.configArg, analyzed, ctx.sourceFile, ctx.checker)
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

function visit(calls: Map<ts.CallExpression, DetectedCall>, checker: ts.Checker, node: ts.Node, validatorLocalName: string | undefined, namespaceName: string | undefined): void {
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
                        if (namespaceName !== undefined && inner.expression.text === namespaceName) {
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

    node.forEachChild(n => visit(calls, checker, n, validatorLocalName, namespaceName));
}

// Self-assertion scanner: a "survivor" is a consumable call site - validator.<build|set|toJsonSchema>()
// reached through the package's own binding (plain, aliased, or namespace form) - that the transform
// did NOT consume (e.g. a build/toJsonSchema call missing its type argument, or an unregistered set).
// The base-binding check mirrors visit()/validators.collect() exactly, so anything those intentionally
// leave (namespace-only access, non-package look-alikes) is never flagged; only genuinely-missed sites
// that would otherwise ship dead config and throw from the runtime stub at call time.
function collectSurvivors(node: ts.Node, sourceFile: ts.SourceFile, checker: ts.Checker, validatorLocalName: string | undefined, namespaceName: string | undefined, consumed: Set<ts.Node>, survivors: Survivor[]): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        let expr = node.expression,
            matched = false,
            method = expr.name.text;

        if (method === 'build' || method === 'set' || method === 'toJsonSchema') {
            if (ts.isIdentifier(expr.expression)) {
                if (validatorLocalName !== undefined && imports.includes(checker, expr.expression, PACKAGE_NAME, validatorLocalName)) {
                    matched = true;
                }
            }
            else if (ts.isPropertyAccessExpression(expr.expression)) {
                let inner = expr.expression;

                if (inner.name.text === 'validator' && ts.isIdentifier(inner.expression) && namespaceName !== undefined && inner.expression.text === namespaceName) {
                    matched = true;
                }
            }

            if (matched && !consumed.has(node)) {
                let position = sourceFile.getLineAndCharacterOfPosition(node.getStart());

                survivors.push({
                    column: position.character + 1,
                    line: position.line + 1,
                    method,
                    node
                });
            }
        }
    }

    node.forEachChild(child => collectSurvivors(child, sourceFile, checker, validatorLocalName, namespaceName, consumed, survivors));
}


const findUntransformed = (sourceFile: ts.SourceFile, checker: ts.Checker, validatorLocalName: string | undefined, namespaceName: string | undefined, consumed: Set<ts.Node>): Survivor[] => {
    let survivors: Survivor[] = [];

    collectSurvivors(sourceFile, sourceFile, checker, validatorLocalName, namespaceName, consumed, survivors);

    return survivors;
};


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

        let detected = new Map<ts.CallExpression, DetectedCall>(),
            namespaceName = namespaceLocalName(ctx.sourceFile),
            registrations = validators.collect(ctx.sourceFile, ctx.checker);

        visit(detected, ctx.checker, ctx.sourceFile, aliases.get('validator'), namespaceName);

        // Self-assertion: every consumable call site reached through the package binding must have been
        // consumed above. A survivor means visit()/collect() silently missed it - fail the BUILD naming
        // file:line:col instead of shipping a call the runtime stub throws on (C9-class hardening).
        let consumed = new Set<ts.Node>(detected.keys());

        for (let i = 0, n = registrations.nodes.length; i < n; i++) {
            consumed.add(registrations.nodes[i].expression);
        }

        let survivors = findUntransformed(ctx.sourceFile, ctx.checker, aliases.get('validator'), namespaceName, consumed);

        if (survivors.length > 0) {
            let survivor = survivors[0];

            throw new Error(
                `${PACKAGE_NAME}: untransformed ${survivor.method} call at ${ctx.sourceFile.fileName}:${survivor.line}:${survivor.column} ` +
                `— the validation plugin did not consume this validator.${survivor.method}() call site`
            );
        }

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
                let callType = ctx.checker.getTypeAtLocation(call.typeArg);

                // The build cache is keyed on the resolved type's identity, so an unresolvable
                // type argument would collapse distinct builds onto one key.
                if (callType === undefined) {
                    throw new Error(`${PACKAGE_NAME}: unable to resolve the type argument of a validator.build call in ${ctx.sourceFile.fileName}`);
                }

                let configText = call.configArg ? call.configArg.getText(ctx.sourceFile) : '',
                    // Key on the resolved type's identity, not its printed name: two same-named
                    // aliases in different scopes are distinct types and must not collapse.
                    typeIdentity = typeof callType.id === 'number' ? `#${callType.id}` : ctx.checker.typeToString(callType),
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
export { findUntransformed };
export type { Survivor };
