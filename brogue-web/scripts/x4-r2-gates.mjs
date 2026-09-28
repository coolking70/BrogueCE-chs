import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const phase = process.argv[2] ?? 'initial';
const out = 'ai_docs/reports/x4-r2-evidence';
const results = [];
const commands = [
    ['typecheck', 'npx vue-tsc -b'],
    ['build', 'npm run build'],
    ['test', `npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile=${out}/${phase}-test.json`],
    ['drift', `npm run test:drift -- --maxWorkers=1 --reporter=json --outputFile=${out}/${phase}-drift.json`],
];
for (const [label, command] of commands) {
    const log = `${out}/${phase}-${label}.log`, fd = fs.openSync(log, 'w'), start = Date.now();
    console.log('START', phase, label);
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
        stdio: ['ignore', fd, fd], windowsHide: true,
    });
    fs.closeSync(fd);
    fs.writeFileSync(log, fs.readFileSync(log, 'utf8').replace(/\r\n/g, '\n'));
    results.push({label, command, exit: result.status, error: result.error?.message,
        seconds: (Date.now() - start) / 1000, log});
    fs.writeFileSync(`${out}/${phase}-gates.json`, JSON.stringify(results, null, 2) + '\n');
    console.log('END', label, result.status);
}
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
