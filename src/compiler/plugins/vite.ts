import { plugin } from '@esportsplus/typescript/compiler';
import { PACKAGE } from '~/constants';
import data from '..';


export default plugin.vite({
    name: PACKAGE,
    plugins: [data]
});
