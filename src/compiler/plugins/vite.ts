import { plugin } from '@esportsplus/typescript/compiler';
import { PACKAGE_NAME, UNCOMPILED } from '~/constants';

import sbc from '../sbc';
import data from '..';


export default plugin.vite({
    name: PACKAGE_NAME,
    plugins: [data, sbc],
    uncompiled: [UNCOMPILED]
});
