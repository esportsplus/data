import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';

import type { Encodable } from '../../src/sbc';


interface InterfaceShape {
    count: number;
    name: string;
}

type AliasShape = {
    count: number;
    name: string;
};


class Widget {
    id = 1;

    label(): string {
        return 'w';
    }
}


// Compile-time only — this function is never invoked, so the throwing runtime
// backstop never fires here; `tsc --noEmit` still checks every line, validating
// each `@ts-expect-error` (build fails if the constraint ever loosens) and every
// accepted shape (build fails if a legitimate value is wrongly rejected).
function _encodableConstraint(): void {
    let c = codec();

    // Rejected value classes — each MUST be a call-site error.
    // @ts-expect-error — Map is not Encodable
    c.encode(new Map());
    // @ts-expect-error — Set is not Encodable
    c.encode(new Set());
    // @ts-expect-error — WeakMap is not Encodable
    c.encode(new WeakMap());
    // @ts-expect-error — functions are not Encodable
    c.encode(() => {});
    // @ts-expect-error — symbols are not Encodable
    c.encode(Symbol('x'));
    // @ts-expect-error — class instances with methods are not Encodable
    c.encode(new Widget());
    // @ts-expect-error — computeSize is presize for encodable values only
    c.computeSize(new Map());

    // Accepted shapes — every line MUST compile clean.
    let alias: AliasShape = { count: 1, name: 'a' },
        iface: InterfaceShape = { count: 1, name: 'a' };

    c.encode(iface);
    c.encode(alias);
    c.encode([{ a: 1 }, { a: 2 }]);
    c.encode(new Date());
    c.encode(new Uint8Array(4));
    c.encode(new Float32Array(4));
    c.computeSize(iface);

    // Direct Encodable assignment: interface accepts, type alias accepts,
    // class instance rejects.
    let _a: Encodable<AliasShape> = alias,
        _i: Encodable<InterfaceShape> = iface,
        // @ts-expect-error — Widget carries a method, so it is not Encodable
        _w: Encodable<Widget> = new Widget();

    void _a;
    void _i;
    void _w;
}


describe('Encodable compile-time constraint', () => {
    it('keeps the type-level assertions in the build', () => {
        expect(typeof _encodableConstraint).toBe('function');
    });
});


describe('Encodable runtime backstop', () => {
    it('throws a named error for a Map at an untyped call site', () => {
        let c = codec();

        expect(() => c.encode(new Map() as never)).toThrow('@esportsplus/data: codec unrepresentable value of type Map');
    });

    it('throws the named error for a DataView instead of encoding tag 0', () => {
        let c = codec();

        expect(() => c.encode(new DataView(new ArrayBuffer(8)) as never)).toThrow('@esportsplus/data: codec unrepresentable value of type DataView');
    });

    it('throws the named error for a class instance instead of encoding {}', () => {
        let c = codec();

        expect(() => c.encode(new Widget() as never)).toThrow('@esportsplus/data: codec unrepresentable value of type Widget');
    });

    it('throws the named error for a Set, WeakMap, RegExp and Promise', () => {
        let c = codec();

        expect(() => c.encode(new Set() as never)).toThrow('@esportsplus/data: codec unrepresentable value of type Set');
        expect(() => c.encode(new WeakMap() as never)).toThrow('@esportsplus/data: codec unrepresentable value of type WeakMap');
        expect(() => c.encode(/x/ as never)).toThrow('@esportsplus/data: codec unrepresentable value of type RegExp');
        expect(() => c.encode(Promise.resolve() as never)).toThrow('@esportsplus/data: codec unrepresentable value of type Promise');
    });

    it('still encodes null and undefined as tag 0', () => {
        let c = codec();

        expect(c.encode(null as never)[0]).toBe(0);
        expect(c.encode(undefined as never)[0]).toBe(0);
    });
});


describe('decode path is unchanged', () => {
    it('throws the unknown-tag error for a retired tag', () => {
        let c = codec();

        expect(() => c.decode(Uint8Array.from([15]))).toThrow('@esportsplus/data: codec unknown tag 15');
        expect(() => c.decode(Uint8Array.from([16]))).toThrow('@esportsplus/data: codec unknown tag 16');
    });
});
