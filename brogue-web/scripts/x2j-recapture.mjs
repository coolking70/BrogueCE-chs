import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
const out = 'ai_docs/reports/x2j-evidence';
const sha = data => createHash('sha256').update(data).digest('hex');
const rows = [];
for (const n of [3, 4]) {
    const file = `ai_docs/reports/u-r${n}-trace.json.gz`;
    const before = sha(execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { maxBuffer: 32 * 1024 * 1024 }));
    const args = ['node_modules/vitest/vitest.mjs', 'run', `src/test/u_r${n}_trace.test.ts`, '--maxWorkers=1'];
    const r = process.argv.includes('only4') && n === 3 ? { status: 0 } : spawnSync(process.execPath, args, { env: { ...process.env, [`UR${n}_CAPTURE`]: '1' }, stdio: 'inherit' });
    if (r.status) throw new Error(`UR${n} capture failed`);
    rows.push({ file, command: `UR${n}_CAPTURE=1 node ${args.join(' ')}`, before, after: sha(fs.readFileSync(file)) });
}
fs.writeFileSync(`${out}/recapture.json`, JSON.stringify(rows, null, 2) + '\n');
