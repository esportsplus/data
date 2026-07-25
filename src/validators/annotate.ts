import type { Annotated, ValidatorFunction } from '~/types';


type Annotate<V> =
    V extends (...args: infer A) => infer R
        ? ((...args: A) => AnnotateReturn<R>) & { [K in keyof V]: Annotate<V[K]> }
        : V;

type AnnotateReturn<R> = R extends ValidatorFunction<infer T> ? Annotated<T> : R;


function attach<T>(value: ValidatorFunction<T>): Annotated<T> {
    let annotated = value as ValidatorFunction<T> & Record<string, unknown>;

    annotated.default = identity;
    annotated.describe = identity;
    annotated.meta = identity;

    return annotated as unknown as Annotated<T>;
}

function identity(this: unknown): unknown {
    return this;
}


const annotate = <V>(value: V): Annotate<V> => {
    if (typeof value !== 'function') {
        return value as unknown as Annotate<V>;
    }

    let factory = value as unknown as (...args: unknown[]) => ValidatorFunction<unknown>,
        source = value as unknown as Record<string, unknown>,
        wrapped = ((...args: unknown[]) => attach(factory(...args))) as unknown as Record<string, unknown>;

    for (let key of Object.keys(source)) {
        let property = source[key];

        wrapped[key] = typeof property === 'function' ? annotate(property) : property;
    }

    return wrapped as unknown as Annotate<V>;
};

const fn = <T>(f: ValidatorFunction<T>): Annotated<T> => attach(f);


export { annotate, fn };
