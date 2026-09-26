import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
const out = 'ai_docs/reports/u-26a-evidence';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u26a-traces-'));
const doors = ['src/engine/Map/LoopMap.ts', 'src/engine/Generator/Architect.ts'];
const changed = execFileSync('git', ['diff', '--name-only', '--', 'src'], { encoding: 'utf8' }).trim().split('\n').map(p => p.replace(/^brogue-web\//, ''));
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
try {
    for (const stage of ['s0', 'doors', 'final']) for (const n of [2, 3, 4]) {
        let source = fs.readFileSync(`src/test/u_r${n}_trace.test.ts`, 'utf8')
            .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
            .replace(/const fixture = new URL\([^;]+;/, 'const fixture = process.argv[2];');
        await build({ stdin: { contents: source, resolveDir: path.resolve('src/test'), loader: 'ts' }, outfile: `${tmp}/trace.mjs`, bundle: true, platform: 'node', format: 'esm',
            plugins: [{ name: 'single-variable', setup(b) { b.onLoad({ filter: /\/src\/.*\.(ts|json)$/ }, a => {
                const f = path.relative(process.cwd(), a.path);
                if (!changed.includes(f) || stage === 'final' || (stage === 'doors' && doors.includes(f))) return;
                return { contents: execFileSync('git', ['show', `HEAD:brogue-web/${f}`], { encoding: 'utf8' }), loader: f.endsWith('.json') ? 'json' : 'ts' };
            }); } }] });
        const r = spawnSync(process.execPath, [`${tmp}/trace.mjs`, `${out}/ur${n}-${stage}.json${n === 2 ? '' : '.gz'}`], { env: { ...process.env, [`UR${n}_CAPTURE`]: '1' }, stdio: 'inherit' });
        if (r.status) throw Error(`UR${n}/${stage} failed`);
    }
    const read = f => { const raw = fs.readFileSync(f); return JSON.parse(f.endsWith('.gz') ? gunzipSync(raw) : raw); };
    const summary = [];
    for (const n of [2, 3, 4]) {
        const suffix = `.json${n === 2 ? '' : '.gz'}`, golden = `ai_docs/reports/u-r${n}-trace${suffix}`;
        const a = read(`${out}/ur${n}-s0${suffix}`), b = read(`${out}/ur${n}-doors${suffix}`), c = read(`${out}/ur${n}-final${suffix}`);
        const diff = (a, b, p = '') => {
            if (JSON.stringify(a) === JSON.stringify(b)) return [];
            if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], `${p}/${k}`));
            return [p];
        };
        summary.push({ trace: n, originalGoldenSha: sha(fs.readFileSync(golden)), headMatchesGolden: JSON.stringify(a) === JSON.stringify(read(golden)),
            doorsChanges: diff(a, b), otherChanges: diff(b, c), finalMatchesGolden: JSON.stringify(c) === JSON.stringify(read(golden)) });
    }
    fs.writeFileSync(`${out}/trace-attribution.json`, JSON.stringify(summary, null, 2) + '\n');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
