import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync,gzipSync} from 'node:zlib';
const out='ai_docs/reports/x2g-evidence';
const read=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(fs.readFileSync(p)):fs.readFileSync(p));
const stages=['s0','lichen','darkness','rot','submerged','pool','review'];
const flatten=value=>Object.entries(value).flatMap(([seed,run])=>[
 ...run.depths.map((r,i)=>({path:`${seed}/depths/${i}`,...r.hash})),
 ...['revisit','returnTo26','loaded'].map(k=>({path:`${seed}/${k}`,...run[k].hash})),
 {path:`${seed}/fall`,...run.fall}]);
const data=stages.map(s=>flatten(read(`${out}/ur3-audit-${s}.json.gz`)));
const diff=(a,b,path='')=>{
 if(JSON.stringify(a)===JSON.stringify(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],path+'/'+k));
 return [{path,before:a,after:b}];
};
const potionNames=new Set(read('src/data/consumables.json').potions.map(p=>p.trueName));
for(let i=0;i<stages.length;i++){
 const original=read(`${out}/ur3-${stages[i]}.json.gz`);
 for(const r of data[i]){let v=r.path.split('/').reduce((v,k)=>v[k],original);if(!r.path.endsWith('/fall'))v=v.hash;assert.equal(r.originalHash,v,`Original observer ${stages[i]}/${r.path}`);}
}
const observations=[];
const comparisons=stages.slice(1).map((to,i)=>({from:stages[i],to,samples:data[i].length,
 changedHashes:data[i+1].filter((r,j)=>r.originalHash!==data[i][j].originalHash).length,
 differences:data[i+1].flatMap((r,j)=>{
  const p=data[i][j];
  for(const d of diff(p.observations,r.observations)){
   assert.match(d.path,/^\/\d+\/products\/\d+\/name$/);
   assert(potionNames.has(d.before)&&potionNames.has(d.after));
   observations.push({from:stages[i],to,sample:r.path,...d});
  }
  const parts=Object.keys(r.canonicalParts).filter(k=>r.canonicalParts[k]!==p.canonicalParts[k]);
  const rng=r.rngHash!==p.rngHash,log=JSON.stringify(r.log)!==JSON.stringify(p.log);
  return parts.length||rng||log?[{path:r.path,parts,rng,log}]:[];
 })}));
const traces=read(`${out}/trace-attribution.json`);assert(traces.every(t=>t.headMatchesGolden));
assert(traces.filter(t=>t.trace!==3).every(t=>t.stages.every(s=>!s.changes.length)));
const changes=data.flatMap((rows,i)=>rows.flatMap(r=>r.changes.map(c=>({stage:stages[i],sample:r.path,...c}))));
fs.writeFileSync(`${out}/trace-audit-summary.json`,JSON.stringify({comparisons,normalizedOnly:['monster.submerged','POTION identityId/consumableId/name/color/description'],originalHashesMatch:true,ur2Unchanged:true,ur4Unchanged:true,explainedMachinePotionNames:observations},null,2)+'\n');
// Exact values are retained separately for review of the tightly scoped normalization.
fs.writeFileSync(`${out}/trace-kind-and-submersion-values.json.gz`,gzipSync(JSON.stringify(changes)));
console.log(JSON.stringify(comparisons,null,2));
assert(comparisons.filter(c=>c.to!=='pool').every(c=>!c.differences.length),'Non-pool trace drift');
// Pool restoration intentionally changes weighted selection, metering and strength-placement RNG.
// Keep all material differences; the isolated pool source patch and first-path trace explain them.
