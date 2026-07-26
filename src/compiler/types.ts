import { type BrandedValidator } from './validators';


type GeneratorContext = {
    brandValidators: Map<string, BrandedValidator>;
    customMessages: Map<string, string>;
    hasAsync: boolean;
};

// An error path is an ordered segment list, never a pre-joined string: the renderer owns
// every separator, so an array index can never be dot-joined and a runtime key can never be
// confused with a nested property. `index` is an array/tuple position (always bracketed),
// `record` is a runtime object key (bracketed only when it is not identifier-safe), and
// `key` is a static property name.
// `expr` is the RUNTIME index expression the path renders; `position` is the COMPILE-TIME
// index the user's ErrorMessages tree is keyed by — `'0'` for an array/Set element (the
// `ErrorMessages<U>[]` first-element convention) and the literal index for a tuple. The two
// differ because a runtime loop variable has no compile-time value to look a message up with.
type PathSegment =
    | { expr: string; kind: 'index'; position: string }
    | { expr: string; kind: 'record' }
    | { kind: 'key'; name: string };

type PathMode = { segments: PathSegment[] };


export type { GeneratorContext, PathMode, PathSegment };
