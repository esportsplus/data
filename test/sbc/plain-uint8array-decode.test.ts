import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


const VALUE = 'A long café string with 漢字 that exceeds sixteen bytes';


describe('Codec2 plain Uint8Array string decode', () => {
    it('decodes long Unicode strings through public codec routes', () => {
        let c = codec(),
            obj = { value: VALUE },
            objectBuffer = new Uint8Array(c.encode(obj)),
            taggedBuffer = new Uint8Array(c.encode(VALUE)),
            registrySource = codec(),
            hash = registrySource.defineSchema([{ name: 'descriptiveLongFieldName', type: 'string' }]),
            registryBuffer = new Uint8Array(registrySource.serializeRegistry()),
            registryTarget = codec();

        expect(c.decode(objectBuffer)).toEqual(obj);
        expect(c.decodeAt(objectBuffer, 0)).toEqual(obj);
        expect(c.decode(taggedBuffer)).toBe(VALUE);
        expect(c.extractField(objectBuffer, 'value')).toBe(VALUE);

        registryTarget.deserializeRegistry(registryBuffer);

        expect(registryTarget.decode(new Uint8Array(registrySource.encode({ descriptiveLongFieldName: VALUE }, { schema: hash })))).toEqual({ descriptiveLongFieldName: VALUE });
    });
});
