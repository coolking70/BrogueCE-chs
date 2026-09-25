import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-18a-3-evidence';const stages=['s0','s5a','s5b','s5c','s5d','s5e','s6a','s6b','s6c','s6d','s6e','s6f','s6g','s7a','s7b','s7c','s7d','s8','s8b','s8c'];
const rows=s=>JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${s}/generation.json.gz`)));
const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));for(const r of rows('s0'))for(const k of ['fp','n','species','items'])assert.equal(r[k],base.levels[r.seed][r.depth-1][k]);
const summary=[];
for(let i=1;i<stages.length;i++){
 const before=rows(stages[i-1]),after=rows(stages[i]);
 const changes=before.flatMap((r,j)=>{const fields=Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(after[j][k]));return fields.length?[{seed:r.seed,depth:r.depth,fields}]:[];});
 const fields={};for(const r of changes)for(const f of r.fields)fields[f]=(fields[f]??0)+1;
 summary.push({stage:stages[i],previous:stages[i-1],changedLayers:changes.length,baselineChangedLayers:changes.filter(r=>r.fields.some(f=>['fp','n','species','items'].includes(f))).length,fieldCounts:fields,changes});
}
fs.writeFileSync(`${dir}/attribution.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary.map(({changes,...r})=>r));
