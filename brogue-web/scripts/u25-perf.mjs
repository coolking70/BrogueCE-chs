import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'u25-perf-'));
try {
    const outfile = path.join(temp, 'perf.cjs');
    await build({ entryPoints: ['scripts/u25-perf.ts'], outfile,
        bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const seed = process.argv[2] ?? '424242';
    for (let i = 0; i < 3; i++) {
        const result = spawnSync(process.execPath, [outfile, seed], { encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr);
        console.log(result.stdout.trim());
    }
} finally {
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary directory');
    fs.rmSync(temp, { recursive: true, force: true });
}
