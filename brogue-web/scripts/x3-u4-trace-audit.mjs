// Isolated UR4 bundles: HEAD -> only final vision -> only visible-set commit -> full change.
// Original observer and commands are reused; golden fixtures are never written here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u4-evidence', stages = ['head', 'vision', 'sets', 'current'];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'x3-u4-trace-'));
const head = file => execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { encoding: 'utf8' });
const sha = value => createHash('sha256').update(value).digest('hex');
const game = 'src/engine/Core/Game.ts', time = 'src/engine/Core/TimeCoordinator.ts';
const changed = execFileSync('git', ['diff', '--name-only', '--', 'src'], { encoding: 'utf8' })
    .trim().split('\n').filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => f.replace(/^brogue-web\//, ''));
const originals = Object.fromEntries(changed.map(f => [f, head(f)]));
function source(stage, file) {
    if (stage === 'current') return fs.readFileSync(file, 'utf8');
    let text = originals[file] ?? fs.readFileSync(file, 'utf8');
    if (stage !== 'head' && file === time) text = text.replace('        ports.clock.needsRender = true;\n    }', '        ports.effects.updateVision();\n        ports.clock.needsRender = true;\n    }');
    if (stage === 'sets' && file === game) {
        text = text.replace("import { playerTravelTerrainAllowed", "import { visibleEntities } from '../Movement/AutoTravelVisibility';\nimport { playerTravelTerrainAllowed");
        text = text.replace('        this.prepareFlareKnowledge();\n        this.updateFlavorText(); // CE Time.c:2876',
            '        this.prepareFlareKnowledge();\n        const current = visibleEntities(this.player, this.grid, this.monsters, this.items);\n        this.visibleMonsters = current.monsters; this.visibleItems = current.items;\n        this.updateFlavorText(); // CE Time.c:2876');
    }
    return text;
}
const read = file => JSON.parse(gunzipSync(fs.readFileSync(file)));
function diffs(a, b, p = '', result = []) {
    if (JSON.stringify(a) === JSON.stringify(b)) return result;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], `${p}/${k}`, result);
    } else result.push({ path: p, before: a, after: b });
    return result;
}
try {
    for (const stage of stages) {
        const inputs = {};
        const plugin = { name: stage, setup(b) { b.onLoad({ filter: /\/src\/.*\.(ts|json)$/ }, a => {
            const file = path.relative(process.cwd(), a.path);
            const contents = changed.includes(file) ? source(stage, file) : fs.readFileSync(file, 'utf8');
            inputs[file] = sha(contents);
            return { contents, loader: file.endsWith('.json') ? 'json' : 'ts' };
        }); } };
        const observer = head('src/test/u_r4_trace.test.ts')
            .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
            .replace(/const fixture = new URL\([^;]+;/, 'const fixture=process.argv[2];');
        await build({ stdin: { contents: observer, resolveDir: path.resolve('src/test'), loader: 'ts' }, outfile: `${work}/trace.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [plugin] });
        const result = spawnSync(process.execPath, [`${work}/trace.mjs`, `${out}/ur4-${stage}.json.gz`], { env: { ...process.env, UR4_CAPTURE: '1' }, stdio: 'inherit' });
        assert.equal(result.status, 0, stage);
        fs.writeFileSync(`${out}/trace-inputs-${stage}.json`, JSON.stringify(inputs, null, 2) + '\n');
        console.log(stage, 'captured');
    }
    // Keep attribution reproducible after the working golden has been recaptured.
    const originalGolden = JSON.parse(gunzipSync(execFileSync('git', ['show', 'HEAD:brogue-web/ai_docs/reports/u-r4-trace.json.gz'], { maxBuffer: 8 * 1024 * 1024 })));
    assert.deepEqual(read(`${out}/ur4-head.json.gz`), originalGolden);
    const comparisons = stages.slice(1).map((to, i) => ({ from: stages[i], to, differences: diffs(read(`${out}/ur4-${stages[i]}.json.gz`), read(`${out}/ur4-${to}.json.gz`)) }));
    fs.writeFileSync(`${out}/trace-attribution.json`, JSON.stringify(comparisons, null, 2) + '\n');
    assert.equal(comparisons.at(-1).differences.length, 0, 'Full change has a delta beyond isolated vision + visibility sets');
    for (const c of comparisons) console.log(c.from, '->', c.to, c.differences.length, 'leaf differences');
} finally { fs.rmSync(work, { recursive: true, force: true }); }
