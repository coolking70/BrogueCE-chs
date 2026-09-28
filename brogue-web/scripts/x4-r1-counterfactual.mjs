/** Run only after the initial gate runner has finished. Source swaps are confined
 * to R1 production files; tests, fixtures and all other production stay.
 * Backups are persisted before swapping and restored even if a check fails.
 */
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x4-r1-evidence';
const files = [
    'src/engine/Map/TerrainType.ts', 'src/engine/Map/TerrainCatalog.ts',
    'src/engine/Map/Grid.ts', 'src/engine/Map/DungeonFeatureCatalog.ts',
    'src/engine/UI/TerrainAppearanceCatalog.ts', 'src/engine/UI/TerrainColorCatalog.ts',
    'src/locales/zh_CN.json', 'src/engine/Map/TerrainHealing.ts',
    'src/engine/Map/WorldCatalogAudit.ts', 'src/engine/UI/WorldCatalogText.ts',
];
const hash = b => createHash('sha256').update(b).digest('hex');
const final = Object.fromEntries(files.map(f => [f, fs.readFileSync(f)]));
const heads = Object.fromEntries(files.map(file => {
    try { return [file, execFileSync('git', ['show', `HEAD:brogue-web/${file}`], {maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']})]; }
    catch { return [file, null]; }
}));
fs.writeFileSync(`${out}/counterfactual-source-backups.json`, JSON.stringify(Object.fromEntries(files.map(f => [f, final[f].toString('utf8')]))));
const initial = JSON.parse(fs.readFileSync(`${out}/initial-test.json`));
const failedFiles = initial.testResults.filter(t => t.status === 'failed').map(t => t.name);
const failedNames = initial.testResults.flatMap(t => t.assertionResults.filter(a => a.status === 'failed').map(a => a.fullName));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = [...failedNames.map(escapeRegex), '4 seed.*D1-D26'].join('|');
const results = [];
function run(label, args, env = {}) {
    const log = `${out}/${label}.log`, fd = fs.openSync(log, 'w'), start = Date.now();
    console.log('START', label);
    const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...args], {
        stdio: ['ignore', fd, fd], windowsHide: true, env: {...process.env, ...env},
    });
    fs.closeSync(fd);
    fs.writeFileSync(log, fs.readFileSync(log, 'utf8').replace(/\r\n/g, '\n'));
    results.push({label, args, exit:r.status, seconds:(Date.now()-start)/1000, log});
    fs.writeFileSync(`${out}/counterfactual-results.json`, JSON.stringify(results, null, 2)+'\n');
    console.log('END', label, r.status);
}
try {
    for (const file of files) {
        if (heads[file] === null) fs.unlinkSync(file);
        else fs.writeFileSync(file, heads[file]);
    }
    fs.writeFileSync(`${out}/counterfactual-manifest.json`, JSON.stringify(files.map(file => ({file, head:heads[file]===null?null:hash(heads[file]), final:hash(final[file])})), null, 2)+'\n');
    run('counterfactual-old-tests', [...failedFiles, 'src/test/generation_baseline.test.ts', '--testNamePattern', pattern, '--maxWorkers=2', '--reporter=json', `--outputFile=${out}/counterfactual-old-tests.json`]);
    run('counterfactual-generation', ['--config', 'scripts/x4-r1-generation.config.ts'], {X4_R1_STAGE:'head'});
} finally {
    for (const file of files) fs.writeFileSync(file, final[file]);
    if (!files.every(file => hash(fs.readFileSync(file)) === hash(final[file]))) throw Error('Source restoration failed');
}
run('final-generation', ['--config', 'scripts/x4-r1-generation.config.ts'], {X4_R1_STAGE:'final'});
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
