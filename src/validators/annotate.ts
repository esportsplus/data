import type { Annotated, ErrorType, Transformer, ValidatorFunction } from '~/types';


type Annotatable = (value: never, errors: ErrorType) => unknown;

type Annotate<V> =
    V extends (...args: infer A) => infer R
        ? ((...args: A) => AnnotateReturn<R>) & { [K in keyof V]: Annotate<V[K]> }
        : V;

type AnnotateReturn<R> = R extends Annotatable ? Annotated<R> : R;


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


const annotate = <V>(value: V): Annotate<V> => {
    if (typeof value !== 'function') {
        return value as unknown as Annotate<V>;
    }

    let factory = value as unknown as (...args: unknown[]) => Annotatable,
        source = value as unknown as Record<string, unknown>,
        wrapped = ((...args: unknown[]) => attach(factory(...args))) as unknown as Record<string, unknown>;

    for (let key of Object.keys(source)) {
        let property = source[key];

        wrapped[key] = typeof property === 'function' ? annotate(property) : property;
    }

    return wrapped as unknown as Annotate<V>;
};

const fn: {
    <T>(f: Transformer<T>): Annotated<Transformer<T>>;
    <T>(f: ValidatorFunction<T>): Annotated<ValidatorFunction<T>>;
} = attach;


export { annotate, fn };
