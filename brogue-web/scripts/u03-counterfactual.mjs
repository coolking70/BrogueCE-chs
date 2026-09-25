// Run the unchanged historical assertions on HEAD in a disposable source copy.
// No real source, fixture, scanner, or expectation is edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const dir = path.resolve('ai_docs/reports/u-03-evidence');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brogue-u03-head-'));
const files = ['c_4a_0_layer_model', 'p1_37_machine_flag_i18n', 'f_1_fire_as_terrain',
    'w_6_arcana_recharge', 'w_7_arcana_enchantment', 'w_13_tunneling', 'w_24_wand_catalog', 'w_25_staff_catalog', 'b_1b_identification_persistence', 'u_02b_level_rng'];
const pattern = '旧格式兼容|AD3a:|旧存档迁移|current flags round-trip|legacy|real old seven-row|new maps, partial|读档与新局都复位|JSON preserves|pack/ground JSON round-trip|pending transaction survives JSON';
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
