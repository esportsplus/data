import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


type AliasShape = {
    a: number;
    b: string;
};

interface InterfaceShape {
    a: number;
    b: string;
}

class WithMethod {
    x = 1;

    greet(): string {
        return 'hi';
    }
}


let c = codec();


// Compile-time constraint assertions (clauses 1 & 2). vitest does NOT type-check;
// these lines are enforced by `npx tsc --noEmit`. The function is intentionally
// never invoked — `void` below marks it used for noUnusedLocals without executing
// the reject calls (which throw at runtime once the backstop lands).
function compileTimeConstraints(): void {
    // --- Clause 1: REJECT (each @ts-expect-error fails the build if the constraint loosens) ---

    // @ts-expect-error Map is not Encodable
    c.encode(new Map());

    // @ts-expect-error Set is not Encodable
    c.encode(new Set());

    // @ts-expect-error WeakMap is not Encodable
    c.encode(new WeakMap());

    // @ts-expect-error function is not Encodable
    c.encode(() => {});

    // @ts-expect-error symbol is not Encodable
    c.encode(Symbol('x'));

    // @ts-expect-error class-instance-with-methods is not Encodable
    c.encode(new WithMethod());

    // @ts-expect-error computeSize carries the same Encodable constraint
    c.computeSize(new Map());

    // --- Clause 2: ACCEPT (no ts error before or after the fix — invariance guard) ---

    let aliasVal: AliasShape = { a: 1, b: 'x' },
        bytes = new Uint8Array([1, 2, 3]),
        date = new Date(),
        floats = new Float32Array([1.5, 2.5]),
        ifaceVal: InterfaceShape = { a: 1, b: 'x' },
        nested: { id: number }[] = [{ id: 1 }, { id: 2 }];

    c.encode(aliasVal);
    c.encode(bytes);
    c.encode(date);
    c.encode(floats);
    c.encode(ifaceVal);
    c.encode(nested);

    c.computeSize(aliasVal);
    c.computeSize(bytes);
    c.computeSize(date);
    c.computeSize(floats);
    c.computeSize(ifaceVal);
    c.computeSize(nested);
}

void compileTimeConstraints;


describe('Codec2 Encodable constraint', () => {
    // === Clause 3: runtime backstop at an untyped call site ===

    describe('runtime backstop — unrepresentable values throw', () => {
        it('encode(new Map() as never) throws the named backstop', () => {
            expect(() => c.encode(new Map() as never)).toThrow(/Codec2: unrepresentable value of type Map/);
        });

        // === Clause 4: DataView + class instance throw the same named error ===

        it('encode(new DataView(...) as never) throws instead of encoding as null', () => {
            expect(() => c.encode(new DataView(new ArrayBuffer(8)) as never)).toThrow(/Codec2: unrepresentable value of type DataView/);
        });

        it('encode(class instance as never) throws instead of encoding as an object', () => {
            expect(() => c.encode(new WithMethod() as never)).toThrow(/Codec2: unrepresentable value of type WithMethod/);
        });
    });

    // === Clause 5: decode path unchanged — unknown/retired tag still throws ===

    describe('decode path unchanged', () => {
        it('decode of a buffer with a bogus leading tag throws unknown-tag', () => {
            expect(() => c.decode(new Uint8Array([200]))).toThrow(/Codec2: unknown tag 200/);
        });
    });
});
