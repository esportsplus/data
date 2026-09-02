import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';

import type { PersistentStore } from '../../src/sbc';


type StoredSchema = Parameters<PersistentStore['set']>[1];


describe('Codec2 numeric-width schema convergence', () => {
    it('converges sixteen two-field width combinations to four schemas', () => {
        let schemas = new Map<number, StoredSchema>(),
            store: PersistentStore = {
                get: (hash: number) => schemas.get(hash) ?? null,
                set(hash: number, schema: StoredSchema) {
                    schemas.set(hash, schema);
                },
            },
            c = codec({ store }),
            widths = [1.5, -1, 256, 1];

        for (let i = 0; i < widths.length; i++) {
            for (let j = 0; j < widths.length; j++) {
                c.encode({ numericWidthConvergenceLeft: widths[i]!, numericWidthConvergenceRight: widths[j]! });

                for (let k = 0; k < 16; k++) {
                    c.encode({ ['numericWidthConvergenceEvict' + k]: k });
                }
            }
        }

        let count = 0;

        for (let schema of schemas.values()) {
            let fields = schema.fields;

            if (fields.length === 2 && fields[0]!.name === 'numericWidthConvergenceLeft' && fields[1]!.name === 'numericWidthConvergenceRight') {
                count++;
            }
        }

        expect(count).toBeLessThanOrEqual(4);
        expect(count).toBe(4);
    });

    it('decodes old narrower bytes after registering a wider sibling', () => {
        let c = codec(),
            value = { numericWidthOldLeft: 1, numericWidthOldRight: 2 },
            oldBytes = c.encode(value);

        c.encode({ numericWidthOldLeft: -1, numericWidthOldRight: -2 });

        expect(c.decode(oldBytes)).toEqual(value);
    });
});
