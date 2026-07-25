import { validator as v } from '@esportsplus/data';

const built = v.build({ name: 'x' });
const schema = v.toJsonSchema();
