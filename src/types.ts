import type { Brand } from '@esportsplus/utilities';


type float = Brand<number, 'float'>;

type integer = Brand<number, 'integer'>;


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
    ) => ValidatorFn<T>;

    set: <T extends { __brand: string }>(
        fn: (value: T, errors: ErrorType) => void | Promise<void>
    ) => void;

    toJsonSchema: <T>(_config?: ValidatorConfig<T>) => JsonSchema;
}

interface ValidationError {
    message: string;
    path: string;
}

type ValidatorConfig<T> = {
    [K in keyof T]?:
        | ValidatorFunction<T[K]>
        | ValidatorFunction<T[K]>[]
};

type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;

type ValidatorFunction<T> = (value: T, errors: ErrorType) => void | Promise<void>;

type ValidationResult<T> =
    | { data: T; errors: undefined; ok: true }
    | { data: unknown; errors: ValidationError[]; ok: false };


export type {
    ErrorMessages,
    ErrorType,
    float,
    integer,
    JsonSchema,
    ValidationError,
    ValidationResult,
    Validator,
    ValidatorConfig,
    ValidatorFn,
    ValidatorFunction
};
