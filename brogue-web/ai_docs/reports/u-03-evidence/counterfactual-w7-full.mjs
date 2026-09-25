// Run the unchanged historical assertions on HEAD in a disposable source copy.
// No real source, fixture, scanner, or expectation is edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const dir = path.resolve('ai_docs/reports/u-03-evidence/counterfactual-w7-full');
fs.mkdirSync(dir, {recursive:true});
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brogue-u03-head-'));
const files = ['w_7_arcana_enchantment'];
const pattern = 'W-7';
try {
    const archive = execFileSync('git', ['archive', 'HEAD', 'brogue-web/src', 'brogue-web/package.json', 'brogue-web/vite.config.ts', 'BrogueCE-master/src', 'brogue-web/ai_docs/reports/u-02b-evidence/ce-reference.json'],
        { cwd: '..', maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', temp], { input: archive });
    const cwd = path.join(temp, 'brogue-web'), modules = path.join(cwd, 'node_modules'); fs.mkdirSync(modules);
    for (const name of fs.readdirSync('node_modules').filter(n => !n.startsWith('.') || n === '.bin'))
        fs.symlinkSync(fs.realpathSync(path.join('node_modules', name)), path.join(modules, name));
    const fd = fs.openSync(path.join(dir, 'counterfactual-head.txt'), 'w');
    const args = ['vitest', 'run', ...files.map(f => `src/test/${f}.test.ts`), '-t', pattern,
        '--maxWorkers=4', '--reporter=default', '--reporter=json', `--outputFile.json=${path.join(dir, 'counterfactual-head.json')}`];
    const r = spawnSync('npx', args, { cwd, stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
    fs.writeFileSync(path.join(dir, 'counterfactual.json'), JSON.stringify({ baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files, pattern, status: r.status }, null, 2) + '\n');
    process.exitCode = r.status ?? 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
