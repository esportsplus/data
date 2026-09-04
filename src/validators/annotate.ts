import type { Annotated, ErrorType, Transformer, ValidatorFunction } from '~/types';


type Annotatable = (value: never, errors: ErrorType) => unknown;

type Annotate<V> =
    V extends (...args: infer A) => infer R
        ? ((...args: A) => AnnotateReturn<R>) & { [K in keyof V]: Annotate<V[K]> }
        : V;

type AnnotateReturn<R> = R extends Annotatable ? Annotated<R> : R;

// Higher-order signature so a generic factory (e.g. `trim`) keeps its type
// parameter through annotation: matching `(...args: A) => R` lets inference
// carry `R`'s generics, which the mapped `Annotate<V>` erases via `infer R`.
// The `Annotate<V>` fallback still covers non-factory values.
type Annotator = {
    <A extends unknown[], R>(value: (...args: A) => R): (...args: A) => AnnotateReturn<R>;
    <V>(value: V): Annotate<V>;
};


function attach<F extends Annotatable>(value: F): Annotated<F> {
    let annotated = value as unknown as Record<string, unknown>;

    annotated.default = identity;
    annotated.describe = identity;
    annotated.meta = identity;

    return annotated as unknown as Annotated<F>;
}

function identity(this: unknown): unknown {
    return this;
}


const annotate = ((value: unknown): unknown => {
    if (typeof value !== 'function') {
        return value;
    }

    let factory = value as unknown as (...args: unknown[]) => Annotatable,
        source = value as unknown as Record<string, unknown>,
        wrapped = ((...args: unknown[]) => attach(factory(...args))) as unknown as Record<string, unknown>;

    for (let key of Object.keys(source)) {
        let property = source[key];

        wrapped[key] = typeof property === 'function' ? annotate(property) : property;
    }

    return wrapped;
}) as unknown as Annotator;

const fn: {
    <T>(f: Transformer<T>): Annotated<Transformer<T>>;
    <T>(f: ValidatorFunction<T>): Annotated<ValidatorFunction<T>>;
} = attach;


export { annotate, fn };
