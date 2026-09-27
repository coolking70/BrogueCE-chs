import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
const out='ai_docs/reports/x2j-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2j-traces-'));
const read=f=>JSON.parse(f.endsWith('.gz')?gunzipSync(fs.readFileSync(f)):fs.readFileSync(f,'utf8'));
const diff=(a,b,p='')=>JSON.stringify(a)===JSON.stringify(b)?[]:
 !a||!b||typeof a!=='object'||typeof b!=='object'?[p]:[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p+'.'+k));
const stages=process.argv.slice(2).length?process.argv.slice(2):['head','projected','current'];
try {
 for(const stage of stages) for(const n of [2,3,4]) {
  let source=fs.readFileSync(`src/test/u_r${n}_trace.test.ts`,'utf8')
   .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
   .replace(/const fixture = new URL\([^;]+;/,'const fixture = process.argv[2];');
  if(stage==='projected') {
   source="function project(v) {if (!v || typeof v !== 'object') return; if (Array.isArray(v)) {v.forEach(project);return;} delete v.mapToMe;delete v.lastSeenPlayerAt;delete v.monsterPathCache;Object.values(v).forEach(project);}\n"+source;
   source=source.replace(/const (snapshot|state|fallSnapshot) = (game|falling)\.toSnapshot\(\);/g,'const $1 = $2.toSnapshot(); project($1);');
  }
  await build({stdin:{contents:source,resolveDir:path.resolve('src/test'),loader:'ts'},outfile:`${tmp}/trace.mjs`,bundle:true,platform:'node',format:'esm',
   plugins:stage!=='head'?[]:[{name:'head',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{
    const file=path.relative(process.cwd(),a.path),head=path.join('/private/tmp/x2j-head/brogue-web',file);
    if(fs.existsSync(head))return {contents:fs.readFileSync(head,'utf8'),loader:file.endsWith('.json')?'json':'ts'};
   });}}]});
  const file=`${out}/ur${n}-${stage}.json${n===2?'':'.gz'}`;
  const r=spawnSync(process.execPath,[`${tmp}/trace.mjs`,file],{env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:'inherit'});
  if(r.status)throw Error(`UR${n}/${stage} failed`);
  const golden=`ai_docs/reports/u-r${n}-trace.json${n===2?'':'.gz'}`;
  const differences=diff(read(file),read(golden));
  fs.writeFileSync(`${out}/ur${n}-${stage}-diff.json`,JSON.stringify({stage,n,equal:!differences.length,changedPaths:differences},null,2)+'\n');
  console.log(`UR${n}/${stage}: ${differences.length} changed paths`);
 }
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
