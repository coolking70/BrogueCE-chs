// Run from brogue-web. Explicit R+S scope, immutable source/config hashes, no baseline capture.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-7-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : [path.join(d,e.name)]);
const sha = data => createHash('sha256').update(data).digest('hex');
const manifest = () => [...walk('src'), ...walk('scripts'), 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'].sort().map(p => `${sha(fs.readFileSync(p))}  ${p}`).join('\n')+'\n';
const scopeRun = spawnSync(process.execPath, ['scripts/w7-test-scope.mjs'], { encoding: 'utf8' });
if (scopeRun.status !== 0) throw Error(scopeRun.stderr);
const scope = JSON.parse(fs.readFileSync(`${dir}/closure.json`, 'utf8'));
const before = manifest();
fs.writeFileSync(`${dir}/sha256-before.txt`, before);
const commands = [
    ['build', 'npm', ['run', 'build']],
    ['regression', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...scope.all.filter(p => !p.endsWith('/generation_baseline.test.ts')), '--maxWorkers=4', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-regression.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-drift.json`]],
];
const results = [];
for (const [name, bin, args] of commands) {
    const start = new Date().toISOString(), log = fs.openSync(`${dir}/final-${name}.log`, 'w');
    console.log(`${start} START ${name} (${name === 'regression' ? scope.all.length-1+' explicit files' : bin+' '+args.join(' ')})`);
    const result = spawnSync(bin, args, { stdio: ['ignore', log, log] });
    fs.closeSync(log);
    results.push({ name, bin, args, start, end: new Date().toISOString(), exitCode: result.status, error: result.error?.message });
    console.log(`${results.at(-1).end} END ${name} exit=${result.status}`);
}
const after = manifest();
fs.writeFileSync(`${dir}/sha256-after.txt`, after);
const summary = { results, filesHashed: before.trim().split('\n').length, shaBefore: sha(before), shaAfter: sha(after), unchanged: before === after };
fs.writeFileSync(`${dir}/final-summary.json`, JSON.stringify(summary, null, 2)+'\n');
console.log(JSON.stringify({ ...summary, results: results.map(({name,exitCode}) => ({name,exitCode})) }, null, 2));
process.exitCode = summary.unchanged && results.every(r => r.exitCode === 0) ? 0 : 1;
