import { ts } from '@esportsplus/typescript';
import { transform } from '~/transformer';


export default (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
    return () => {
        return (sourceFile: ts.SourceFile): ts.SourceFile => {
            let result = transform(sourceFile, program);

            return result.changed ? result.sourceFile : sourceFile;
        };
    };
};
