const path = require('node:path');

// Nest's Windows watcher uses taskkill to stop the previous server.
// Some editor terminals omit System32 from their inherited PATH.
if (process.platform === 'win32') {
  const pathKey =
    Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ??
    'Path';
  const systemRoot =
    process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const system32 = path.join(systemRoot, 'System32');
  process.env[pathKey] = [system32, process.env[pathKey]]
    .filter(Boolean)
    .join(path.delimiter);
}

require('@nestjs/cli/bin/nest.js');
