import { PACKAGE } from '../../constants';
import { plugin } from '@esportsplus/typescript/compiler';
import { clearValidatorCache, transform } from '..';


export default plugin.vite({
    name: PACKAGE,
    onWatchChange: clearValidatorCache,
    transform
});