import path from 'path';
import ts from 'typescript';


const createProgramFromTsConfig = (root: string): ts.Program => {
    let configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');

    if (!configPath) {
        throw new Error('@esportsplus/data: tsconfig.json not found');
    }

    let configFile = ts.readConfigFile(configPath, ts.sys.readFile);

    if (configFile.error) {
        throw new Error(`@esportsplus/data: Error reading tsconfig.json: ${configFile.error.messageText}`);
    }

    let parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
    );

    if (parsedConfig.errors.length > 0) {
        throw new Error(`@esportsplus/data: Error parsing tsconfig.json: ${parsedConfig.errors[0].messageText}`);
    }

    return ts.createProgram({
        options: parsedConfig.options,
        rootNames: parsedConfig.fileNames
    });
};


export { createProgramFromTsConfig };
