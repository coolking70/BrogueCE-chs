import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
const out='ai_docs/reports/x2e-evidence';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2e-traces-'));
try {
 for(const stage of (process.argv.slice(2).length?process.argv.slice(2):['s0','effects','pool'])) {
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
 const kinds: any[] = [];
 const clean = (v: any, path = '') => {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v.identifiedItems)) v.identifiedItems = v.identifiedItems.filter((id: string) => !id.startsWith('charm_of_'));
  if (v.flavors?.arcana) v.flavors.arcana = v.flavors.arcana.filter((r: any[]) => !r[0].startsWith('charm_of_'));
  if (v.category === 9 && v.identityId?.startsWith('charm_of_')) {
   kinds.push({path, id:v.id, identityId:v.identityId, name:v.name, color:v.color, cooldownTurns:v.cooldownTurns});
   for (const key of ['identityId','name','color','cooldownTurns']) delete v[key];
  }
  for (const [key, child] of Object.entries(v)) clean(child, path + '/' + key);
 };
 clean(copy);
 return {originalHash:sha(payload), canonicalHash:sha(copy),
  canonicalParts:Object.fromEntries(Object.entries(copy.snapshot).map(([k,v]) => [k,sha(v)])),
  rngHash:sha(copy.rng),log:copy.log,observationsHash:sha(copy.observations??null),observations:payload.observations,
  identifiedItems:payload.snapshot.identifiedItems,arcana:payload.snapshot.flavors.arcana,kinds};
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
