import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const dir='ai_docs/reports/u-18a-2-evidence';
const read=s=>JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${s}/generation.json.gz`)));
const stages=['s0','s1','s2','s3','s4a','s4b','s4c'],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));
const values=Object.fromEntries(stages.map(s=>[s,read(s)]));
for(const r of values.s0)for(const k of ['fp','n','species','items'])assert.equal(r[k],base.levels[r.seed][r.depth-1][k]);
const summary=[];
for(let i=1;i<stages.length;i++){
 const before=values[stages[i-1]],after=values[stages[i]];
 const changes=before.flatMap((r,j)=>{
  const fields=Object.keys(r).filter(k=>!same(r[k],after[j][k]));return fields.length?[{seed:r.seed,depth:r.depth,fields}]:[];
 });
 const fields={};for(const r of changes)for(const k of r.fields)fields[k]=(fields[k]??0)+1;
 const baselineChanges=changes.filter(r=>r.fields.some(k=>['fp','n','species','items'].includes(k)));
 summary.push({stage:stages[i],previous:stages[i-1],changedLayers:changes.length,fieldCounts:fields,baselineChangedLayers:baselineChanges.length,changes});
}
const entry=(stage)=>values[stage].find(r=>r.seed===20260913&&r.depth===6).entries[0].path;
const pathTrace=Object.fromEntries(['s1','s2','s3'].map(s=>{
 const p=entry(s),dist=p.scans[0].after;
 const qualifies=p.checks.filter(c=>c.result && dist[c.x]?.[c.y]>0 && dist[c.x]?.[c.y]<30000);
 const best=Math.min(...qualifies.map(c=>dist[c.x][c.y]));
 return [s,{target:p.target,best,ties:qualifies.filter(c=>dist[c.x][c.y]===best).map(({x,y})=>({x,y})),draws:p.draws,result:p.result}];
}));
const scanConsumers={};
// Compare every observed call, retaining unmatched/new input rather than assuming equality.
for(let i=0;i<values.s2.length;i++){
 const a=values.s2[i].scans,b=values.s3[i].scans;
 for(let j=0;j<Math.max(a.length,b.length);j++){
  const r=a[j],s=b[j],name=s?.caller??r?.caller;
  const n=scanConsumers[name]??={calls:0,identicalInput:0,outputChangedForIdenticalInput:0,allOutputsEqual:0};n.calls++;
  if(r&&s&&r.caller===s.caller&&r.cost===s.cost&&r.before===s.before){n.identicalInput++;if(r.after!==s.after)n.outputChangedForIdenticalInput++;}
  if(r&&s&&r.after===s.after)n.allOutputsEqual++;
 }
}
const candidates=values.s1.map(r=>({seed:r.seed,depth:r.depth,removed:r.entries.flatMap(e=>e.removed),added:r.entries.flatMap(e=>e.added),rngBefore:r.entries.map(e=>e.before)}));
fs.writeFileSync(`${dir}/attribution.json`,JSON.stringify({summary,pathTrace,scanConsumers,step1Removed:candidates.reduce((n,r)=>n+r.removed.length,0),candidates},null,2)+'\n');
console.log(summary.map(({changes,...r})=>r));console.log(scanConsumers);
