import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u4-evidence';
const scope = new Set(fs.readFileSync(`${out}/reverse-test-scope.txt`, 'utf8').trim().split('\n'));
const required = ['p1_30', 'u24', 'u_27_recording', 'x2a_recording_checkpoint', 'x3b_display_recording', 'x4a_movement_rendering', 'x4b_flavor_text', 'x3_u1_movement_safety', 'x3_u2_ally_captive', 'x3_u4', 'fe_1_touch', 'i_1_interaction', 'w_18', 'u_r2', 'u_r3', 'u_r4', 'u_03'];
const tests = fs.readdirSync('src/test').filter(f => f.endsWith('.test.ts'));
for (const prefix of required) {
    const found = tests.filter(f => f.startsWith(prefix));
    if (!found.length) throw Error(`Missing required suite ${prefix}`);
    for (const f of found) scope.add(`src/test/${f}`);
}
const files = [...scope].sort();
fs.writeFileSync(`${out}/targeted-scope.txt`, files.join('\n') + '\n');
const inputs = {};
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else inputs[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
} }
walk('src');
for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/u03-state-contract.json']) inputs[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(`${out}/targeted-inputs.json`, JSON.stringify(inputs, null, 2) + '\n');
const fd = fs.openSync(`${out}/targeted.txt`, 'w'), args = ['vitest', 'run', ...files, '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile.json=${out}/targeted-results.json`];
console.log('npx', args.join(' '));
const started = Date.now();
const code = await new Promise((resolve, reject) => { const p = spawn('npx', args, { stdio: ['ignore', fd, fd] }); p.on('error', reject); p.on('exit', resolve); });
fs.closeSync(fd);
const changed = Object.keys(inputs).filter(f => createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== inputs[f]);
fs.writeFileSync(`${out}/targeted-validation.json`, JSON.stringify({ files: files.length, code, seconds: (Date.now() - started) / 1000, changed }, null, 2) + '\n');
process.exitCode = code || Number(changed.length > 0);
