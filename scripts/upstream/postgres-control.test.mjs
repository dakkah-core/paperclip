import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { disposablePostgresStartArguments } from './postgres-control.mjs';

test('disposable native startup uses bounded pg_ctl and an explicit loopback port', () => {
  const directory = path.resolve('owned fixture', 'data'), logFile = path.resolve('owned fixture', 'native.log');
  assert.deepEqual(disposablePostgresStartArguments({ directory, logFile, port: 32167 }),
    ['-D', directory, 'start', '-w', '-t', '15', '-l', logFile, '-o', '-h 127.0.0.1 -p 32167']);
  for (const port of [0, -1, 65536, 54329, '32167', 32167.5]) {
    assert.throws(() => disposablePostgresStartArguments({ directory, logFile, port }));
  }
  assert.throws(() => disposablePostgresStartArguments({ directory: 'relative', logFile, port: 32167 }));
});
