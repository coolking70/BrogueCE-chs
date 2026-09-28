// Historical extra full attempt; stopped without completion.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const out = 'ai_docs/reports/x3-u4-evidence';
fs.mkdirSync(out, { recursive: true });
const jobs = [
    ['types', 'npx', ['vue-tsc', '-b']],
    ['build', 'npm', ['run', 'build']],
    ['full', 'npm', ['test', '--', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile.json=${out}/full-results.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--maxWorkers=1']],
];
const results = [];
for (const [name, command, args] of jobs) {
    const started = new Date(), fd = fs.openSync(`${out}/${name}.txt`, 'w');
    console.log(`${started.toISOString()} START ${command} ${args.join(' ')}`);
    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', fd, fd] });
        child.on('error', reject); child.on('exit', resolve);
    });
    fs.closeSync(fd);
    results.push({ name, command, args, started: started.toISOString(), seconds: (Date.now() - started.getTime()) / 1000, exitCode });
    fs.writeFileSync(`${out}/validation.json`, JSON.stringify(results, null, 2) + '\n');
    console.log(`${new Date().toISOString()} END ${name}: ${exitCode}`);
}
process.exitCode = results.every(r => r.exitCode === 0) ? 0 : 1;
