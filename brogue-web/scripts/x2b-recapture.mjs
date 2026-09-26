import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2b-evidence';
const read=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(fs.readFileSync(p)):fs.readFileSync(p));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(fs.existsSync(`${out}/recapture.json`))throw Error('One-time recapture already registered');
const original=read(`${out}/baseline-before.json`);
for(const [p,h]of Object.entries(original))assert.equal(sha(p),h,`Untouched before capture: ${p}`);
const head=read(`${out}/generation-s0.json.gz`),final=read(`${out}/generation-guard.json.gz`);
assert(final.every(r=>r.mismatches.length===0));
const traces=read(`${out}/trace-attribution.json`);assert.equal(traces.length,3);assert(traces.every(t=>t.headMatchesGolden));
const shallow='src/test/fixtures/generation_baseline.json',deep='src/test/fixtures/deep_generation_baseline.json';
const sb=read(shallow),db=read(deep);
const four=r=>({fp:r.fp,n:r.n,species:r.species,items:r.items});
for(const r of head.filter(r=>r.depth<=26))assert.deepEqual(four(r),sb.levels[r.seed][r.depth-1]);
const deepRows=rows=>rows.filter(r=>r.depth>26).map(r=>({seed:r.seed,depth:r.depth,...four(r),gems:r.gems}));
assert.deepEqual(deepRows(head),db.levels);
const changes=final.flatMap((r,i)=>['fp','n','species','items',...(r.depth>26?['gems']:[])].filter(k=>JSON.stringify(r[k])!==JSON.stringify(head[i][k])).map(field=>({seed:r.seed,depth:r.depth,field,before:head[i][field],after:r[field]})));
const records=[];
if(changes.some(r=>r.depth<=26)) {
 sb.note='X2b: full-layer passability/opacity and CE passableArcCount consumers. Independently attributed; see x2b.report.md. D27–40 stay in their own fixture.';
 for(const seed of sb.seeds)sb.levels[seed]=final.filter(r=>r.seed===seed&&r.depth<=26).map(four);
 fs.writeFileSync(shallow,JSON.stringify(sb,null,2)+'\n');records.push({file:shallow,before:original[shallow],after:sha(shallow),writes:1,changes:changes.filter(r=>r.depth<=26)});
}
if(changes.some(r=>r.depth>26)) {
 db.note='X2b independent D27–40 baseline, full runs through D1–40. Full-layer flags and CE passableArcCount attribution in x2b.report.md; not a CE map-identity oracle.';
 db.levels=deepRows(final);fs.writeFileSync(deep,JSON.stringify(db,null,2)+'\n');
 records.push({file:deep,before:original[deep],after:sha(deep),writes:1,changes:changes.filter(r=>r.depth>26)});
}
// Invoke the original trace capture method only for changed goldens, once.
for(const n of [2,3,4]) {
 const suffix=`.json${n===2?'':'.gz'}`,p=`ai_docs/reports/u-r${n}-trace${suffix}`,candidate=read(`${out}/ur${n}-guard${suffix}`);
 if(JSON.stringify(candidate)===JSON.stringify(read(p))) {records.push({file:p,before:original[p],after:sha(p),writes:0});continue;}
 const fd=fs.openSync(`${out}/ur${n}-recapture.txt`,'w');
 const r=spawnSync('npx',['vitest','run',`src/test/u_r${n}_trace.test.ts`,'--maxWorkers=1'],{env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 assert.equal(r.status,0);assert.deepEqual(read(p),candidate);
 records.push({file:p,before:original[p],after:sha(p),writes:1,originalMethod:`UR${n}_CAPTURE=1 npx vitest run src/test/u_r${n}_trace.test.ts --maxWorkers=1`});
}
fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({time:new Date().toISOString(),records},null,2)+'\n');
console.log(records.map(({file,before,after,writes,changes})=>({file,before,after,writes,changes:changes?.length})));
