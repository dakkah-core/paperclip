import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Resolve npm from the selected Node distribution, never from PATH. */
export function owningNpm(nodeExecutable = process.execPath) {
  const bin = dirname(realpathSync(nodeExecutable));
  for (const file of [join(bin, 'node_modules/npm/bin/npm-cli.js'), join(bin, '../lib/node_modules/npm/bin/npm-cli.js')]) {
    if (existsSync(file)) return realpathSync(file);
  }
  throw Error('Selected Node distribution must include its own npm');
}
