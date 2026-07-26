import { codec } from '@esportsplus/data';

const c = codec({ type: 'object', properties: { name: { type: 'string' } } });

export const encoded = c();
