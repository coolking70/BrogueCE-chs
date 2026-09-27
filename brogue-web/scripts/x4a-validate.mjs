// Run the requested unchanged npm gates and retain UTF-8/LF evidence.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'ai_docs/reports/x4a-evidence');
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
const relevant = tests.filter(p => /(?:x4a_|x3[ab]_|x2[a-z]_|w_18|fe_1_touch|i_1_interaction|u_27|u_r[234]|p1_30|p1_20|u24_|ui_|DetailGenerator|armor_display_effect|b_1[ab]|w_[1256]_|c_7_|p2_|u_0[123]|u_13|u_19e|u_23|u_26a)/.test(p));
const closure = { R: names(relevant), S: names(sourceReaders), union: names([...new Set([...relevant, ...sourceReaders])]) };
writeFileSync(resolve(out, 'rs-closure.json'), JSON.stringify(closure, null, 2) + '\n');
const baseline = [resolve(root, 'package.json'), resolve(root, 'vite.config.ts'),
    ...files(resolve(root, 'src/test')).filter(p => /baseline/.test(p)),
    ...files(resolve(root, 'ai_docs/reports')).filter(p => /u-r[234]-trace|deep.*baseline|generation.*baseline/.test(p) && !p.includes('x4a-evidence'))];
const hashes = () => Object.fromEntries(names(baseline).map(p => [p, createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex')]));
const phase = process.argv[2];
if (phase === 'inventory') {
    writeFileSync(resolve(out, 'baseline-before.json'), JSON.stringify(hashes(), null, 2) + '\n');
    console.log(JSON.stringify({ tests: tests.length, R: closure.R.length, S: closure.S.length, union: closure.union.length, protected: baseline.length }));
    process.exit(0);
}
const commands = {
    full: 'npm test -- --maxWorkers=8 --reporter=default --reporter=json --outputFile=ai_docs/reports/x4a-evidence/full.json',
    drift: 'npm run test:drift -- --maxWorkers=1 --reporter=json --outputFile=ai_docs/reports/x4a-evidence/drift.json',
    build: 'npm run build',
    tsc: 'npx vue-tsc -b',
    targeted: 'node node_modules/vitest/vitest.mjs run src/test/x4a_movement_rendering.test.ts src/test/p1_30_i18n_gate.test.ts src/test/u24_hardcoded_text.test.ts src/test/u_27_recording.test.ts src/test/x2a_recording_checkpoint.test.ts src/test/x3b_display_recording.test.ts src/test/w_18_entrancement.test.ts src/test/p2_2_real_speed.test.ts src/test/p2_4_animation_cadence.test.ts src/test/fe_1_touch.test.ts src/test/i_1_interaction.test.ts --maxWorkers=4 --reporter=json --outputFile=ai_docs/reports/x4a-evidence/targeted.json',
};
if (!commands[phase]) throw new Error('Expected inventory, full, drift, build or targeted');
const started = new Date(), chunks = [];
const child = spawn('/bin/zsh', ['-c', commands[phase]], { cwd: root });
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { chunks.push(b); process.stdout.write(b); });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => {
    writeFileSync(resolve(out, `${phase}.txt`), Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n'));
    const result = { command: commands[phase], started: started.toISOString(), finished: new Date().toISOString(), seconds: (Date.now() - started.getTime()) / 1000, exitCode: code };
    const jsonPath = resolve(out, `${phase}.json`);
    if (phase !== 'build' && phase !== 'tsc') {
        try {
            const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
            Object.assign(result, { files: j.testResults.length, total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, pending: j.numPendingTests, todo: j.numTodoTests });
            result.failures = j.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed').map(a => ({ file: relative(root, f.name), title: a.fullName, messages: a.failureMessages })));
        } catch { /* Startup failures are retained in the text log. */ }
    }
    const protectedBefore = JSON.parse(readFileSync(resolve(out, 'baseline-before.json'), 'utf8'));
    result.protectedUnchanged = Object.entries(protectedBefore).every(([path, hash]) => hashes()[path] === hash);
    result.productionHashes = Object.fromEntries([
        'src/engine/Core/Game.ts', 'src/engine/Movement/PlayerTravel.ts', 'src/engine/Map/Pathfind.ts',
        'src/components/GameCanvas.vue', 'src/components/TargetBar.vue', 'src/ui/mapGlyph.ts',
        'src/locales/zh_CN.json', 'src/test/x4a_movement_rendering.test.ts',
        'scripts/u03-state-contract.json', 'src/test/fixtures/u19e-machine-actions.ts',
    ].map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
    writeFileSync(resolve(out, `${phase}-summary.json`), JSON.stringify(result, null, 2) + '\n');
    writeFileSync(resolve(out, 'baseline-after.json'), JSON.stringify(hashes(), null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    if (code) console.log(Buffer.concat(chunks).toString('utf8').slice(-4000));
    process.exitCode = result.protectedUnchanged ? (code ?? 1) : 1;
});
