import { plugin } from '@esportsplus/typescript/compiler';
import { PACKAGE } from '~/constants';
import dataPlugin from '..';


export default plugin.vite({
    name: PACKAGE,
    plugins: [dataPlugin]
});
