import assert from 'node:assert/strict';
import path from 'node:path';

/** pg_ctl restricts the child token on Windows; direct postgres startup cannot. */
export function disposablePostgresStartArguments({ directory, port, logFile }) {
  assert.ok(path.isAbsolute(directory) && path.isAbsolute(logFile));
  assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536 && port !== 54329);
  assert.notEqual(path.resolve(directory), path.resolve(logFile));
  return ['-D', directory, 'start', '-w', '-t', '15', '-l', logFile, '-o', `-h 127.0.0.1 -p ${port}`];
}
