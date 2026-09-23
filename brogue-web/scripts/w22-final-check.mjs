// Final audit: immutable source, original CE probe, explicit regression files, build, drift.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-22-evidence';
fs.mkdirSync(dir, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const tracked = execFileSync('git', ['ls-files', '-z', 'src', 'public', 'package.json', 'package-lock.json', 'tsconfig*', 'vite.config.ts'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const unchangedFromHead = () => tracked.every(f => fs.readFileSync(f).equals(execFileSync('git', ['show', `HEAD:brogue-web/${f}`])));
if (!unchangedFromHead()) throw Error('Deferred W-22 must not modify existing runtime/data/tests/config');
execFileSync(process.execPath, ['scripts/w22-test-scope.mjs'], { stdio: 'inherit' });
const scope = JSON.parse(fs.readFileSync(`${dir}/closure.json`, 'utf8'));
const manifest = () => [...new Set([...walk('src'), ...walk('public'), ...walk('scripts'), ...walk('../BrogueCE-master/src'),
    ...tracked, 'ai_docs/tasks/w-22.prompt.md', 'ai_docs/reports/w-0-survey.report.md',
    `${dir}/ce-learning.c`, `${dir}/ce-learning.txt`, `${dir}/ce-bolts.json`, `${dir}/closure.json`, `${dir}/semantic-hits.txt`])]
    .sort().map(f => `${sha(fs.readFileSync(f))}  ${f}`).join('\n') + '\n';
const before = manifest(); fs.writeFileSync(`${dir}/sha256-before.txt`, before);
const regressionFiles = scope.all.filter(f => !f.endsWith('/generation_baseline.test.ts'));
const runs = [
    ['ce-audit', process.execPath, ['scripts/w22-ce-audit.mjs']],
    ['build', 'npm', ['run', 'build']],
    ['regression', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...regressionFiles, '--maxWorkers=8', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-regression.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-drift.json`]],
];
const results = [];
const run = (name, bin, args) => {
    const start = new Date().toISOString(), log = fs.openSync(`${dir}/final-${name}.log`, 'w');
    console.log(`${start} START ${name}`);
    const r = spawnSync(bin, args, { stdio: ['ignore', log, log], env: process.env }); fs.closeSync(log);
    const result = { name, bin, args, start, end: new Date().toISOString(), exit: r.status, error: r.error?.message };
    console.log(`${result.end} END ${name} exit=${r.status}`); return result;
};
for (const [name, bin, args] of runs) results.push(run(name, bin, args));
const retries = [];
const batch = JSON.parse(fs.readFileSync(`${dir}/final-regression.json`, 'utf8'));
// If contention alone causes timeouts, rerun only those explicit files serially at the original timeout.
for (const t of batch.testResults.filter(t => t.status === 'failed')) {
    const failed = t.assertionResults.filter(a => a.status === 'failed');
    if (!failed.length || !failed.every(a => (a.failureMessages ?? []).some(m => /Test timed out|Hook timed out|Timeout of \d+ms exceeded/i.test(m)))) continue;
    const file = path.relative(process.cwd(), t.name), name = `serial-${retries.length + 1}`;
    retries.push({ file, ...run(name, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', file, '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-${name}.json`]) });
}
const after = manifest(); fs.writeFileSync(`${dir}/sha256-after.txt`, after);
const perFile = new Map();
for (const name of ['regression', 'drift', ...retries.map(r => r.name)]) {
    const json = JSON.parse(fs.readFileSync(`${dir}/final-${name}.json`, 'utf8'));
    for (const t of json.testResults) {
        const statuses = {}; for (const a of t.assertionResults) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
        const file = path.relative(process.cwd(), t.name); perFile.set(file, { file, status: t.status, statuses, run: name });
    }
}
const counts = {}; for (const f of perFile.values()) for (const [s, n] of Object.entries(f.statuses)) counts[s] = (counts[s] ?? 0) + n;
const files = [...perFile.values()].sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(`${dir}/final-files.json`, JSON.stringify({ counts, files }, null, 2) + '\n');
const summary = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    results, retries, fileCount: files.length, counts, filesHashed: before.trim().split('\n').length,
    shaBefore: sha(before), shaAfter: sha(after), unchanged: before === after, unchangedFromHead: unchangedFromHead() };
fs.writeFileSync(`${dir}/final-summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, results: results.map(({ name, exit }) => ({ name, exit })) }, null, 2));
process.exitCode = summary.unchanged && summary.unchangedFromHead && results.filter(r => r.name !== 'regression').every(r => r.exit === 0)
    && files.every(f => f.status === 'passed') && files.length === new Set([...regressionFiles, 'src/test/generation_baseline.test.ts']).size ? 0 : 1;
