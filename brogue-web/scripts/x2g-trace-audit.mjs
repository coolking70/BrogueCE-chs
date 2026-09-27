import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
const out='ai_docs/reports/x2g-evidence';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-traces-'));
try {
 for(const stage of (process.argv.slice(2).length?process.argv.slice(2):['s0','lichen','darkness','rot','submerged','pool','review'])) {
  const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
  for(const n of [3]) {
   let source=fs.readFileSync(`src/test/u_r${n}_trace.test.ts`,'utf8')
    .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
    .replace(/const fixture = new URL\([^;]+;/,'const fixture = process.argv[2];');
   source = source.replace(/createHash\('sha256'\)\.update\(JSON\.stringify\((\{[^;]+?)\)\)\.digest\('hex'\)/g, 'inspectPayload($1)');
   source += `
function inspectPayload(payload: any) {
 const sha = (v: any) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const copy = JSON.parse(JSON.stringify(payload));
 const changes: any[] = [];
 const clean = (v: any, path = '') => {
  if (!v || typeof v !== 'object') return;
  if ('submerged' in v) {changes.push({path, submerged:v.submerged, id:v.id, typeId:v.typeId}); delete v.submerged;}
  if (v.category === 2 && typeof v.consumableId === 'string') {
   const kind:any={path};
   for(const k of ['identityId','consumableId','name','color','description']) {kind[k]=v[k];delete v[k];}
   changes.push(kind);
  }
  for(const [k,c] of Object.entries(v)) clean(c,path+'/'+k);
 };
 clean(copy);
 return {originalHash:sha(payload), canonicalHash:sha(copy),
 canonicalParts:Object.fromEntries(Object.entries(copy.snapshot).map(([k,v])=>[k,sha(v)])),
 rngHash:sha(copy.rng), log:copy.log, observationsHash:sha(copy.observations??null), observations:payload.observations, changes};
}

`;
   await build({stdin:{contents:source,resolveDir:path.resolve('src/test'),loader:'ts'},outfile:`${tmp}/trace.mjs`,bundle:true,platform:'node',format:'esm',
    plugins:[{name:'single-variable',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{
     const f=path.relative(process.cwd(),a.path);if(!(f in sources))return;
     return {contents:sources[f],loader:f.endsWith('.json')?'json':'ts'};
    });}}]});
   const r=spawnSync(process.execPath,[`${tmp}/trace.mjs`,`${out}/ur${n}-audit-${stage}.json${n===2?'':'.gz'}`],{env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:'inherit'});
   if(r.status)throw Error(`UR${n}/${stage} failed`);
   console.log(`Captured UR${n}/${stage}`);
  }
 }
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
