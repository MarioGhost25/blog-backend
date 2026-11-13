// Jest 29 cannot require Nest Config 12's ESM entrypoint as Node 24 does.
// Transform only the explicitly allowlisted dependency JavaScript in Jest.
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
module.exports = {
  getCacheKey(source, filename, options) {
    return createHash('sha256')
      .update(readFileSync(__filename))
      .update(source)
      .update(filename)
      .update(options.configString)
      .digest('hex');
  },
  process(source, filename) {
    return {
      code: ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          allowJs: true,
          esModuleInterop: true,
        },
      }).outputText,
    };
  },
};
