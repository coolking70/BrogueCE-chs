import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-03b-evidence';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const base=read('baseline-before'),control=read('stage-control');assert.deepEqual(control.levels,base.levels);
const stages=['control','follow','bridge','environment'];
const differences=(a,b,key)=>Object.keys(a[key]).flatMap(seed=>a[key][seed].flatMap((row,i)=>{
 const fields=Object.keys(row).filter(f=>JSON.stringify(row[f])!==JSON.stringify(b[key][seed][i][f]));
 return fields.length?[{seed,depthOrCheckpoint:i+1,fields}]:[];
}));
const transitions=stages.slice(1).map((stage,i)=>{
 const a=read(`stage-${stages[i]}`),b=read(`stage-${stage}`);
 return {from:stages[i],to:stage,baselineFields:differences(a,b,'levels'),generation:differences(a,b,'traces'),interaction:differences(a,b,'interaction')};
});
assert.deepEqual(transitions[0].baselineFields,[]);assert.deepEqual(transitions[0].generation,[]);
assert.deepEqual(transitions[1].baselineFields,[]);assert.deepEqual(transitions[1].generation,[]);
fs.writeFileSync(`${dir}/attribution.json`,JSON.stringify({controlMatchesBaseline:true,transitions},null,2)+'\n');
const fixture='src/test/fixtures/generation_baseline.json',hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(process.argv.includes('--recapture')) {
 const guards=read('guards3');assert.equal(guards.numFailedTests,0);assert.ok(guards.numPassedTests>=35);
 const probes=read('probes');assert.ok(probes.filter(p=>p.mode!=='head-graph').every(p=>p.status===1));
 assert.equal(hash(fixture),hash(`${dir}/baseline-before.json`));
 const beforeSHA256=hash(fixture),levels=read('stage-environment').levels;
 const next={...base,note:'U03b CE stair approach and environment catch-up (50/new, max 100/revisit); recaptured after separate follow/kernel/catch-up attribution. Original fp/n/species/items fields unchanged; full map/RNG and interaction evidence: ai_docs/reports/u-03b.report.md',levels};
 fs.writeFileSync(fixture,JSON.stringify(next,null,2)+'\n');
 fs.writeFileSync(`${dir}/recapture.json`,JSON.stringify({beforeSHA256,afterSHA256:hash(fixture),valuesUnchanged:JSON.stringify(levels)===JSON.stringify(base.levels),independentGuards:guards.numPassedTests,negativeControlsCaught:3},null,2)+'\n');
}
console.log(JSON.stringify(transitions.map(t=>({from:t.from,to:t.to,baselineFields:t.baselineFields.length,generation:t.generation.length,interaction:t.interaction.length}))));
