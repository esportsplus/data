// Audit spec — SBC public type/runtime characteristics: STANDING findings.
//
// H8 (createCache capacity loop) was fixed; its regression guard now lives in
// test/audit/fixes/sbc-cache.test.ts. What remains here documents behaviour that is either
// deferred (M7a) or an intentional contract (M7b type-level, M7c):
//   M7a — typedSchemaFieldCounts never shrinks on a name-hash collision delete (PARTIAL, deferred).
//   M7b — the runtime rejects DataView (the type was tightened to match; this pins the runtime side).
//   M7c — decode<T>() is an unchecked assertion (no validation against T) — a documented contract.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { codec } from '../../src/sbc';


// ---------------------------------------------------------------------------
// M7a — typedSchemaFieldCounts never shrinks (PARTIAL, deferred)
// ---------------------------------------------------------------------------
//
// `defineSchema` calls `.add(schema.fields.length)` on registration but the name-hash-collision
// branch only calls `typedSchemas.delete(nameHash)` — it never touches the count Set, so the Set
// is add-only. This cannot be observed via the public API (private closure state; the extra branch
// entry is behaviour-neutral), so the finding stays PARTIAL: proven by source evidence plus a
// public-API demonstration that the collision-delete path really executes.
describe('M7a — typedSchemaFieldCounts bookkeeping', () => {
    const indexUrl = new URL('../../src/sbc/index.ts', import.meta.url);
    const indexSrc = readFileSync(fileURLToPath(indexUrl), 'utf8');

    it('source only ever ADDs to typedSchemaFieldCounts — no delete/clear/remove', () => {
        const calls = [...indexSrc.matchAll(/typedSchemaFieldCounts\s*\.\s*(add|has|delete|clear|remove)\s*\(/g)]
            .map(m => m[1]);

        expect(calls).toContain('add');
        expect(calls).toContain('has');
        expect(calls).not.toContain('delete');
        expect(calls).not.toContain('clear');
        expect(calls).not.toContain('remove');
    });

    it('a same-names/different-types defineSchema actually executes the collision-delete path', () => {
        // Declared int32 -> encoded as a fixed 4-byte int32 field: 9-byte tag-8 header + 4 = 13.
        const typed = codec();
        typed.defineSchema([{ name: 'a', type: 'int32' }]);
        const typedBuf = typed.encode({ a: 5 });

        // Same name set ('a') with a different type collides on the name hash. The typedSchemas
        // entry is deleted, so the declared int32 is no longer selected and inference picks uint8:
        // header 9 + 1 = 10.
        const collided = codec();
        collided.defineSchema([{ name: 'a', type: 'int32' }]);
        collided.defineSchema([{ name: 'a', type: 'string' }]);
        const collidedBuf = collided.encode({ a: 5 });

        expect(typedBuf.length).toBe(13);
        expect(collidedBuf.length).toBe(10);
        expect(typedBuf.length - collidedBuf.length).toBe(3);
    });
});


// ---------------------------------------------------------------------------
// M7b — the runtime rejects DataView
// ---------------------------------------------------------------------------
//
// EncodablePrimitive was tightened so the type no longer admits DataView (it excludes it from
// ArrayBufferView). This pins the runtime side of that contract: encodeSbc's `case 'object'`
// excludes DataView and falls through to unrepresentable().
describe('M7b — DataView rejected at runtime', () => {
    it('encode(new DataView(...)) throws at runtime', () => {
        const c = codec();
        const dv = new DataView(new ArrayBuffer(8));

        dv.setFloat64(0, 3.14);

        expect(() => c.encode(dv as never))
            .toThrow('@esportsplus/data: codec unrepresentable value of type DataView');
    });
});


// ---------------------------------------------------------------------------
// M7c — decode<T>() is an unchecked assertion (documented contract)
// ---------------------------------------------------------------------------
//
// `decode<T>(buffer)` returns the shape actually present on the wire; T is erased and never
// consulted at runtime. This is intentional (no runtime validation cost) and is documented in the
// public API JSDoc; the test pins the contract.
describe('M7c — decode<T>() unchecked assertion', () => {
    it('returns wire data cast to a mismatched T without validation', () => {
        const c = codec();
        const buf = c.encode({ a: 5 }); // wire truth: { a: 5 }

        const wrongType = c.decode<{ a: string }>(buf);

        expect(wrongType).toEqual({ a: 5 });
        expect(typeof wrongType.a).toBe('number');
    });

    it('a T with fields that do not exist on the payload is not detected', () => {
        const c = codec();
        const buf = c.encode({ a: 5 });

        const wrongShape = c.decode<{ a: number; b: string; nested: { c: boolean } }>(buf);

        expect(wrongShape).toEqual({ a: 5 });
        expect((wrongShape as Record<string, unknown>).b).toBeUndefined();
        expect((wrongShape as Record<string, unknown>).nested).toBeUndefined();
    });
});
