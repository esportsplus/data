import type { Brand } from '@esportsplus/utilities';


type float = Brand<number, 'float'>;

type integer = Brand<number, 'integer'>;


interface ErrorType {
    push(message: string): void;
}

interface ValidationError {
    message: string;
    path: string;
}

type ValidationResult<T> =
    | { data: T; errors: undefined; ok: true }
    | { data: unknown; errors: ValidationError[]; ok: false };

// Return type is sync or async depending on validators
type ValidatorFn<T> = (input: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;

interface Validator {
    build: <T, _TErrors extends ErrorMessages<T> = {}>(
        _config?: ValidatorConfig<T>
    ) => ValidatorFn<T>;

    // Register branded type validators
    set: <T extends { __brand: string }>(
        fn: (value: T, errors: ErrorType) => void | Promise<void>
    ) => void;
}

type ValidatorConfig<T> = {
    [K in keyof T]?:
        | ValidatorFunction<T[K]>
        | ValidatorFunction<T[K]>[]
};

type ValidatorFunction<T> = (value: T, errors: ErrorType) => void | Promise<void>;

type ErrorMessages<T> = {
    [K in keyof T]?:
        T[K] extends (infer U)[]
            ? string | ErrorMessages<U>[]
            : T[K] extends object
                ? string | ErrorMessages<T[K]>
                : string;
};


export type {
    ErrorMessages,
    ErrorType,
    float,
    integer,
    ValidationError,
    ValidationResult,
    Validator,
    ValidatorConfig,
    ValidatorFn,
    ValidatorFunction
};
