import { plugin } from '@esportsplus/typescript/compiler';
import { transform } from '..';


export default plugin.tsc(transform) as ReturnType<typeof plugin.tsc>;
