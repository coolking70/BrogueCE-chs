// Exactly one fixture rewrite, guarded by completed single-variable observations
// and a fresh final capture equal to attributed stage d. Reruns refuse to overwrite.
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {build}from'esbuild';import{execFileSync}from'node:child_process';
const dir='ai_docs/reports/u-02b-evidence',fixture='src/test/fixtures/generation_baseline.json';
assert.ok(!fs.existsSync(`${dir}/baseline-hashes.json`),'already recaptured');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const stages=Object.fromEntries(['before','a','b','c','d'].map(s=>[s,JSON.parse(fs.readFileSync(`${dir}/stage-${s}/comparison.json`))]));
assert.equal(stages.before.low.fields,0);assert.equal(stages.a.low.fields,0);assert.equal(stages.d.low.fields,0);
execFileSync('node',['scripts/u02b-audit.mjs']);
await build({entryPoints:['scripts/u02b-stage-probe.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/u02b-final-capture.mjs',logLevel:'silent'});
const raw=execFileSync('node',['/tmp/u02b-final-capture.mjs'],{encoding:'utf8',maxBuffer:64*1024*1024});
const rows=JSON.parse(raw.split('U02B_RESULT ')[1]);assert.deepEqual(rows,JSON.parse(fs.readFileSync(`${dir}/stage-d/rows.json`)));
fs.writeFileSync(`${dir}/final-capture.json`,JSON.stringify(rows,null,2)+'\n');
const before=fs.readFileSync(fixture,'utf8'),head=execFileSync('git',['show',`HEAD:brogue-web/${fixture}`],{encoding:'utf8'});assert.equal(before,head);
const baseline=JSON.parse(before),diffs=[];
for(const seed of baseline.seeds){
 const old=baseline.levels[seed];baseline.levels[seed]=rows[seed].map((r,i)=>Object.fromEntries(['fp','n','species','items'].map(k=>{if(r[k]!==old[i][k])diffs.push({seed,depth:i+1,field:k,before:old[i][k],after:r[k]});return[k,r[k]];})));
}
baseline.note='U02b CE uint64 and per-level seed isolation; four-stage attribution: ai_docs/reports/u-02b.report.md';
const after=JSON.stringify(baseline,null,2)+'\n';
fs.writeFileSync(`${dir}/baseline-before.json`,before);fs.writeFileSync(fixture,after);
fs.writeFileSync(`${dir}/baseline-hashes.json`,JSON.stringify({fixture,before:hash(before),after:hash(after),test:hash(fs.readFileSync('src/test/generation_baseline.test.ts')),recaptures:1,changedLayers:new Set(diffs.map(d=>`${d.seed}/${d.depth}`)).size,changedFields:diffs.length,diffs},null,2)+'\n');
console.log(JSON.stringify({before:hash(before),after:hash(after),layers:new Set(diffs.map(d=>`${d.seed}/${d.depth}`)).size,fields:diffs.length}));
