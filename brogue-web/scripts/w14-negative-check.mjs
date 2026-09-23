// Isolated mutations, restored byte-for-byte even if execution fails.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const file = 'src/engine/Map/Promotion.ts', original = fs.readFileSync(file, 'utf8');
const dir = 'ai_docs/reports/w-14-evidence';
const sha = x => createHash('sha256').update(x).digest('hex');
const mutations = [
    ['blocking-veto', 'const result = spawnDungeonFeature(grid, x, y, feat, false);', 'const result = spawnDungeonFeature(grid, x, y, feat, true);'],
    ['fixed-area', 'feat.probabilityDecrement = obstructionDecrement(enchantment);', 'feat.probabilityDecrement = 50;'],
    ['protected-floor', 'const feat = catalogFeature(DF.DF_FORCEFIELD);', "if (grid.isImpregnable(x, y)) throw new Error('wrong IMPREGNABLE rule');\n    const feat = catalogFeature(DF.DF_FORCEFIELD);"],
    ['passability-cache', 'cell.isPassable = !(flags & T_OBSTRUCTS_PASSABILITY);', 'cell.isPassable = true;'],
];
const results = [];
try {
    for (const [name, from, to] of mutations) {
        if (!original.includes(from)) throw Error(`missing mutation anchor ${name}`);
        fs.writeFileSync(file, original.replace(from, to));
        const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/test/w_14_obstruction.test.ts', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/negative-${name}.json`], { encoding: 'utf8' });
        fs.writeFileSync(`${dir}/negative-${name}.log`, run.stdout + run.stderr);
        const data = JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`, 'utf8'));
        results.push({ name, exit: run.status, failed: data.numFailedTests });
        fs.writeFileSync(file, original);
        if (run.status !== 1 || !data.numFailedTests) throw Error(`mutation survived ${name}`);
    }
} finally { fs.writeFileSync(file, original); }
fs.writeFileSync(`${dir}/negative-summary.json`, JSON.stringify({ results, shaBefore: sha(original), shaAfter: sha(fs.readFileSync(file)), restored: fs.readFileSync(file, 'utf8') === original }, null, 2) + '\n');
console.log(JSON.stringify(results));
