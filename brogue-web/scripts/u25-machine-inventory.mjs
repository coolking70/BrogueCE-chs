import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'u25-machine-'));
try {
    const outfile = path.join(temp, 'inventory.cjs');
    await build({ entryPoints: ['scripts/u25-machine-inventory.ts'], outfile,
        bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)],
        { encoding: 'utf8', stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary directory');
    fs.rmSync(temp, { recursive: true, force: true });
}
