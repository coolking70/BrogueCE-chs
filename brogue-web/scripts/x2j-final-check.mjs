import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x2j-evidence';
const read = name => JSON.parse(fs.readFileSync(`${out}/${name}.json`, 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = read('full-final-inputs');
const changedSinceFull = Object.keys(before).filter(f => !fs.existsSync(f) || sha(f) !== before[f]);
const protectedFiles = read('baseline-before');
const baselineChanges = Object.keys(protectedFiles).filter(f => sha(f) !== protectedFiles[f]);
const full = read('full-final'), drift = read('drift-final'), closure = read('closure');
const covered = new Set([...full.testResults, ...drift.testResults].map(r => path.relative(process.cwd(), r.name)));
const missingClosure = closure.union.filter(f => !covered.has(f));
const changed = execFileSync('git', ['diff', '--name-only', '--relative'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--full-name'], { encoding: 'utf8' }).trim().split('\n')
    .filter(f => f.startsWith('brogue-web/')).map(f => f.slice('brogue-web/'.length));
const crlf = [...new Set([...changed, ...untracked])].filter(f => fs.existsSync(f) && /\.(ts|mjs|py|md|json|txt|c)$/.test(f))
    .filter(f => fs.readFileSync(f).includes(Buffer.from('\r\n')));
let diffCheck = true;
try { execFileSync('git', ['diff', '--check'], { stdio: 'pipe' }); } catch { diffCheck = false; }
const result = { changedSinceFull, baselineChanges, missingClosure, closureFiles: closure.union.length,
    sourceReadingTests: closure.S.sourceReaders.length, crlf, diffCheck,
    gates: Object.fromEntries(['full-final', 'build-final', 'drift-final', 'deep-final'].map(n => [n, read(`${n}-summary`)])) };
fs.writeFileSync(`${out}/final-check.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (changedSinceFull.length || baselineChanges.length || missingClosure.length || crlf.length || !diffCheck
    || Object.values(result.gates).some(g => g.exit !== 0 || g.changedInputs.length)) process.exitCode = 1;
