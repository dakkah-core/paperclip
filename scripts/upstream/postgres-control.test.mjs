import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { disposablePostgresStartArguments, disposableRestoreAclArguments } from './postgres-control.mjs';

test('disposable native startup uses bounded pg_ctl and an explicit loopback port', () => {
  const directory = path.resolve('owned fixture', 'data'), logFile = path.resolve('owned fixture', 'native.log');
  assert.deepEqual(disposablePostgresStartArguments({ directory, logFile, port: 32167 }),
    ['-D', directory, 'start', '-w', '-t', '15', '-l', logFile, '-o', '-h 127.0.0.1 -p 32167']);
  for (const port of [0, -1, 65536, 54329, '32167', 32167.5]) {
    assert.throws(() => disposablePostgresStartArguments({ directory, logFile, port }));
  }
  assert.throws(() => disposablePostgresStartArguments({ directory: 'relative', logFile, port: 32167 }));
});

test('restore permissions are bounded to the run and exact current user SID', () => {
  const output = path.resolve('owned fixture'), directory = path.join(output, 'restored-data');
  const ownerSid = 'S-1-5-21-1234-5678-9012-1001';
  assert.deepEqual(disposableRestoreAclArguments({ directory, output, ownerSid }),
    [directory, '/grant:r', `*${ownerSid}:(OI)(CI)F`, '/T', '/Q']);
  for (const changed of [{ directory: output }, { directory: path.resolve('foreign') },
    { ownerSid: 'Administrators' }, { ownerSid: ownerSid + ' /reset' }]) {
    assert.throws(() => disposableRestoreAclArguments({ directory, output, ownerSid, ...changed }));
  }
});
