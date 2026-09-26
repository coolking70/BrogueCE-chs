import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x2d-evidence';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const changed = git('diff', '--name-only').split('\n').filter(Boolean);
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
const root = path.resolve('..');
const files = [...changed.map(f => path.join(root, f)), ...untracked.map(f => path.resolve(f))];
const crlf = files.filter(f => fs.existsSync(f) && /\.(ts|mjs|json|md|txt|c)$/.test(f) && fs.readFileSync(f).includes(Buffer.from('\r\n'))).map(f => path.relative(root, f));
const old = JSON.parse(fs.readFileSync(`${out}/baseline-before.json`, 'utf8'));
const baselines = Object.fromEntries(Object.keys(old).map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const full = JSON.parse(fs.readFileSync(`${out}/full-final2.json`, 'utf8'));
const closure = JSON.parse(fs.readFileSync(`${out}/closure.json`, 'utf8'));
const tested = full.testResults.map(f => f.name.replaceAll('\\', '/').split('/brogue-web/')[1]);
const missingClosure = closure.union.filter(f => !tested.includes(f) && f !== 'src/test/generation_baseline.test.ts');
const summary = JSON.parse(fs.readFileSync(`${out}/full-final2-summary.json`, 'utf8'));
const result = {
    head: git('rev-parse', 'HEAD'), staged: git('diff', '--cached', '--name-only'), changedTracked: changed,
    baselineCount: Object.keys(old).length, baselineChanges: Object.keys(old).filter(f => old[f] !== baselines[f]),
    existingTestChanges: changed.filter(f => /\/src\/test\//.test(f)), crlf, closureFiles: closure.union.length, missingClosure,
    finalTestFiles: full.testResults.length, finalPassed: full.numPassedTests, finalFailed: full.numFailedTests,
    finalPending: full.numPendingTests, frozenInputs: summary.inputs, changedDuringFinalFull: summary.changedInputs,
    deferred: full.testResults.flatMap(f => f.assertionResults.filter(t => ['pending', 'todo', 'skipped'].includes(t.status)).map(t => ({ file: f.name.split(/[\\/]/).pop(), name: t.fullName, status: t.status }))),
};
fs.writeFileSync(`${out}/delivery-check.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.staged || result.baselineChanges.length || result.existingTestChanges.length || crlf.length || missingClosure.length || summary.changedInputs.length) process.exitCode = 1;
