import type { Annotated, Transformer } from '~/types';

import { annotate } from '../validators/annotate';

import _trim from './trim';


// `trim` is generic over the field it decodes so it satisfies a typed/branded
// field slot (`Transformer<TrimmedNonEmptyString>`, etc.) rather than only
// `Transformer<unknown>`. `T` is inferred from the config field's expected
// type; the runtime is the plain string trimmer wrapped by `annotate`.
type TrimFn = <T = string>(error?: string) => Annotated<Transformer<T>>;


export const trim = annotate(_trim) as unknown as TrimFn & { end: TrimFn; start: TrimFn };
