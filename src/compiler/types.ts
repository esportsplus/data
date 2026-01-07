import { type BrandedValidator } from './validators';


type GeneratorContext = {
    brandValidators: Map<string, BrandedValidator>;
    customMessages: Map<string, string>;
    hasAsync: boolean;
};

type PathMode =
    | { kind: 'dynamic' | 'record'; key: string; path: string[] }
    | { kind: 'static'; path: string[] };


export type { GeneratorContext, PathMode };