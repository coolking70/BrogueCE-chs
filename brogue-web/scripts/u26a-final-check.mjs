import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
const out = 'ai_docs/reports/u-26a-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const save = (name, value) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
execFileSync(process.execPath, ['scripts/u26a-audit.mjs'], { stdio: 'inherit' });
const inputs = [...walk('src'), ...walk('public'), ...walk('scripts'),
    ...fs.readdirSync('.').filter(f => /^(package.*\.json|.*config.*\.[jt]s|tsconfig.*\.json|index\.html)$/.test(f)),
    'ai_docs/reports/u-r2-trace.json', 'ai_docs/reports/u-r3-trace.json.gz', 'ai_docs/reports/u-r4-trace.json.gz']
    .filter(f => !f.endsWith('.DS_Store')).sort();
const before = Object.fromEntries(inputs.map(f => [f, sha(f)])); save('frozen-inputs-before', before);
fs.writeFileSync(`${out}/failures-final.ndjson`, '');
const gates = [];
for (const [name, cmd, args] of [
    ['build', 'npm', ['run', 'build']],
    ['regression', 'npm', ['test', '--', '--maxWorkers=4', '--reporter=default', '--reporter=json',
        '--reporter=./scripts/u26a-failure-reporter.mjs', `--outputFile=${out}/regression-final.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--maxWorkers=1']],
    ['diff-check', 'git', ['diff', '--check']],
]) {
    const start = new Date().toISOString(), fd = fs.openSync(`${out}/${name}-final.txt`, 'w');
    const r = spawnSync(cmd, args, { stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
    gates.push({ name, command: [cmd, ...args], start, end: new Date().toISOString(), exit: r.status });
    save('final-gates', gates); console.log(name, r.status);
}
const after = Object.fromEntries(inputs.map(f => [f, sha(f)])); save('frozen-inputs-after', after);
const changed = inputs.filter(f => before[f] !== after[f]); save('frozen-input-differences', changed);
const result = JSON.parse(fs.readFileSync(`${out}/regression-final.json`));
const actual = new Set(result.testResults.map(r => path.relative(process.cwd(), r.name)));
const required = fs.readFileSync(`${out}/tests.txt`, 'utf8').trim().split('\n'), missing = required.filter(f => !actual.has(f));
save('closure-coverage', { required: required.length, executed: actual.size, missing });
const prefixes = ['p1_30', 'u24', 'u_00', 'u_01', 'u_03', 'u_03b', 'u_04', 'u_18a_3', 'u_26b', 'u_27', 'w_5', 'u_r2', 'u_r3', 'u_r4', 'v_'];
const named = Object.fromEntries(prefixes.map(p => [p, [...actual].filter(f => f.split('/').at(-1).startsWith(p))]));
save('named-guard-coverage', named);
const baselineBefore = JSON.parse(fs.readFileSync(`${out}/baseline-before.json`));
const baselineAfter = Object.fromEntries([...Object.keys(baselineBefore), 'src/test/fixtures/deep_generation_baseline.json'].map(f => [f, sha(f)]));
save('baseline-after', baselineAfter);
const recapture = JSON.parse(fs.readFileSync(`${out}/recapture.json`)), trace = JSON.parse(fs.readFileSync(`${out}/trace-recapture.json`));
const allowed = { [recapture.shallow.file]: recapture.shallow.after, [trace.file]: trace.after };
const unexpectedBaselines = Object.keys(baselineBefore).filter(f => baselineAfter[f] !== (allowed[f] ?? baselineBefore[f]));
if (baselineAfter[recapture.deep.file] !== recapture.deep.after) unexpectedBaselines.push(recapture.deep.file);
const deferred = result.testResults.flatMap(f => f.assertionResults.filter(a => !['passed', 'failed'].includes(a.status)).map(a => ({ file: path.relative(process.cwd(), f.name), test: a.fullName, status: a.status })));
save('existing-deferred-tests', deferred);
const crlf = inputs.filter(f => /\.(ts|vue|json|mjs|css|html)$/.test(f) && fs.readFileSync(f).includes(Buffer.from('\r\n')));
save('crlf-scan', crlf);
fs.writeFileSync(`${out}/final-results.md`, '| Test file | Passed | Failed | Pending/todo |\n|---|---:|---:|---:|\n' + result.testResults.map(f =>
    `| ${path.relative(process.cwd(), f.name)} | ${f.assertionResults.filter(a => a.status === 'passed').length} | ${f.assertionResults.filter(a => a.status === 'failed').length} | ${f.assertionResults.filter(a => !['passed', 'failed'].includes(a.status)).length} |`).join('\n') + '\n');
save('final-summary', { gates, files: actual.size, passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests, todo: result.numTodoTests,
    frozenInputs: inputs.length, changedInputs: changed, missing, missingNamed: prefixes.filter(p => !named[p].length), unexpectedBaselines,
    crlf, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), staged: execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim() });
if (gates.some(g => g.exit !== 0) || changed.length || missing.length || prefixes.some(p => !named[p].length) || unexpectedBaselines.length) process.exitCode = 1;
