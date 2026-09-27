import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/x2g-evidence';
const read=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(fs.readFileSync(p)):fs.readFileSync(p));
const stages=['s0','lichen','darkness','rot','submerged','pool','review'];
const changes=[];
for(let i=1;i<stages.length;i++) {
 const before=read(`${out}/generation-${stages[i-1]}.json.gz`),after=read(`${out}/generation-${stages[i]}.json.gz`);
 const fields=after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field})));
 changes.push({from:stages[i-1],to:stages[i],shallow:fields.filter(r=>r.depth<=26),deep:fields.filter(r=>r.depth>26),mismatches:after.reduce((n,r)=>n+r.mismatches.length,0)});
}
fs.writeFileSync(`${out}/generation-attribution.json`,JSON.stringify(changes,null,2)+'\n');
const diff=(a,b,p='')=>{
 if(JSON.stringify(a)===JSON.stringify(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],`${p}/${k}`));
 return [p];
};
const traces=[];
for(const n of [2,3,4]) {
 const suffix=`.json${n===2?'':'.gz'}`;
 const original=execFileSync('git',['show',`HEAD:brogue-web/ai_docs/reports/u-r${n}-trace${suffix}`],{maxBuffer:16*1024*1024});
 const golden=JSON.parse(n===2?original:gunzipSync(original));
 if(!stages.every(s=>fs.existsSync(`${out}/ur${n}-${s}${suffix}`)))continue;
 traces.push({trace:n,headMatchesGolden:diff(read(`${out}/ur${n}-s0${suffix}`),golden).length===0,
  stages:stages.slice(1).map((s,i)=>({from:stages[i],to:s,changes:diff(read(`${out}/ur${n}-${stages[i]}${suffix}`),read(`${out}/ur${n}-${s}${suffix}`))}))});
}
fs.writeFileSync(`${out}/trace-attribution.json`,JSON.stringify(traces,null,2)+'\n');
console.log(changes.map(r=>({from:r.from,to:r.to,shallow:r.shallow.length,deep:r.deep.length,mismatches:r.mismatches})), traces.map(r=>({trace:r.trace,headMatchesGolden:r.headMatchesGolden,stages:r.stages.map(s=>({to:s.to,changes:s.changes.length}))})));
