import ts from 'typescript';
import { createTransformer } from '~/transformer/core';


// ts-patch transformer entry point
const transformer = (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
    return createTransformer(program);
};


export default transformer;
