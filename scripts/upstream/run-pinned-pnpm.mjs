import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const required = /^pnpm@(\d+\.\d+\.\d+)$/u.exec(manifest.packageManager)?.[1];
const major = readFileSync(resolve(root, '.nvmrc'), 'utf8').trim();
if (!required || process.versions.node.split('.')[0] !== major) throw Error('Select the owning Paperclip Node major before running its pinned package manager');
const cli = realpathSync(process.env.PAPERCLIP_PNPM_CLI ?? '');
const installed = JSON.parse(readFileSync(resolve(dirname(cli), '../package.json'), 'utf8'));
if (installed.name !== 'pnpm' || installed.version !== required) throw Error('PAPERCLIP_PNPM_CLI must select exactly package.json#packageManager; ambient pnpm is never used');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
