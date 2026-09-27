// Isolated regressions against the pre-X2m guard premises. Never edits working-tree guards,
// production files, snapshots or fixtures. Run from brogue-web.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), stageRoot = path.join(os.tmpdir(), `brogue-x2m-counterfactual-${process.pid}`);
const stage = path.join(stageRoot, 'brogue-web'), out = path.join(root, 'ai_docs/reports/x2m-evidence');
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });
// Preserve the original guard premises in this isolated experiment even after
// their narrowly documented corrections land in the working tree.
for (const name of ['c_7_lighting.test.ts', 'w_21_empowerment.test.ts']) {
    const baseline = spawnSync('git', ['show', `HEAD:brogue-web/src/test/${name}`],
        { cwd: root, encoding: 'utf8', windowsHide: true });
    if (baseline.status !== 0) throw new Error(baseline.stderr);
    fs.writeFileSync(path.join(stage, 'src/test', name), baseline.stdout);
}
for (const name of ['package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'])
    fs.copyFileSync(path.join(root, name), path.join(stage, name));
for (const [name, target] of [['node_modules', path.join(root, 'node_modules')], ['ai_docs', path.join(root, 'ai_docs')], ['scripts', path.join(root, 'scripts')], ['../BrogueCE-master', path.resolve(root, '../BrogueCE-master')]]) {
    const link = path.resolve(stage, name);
    if (!fs.existsSync(link)) fs.symlinkSync(target, link, 'junction');
}
const file = path.join(stage, 'src/engine/Core/Game.ts');
const original = fs.readFileSync(file, 'utf8');
const variants = {
    'missing-sources': original.split('\n').filter(line => !/this\.createFlare.*LightKind\.(SUMMONING_FLASH_LIGHT|GENERIC_FLASH_LIGHT)/.test(line))
        .join('\n').replace(/        if \(!isSubmerged\(target\)\) \{\n            if \(runicType === 'speed'\)[\s\S]*?\n        }/, ''),
    'hidden-empowerment': original.replace('                    this.createFlare(target.x, target.y, LightKind.EMPOWERMENT_LIGHT);\n                    if (autoID) {',
        '                    if (autoID) {\n                        this.createFlare(target.x, target.y, LightKind.EMPOWERMENT_LIGHT);'),
};
const results = [];
for (const [name, source] of Object.entries(variants)) {
    if (source === original) throw new Error(`Variant did not mutate: ${name}`);
    fs.writeFileSync(file, source);
    const log = fs.openSync(path.join(out, `negative-${name}.txt`), 'w');
    const tests = name === 'missing-sources'
        ? ['src/test/c_7_lighting.test.ts', 'src/test/x2m_lighting.test.ts']
        : ['src/test/w_21_empowerment.test.ts', 'src/test/x2m_lighting.test.ts'];
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers=2', '--reporter=json',
        `--outputFile=${path.join(out, `negative-${name}.json`)}`], { cwd: stage, stdio: ['ignore', log, log], windowsHide: true });
    fs.closeSync(log); results.push({ name, status: run.status });
}
fs.writeFileSync(file, original);
fs.writeFileSync(path.join(out, 'counterfactual-summary.json'), JSON.stringify(results, null, 2) + '\n');
