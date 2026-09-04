import type { Brand } from '@esportsplus/utilities';


type float = Brand<number, 'float'>;

type integer = Brand<number, 'integer'>;

type LiteralValue = {
    type: 'boolean' | 'number' | 'string';
    value: boolean | number | string;
};

interface JsonSchema {
    $schema?: string;
    additionalProperties?: JsonSchema | boolean;
    allOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    const?: boolean | number | string | null;
    enum?: (boolean | number | string)[];
    exclusiveMaximum?: number;
    exclusiveMinimum?: number;
    format?: string;
    items?: JsonSchema | false;
    maximum?: number;
    maxItems?: number;
    maxLength?: number;
    minimum?: number;
    minItems?: number;
    minLength?: number;
    multipleOf?: number;
    not?: JsonSchema;
    pattern?: string;
    prefixItems?: JsonSchema[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    type?: string | string[];
}


type ErrorMessages<T> = {
    [K in keyof T]?:
        T[K] extends (infer U)[]
            ? string | ErrorMessages<U>[]
            : T[K] extends object
                ? string | ErrorMessages<T[K]>
                : string;
};

interface ErrorType {
    push(message: string): void;
}

interface Validator {
    build: <T, _TErrors extends ErrorMessages<T> = {}>(
        _config?: ValidatorConfig<T>
    ) => Schema<T>;

    set: <T extends { __brand: string }>(
        fn: (value: T, errors: ErrorType) => void | Promise<void>
    ) => void;

    toJsonSchema: <T>(_config?: ValidatorConfig<T>) => JsonSchema;
}

interface ValidationError {
    message: string;
    path: string;
}

type Transformer<T> = (value: T, errors: ErrorType) => T | Promise<T>;

type ValidatorConfig<T> = {
    [K in keyof T]?:
        | Transformer<T[K]>
        | ValidatorFunction<T[K]>
        | (Transformer<T[K]> | ValidatorFunction<T[K]>)[]
};

type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;

type ValidatorFunction<T> = (value: T, errors: ErrorType) => void | Promise<void>;

type Annotated<F extends (value: never, errors: ErrorType) => unknown> = F & {
    default(value: Parameters<F>[0]): Annotated<F>;
    describe(text: string): Annotated<F>;
    meta(values: Record<string, unknown>): Annotated<F>;
};

type AnnotationDefault = {
    fresh: boolean;
    schema: unknown;
    source: string;
};

type Annotations = {
    default?: AnnotationDefault;
    description?: string;
    meta?: Record<string, unknown>;
};

type Schema<T> = {
    toJsonSchema(): JsonSchema;
    validate: ValidatorFn<T>;
};

type ValidationResult<T> =
    | { data: T; errors: undefined; ok: true }
    | { data: unknown; errors: ValidationError[]; ok: false };


export type {
    Annotated,
    AnnotationDefault,
    Annotations,
    ErrorMessages,
    ErrorType,
    float,
    integer,
    JsonSchema,
    LiteralValue,
    Schema,
    Transformer,
    ValidationError,
    ValidationResult,
    Validator,
    ValidatorConfig,
    ValidatorFn,
    ValidatorFunction
};
