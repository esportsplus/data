import type { AnalyzedProperty } from '../type-analyzer';
import { getFieldTag, getProtoFieldInfo, type WireType } from './type-mapper';


interface MappedField {
    fieldNumber: number;
    name: string;
    optional: boolean;
    property: AnalyzedProperty;
    tag: number;
    wireType: WireType;
}


const mapFields = (properties: AnalyzedProperty[]): MappedField[] => {
    // Properties are already sorted alphabetically by type-analyzer
    let fields: MappedField[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let prop = properties[i],
            fieldNumber = i + 1,
            fieldInfo = getProtoFieldInfo(prop);

        fields.push({
            fieldNumber,
            name: prop.name,
            optional: prop.optional,
            property: prop,
            tag: getFieldTag(fieldNumber, fieldInfo.wireType),
            wireType: fieldInfo.wireType
        });
    }

    return fields;
};


export { mapFields };
export type { MappedField };
