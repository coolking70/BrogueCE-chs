import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const out = 'ai_docs/reports/x2d-evidence';
fs.mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'targeted';
const selected = fs.readdirSync('src/test').filter(f => /^(x2d_|p1_30|u_?24|u_01|u_03|u_27|u_r2|w_7|u_15[bcd]|scroll_effects|b_1|invented_content_pool|p1_37)/.test(f) && f.endsWith('.test.ts')).map(f => `src/test/${f}`);
const old = ['src/test/w_7_arcana_enchantment.test.ts', 'src/test/invented_content_pool.test.ts', 'src/test/p1_37_machine_flag_i18n.test.ts'];
const schema = fs.readdirSync('src/test').filter(f => /^(u_03|u_r1|u_27|w_7|p1_30|u24|u_r2)/.test(f) && f.endsWith('.test.ts')).map(f => `src/test/${f}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = mode === 'build' ? ['run', 'build']
    : mode === 'drift' ? ['run', 'test:drift', '--', '--maxWorkers=2']
    : ['test', '--', ...(mode.startsWith('full') ? [] : mode === 'before' ? old : mode === 'new' ? ['src/test/x2d_scroll_equipment.test.ts'] : mode === 'schema' ? schema : selected), mode === 'full-final2' ? '--maxWorkers=6' : mode === 'full-final' ? '--maxWorkers=4' : '--maxWorkers=2', '--reporter=json', `--outputFile=${out}/${mode}.json`];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const inputs = () => Object.fromEntries([...walk('src'), ...walk('public'), 'package.json', 'package-lock.json', 'vite.config.ts', 'scripts/u03-state-contract.json', 'ai_docs/reports/u-r2-trace.json'].map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const before = inputs();
const started = Date.now();
const result = spawnSync(npm, args, { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = `${result.stdout ?? ''}${result.stderr ?? ''}`.replaceAll('\r\n', '\n');
fs.writeFileSync(`${out}/${mode}.txt`, log);
const after = inputs();
const summary = { command: [npm, ...args], started: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000, exitCode: result.status, error: result.error?.message,
    inputs: Object.keys(before).length, changedInputs: Object.keys(after).filter(f => before[f] !== after[f]) };
fs.writeFileSync(`${out}/${mode}-inputs.json`, JSON.stringify(before, null, 2) + '\n');
if (fs.existsSync(`${out}/${mode}.json`)) {
    const r = JSON.parse(fs.readFileSync(`${out}/${mode}.json`, 'utf8'));
    Object.assign(summary, { files: r.testResults.length, passed: r.numPassedTests, failed: r.numFailedTests, pending: r.numPendingTests,
        failures: r.testResults.flatMap(f => f.assertionResults.filter(t => t.status === 'failed').map(t => ({ file: f.name.split(/[\\/]/).pop(), name: t.fullName, message: t.failureMessages.join('\n').replace(/\u001b\[[0-9;]*m/g, '') }))) });
}
fs.writeFileSync(`${out}/${mode}-summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
process.exitCode = result.status ?? 1;
