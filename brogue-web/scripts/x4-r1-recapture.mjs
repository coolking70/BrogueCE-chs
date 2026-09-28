/** One-time baseline refresh, gated by unchanged old fixtures + R1-only HEAD
 * counterfactual passing the original guards. No expectation changes here.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/x4-r1-evidence';
const read = file => JSON.parse(file.endsWith('.gz') ? gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert(!fs.existsSync(`${out}/recapture.json`), 'Already recaptured; do not silently record twice');
const before = read(`${out}/baseline-before.json`);
for (const [file, sha] of Object.entries(before)) assert.equal(hash(file), sha, `Original fixture changed: ${file}`);
const proof = read(`${out}/counterfactual-old-tests.json`);
assert.equal(proof.numFailedTests, 0);
assert(proof.numPassedTests > 0);
assert(read(`${out}/counterfactual-results.json`).every(row => row.exit === 0));
assert.equal(read(`${out}/targeted.json`).numFailedTests, 0);
for (const row of read(`${out}/counterfactual-manifest.json`)) assert.equal(hash(row.file), row.final);
const old = read(`${out}/generation-head.json.gz`), now = read(`${out}/generation-final.json.gz`);
const shallow = 'src/test/fixtures/generation_baseline.json', deep = 'src/test/fixtures/deep_generation_baseline.json';
const sb = read(shallow), db = read(deep);
const four = row => ({fp:row.fp, n:row.n, species:row.species, items:row.items});
const deepRows = rows => rows.filter(row => row.depth > 26).map(row => ({seed:row.seed, depth:row.depth, ...four(row), gems:row.gems}));
for (const row of old.filter(row => row.depth <= 26)) assert.deepEqual(four(row), sb.levels[row.seed][row.depth-1]);
assert.deepEqual(deepRows(old), db.levels);
assert.equal(old.length, 160); assert.equal(now.length, 160);
const changes = now.flatMap((row, i) => {
    assert.deepEqual([row.seed,row.depth], [old[i].seed,old[i].depth]);
    return ['fp','n','species','items',...(row.depth>26?['gems']:[])].filter(field => JSON.stringify(row[field])!==JSON.stringify(old[i][field]))
        .map(field => ({seed:row.seed, depth:row.depth, field, before:old[i][field], after:row[field],
            reason:'R1 real POD/HAY/URINE/JUNK/BURNED_CARPET plus STALK priority/growth: R1-only production HEAD rollback exactly reproduces old fixture'}));
});
fs.writeFileSync(`${out}/generation-field-changes.json`,JSON.stringify(changes,null,2)+'\n');
const terrainChanges = now.map((row,i) => ({seed:row.seed,depth:row.depth,
    changedLayerSlots:row.layers.filter((tile,k)=>tile!==old[i].layers[k]).length,
    counts:Object.fromEntries([...new Set([...Object.keys(row.terrain),...Object.keys(old[i].terrain)])]
        .filter(name => (row.terrain[name]??0)!==(old[i].terrain[name]??0))
        .map(name => [name,{before:old[i].terrain[name]??0,after:row.terrain[name]??0}])),
    substantiveDraws:{before:old[i].rng.randomNumbersGenerated,after:row.rng.randomNumbersGenerated},
}));
fs.writeFileSync(`${out}/generation-terrain-changes.json`,JSON.stringify(terrainChanges,null,2)+'\n');
const records = [];
for (const [file, base, levels] of [[shallow,sb,Object.fromEntries(sb.seeds.map(seed => [seed,now.filter(row=>row.seed===seed && row.depth<=26).map(four)]))], [deep,db,deepRows(now)]]) {
    const changed = JSON.stringify(base.levels)!==JSON.stringify(levels);
    if (changed) {
        base.levels=levels;
        base.note='X4-R1: real bloodwort pods, hay, urine, junk and burned carpet; CE stalk growth/priority. R1-only production rollback reproduces old fixtures. Original full-run capture method; see x4-r1.report.md.';
        fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n');
    }
    records.push({file,before:before[file],after:hash(file),writes:changed?1:0});
}
const failed = read(`${out}/initial-test.json`).testResults.filter(t=>t.status==='failed').map(t=>t.name.replaceAll('\\','/'));
function differences(a,b,path='$',result=[]) {
    if (Object.is(a,b)) return result;
    if (a && b && typeof a==='object' && typeof b==='object' && Array.isArray(a)===Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a),...Object.keys(b)])) differences(a[key],b[key],`${path}.${key}`,result);
    } else result.push({path,before:a ?? null,after:b ?? null});
    return result;
}
for (const n of [2,3,4]) {
    const file=`ai_docs/reports/u-r${n}-trace.json${n===2?'':'.gz'}`;
    if (!failed.some(name=>name.endsWith(`/u_r${n}_trace.test.ts`))) {
        records.push({file,before:before[file],after:hash(file),writes:0}); continue;
    }
    const oldTrace=read(file), log=`${out}/ur${n}-recapture.log`,fd=fs.openSync(log,'w');
    const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',`src/test/u_r${n}_trace.test.ts`,'--maxWorkers=1'], {
        env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:['ignore',fd,fd],windowsHide:true,
    });
    fs.closeSync(fd); assert.equal(r.status,0,log);
    fs.writeFileSync(log,fs.readFileSync(log,'utf8').replace(/\r\n/g,'\n'));
    const delta=differences(oldTrace,read(file));
    fs.writeFileSync(`${out}/ur${n}-leaf-changes.json.gz`,gzipSync(JSON.stringify(delta)));
    records.push({file,before:before[file],after:hash(file),writes:1,changedLeaves:delta.length,
        originalMethod:`UR${n}_CAPTURE=1 node node_modules/vitest/vitest.mjs run src/test/u_r${n}_trace.test.ts --maxWorkers=1`,
        reason:'Only R1 production rollback passes original trace; complete leaf changes retained in evidence'});
}
fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({time:new Date().toISOString(),generationFields:changes.length,records},null,2)+'\n');
console.log(JSON.stringify(records));
