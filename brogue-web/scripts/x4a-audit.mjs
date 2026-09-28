import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'ai_docs/reports/x4a-evidence');
const read = name => JSON.parse(readFileSync(resolve(out, name), 'utf8'));
const before = read('baseline-before.json');
const phases = ['tsc', 'build', 'full', 'drift'];
const summaries = Object.fromEntries(phases.map(phase => [phase, read(`${phase}-summary.json`)]));
const rows = [...read('full.json').testResults, ...read('drift.json').testResults];
const executed = new Set(rows.map(row => relative(root, row.name).replaceAll('\\', '/')));
const closure = read('rs-closure.json');
const sha = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const protectedChanges = Object.entries(before).filter(([path, hash]) => sha(path) !== hash).map(([path]) => path);
const sourceMismatches = phases.flatMap(phase => Object.entries(summaries[phase].productionHashes ?? {}).filter(([path, hash]) => sha(path) !== hash).map(([path]) => `${phase}: ${path}`));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const changed = [...git(['diff', '--name-only', '--relative']), ...git(['ls-files', '--others', '--exclude-standard'])];
const textFiles = changed.filter(path => !/\.(png|jpg|gz)$/.test(path));
const crlf = textFiles.filter(path => readFileSync(resolve(root, path)).includes(13));
const oldGuardChanges = git(['diff', '--name-only', '--relative', '--', 'src']).filter(path => path.endsWith('.test.ts'));
const priorContract = JSON.parse(execFileSync('git', ['show', 'HEAD:brogue-web/scripts/u03-state-contract.json'], { cwd: root, encoding: 'utf8' }));
const currentContract = JSON.parse(readFileSync(resolve(root, 'scripts/u03-state-contract.json'), 'utf8'));
const contractDelta = {
    added: Object.keys(currentContract).filter(key => !(key in priorContract)),
    removed: Object.keys(priorContract).filter(key => !(key in currentContract)),
    changedExisting: Object.keys(priorContract).filter(key => key in currentContract && JSON.stringify(priorContract[key]) !== JSON.stringify(currentContract[key])),
};
const fixturePremiseChanges = changed.filter(path => path.startsWith('src/test/fixtures/'));
const missing = closure.union.filter(path => !executed.has(path));
const distChanges = changed.filter(path => path.startsWith('dist/'));
const result = {
    head: git(['rev-parse', 'HEAD'])[0],
    stagedFiles: git(['diff', '--cached', '--name-only']),
    phases: Object.fromEntries(phases.map(phase => [phase, { exitCode: summaries[phase].exitCode, seconds: summaries[phase].seconds, total: summaries[phase].total, passed: summaries[phase].passed, failed: summaries[phase].failed, pending: summaries[phase].pending, todo: summaries[phase].todo }])),
    closure: { R: closure.R.length, S: closure.S.length, union: closure.union.length, executedFiles: executed.size, missing },
    protectedCount: Object.keys(before).length, protectedChanges, sourceMismatches, oldGuardChanges, contractDelta, fixturePremiseChanges, crlf, distChanges,
    failures: rows.flatMap(row => row.assertionResults.filter(test => test.status === 'failed').map(test => ({ file: row.name, name: test.fullName }))),
    uncommittedFiles: changed,
};
result.ok = phases.every(phase => summaries[phase].exitCode === 0 && !!summaries[phase].productionHashes)
    && JSON.stringify(contractDelta.added) === '["isAutoExploring"]' && !contractDelta.removed.length && !contractDelta.changedExisting.length
    && ![protectedChanges, sourceMismatches, oldGuardChanges, crlf, distChanges, missing, result.failures].some(a => a.length);
writeFileSync(resolve(out, 'final-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
