// Original UR observers, isolated bundles: baseline -> archive metadata -> full U6.
// Does not write any golden fixture. Raw hashes must first match HEAD.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u6-evidence';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'x3-u6-trace-'));
const head = file => execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { encoding: 'utf8', maxBuffer: 16e6 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const changed = execFileSync('git', ['diff', '--name-only', '--', 'src'], { encoding: 'utf8' })
    .trim().split('\n').filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => f.replace(/^brogue-web\//, ''));
const sources = Object.fromEntries(changed.map(f => [f, head(f)]));
const read = file => JSON.parse(file.endsWith('.gz') ? gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file));
function diffs(a, b, p = '', result = []) {
    if (JSON.stringify(a) === JSON.stringify(b)) return result;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], `${p}/${k}`, result);
    } else result.push({ path: p, before: a, after: b });
    return result;
}
const results = [];
try {
    for (const unit of [2, 3, 4]) {
        for (const stage of ['head','archive','current']) {
            const inputs = {};
            const plugin = { name: stage, setup(b) { b.onLoad({ filter: /\/src\/.*\.(ts|json)$/ }, a => {
                const file = path.relative(process.cwd(), a.path);
                let contents = stage === 'current' ? fs.readFileSync(file, 'utf8') : sources[file] ?? fs.readFileSync(file, 'utf8');
                if (stage === 'archive') {
                    if (file.endsWith('/Logger.ts')) contents = fs.readFileSync(file, 'utf8');
                    if (file.endsWith('/TimeCoordinator.ts')) contents = contents.replace('        ports.effects.syncEquipmentStatuses();', "        if (!ports.world.player.hasStatus('paralyzed')) logger.turn++;\n        ports.effects.syncEquipmentStatuses();");
                }
                inputs[file] = sha(contents);
                return { contents, loader: file.endsWith('.json') ? 'json' : 'ts' };
            }); } };
            let observer = head(`src/test/u_r${unit}_trace.test.ts`)
                .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
                .replace(/const fixture = new URL\([^;]+;/, 'const fixture=process.argv[2];');
            if (unit === 3) {
                // Same input objects and original raw hashes; additionally audit every
                // non-message field (including both RNG streams and machine observations).
                observer = observer.replace(/createHash\('sha256'\)\.update\(JSON.stringify\((\{[^\n]+\})\)\)\.digest\('hex'\)/g, 'auditHash($1)');
                observer += `\nwriteFileSync(process.argv[2]+'.semantics.json', JSON.stringify(auditRows));\n`;
                observer = `const auditRows=[]; function auditHash(payload) {
                    const clean=JSON.parse(JSON.stringify(payload));
                    const logs=clean.log; delete clean.log;
                    const latch=clean.snapshot.run.receivedLevitationWarning;
                    delete clean.snapshot.run.logger; delete clean.snapshot.run.receivedLevitationWarning;
                    auditRows.push({worldHash:createHash('sha256').update(JSON.stringify(clean)).digest('hex'),logs,latch});
                    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
                }\n` + observer;
            }
            const filename = `${out}/ur${unit}-${stage}.json${unit === 2 ? '' : '.gz'}`;
            await build({ stdin: { contents: observer, resolveDir: path.resolve('src/test'), loader: 'ts' }, outfile: `${work}/trace.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [plugin] });
            const result = spawnSync(process.execPath, [`${work}/trace.mjs`, filename], { env: { ...process.env, [`UR${unit}_CAPTURE`]: '1' }, stdio: 'inherit' });
            assert.equal(result.status, 0, `UR${unit} ${stage}`);
            fs.writeFileSync(`${out}/ur${unit}-inputs-${stage}.json`, JSON.stringify(inputs, null, 2)+'\n');
            console.log(`UR${unit} ${stage} captured`);
        }
        const ext = unit === 2 ? '' : '.gz';
        const original = execFileSync('git', ['show', `HEAD:brogue-web/ai_docs/reports/u-r${unit}-trace.json${ext}`], { maxBuffer: 16e6 });
        assert.deepEqual(read(`${out}/ur${unit}-head.json${ext}`), JSON.parse(ext ? gunzipSync(original) : original));
        for (const [from,to] of [['head','archive'],['archive','current']]) {
            const suffix = unit === 3 ? '.semantics.json' : '';
            const delta = diffs(read(`${out}/ur${unit}-${from}.json${ext}${suffix}`), read(`${out}/ur${unit}-${to}.json${ext}${suffix}`));
            const outsideLog = delta.filter(d => !/\/(log|logger|logs)\//.test(d.path));
            results.push({ unit, from, to, count: delta.length, outsideLog, differences: delta });
            assert.deepEqual(outsideLog, [], 'Difference outside message history');
            console.log(`UR${unit}: ${from} -> ${to}: ${delta.length} log-only differences`);
        }
    }
    fs.writeFileSync(`${out}/trace-attribution.json`, JSON.stringify(results,null,2)+'\n');
} finally { fs.rmSync(work, { recursive:true, force:true }); }
