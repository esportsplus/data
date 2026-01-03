import { createTransformer } from '~/transformer';
import ts from 'typescript';


// ts-patch transformer entry point
export default (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
    return createTransformer(program);
};
