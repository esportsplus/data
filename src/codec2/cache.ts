// Codec2 — SIEVE-evicted bounded schema cache (module singleton)


type CacheEntry = {
    hash: number;
    next: CacheEntry | null;
    prev: CacheEntry | null;
    schema: StoredSchema;
    visited: boolean;
};

type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: string;
};

type StoredSchema = {
    fields: FieldSpec[];
    hash: number;
};


let hand: CacheEntry | null = null,
    head: CacheEntry | null = null,
    map = new Map<number, CacheEntry>(),
    maxSize = 1024,
    tail: CacheEntry | null = null;


function evictOne(): void {
    let o = hand ?? tail;

    if (!o) {
        return;
    }

    for (let i = 0, n = 64; i < n && o.visited; i++) {
        o.visited = false;
        o = o.prev ?? tail!;
    }

    hand = o.prev;
    unlinkEntry(o);
    map.delete(o.hash);
}

function unlinkEntry(entry: CacheEntry): void {
    if (entry.prev) {
        entry.prev.next = entry.next;
    }
    else {
        head = entry.next;
    }

    if (entry.next) {
        entry.next.prev = entry.prev;
    }
    else {
        tail = entry.prev;
    }

    if (hand === entry) {
        hand = entry.prev;
    }

    entry.prev = entry.next = null;
}


const get = (hash: number): StoredSchema | null => {
    let entry = map.get(hash);

    if (!entry) {
        return null;
    }

    entry.visited = true;

    return entry.schema;
}

const set = (hash: number, schema: StoredSchema): void => {
    let entry = map.get(hash);

    if (entry) {
        entry.schema = schema;
        entry.visited = true;

        return;
    }

    while (map.size >= maxSize) {
        evictOne();
    }

    entry = { hash, next: null, prev: null, schema, visited: false };

    if (head) {
        entry.next = head;
        head.prev = entry;
    }
    else {
        tail = entry;
    }

    head = entry;
    map.set(hash, entry);
}


export default { get, set };
export type { StoredSchema };
