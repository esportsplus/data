import { describe, expect, it } from 'vitest';
import { createCodec } from './utils';


describe('Codec: Boolean Arrays', () => {
    let codec = createCodec<{ flags: boolean[] }>(`
        type Data = { flags: boolean[] };
        codec<Data>();
    `);

    it('roundtrips boolean array', () => {
        let data = { flags: [true, false, true, true] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips empty boolean array', () => {
        let data = { flags: [] as boolean[] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips single-element boolean array', () => {
        let data = { flags: [false] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips all-true array', () => {
        let data = { flags: [true, true, true] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips all-false array', () => {
        let data = { flags: [false, false, false] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });
});


describe('Codec: BigInt Arrays', () => {
    let codec = createCodec<{ values: bigint[] }>(`
        type Data = { values: bigint[] };
        codec<Data>();
    `);

    it('roundtrips bigint array', () => {
        let data = { values: [1n, 100n, 9007199254740991n] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips empty bigint array', () => {
        let data = { values: [] as bigint[] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips bigint array with large values', () => {
        let data = { values: [-1n, BigInt('999999999999999999'), 0n] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips single-element bigint array', () => {
        let data = { values: [42n] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips bigint array with zeros', () => {
        let data = { values: [0n, 0n, 0n] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });
});


describe('Codec: Mixed Types with Boolean/BigInt Arrays', () => {
    it('roundtrips boolean array alongside string and number fields', () => {
        let codec = createCodec<{ flags: boolean[]; name: string; score: number }>(`
            type Data = { name: string; score: number; flags: boolean[] };
            codec<Data>();
        `);

        let data = { flags: [true, false], name: 'test', score: 42 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.flags).toEqual([true, false]);
        expect(decoded.name).toBe('test');
        expect(decoded.score).toBeCloseTo(42);
    });

    it('roundtrips bigint array alongside other fields', () => {
        let codec = createCodec<{ ids: bigint[]; label: string }>(`
            type Data = { label: string; ids: bigint[] };
            codec<Data>();
        `);

        let data = { ids: [1n, 2n, 3n], label: 'items' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('roundtrips both boolean and bigint arrays in same type', () => {
        let codec = createCodec<{ flags: boolean[]; values: bigint[] }>(`
            type Data = { flags: boolean[]; values: bigint[] };
            codec<Data>();
        `);

        let data = { flags: [true, false, true], values: [10n, 20n] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });
});
