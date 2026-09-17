import { describe, expect, it } from 'vitest';

import { codec } from '../../src/sbc';


describe('hinted schema is exact-or-fail', () => {
    it('rejects an own-property the schema never declared', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'name', type: 'string' }]);

        expect(() => c.encode({ name: 'x', extra: 42 } as Record<string, unknown>, { schema: hash }))
            .toThrow("@esportsplus/data: codec unexpected field 'extra' not in schema");
    });

    it('rejects an extra own-property inside a nested reference, with a path', () => {
        let c = codec(),
            child = c.defineSchema([{ name: 'x', type: 'uint8' }]),
            parent = c.defineSchema([{ name: 'child', type: 'object(' + child + ')' }]);

        expect(() => c.encode({ child: { x: 1, y: 2 } } as Record<string, unknown>, { schema: parent }))
            .toThrow("@esportsplus/data: codec unexpected field 'child.y' not in schema");
    });

    it('still encodes and round-trips an exact match', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'active', type: 'boolean' }, { name: 'name', type: 'string' }]);

        expect(c.decode(c.encode({ active: true, name: 'x' }, { schema: hash })))
            .toEqual({ active: true, name: 'x' });
    });

    it('allows a declared nullable field to be absent', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'name', nullable: true, type: 'string' }]);

        expect(c.decode(c.encode({}, { schema: hash }))).toEqual({ name: null });
    });
});
