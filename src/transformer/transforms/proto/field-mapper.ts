import { getFieldTag, getProtoFieldInfo, type WireType } from './type-mapper';
import type { AnalyzedProperty } from '~/transformer/type-analyzer';


type MappedField = {
    fieldNumber: number;
    name: string;
    optional: boolean;
    property: AnalyzedProperty;
    tag: number;
    wireType: WireType;
};


// Properties are already sorted alphabetically by type-analyzer
const mapFields = (properties: AnalyzedProperty[]): MappedField[] => {
    let fields: MappedField[] = [];

    for (let i = 0, n = properties.length; i < n; i++) {
        let fieldInfo = getProtoFieldInfo(properties[i]);

        fields.push({
            fieldNumber: i + 1,
            name: properties[i].name,
            optional: properties[i].optional,
            property: properties[i],
            tag: getFieldTag(i + 1, fieldInfo.wireType),
            wireType: fieldInfo.wireType
        });
    }

    return fields;
};


export { mapFields };
export type { MappedField };
