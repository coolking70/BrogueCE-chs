/** Original capture methods, permitted only after the R3-only production
 * counterfactual passes every affected old guard and both old baselines. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
const out='ai_docs/reports/x4-r3-evidence',raw='output/x4-r3';
const read=f=>JSON.parse(f.endsWith('.gz')?gunzipSync(fs.readFileSync(f)):fs.readFileSync(f));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(!fs.existsSync(`${out}/recapture.json`),'Do not recapture twice');
const state=read(`${out}/initial-state.json`);
for(const [f,sha] of Object.entries(state.fixtures)) assert.equal(hash(f),sha,f);
const proof=read(`${raw}/counterfactual-old-tests.json`);
assert.equal(proof.numFailedTests,0);assert.equal(proof.success,true);
assert(read(`${out}/counterfactual-results.json`).filter(r=>r.label!=='final-original-traces').every(r=>r.exit===0));
const manifest=read(`${out}/counterfactual-manifest.json`);
for(const row of [...manifest.sources,...manifest.added]) assert.equal(hash(row.file),row.final,row.file);
const old=read(`${raw}/generation-head.json.gz`),now=read(`${raw}/generation-final.json.gz`);
const shallow='src/test/fixtures/generation_baseline.json',deep='src/test/fixtures/deep_generation_baseline.json';
const sb=read(shallow),db=read(deep);
const four=r=>({fp:r.fp,n:r.n,species:r.species,items:r.items});
const deepRows=rows=>rows.filter(r=>r.depth>26).map(r=>({seed:r.seed,depth:r.depth,...four(r),gems:r.gems}));
assert.equal(old.length,160);assert.equal(now.length,160);
for(const r of old.filter(r=>r.depth<=26)) assert.deepEqual(four(r),sb.levels[r.seed][r.depth-1]);
assert.deepEqual(deepRows(old),db.levels);
const changes=now.flatMap((r,i)=>{
    assert.deepEqual([r.seed,r.depth],[old[i].seed,old[i].depth]);
    return ['fp','n','species','items',...(r.depth>26?['gems']:[])]
        .filter(k=>JSON.stringify(r[k])!==JSON.stringify(old[i][k]))
        .map(k=>({seed:r.seed,depth:r.depth,field:k,before:old[i][k],after:r[k]}));
});
fs.writeFileSync(`${out}/generation-field-changes.json`,JSON.stringify(changes,null,2)+'\n');
fs.writeFileSync(`${out}/generation-diagnostics.json`,JSON.stringify(now.map((r,i)=>({seed:r.seed,depth:r.depth,
    changedLayerSlots:r.layers.filter((tile,k)=>tile!==old[i].layers[k]).length,
    substantiveDraws:{before:old[i].rng.randomNumbersGenerated,after:r.rng.randomNumbersGenerated},
    aggravationScrolls:r.itemKinds.filter(k=>k==='scroll_of_aggravate_monsters').length,
})),null,2)+'\n');
const records=[];
for(const [f,base,levels] of [[shallow,sb,Object.fromEntries(sb.seeds.map(seed=>[seed,now.filter(r=>r.seed===seed&&r.depth<=26).map(four)]))],
    [deep,db,deepRows(now)]]) {
    const changed=JSON.stringify(base.levels)!==JSON.stringify(levels);
    if(changed) {
        base.levels=levels;
        base.note='X4-R3: restore SCROLL_AGGRAVATE_MONSTER base frequency 15 and flavor allocation. R3-only production rollback exactly reproduces old fixtures; original full-run capture method. See x4-r3.report.md.';
        fs.writeFileSync(f,JSON.stringify(base,null,2)+'\n');
    }
    records.push({file:f,before:state.fixtures[f],after:hash(f),writes:changed?1:0});
}
function differences(a,b,path='$',result=[]) {
    if(Object.is(a,b)) return result;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)) {
        for(const key of new Set([...Object.keys(a),...Object.keys(b)])) differences(a[key],b[key],`${path}.${key}`,result);
    } else result.push({path,before:a??null,after:b??null});
    return result;
}
const failed=read(`${raw}/final-original-traces.json`).testResults.filter(t=>t.status==='failed').map(t=>t.name.replaceAll('\\','/'));
for(const n of [2,3,4]) {
    const f=`ai_docs/reports/u-r${n}-trace.json${n===2?'':'.gz'}`;
    if(!failed.some(name=>name.endsWith(`/u_r${n}_trace.test.ts`))) {
        records.push({file:f,before:state.fixtures[f],after:hash(f),writes:0});continue;
    }
    const before=read(f),log=`${raw}/ur${n}-recapture.log`,fd=fs.openSync(log,'w');
    const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',`src/test/u_r${n}_trace.test.ts`,'--maxWorkers=1'],{
        env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:['ignore',fd,fd],windowsHide:true});
    fs.closeSync(fd);assert.equal(r.status,0,log);
    fs.writeFileSync(log,fs.readFileSync(log,'utf8').replace(/\r\n/g,'\n'));
    const delta=differences(before,read(f));
    fs.writeFileSync(`${out}/ur${n}-leaf-changes.json.gz`,gzipSync(JSON.stringify(delta)));
    records.push({file:f,before:state.fixtures[f],after:hash(f),writes:1,changedLeaves:delta.length,
        originalMethod:`UR${n}_CAPTURE=1 node node_modules/vitest/vitest.mjs run src/test/u_r${n}_trace.test.ts --maxWorkers=1`});
}
fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({time:new Date().toISOString(),generationFields:changes.length,records},null,2)+'\n');
console.log(JSON.stringify(records,null,2));
