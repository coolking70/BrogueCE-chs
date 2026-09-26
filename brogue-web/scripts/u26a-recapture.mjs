import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
const out = 'ai_docs/reports/u-26a-evidence';
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if (fs.existsSync(`${out}/recapture.json`)) throw Error('One-time baseline recapture already registered');
const before = JSON.parse(fs.readFileSync(`${out}/baseline-before.json`));
const shallow = 'src/test/fixtures/generation_baseline.json', deep = 'src/test/fixtures/deep_generation_baseline.json';
assert.equal(sha(shallow), before[shallow]);
const rows = JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-final.json.gz`)));
const original = JSON.parse(fs.readFileSync(shallow));
const stage0 = JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-s0.json.gz`)));
const stages = JSON.parse(fs.readFileSync(`${out}/attribution.json`));
assert(stages.find(s => s.to === 'doors').shallowChanges.every(r => r.depth === 26));
assert.equal(stages.find(s => s.to === 'gems').shallowChanges.length, 0);
assert.equal(stages.find(s => s.to === 'final').shallowChanges.length, 0);
const shallowFields = r => ({ fp: r.fp, n: r.n, species: r.species, items: r.items });
// Preserve the legacy four-field rows; verify the capture method against HEAD first.
for (const r of stage0.filter(r => r.depth <= 26)) for (const k of ['fp', 'n', 'species', 'items'])
    assert.equal(r[k], original.levels[r.seed][r.depth - 1][k]);
const differences = rows.filter(r => r.depth <= 26).flatMap(r => ['fp', 'n', 'species', 'items']
    .filter(k => r[k] !== original.levels[r.seed][r.depth - 1][k]).map(field => ({ seed: r.seed, depth: r.depth, field,
        before: original.levels[r.seed][r.depth - 1][field], after: r[field] })));
assert(differences.every(r => r.depth === 26));
original.note = 'U26a: CE deepestLevel=40 door placement; only D26 changes. D1–25 unchanged; GEM population has zero D1–26 drift. D27–40 use a separate baseline. See u-26a.report.md.';
for (const seed of original.seeds) original.levels[seed] = rows.filter(r => r.seed === seed && r.depth <= 26).map(shallowFields);
fs.writeFileSync(shallow, JSON.stringify(original, null, 2) + '\n');
const deepRows = rows.filter(r => r.depth > 26).map(r => ({ seed: r.seed, depth: r.depth, ...shallowFields(r), gems: r.gems }));
fs.writeFileSync(deep, JSON.stringify({ note: 'U26a independent D27–40 baseline; fresh runs traverse D1–40 using the legacy capture method. Not a CE map identity oracle.', seeds: original.seeds, levels: deepRows }, null, 2) + '\n');
fs.writeFileSync(`${out}/recapture.json`, JSON.stringify({ shallow: { file: shallow, before: before[shallow], after: sha(shallow), writes: 1, differences },
    deep: { file: deep, before: null, after: sha(deep), layers: deepRows.length, writes: 1 } }, null, 2) + '\n');
console.log(`Captured shallow once (${differences.length} fields on D26); created independent ${deepRows.length}-layer deep baseline.`);
