/** Run after the initial full suite finishes. Restore only R2 production to
 * HEAD, prove the untouched old guards/fixtures, then restore exact R2 bytes. */
import fs from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out = 'ai_docs/reports/x4-r2-evidence';
if (fs.existsSync(`${out}/counterfactual-results.json`)) throw Error('One-time pre-revision proof already recorded; do not overwrite it with revised tests or fixtures');
const files = JSON.parse(fs.readFileSync(`${out}/initial-state.json`)).productionFiles;
const hash = b => createHash('sha256').update(b).digest('hex');
const final = Object.fromEntries(files.map(f => [f, fs.readFileSync(f)]));
const heads = Object.fromEntries(files.map(f => [f, execFileSync('git', ['show', `HEAD:brogue-web/${f}`], {maxBuffer: 16*1024*1024})]));
fs.writeFileSync(`${out}/counterfactual-source-backups.json`, JSON.stringify(Object.fromEntries(files.map(f => [f, final[f].toString('utf8')]))));
const initial = JSON.parse(fs.readFileSync(`${out}/initial-test.json`));
const failedFiles = initial.testResults.filter(t => t.status === 'failed' && !t.name.includes('x4_r2_')).map(t => t.name);
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
    for (const file of files) fs.writeFileSync(file, heads[file]);
    fs.writeFileSync(`${out}/counterfactual-manifest.json`, JSON.stringify(files.map(file => ({file, head:hash(heads[file]), final:hash(final[file])})), null, 2)+'\n');
    run('counterfactual-old-tests', [...failedFiles, 'src/test/generation_baseline.test.ts', '--maxWorkers=4', '--reporter=json', `--outputFile=${out}/counterfactual-old-tests.json`]);
    run('counterfactual-generation', ['--config', 'scripts/x4-r2-generation.config.ts'], {X4_R2_STAGE:'head'});
    run('counterfactual-shallow-census', ['--config', 'scripts/x4-r2-census.config.ts'],
        {X4_START:'0',X4_SEEDS:'50',X4_MAX_DEPTH:'6',X4_PHASE:'before-shallow'});
} finally {
    for (const file of files) fs.writeFileSync(file, final[file]);
    if (!files.every(file => hash(fs.readFileSync(file)) === hash(final[file]))) throw Error('Source restoration failed');
}
run('final-generation', ['--config', 'scripts/x4-r2-generation.config.ts'], {X4_R2_STAGE:'final'});
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
