import { type BrandedValidator } from './validators';


type GeneratorContext = {
    brandValidators: Map<string, BrandedValidator>;
    customMessages: Map<string, string>;
    hasAsync: boolean;
};

type PathMode =
    | { kind: 'dynamic'; indexVar: string; parentParts: string[] }
    | { kind: 'static'; parts: string[] };


export type { GeneratorContext, PathMode };