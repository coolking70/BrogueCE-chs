// Run the requested unchanged npm gates and retain UTF-8/LF evidence.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'ai_docs/reports/x3b-evidence');
mkdirSync(out, { recursive: true });
function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const path = resolve(dir, e.name);
        return e.isDirectory() ? files(path) : [path];
    });
}
const tests = files(resolve(root, 'src')).filter(p => p.endsWith('.test.ts'));
const names = paths => paths.map(p => relative(root, p).replaceAll('\\', '/')).sort();
const sourceReaders = tests.filter(p => /readFile(?:Sync)?\s*\(/.test(readFileSync(p, 'utf8')));
const relevant = tests.filter(p => /(?:x3b_|x2[a-z]_|u_27|u_r[234]|p1_30|u24_|ui_|DetailGenerator|armor_display_effect|b_1[ab]|w_[1256]_|c_7_|p2_|u_0[123]|u_13|u_23|u_26a)/.test(p));
const closure = { R: names(relevant), S: names(sourceReaders), union: names([...new Set([...relevant, ...sourceReaders])]) };
writeFileSync(resolve(out, 'rs-closure.json'), JSON.stringify(closure, null, 2) + '\n');
const baseline = [resolve(root, 'package.json'), resolve(root, 'vite.config.ts'),
    ...files(resolve(root, 'src/test')).filter(p => /baseline/.test(p)),
    ...files(resolve(root, 'ai_docs/reports')).filter(p => /u-r[24]-trace|deep.*baseline|generation.*baseline/.test(p) && !p.includes('x3b-evidence'))];
const hashes = () => Object.fromEntries(names(baseline).map(p => [p, createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex')]));
const phase = process.argv[2];
if (phase === 'inventory') {
    writeFileSync(resolve(out, 'baseline-before.json'), JSON.stringify(hashes(), null, 2) + '\n');
    console.log(JSON.stringify({ tests: tests.length, R: closure.R.length, S: closure.S.length, union: closure.union.length, protected: baseline.length }));
    process.exit(0);
}
const commands = {
    full: 'npm test -- --maxWorkers=8 --reporter=json --outputFile=ai_docs/reports/x3b-evidence/full.json',
    drift: 'npm run test:drift -- --maxWorkers=1 --reporter=json --outputFile=ai_docs/reports/x3b-evidence/drift.json',
    build: 'npm run build',
    targeted: 'node node_modules/vitest/vitest.mjs run src/test/x3b_display_recording.test.ts src/test/x3b_item_details.test.ts --maxWorkers=2 --reporter=json --outputFile=ai_docs/reports/x3b-evidence/targeted.json',
};
if (!commands[phase]) throw new Error('Expected inventory, full, drift, build or targeted');
const started = new Date(), chunks = [];
const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', commands[phase]], { cwd: root, windowsHide: true });
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { chunks.push(b); });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => {
    writeFileSync(resolve(out, `${phase}.txt`), Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n'));
    const result = { command: commands[phase], started: started.toISOString(), finished: new Date().toISOString(), seconds: (Date.now() - started.getTime()) / 1000, exitCode: code };
    const jsonPath = resolve(out, `${phase}.json`);
    if (phase !== 'build') {
        try {
            const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
            Object.assign(result, { files: j.testResults.length, total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, pending: j.numPendingTests, todo: j.numTodoTests });
            result.failures = j.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed').map(a => ({ file: relative(root, f.name), title: a.fullName, messages: a.failureMessages })));
        } catch { /* Startup failures are retained in the text log. */ }
    }
    writeFileSync(resolve(out, `${phase}-summary.json`), JSON.stringify(result, null, 2) + '\n');
    writeFileSync(resolve(out, 'baseline-after.json'), JSON.stringify(hashes(), null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    if (code) console.log(Buffer.concat(chunks).toString('utf8').slice(-4000));
    process.exitCode = code ?? 1;
});
