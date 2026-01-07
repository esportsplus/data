import { writeFileSync } from 'fs';
import { coordinator } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import plugin from '../src/compiler/index';


const VALIDATORS_CODE = `
import { codec, validator, integer, float } from '@esportsplus/data';
import { min, max, range } from '@esportsplus/data';

// ============================================
// PRIMITIVE VALIDATORS
// ============================================

type User = { name: string };
const validateUser = validator.build<User>();

type WithAge = { age: number };
const validateWithAge = validator.build<WithAge>();

type WithFlag = { active: boolean };
const validateWithFlag = validator.build<WithFlag>();

type WithBigInt = { id: bigint };
const validateWithBigInt = validator.build<WithBigInt>();

// ============================================
// BRANDED TYPE VALIDATORS
// ============================================

type Brand<T, B extends string> = T & { __brand: B };
type integer = Brand<number, 'integer'>;
type float = Brand<number, 'float'>;

type WithInteger = { count: integer };
const validateWithInteger = validator.build<WithInteger>();

type WithFloat = { price: float };
const validateWithFloat = validator.build<WithFloat>();

// ============================================
// OPTIONAL AND NULLABLE
// ============================================

type OptionalField = { name?: string };
const validateOptional = validator.build<OptionalField>();

type NullableField = { value: string | null };
const validateNullable = validator.build<NullableField>();

type OptionalNullable = { data?: string | null };
const validateOptionalNullable = validator.build<OptionalNullable>();

// ============================================
// ARRAYS
// ============================================

type StringArray = { items: string[] };
const validateStringArray = validator.build<StringArray>();

type NumberArray = { values: number[] };
const validateNumberArray = validator.build<NumberArray>();

type ObjectArray = { users: { name: string; age: number }[] };
const validateObjectArray = validator.build<ObjectArray>();

// ============================================
// NESTED OBJECTS
// ============================================

type Address = {
    city: string;
    country: string;
    street: string;
    zip: string;
};

type Person = {
    address: Address;
    name: string;
};

const validatePerson = validator.build<Person>();

// ============================================
// UNIONS
// ============================================

type Status = 'active' | 'inactive' | 'pending';
type WithStatus = { status: Status };
const validateWithStatus = validator.build<WithStatus>();

type NumberOrString = { value: number | string };
const validateNumberOrString = validator.build<NumberOrString>();

// ============================================
// COMPLEX TYPE
// ============================================

type Pagination = {
    page: integer;
    pageSize: integer;
    total: integer;
};

type ApiUser = {
    createdAt: Date;
    email: string;
    id: integer;
    name: string;
    roles: string[];
};

type ApiResponse = {
    data: ApiUser[];
    pagination: Pagination;
};

const validateApiResponse = validator.build<ApiResponse>();

// ============================================
// WITH CUSTOM VALIDATORS
// ============================================

type Email = { email: string };
const validateEmail = validator.build<Email>((value, errors) => {
    if (!value.email.includes('@')) {
        errors.push('must be valid email');
    }
});

// ============================================
// WITH BUILT-IN VALIDATORS
// ============================================

type WithMinMax = {
    age: number;
    name: string;
};
const validateWithMinMax = validator.build<WithMinMax>({
    age: [min(0), max(150)],
    name: [min(1), max(100)]
});

// ============================================
// CODECS
// ============================================

type SimpleCodec = { name: string };
const simpleCodec = codec<SimpleCodec>();

type ComplexCodec = {
    active: boolean;
    count: integer;
    name: string;
    price: float;
    tags: string[];
};
const complexCodec = codec<ComplexCodec>();
`;

let compilerOptions: ts.CompilerOptions = {
    lib: ['lib.es2020.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2020
};

function createProgram(code: string, filename: string): ts.Program {
    let host = ts.createCompilerHost(compilerOptions),
        originalGetSourceFile = host.getSourceFile.bind(host);

    host.getSourceFile = (name, languageVersion) => {
        if (name === filename) {
            return ts.createSourceFile(name, code, languageVersion, true);
        }

        return originalGetSourceFile(name, languageVersion);
    };

    host.fileExists = (name) => name === filename || ts.sys.fileExists(name);
    host.readFile = (name) => name === filename ? code : ts.sys.readFile(name);

    return ts.createProgram([filename], compilerOptions, host);
}

function transform(code: string): string {
    let program = createProgram(code, 'validators.ts'),
        shared = new Map(),
        sourceFile = program.getSourceFile('validators.ts')!;

    let result = coordinator.transform([plugin], code, sourceFile, program, shared);

    return result.code;
}

let output = transform(VALIDATORS_CODE);

writeFileSync('tests/build/validators.js', output);

console.log('Compiled validators saved to tests/build/validators.js');
console.log('\n--- OUTPUT ---\n');
console.log(output);
