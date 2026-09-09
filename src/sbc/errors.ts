// Typed decode miss — carries the unresolved hash so a resolver can fetch it
// and retry, instead of matching the message string.

class SchemaMissError extends Error {
    readonly hash: number;

    constructor(hash: number) {
        super('@esportsplus/data: codec unknown schema hash ' + hash);
        this.hash = hash;
    }
}


export { SchemaMissError };
