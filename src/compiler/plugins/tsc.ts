import { plugin } from '@esportsplus/typescript/transformer';
import { transform } from '..';


export default plugin.tsc(transform) as ReturnType<typeof plugin.tsc>;
