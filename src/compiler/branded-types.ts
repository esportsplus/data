import { ts } from '@esportsplus/typescript';


type BaseType = 'boolean' | 'number' | 'string' | 'unknown';

interface BrandedTypeInfo {
    base: BaseType;
    brand?: string;
}


function getBaseType(type: ts.Type): BaseType {
    if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
        return 'boolean';
    }

    if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) {
        return 'number';
    }

    if (type.flags & ts.TypeFlags.String || type.flags & ts.TypeFlags.StringLiteral) {
        return 'string';
    }

    return 'unknown';
}


const resolveBrandedType = (type: ts.Type, typeChecker: ts.TypeChecker): BrandedTypeInfo => {
    if (!type.isIntersection()) {
        return { base: getBaseType(type) };
    }

    let base: BaseType | undefined,
        brand: string | undefined;

    for (let i = 0, n = type.types.length; i < n; i++) {
        let constituent = type.types[i];

        if (constituent.flags & ts.TypeFlags.Boolean) {
            base = 'boolean';
        }
        else if (constituent.flags & ts.TypeFlags.Number) {
            base = 'number';
        }
        else if (constituent.flags & ts.TypeFlags.String) {
            base = 'string';
        }
        else if (constituent.flags & ts.TypeFlags.Object) {
            let brandProp = typeChecker.getPropertyOfType(constituent, '__brand');

            if (brandProp) {
                let brandType = typeChecker.getTypeOfSymbol(brandProp);

                if (brandType.isStringLiteral()) {
                    brand = brandType.value;
                }
            }
        }
    }

    return { base: base ?? 'unknown', brand };
};


export { resolveBrandedType };
