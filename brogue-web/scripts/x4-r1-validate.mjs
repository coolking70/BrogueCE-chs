import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const phase = process.argv[2] ?? 'final';
if (!['initial', 'final'].includes(phase)) throw Error('Expected initial or final');
const out = 'ai_docs/reports/x4-r1-evidence';
fs.mkdirSync(out, { recursive: true });
const checks = [
    ['tsc', 'npx vue-tsc -b'],
    ['build', 'npm run build'],
    ['test', `npm test -- --maxWorkers=${phase === 'final' ? 8 : 4} --reporter=default --reporter=json --outputFile=${out}/${phase}-test.json`],
    ['drift', `npm run test:drift -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=${out}/${phase}-drift.json`],
];
const results = [];
for (const [name, command] of checks) {
    console.log(`START ${phase} ${name}: ${command}`);
    const start = Date.now();
    const log = `${out}/${phase}-${name}.log`;
    const fd = fs.openSync(log, 'w');
    const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { stdio: ['ignore', fd, fd], windowsHide: true });
    fs.closeSync(fd);
    fs.writeFileSync(log, fs.readFileSync(log, 'utf8').replace(/\r\n/g, '\n'));
    results.push({ name, command, exit: result.status, error: result.error?.message, seconds: (Date.now() - start) / 1000, log });
    fs.writeFileSync(`${out}/${phase}-gates.json`, JSON.stringify(results, null, 2) + '\n');
    console.log(`END ${phase} ${name}: exit=${result.status} seconds=${results.at(-1).seconds}`);
}
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
