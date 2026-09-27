import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2o-evidence';
const read=f=>JSON.parse(f.endsWith('.gz')?gunzipSync(fs.readFileSync(f)):fs.readFileSync(f));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(!fs.existsSync(`${out}/recapture.json`),'One-time captures already registered');
const before=read(`${out}/baseline-before.json`);
for(const [f,sha] of Object.entries(before))assert.equal(hash(f),sha,`Unchanged until capture: ${f}`);
for(const [f,source] of Object.entries(read(`${out}/sources-depth.json`)))assert.equal(fs.readFileSync(f,'utf8'),source);
assert.equal(read(`${out}/targeted.json`).numFailedTests,0);
assert.equal(read(`${out}/negatives.json`).length,5);
assert(read(`${out}/negatives.json`).every(r=>r.exit===1&&r.failures.length));
const attribution=read(`${out}/attribution.json`);
assert.equal(attribution.length,2);assert.equal(attribution[0].shallow.length,0);assert(attribution[0].deep.length>0);
assert.equal(attribution[1].shallow.length+attribution[1].deep.length,0);
assert(attribution.every(a=>a.traces.every(t=>t.headMatchesGolden)));
const old=read(`${out}/generation-s0.json.gz`),rows=read(`${out}/generation-depth.json.gz`);
const shallow='src/test/fixtures/generation_baseline.json',deep='src/test/fixtures/deep_generation_baseline.json';
const sb=read(shallow),db=read(deep);
const four=r=>({fp:r.fp,n:r.n,species:r.species,items:r.items});
const deepRows=rows=>rows.filter(r=>r.depth>26).map(r=>({seed:r.seed,depth:r.depth,...four(r),gems:r.gems}));
for(const r of old.filter(r=>r.depth<=26))assert.deepEqual(four(r),sb.levels[r.seed][r.depth-1]);
assert.deepEqual(deepRows(old),db.levels);
const changes=rows.flatMap((r,i)=>['fp','n','species','items',...(r.depth>26?['gems']:[])].filter(k=>JSON.stringify(r[k])!==JSON.stringify(old[i][k])).map(field=>({seed:r.seed,depth:r.depth,field,before:old[i][field],after:r[field]})));
for(const seed of sb.seeds)sb.levels[seed]=rows.filter(r=>r.seed===seed&&r.depth<=26).map(four);
// Shallow capture intentionally preserves its metadata and bytes when no fields drift.
fs.writeFileSync(shallow,JSON.stringify(sb,null,2)+'\n');
db.note='X2o independent D27–40 baseline. All CE horde member clumps restored; blueprint depth limits have separately proven zero generation impact. Full D1–40 capture; not a CE map identity oracle.';
db.levels=deepRows(rows);fs.writeFileSync(deep,JSON.stringify(db,null,2)+'\n');
const records=[shallow,deep].map(f=>({file:f,before:before[f],after:hash(f),writes:1,changes:changes.filter(r=>f===shallow?r.depth<=26:r.depth>26)}));
for(const n of [2,3,4]){
 const suffix=`.json${n===2?'':'.gz'}`,f=`ai_docs/reports/u-r${n}-trace${suffix}`,candidate=read(`${out}/ur${n}-depth${suffix}`);
 if(JSON.stringify(candidate)===JSON.stringify(read(f))){records.push({file:f,before:before[f],after:hash(f),writes:0});continue;}
 const log=fs.openSync(`${out}/ur${n}-recapture.txt`,'w');
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',`src/test/u_r${n}_trace.test.ts`,'--maxWorkers=1'],{env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:['ignore',log,log]});fs.closeSync(log);
 assert.equal(r.status,0);assert.deepEqual(read(f),candidate);
 records.push({file:f,before:before[f],after:hash(f),writes:1,originalMethod:`UR${n}_CAPTURE=1`});
}
fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({time:new Date().toISOString(),records},null,2)+'\n');
console.log(records.map(r=>({...r,changes:r.changes?.length})));
