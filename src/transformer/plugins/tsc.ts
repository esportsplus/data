import { transform } from '~/transformer';
import { ts } from '@esportsplus/typescript';


export default (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
    return () => {
        return (sourceFile: ts.SourceFile): ts.SourceFile => {
            let result = transform(sourceFile, program);

            return result.transformed ? result.sourceFile : sourceFile;
        };
    };
};
