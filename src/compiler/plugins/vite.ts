import { plugin } from '@esportsplus/typescript/compiler';
import { PACKAGE_NAME } from '~/constants';
import data from '..';


export default plugin.vite({
    name: PACKAGE_NAME,
    plugins: [data]
});
