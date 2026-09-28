import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u8c-evidence';
const workers = process.env.U8C_WORKERS ?? '1';
if (!['1', '2'].includes(workers)) throw new Error('U8C_WORKERS must be 1 or 2');
const concurrency = [`--maxWorkers=${workers}`, ...(workers === '1' ? ['--no-file-parallelism'] : [])];
fs.mkdirSync(out, { recursive: true });
const list = args => execFileSync('rg', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const all = list(['--files', 'src', '-g', '*.test.ts']).sort();
const readerCache = new Map();
function readsSource(file, seen = new Set()) {
    if (readerCache.has(file)) return readerCache.get(file);
    if (seen.has(file)) return false;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    if (/\breadFile(?:Sync)?\b|\breaddir(?:Sync)?\b|\bglobSync\b|\bexec(?:File)?Sync\b/.test(source)) return true;
    for (const m of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
        const root = path.resolve(path.dirname(file), m[1]);
        const dependency = [root, root + '.ts', root + '/index.ts'].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (dependency && /\.ts$/.test(dependency) && readsSource(dependency, seen)) return true;
    }
    return false;
}
const sourceReaders = all.filter(f => readsSource(f));
const pattern = 'logger|Combat|combat|inscrib|relabel|callItem|itemCallMode|RUNIC_HINTED|monsterIsInClass|inventoryLetter|displaySettings|DisplaySettings|Item\\.ts|Game\\.ts';
const direct = list(['-l', '-g', '*.test.ts', pattern, 'src']);
const required = all.filter(f => /\/(c_4a_terrain_catalog|p1_30|u24|repo_hygiene|u_r[234]|u_27|x2a|x3_u)/.test(f));
const reverse = [...new Set([...direct, ...sourceReaders, ...required])].sort();
fs.writeFileSync(`${out}/test-selection.json`, JSON.stringify({pattern, direct, sourceReaders, required, reverse, full: all}, null, 2) + '\n');
const inputs = [...list(['--files', 'src', 'scripts', '-g', '*.ts', '-g', '*.vue', '-g', '*.json', '-g', '*.mjs']), 'package.json', 'package-lock.json', 'vite.config.ts',
    'ai_docs/reports/u-r2-trace.json', 'ai_docs/reports/u-r3-trace.json.gz', 'ai_docs/reports/u-r4-trace.json.gz',
    ...list(['--files', '../BrogueCE-master/src', '-g', '*.c', '-g', '*.h'])];
const frozen = Object.fromEntries(inputs.map(f => [f, sha(f)]));
fs.writeFileSync(`${out}/gate-inputs.json`, JSON.stringify(frozen, null, 2) + '\n');
const results = [];
for (const [name, command, args] of [
    ['types', 'npx', ['--no-install', 'vue-tsc', '-b']],
    ['build', 'npm', ['run', 'build']],
    ['full', 'npm', ['test', '--', ...concurrency, '--reporter=default', '--reporter=json', `--outputFile.json=${out}/full.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--maxWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${out}/drift.json`]],
]) {
    const start = new Date(), fd = fs.openSync(`${out}/${name}.txt`, 'w');
    console.log(name, 'started', start.toISOString());
    const run = spawnSync(command, args, { stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
    results.push({ name, command: [command, ...args], exit: run.status, signal: run.signal, seconds: (Date.now() - start) / 1000 });
    fs.writeFileSync(`${out}/gate-results.json`, JSON.stringify(results, null, 2) + '\n');
    console.log(name, 'exit', run.status);
}
const changed = Object.entries(frozen).filter(([f, h]) => !fs.existsSync(f) || sha(f) !== h).map(([f]) => f);
fs.writeFileSync(`${out}/gate-integrity.json`, JSON.stringify({ inputs: inputs.length, changed }, null, 2) + '\n');
if (changed.length || results.some(r => r.exit !== 0)) process.exitCode = 1;
