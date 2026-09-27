import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x2j-evidence';
const mode = process.argv[2] ?? 'full-final';
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const inputs = () => Object.fromEntries([...walk('src'), ...walk('public'), ...walk('scripts'),
    'package.json', 'package-lock.json', 'vite.config.ts',
    ...[2,3,4].map(n => `ai_docs/reports/u-r${n}-trace.json${n === 2 ? '' : '.gz'}`),
    `${out}/ce-state.json`].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const args = mode === 'build-final' ? ['run', 'build']
    : mode === 'drift-final' ? ['run', 'test:drift', '--', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${out}/${mode}.json`]
    : ['test', '--', ...(mode === 'deep-final' ? ['src/test/u_26a_deep_baseline.test.ts'] : []),
        '--maxWorkers=6', '--reporter=default', '--reporter=json', `--outputFile=${out}/${mode}.json`];
const before = inputs(), start = Date.now();
fs.writeFileSync(`${out}/${mode}-inputs.json`, JSON.stringify(before, null, 2) + '\n');
const log = fs.openSync(`${out}/${mode}.txt`, 'w');
const result = spawnSync('npm', args, { stdio: ['ignore', log, log] });
fs.closeSync(log);
const after = inputs();
const summary = { command: ['npm', ...args], start: new Date(start).toISOString(),
    seconds: (Date.now() - start) / 1000, exit: result.status, inputs: Object.keys(before).length,
    changedInputs: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]) };
if (fs.existsSync(`${out}/${mode}.json`)) {
    const r = JSON.parse(fs.readFileSync(`${out}/${mode}.json`, 'utf8'));
    Object.assign(summary, { files: r.testResults.length, passed: r.numPassedTests, failed: r.numFailedTests,
        pending: r.numPendingTests, todo: r.numTodoTests,
        failures: r.testResults.flatMap(t => t.assertionResults.filter(a => a.status === 'failed')
            .map(a => ({ file: t.name, name: a.fullName, messages: a.failureMessages }))) });
}
fs.writeFileSync(`${out}/${mode}-summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
process.exitCode = result.status ?? 1;
